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
TTS_VOICES: "${TTS_VOICES:-en-US-Standard-C,en-US-Standard-D}"
YAML
cp .data/deploy/common.env.yaml .data/deploy/worker.env.yaml
echo 'SERVICE_ROLE: worker' >> .data/deploy/worker.env.yaml
gc run deploy "$WORKER_SERVICE" --image="$IMAGE" --region="$REGION" --service-account="reader-worker@$PROJECT_ID.iam.gserviceaccount.com" --env-vars-file=.data/deploy/worker.env.yaml --set-secrets=APP_SECRET_KEY=reader-app-key:latest --no-allow-unauthenticated --memory=1Gi --cpu=1 --concurrency=1 --min-instances=0 --max-instances=2 --timeout=300 --port=8080
WORKER_URL=$(gc run services describe "$WORKER_SERVICE" --region="$REGION" --format='value(status.url)')
gc run services update "$WORKER_SERVICE" --region="$REGION" --update-env-vars="WORKER_URL=$WORKER_URL"
gc run services add-iam-policy-binding "$WORKER_SERVICE" --region="$REGION" --member="serviceAccount:reader-tasks@$PROJECT_ID.iam.gserviceaccount.com" --role=roles/run.invoker >/dev/null
cp .data/deploy/common.env.yaml .data/deploy/web.env.yaml
printf 'SERVICE_ROLE: web\nWORKER_URL: "%s"\n' "$WORKER_URL" >> .data/deploy/web.env.yaml
# Preserve configured OAuth across later deploys without putting any secret in this checkout.
if gc run services describe "$WEB_SERVICE" --region="$REGION" --format=json > .data/deploy/existing-web.json 2>/dev/null; then
  node --input-type=commonjs -e 'const fs=require("fs"),s=JSON.parse(fs.readFileSync(".data/deploy/existing-web.json"));const e=s.spec.template.spec.containers[0].env||[];for(const x of e)if(x.name==="GOOGLE_OAUTH_CLIENT_ID")fs.appendFileSync(".data/deploy/web.env.yaml",`GOOGLE_OAUTH_CLIENT_ID: ${JSON.stringify(x.value)}\n`);'
fi
SECRETS=APP_SECRET_KEY=reader-app-key:latest
OAUTH_SECRET_NAME=${GOOGLE_OAUTH_SECRET_NAME:-reader-google-oauth}
if gc secrets describe "$OAUTH_SECRET_NAME" >/dev/null 2>&1; then SECRETS="$SECRETS,GOOGLE_OAUTH_CLIENT_SECRET=$OAUTH_SECRET_NAME:latest"; fi
gc run deploy "$WEB_SERVICE" --image="$IMAGE" --region="$REGION" --service-account="reader-web@$PROJECT_ID.iam.gserviceaccount.com" --env-vars-file=.data/deploy/web.env.yaml --set-secrets="$SECRETS" --allow-unauthenticated --memory=512Mi --cpu=1 --concurrency=8 --min-instances=0 --max-instances=3 --timeout=60 --port=8080
WEB_URL=$(gc run services describe "$WEB_SERVICE" --region="$REGION" --format='value(status.url)')
if [ "$APP_ORIGIN" = 'https://example.invalid' ]; then APP_ORIGIN=$WEB_URL; fi
gc run services update "$WEB_SERVICE" --region="$REGION" --update-env-vars="APP_ORIGIN=$APP_ORIGIN"
gc run services update "$WORKER_SERVICE" --region="$REGION" --update-env-vars="APP_ORIGIN=$APP_ORIGIN"
test "$(gcloud config get-value account 2>/dev/null)" = "$INITIAL_ACCOUNT"
echo "Web: $WEB_URL"
echo "OAuth redirect: $APP_ORIGIN/api/auth/callback"
echo 'Active gcloud account preserved. Internal OAuth configuration is required before teacher sign-in.'
