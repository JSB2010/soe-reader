#!/usr/bin/env bash
set -euo pipefail
: "${PROJECT_ID:?Set PROJECT_ID}" "${GCP_ACCOUNT:?Set GCP_ACCOUNT}" "${GOOGLE_OAUTH_CLIENT_ID:?Set the Internal OAuth web client ID}"
REGION=${REGION:-us-central1}
WEB_SERVICE=${WEB_SERVICE:-soe-reader-web}
GOOGLE_OAUTH_SECRET_NAME=${GOOGLE_OAUTH_SECRET_NAME:-reader-google-oauth}
gc() { gcloud "$@" --account="$GCP_ACCOUNT" --project="$PROJECT_ID" --quiet; }
gc secrets describe "$GOOGLE_OAUTH_SECRET_NAME" >/dev/null
gc secrets add-iam-policy-binding "$GOOGLE_OAUTH_SECRET_NAME" --member="serviceAccount:reader-web@$PROJECT_ID.iam.gserviceaccount.com" --role=roles/secretmanager.secretAccessor >/dev/null
gc run services update "$WEB_SERVICE" --region="$REGION" --update-env-vars="GOOGLE_OAUTH_CLIENT_ID=$GOOGLE_OAUTH_CLIENT_ID" --update-secrets="GOOGLE_OAUTH_CLIENT_SECRET=$GOOGLE_OAUTH_SECRET_NAME:latest"
echo 'Internal OAuth credentials connected. Verify the Google Auth Platform audience is Internal, then test two accepted accounts.'
