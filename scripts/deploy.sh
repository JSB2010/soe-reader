#!/usr/bin/env bash
set -euo pipefail
: "${PROJECT_ID:?Set PROJECT_ID}" "${GCP_ACCOUNT:?Set GCP_ACCOUNT}"
REGION=${REGION:-us-central1}
REPOSITORY=${REPOSITORY:-soe-reader}
BUCKET=${BUCKET:-${PROJECT_ID}-reader-assets}
BUILD_BUCKET=${BUILD_BUCKET:-${PROJECT_ID}-reader-build-source}
WEB_SERVICE=${WEB_SERVICE:-soe-reader-web}
WORKER_SERVICE=${WORKER_SERVICE:-soe-reader-worker}
gc() { gcloud "$@" --account="$GCP_ACCOUNT" --project="$PROJECT_ID" --quiet; }
INITIAL_ACCOUNT=$(gcloud config get-value account 2>/dev/null)
mkdir -p .data/deploy
# Read existing configuration before deploying. Custom origins and limits survive a plain redeploy.
if ! gc run services describe "$WEB_SERVICE" --region="$REGION" --format=json > .data/deploy/existing-web.json 2>.data/deploy/describe-error.txt; then
  if ! node --input-type=commonjs -e 'process.exit(/NOT_FOUND|was not found/.test(require("fs").readFileSync(".data/deploy/describe-error.txt","utf8"))?0:1)'; then
    echo 'Unable to read the existing web configuration; deployment stopped to preserve it.' >&2
    exit 1
  fi
  printf '{}' > .data/deploy/existing-web.json
fi
retained() { node --input-type=commonjs -e 'const s=JSON.parse(require("fs").readFileSync(".data/deploy/existing-web.json"));console.log((s.spec?.template?.spec?.containers?.[0]?.env||[]).find(e=>e.name===process.argv[1])?.value||"")' "$1"; }
APP_ORIGIN=${APP_ORIGIN:-$(retained APP_ORIGIN)}
TTS_VOICES=${TTS_VOICES:-$(retained TTS_VOICES)}
DEFAULT_TIMEZONE=${DEFAULT_TIMEZONE:-$(retained DEFAULT_TIMEZONE)}
BUILD_ID=$(gc builds submit --config=cloudbuild.yaml --substitutions="_REGION=$REGION,_REPOSITORY=$REPOSITORY" --service-account="projects/$PROJECT_ID/serviceAccounts/reader-build@$PROJECT_ID.iam.gserviceaccount.com" --gcs-source-staging-dir="gs://$BUILD_BUCKET/source" --async --format='value(id)')
echo "Build submitted: $BUILD_ID"
while true; do
  STATUS=$(gc builds describe "$BUILD_ID" --format='value(status)')
  case "$STATUS" in SUCCESS) break;; FAILURE|TIMEOUT|CANCELLED|EXPIRED|INTERNAL_ERROR) echo "Build failed: $STATUS" >&2; exit 1;; esac
  sleep 15
done
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/app:$BUILD_ID"
APP_ORIGIN=${APP_ORIGIN:-https://example.invalid}
cat > .data/deploy/common.env.yaml <<YAML
APP_MODE: cloud
APP_ORIGIN: "$APP_ORIGIN"
GOOGLE_CLOUD_PROJECT: "$PROJECT_ID"
GCP_REGION: "$REGION"
STORAGE_BUCKET: "$BUCKET"
TASK_QUEUE: reader-processing
TASK_SERVICE_ACCOUNT: "reader-tasks@$PROJECT_ID.iam.gserviceaccount.com"
DEFAULT_TIMEZONE: "${DEFAULT_TIMEZONE:-America/Denver}"
TTS_VOICES: "${TTS_VOICES:-$(node --import tsx -e 'import {DEFAULT_VOICES} from "./lib/voices.ts";console.log(DEFAULT_VOICES.join(","))')}"
YAML
cp .data/deploy/common.env.yaml .data/deploy/worker.env.yaml
echo 'SERVICE_ROLE: worker' >> .data/deploy/worker.env.yaml
node --input-type=commonjs - <<'JS'
const fs=require("fs"),s=JSON.parse(fs.readFileSync(".data/deploy/existing-web.json"));
for(const e of s.spec?.template?.spec?.containers?.[0]?.env||[])if(e.value&&(e.name.startsWith("MAX_")||e.name==="WORKER_BATCH_SIZE"))fs.appendFileSync(".data/deploy/worker.env.yaml",`${e.name}: ${JSON.stringify(e.value)}\n`);
JS
gc run deploy "$WORKER_SERVICE" --image="$IMAGE" --region="$REGION" --service-account="reader-worker@$PROJECT_ID.iam.gserviceaccount.com" --env-vars-file=.data/deploy/worker.env.yaml --set-secrets=APP_SECRET_KEY=reader-app-key:latest --no-allow-unauthenticated --memory=1Gi --cpu=1 --concurrency=1 --min-instances=0 --max-instances=2 --timeout=300 --port=8080
WORKER_URL=$(gc run services describe "$WORKER_SERVICE" --region="$REGION" --format='value(status.url)')
gc run services update "$WORKER_SERVICE" --region="$REGION" --update-env-vars="WORKER_URL=$WORKER_URL"
gc run services add-iam-policy-binding "$WORKER_SERVICE" --region="$REGION" --member="serviceAccount:reader-tasks@$PROJECT_ID.iam.gserviceaccount.com" --role=roles/run.invoker >/dev/null
cp .data/deploy/common.env.yaml .data/deploy/web.env.yaml
printf 'SERVICE_ROLE: web\nWORKER_URL: "%s"\n' "$WORKER_URL" >> .data/deploy/web.env.yaml
# Preserve custom limits and OAuth identity/secret references without reading secret values.
node --input-type=commonjs - <<'JS'
const fs=require("fs"),s=JSON.parse(fs.readFileSync(".data/deploy/existing-web.json"));
const env=s.spec?.template?.spec?.containers?.[0]?.env||[];
for(const e of env)if(e.value && (e.name.startsWith("MAX_")||e.name==="WORKER_BATCH_SIZE")) {
 for(const file of ["web"])fs.appendFileSync(`.data/deploy/${file}.env.yaml`,`${e.name}: ${JSON.stringify(e.value)}\n`);
}
for(const e of env)if(e.name==="GOOGLE_OAUTH_CLIENT_ID"&&e.value)fs.appendFileSync(".data/deploy/web.env.yaml",`GOOGLE_OAUTH_CLIENT_ID: ${JSON.stringify(e.value)}\n`);
JS
SECRETS=APP_SECRET_KEY=reader-app-key:latest
OAUTH_SECRET_NAME=${GOOGLE_OAUTH_SECRET_NAME:-$(node --input-type=commonjs -e 'const s=JSON.parse(require("fs").readFileSync(".data/deploy/existing-web.json"));console.log((s.spec?.template?.spec?.containers?.[0]?.env||[]).find(e=>e.name==="GOOGLE_OAUTH_CLIENT_SECRET")?.valueFrom?.secretKeyRef?.name||"reader-google-oauth")')}
if gc secrets describe "$OAUTH_SECRET_NAME" >/dev/null 2>&1; then SECRETS="$SECRETS,GOOGLE_OAUTH_CLIENT_SECRET=$OAUTH_SECRET_NAME:latest"; fi
gc run deploy "$WEB_SERVICE" --image="$IMAGE" --region="$REGION" --service-account="reader-web@$PROJECT_ID.iam.gserviceaccount.com" --env-vars-file=.data/deploy/web.env.yaml --set-secrets="$SECRETS" --allow-unauthenticated --memory=512Mi --cpu=1 --concurrency=8 --min-instances=0 --max-instances=3 --timeout=60 --port=8080
WEB_URL=$(gc run services describe "$WEB_SERVICE" --region="$REGION" --format='value(status.url)')
if [ "$APP_ORIGIN" = 'https://example.invalid' ]; then APP_ORIGIN=$WEB_URL; fi
gc run services update "$WEB_SERVICE" --region="$REGION" --update-env-vars="APP_ORIGIN=$APP_ORIGIN"
gc run services update "$WORKER_SERVICE" --region="$REGION" --update-env-vars="APP_ORIGIN=$APP_ORIGIN"
test "$(gcloud config get-value account 2>/dev/null)" = "$INITIAL_ACCOUNT"
echo "Web: $WEB_URL"
echo "OAuth redirect: $APP_ORIGIN/api/auth/callback"
echo 'Active gcloud account preserved. Verify Google sign-in and reader access.'
