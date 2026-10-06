#!/usr/bin/env bash
set -euo pipefail
: "${PROJECT_ID:?Set PROJECT_ID to your dedicated GCP project}"
: "${GCP_ACCOUNT:?Set GCP_ACCOUNT to the authorized deployment account}"
REGION=${REGION:-us-central1}
REPOSITORY=${REPOSITORY:-soe-reader}
BUCKET=${BUCKET:-${PROJECT_ID}-reader-assets}
BUILD_BUCKET=${BUILD_BUCKET:-${PROJECT_ID}-reader-build-source}
gc() { gcloud "$@" --account="$GCP_ACCOUNT" --project="$PROJECT_ID" --quiet; }
INITIAL_ACCOUNT=$(gcloud config get-value account 2>/dev/null)
gc services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com firestore.googleapis.com storage.googleapis.com cloudtasks.googleapis.com texttospeech.googleapis.com secretmanager.googleapis.com iam.googleapis.com iamcredentials.googleapis.com logging.googleapis.com firebaserules.googleapis.com
for identity in reader-web reader-worker reader-tasks reader-build; do
  gc iam service-accounts describe "$identity@$PROJECT_ID.iam.gserviceaccount.com" >/dev/null 2>&1 || gc iam service-accounts create "$identity" --display-name="SOE Reader $identity"
done
gc firestore databases describe --database='(default)' >/dev/null 2>&1 || gc firestore databases create --database='(default)' --location="$REGION" --type=firestore-native --delete-protection
for destination in "$BUCKET" "$BUILD_BUCKET"; do
  gc storage buckets describe "gs://$destination" >/dev/null 2>&1 || gc storage buckets create "gs://$destination" --location="$REGION" --uniform-bucket-level-access --public-access-prevention
done
mkdir -p .data/deploy
cat > .data/deploy/build-lifecycle.json <<'JSON'
{"rule":[{"action":{"type":"Delete"},"condition":{"age":3}}]}
JSON
gc storage buckets update "gs://$BUILD_BUCKET" --lifecycle-file=.data/deploy/build-lifecycle.json
gc artifacts repositories describe "$REPOSITORY" --location="$REGION" >/dev/null 2>&1 || gc artifacts repositories create "$REPOSITORY" --repository-format=docker --location="$REGION"
for identity in reader-web reader-worker; do
  gc projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$identity@$PROJECT_ID.iam.gserviceaccount.com" --role=roles/datastore.user --condition=None >/dev/null
  gc projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$identity@$PROJECT_ID.iam.gserviceaccount.com" --role=roles/cloudtasks.enqueuer --condition=None >/dev/null
  gc iam service-accounts add-iam-policy-binding "reader-tasks@$PROJECT_ID.iam.gserviceaccount.com" --member="serviceAccount:$identity@$PROJECT_ID.iam.gserviceaccount.com" --role=roles/iam.serviceAccountUser >/dev/null
done
gc storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:reader-web@$PROJECT_ID.iam.gserviceaccount.com" --role=roles/storage.objectAdmin >/dev/null
gc storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:reader-worker@$PROJECT_ID.iam.gserviceaccount.com" --role=roles/storage.objectUser >/dev/null
gc projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:reader-worker@$PROJECT_ID.iam.gserviceaccount.com" --role=roles/serviceusage.serviceUsageConsumer --condition=None >/dev/null
gc artifacts repositories add-iam-policy-binding "$REPOSITORY" --location="$REGION" --member="serviceAccount:reader-build@$PROJECT_ID.iam.gserviceaccount.com" --role=roles/artifactregistry.writer >/dev/null
gc storage buckets add-iam-policy-binding "gs://$BUILD_BUCKET" --member="serviceAccount:reader-build@$PROJECT_ID.iam.gserviceaccount.com" --role=roles/storage.objectViewer >/dev/null
gc projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:reader-build@$PROJECT_ID.iam.gserviceaccount.com" --role=roles/logging.logWriter --condition=None >/dev/null
if ! gc secrets describe reader-app-key >/dev/null 2>&1; then
  gc secrets create reader-app-key --replication-policy=automatic
  node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))' | gc secrets versions add reader-app-key --data-file=- >/dev/null
fi
for identity in reader-web reader-worker; do
  gc secrets add-iam-policy-binding reader-app-key --member="serviceAccount:$identity@$PROJECT_ID.iam.gserviceaccount.com" --role=roles/secretmanager.secretAccessor >/dev/null
done
gc tasks queues describe reader-processing --location="$REGION" >/dev/null 2>&1 || gc tasks queues create reader-processing --location="$REGION"
gc tasks queues update reader-processing --location="$REGION" --max-dispatches-per-second=2 --max-concurrent-dispatches=2 --max-attempts=12 --min-backoff=10s --max-backoff=300s --max-retry-duration=3600s >/dev/null
node scripts/apply-firestore-rules.mjs
gc logging sinks describe _Default --format=json > .data/deploy/log-sink.json
if ! node --input-type=commonjs -e 'const s=require("./.data/deploy/log-sink.json");process.exit((s.exclusions||[]).some(e=>e.name==="reader-oauth-callbacks")?0:1)'; then
  gc logging sinks update _Default --add-exclusion='name=reader-oauth-callbacks,filter=resource.type="cloud_run_revision" AND httpRequest.requestUrl:"/api/auth/callback"'
fi
test "$(gcloud config get-value account 2>/dev/null)" = "$INITIAL_ACCOUNT"
echo 'Infrastructure provisioned. Active gcloud account preserved.'
