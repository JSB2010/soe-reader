# Deploy to Google Cloud

Use a dedicated project with billing enabled and an authorized account. Every script passes the account and project explicitly; none changes gcloud's global configuration or Application Default Credentials.

```sh
export PROJECT_ID=your-project
export GCP_ACCOUNT=your-authorized-account
export REGION=us-central1
bash scripts/provision.sh
bash scripts/deploy.sh
```

Provisioning creates a regional Firestore Native database with deletion protection, deny-all browser rules, private buckets with public access prevention and uniform access, four service accounts, a throttled Cloud Tasks queue, Artifact Registry, and a random 32-byte application key in Secret Manager. The build-source bucket deletes staging files after three days. No VM, persistent worker, or paid minimum instance is created.

Deploying builds one Docker image through Cloud Build with an explicit build identity and runs that image as web and worker services. The worker is protected by Cloud Run IAM and additionally verifies the task OIDC identity/audience. Cloud Tasks uses the dedicated task identity. The public web shell verifies its own teacher sessions and reader capabilities.

Defaults: worker 1 GiB/one CPU/concurrency one/maximum two instances, web 512 MiB/one CPU/concurrency eight/maximum three instances, both minimum zero. Request-based billing is used. Queue maximum two concurrent deliveries and two dispatches per second; synthesis inside each batch is sequential with bounded transient retries. Monitor billing and adjust these limits for expected usage. There are no always-on resources.

## IAM

| Identity        | Scope and roles                                                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reader-web`    | Project `datastore.user` and `cloudtasks.enqueuer`; private asset bucket `storage.objectAdmin`; task identity `iam.serviceAccountUser`; only application/OAuth secrets `secretmanager.secretAccessor`  |
| `reader-worker` | Project `datastore.user`, `cloudtasks.enqueuer`, `serviceusage.serviceUsageConsumer`; private asset bucket `storage.objectUser`; task identity `iam.serviceAccountUser`; application key secret access |
| `reader-tasks`  | `run.invoker` on the worker service only                                                                                                                                                               |
| `reader-build`  | Artifact repository `artifactregistry.writer`, build-source bucket `storage.objectViewer`, project `logging.logWriter`                                                                                 |

The Cloud Tasks service agent receives the platform-managed role used to mint OIDC tokens. No service-account key files are created. Operators need project provisioning permissions and permission to attach the explicit runtime/build identities. Firestore server SDKs bypass browser rules, so all dashboard routes perform their own verified-user ownership checks.

## Configure Internal Google sign-in

The printed deployment URL is `APP_ORIGIN`. A custom HTTPS hostname may instead be supplied through the `APP_ORIGIN` environment variable when deploying. Configure DNS/Cloud Run custom hosting separately if desired.

1. Open **Google Auth Platform** for your project in Cloud Console. Create the application branding/contact information and set **Audience → Internal**. The project must belong to your school/organization. The public app code does not impose a domain filter.
2. Create a **Web application** OAuth client. Its authorized redirect URI is exactly:

   ```text
   https://YOUR_APP_ORIGIN/api/auth/callback
   ```

   Only `openid email profile` scopes are used. No browser API key or Firebase/Identity Platform provider is needed.

3. Copy the client ID. Store the client secret in a project Secret Manager secret named `reader-google-oauth`. Use Console's secret entry field or a secure file/stdin; avoid putting the secret in shell history, chat, source, or an environment file committed to Git.
4. Connect it:

   ```sh
   export GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
   bash scripts/configure-oauth.sh
   ```

   `PROJECT_ID` and `GCP_ACCOUNT` must still be set. An alternative existing secret name can be supplied through `GOOGLE_OAUTH_SECRET_NAME`.

5. Verify `/api/health` reports `authConfigured: true`, then sign in using two accounts accepted by the actual Internal application. Upload/preview each account’s own PDF and confirm the other account cannot list, preview, obtain links for, modify, or delete it. Also check an account outside the organization is rejected by Google's Internal OAuth policy.

The Google sign-in web client is configured in Console, not through IAP OAuth-client CLI commands. See [Google's client setup instructions](https://support.google.com/cloud/answer/15549257) and [Internal audience configuration](https://support.google.com/cloud/answer/15544987). Missing client configuration fails closed. The deployment remains available for public shell/health checks, while teacher APIs and sign-in are unavailable.

Application-key rotation invalidates encrypted sessions, capabilities, and stored copyable links unless stored token ciphertexts are migrated. Retain the current key version and plan a deliberate migration before rotating it. Link replacement is independent and immediately invalidates the old token/capability.

The default logging sink excludes OAuth callback request URLs so one-use authorization codes/state are not retained. Share bearer tokens occur only in fragments/POST bodies and cookies; they never appear in asset URLs. No analytics, external fonts, or third-party reader assets are loaded.

## Redeploy and rollback

Run `scripts/deploy.sh` again with the same project/account and original `APP_ORIGIN` if using a custom hostname. Existing Google client ID and the configured OAuth Secret Manager secret are preserved. Change runtime limits/settings with explicit-account/project `gcloud run services update` commands or extend the environment YAML generated under ignored `.data/deploy`.

Each image tag is its immutable Cloud Build ID. Cloud Run retains previous revisions; roll back traffic to the previous compatible web/worker revisions with explicit-account/project `gcloud run services update-traffic`. Metadata/manifest version is currently `1`; review compatibility before introducing future schema changes.

Avoid logging URLs, cookies, PDF text, or provider response bodies in custom diagnostics. Keep buckets private; student and owner assets should only be obtained through protected web routes. Review storage retention and delete expired assessments through the dashboard. Deletion marks a tombstone before removing objects so delayed jobs cannot restore access.
