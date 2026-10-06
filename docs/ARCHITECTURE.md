# Architecture and limits

The same container runs in two roles. Web handles Google OAuth, encrypted HttpOnly sessions, account-owned uploads/metadata, reader sessions, and private asset delivery. Worker accepts only the configured task service identity and extracts/synthesizes cached speech. Cloud Tasks delivers durable, named tasks with OIDC authentication. Firestore stores bounded document metadata and daily owner usage; manifests and geometry live in private Cloud Storage.

Google authorization-code sign-in uses state, nonce, and PKCE. The server verifies the ID token signature, issuer, audience, email verification, nonce, and expiry. It derives ownership solely from Google's verified `sub`. Session lifetime is eight hours. Mutation endpoints enforce the configured exact Origin; cookies are HttpOnly, Secure in cloud mode, and SameSite. Internal access is Google's application-audience policy, without another unrestricted sign-in flow.

## Student capability

Share links use 256-bit random tokens in URL fragments. Firestore stores a SHA-256 lookup hash and AES-256-GCM encrypted token so owners can copy the link after a dashboard reload. The encryption key lives in Secret Manager. A POST exchanges the token for a document-scoped encrypted cookie, bound to the current token hash. The reader replaces the fragment with a non-secret document ID and reloads through the cookie. Capabilities last at most 12 hours or the original end time; changing a window earlier applies immediately on the server. Extending a window beyond an existing cookie's expiration requires opening the original link again.

Every policy/manifest/PDF/audio request rechecks the current Ready/enabled/window policy using server time. Owner preview instead checks the verified account and ownership. Audio paths must match a manifest segment. Range requests are parsed only after authorization; only one valid range is accepted. Responses are private/no-store. No signed public asset URLs, offline caches, browser storage access, student TTS, or service workers are used.

The reader checks policy every five seconds, pauses on visibility changes, rechecks on resume, and clears its PDF/text/audio at expiry. It computes the timeout from server timestamps and monotonic elapsed time, subtracting request/loading time conservatively. Disable Now refuses subsequent requests immediately; an already open reader clears on its next policy check.

Forwarding a valid link grants access during its window. PDF/audio bytes already delivered cannot be recalled. SEB/device restrictions must be configured independently.

## Worker durability

Each document has an immutable UUID version, deterministic segment IDs, persisted audio, durable progress, and a transactional 240-second processing lease. Duplicate deliveries cannot steal an active lease. Each task generates at most 12 missing clips and checkpoints after every stored MP3. Completed audio is reused. A continuation is durably queued before the current task acknowledges completion. If scheduling fails, the original delivery retries; there is no detached web-process job.

Worker task deadline is 240 seconds and container request timeout 300 seconds. A batch stops launching new synthesis after 130 seconds; provider calls have 15-second timeouts and at most three attempts. Extraction is bounded by bytes/pages/segments/characters. Retry exhaustion produces an actionable failed record. Owner retry resumes the same version's missing clips. Deleted/stale documents cannot transition to Ready, and metadata tombstones block old tasks.

Synthesis inputs are split by UTF-8 bytes below Google's [5,000-byte limit](https://docs.cloud.google.com/text-to-speech/quotas). Ready is committed only after validating every required audio reference. Student playback never contacts TTS.

## Defaults

All values below may be configured with environment variables.

| Variable                  | Default                                                |
| ------------------------- | ------------------------------------------------------ |
| `MAX_UPLOAD_BYTES`        | 12 MiB                                                 |
| `MAX_PAGES`               | 30                                                     |
| `MAX_SEGMENTS`            | 500                                                    |
| `MAX_DOCUMENT_CHARACTERS` | 60,000                                                 |
| `MAX_DOCUMENTS_PER_OWNER` | 30 non-deleted documents                               |
| `MAX_UPLOADS_PER_DAY`     | 10 uploads per owner per UTC day                       |
| `MAX_CHARACTERS_PER_DAY`  | 150,000 speech characters per owner per upload UTC day |
| `WORKER_BATCH_SIZE`       | 12 sequential clips                                    |
| `TTS_VOICES`              | `en-US-Standard-C,en-US-Standard-D`                    |
| `DEFAULT_TIMEZONE`        | `America/Denver`                                       |

The speech quota is reserved once before synthesis and remains charged for failed/retried uploads; retries cannot reset it. Whole-document deletion frees the library slot but does not reset daily usage. Limits apply to every account accepted by the Internal application. Access windows may last at most 31 days. DST gaps and repeated local times are rejected with explicit messages.

## PDF mapping

PDF.js 6.4.299 is pinned for extraction and viewing. Coordinates are PDF user-space rectangles, independent of screen density. The viewer transforms all four rectangle corners using the actual PDF.js viewport matrix, including PDF rotation, reader rotation, and zoom. Canvas pixel density changes only the raster backing size. Wrapped passages retain separate rectangles for each line. Stable IDs include the extraction version, page, source item indices, part index, and literal text.

Geometry first reconstructs lines, detects a two-column arrangement, and forms logical blocks. Question/answer labels always begin a new block. Paper Voice's MIT sentence-boundary heuristic preserves abbreviations and decimals; its academic content-removal/reflow is not used. Repeated passages are retained. Long blocks split to bounded clips; adjacent split clips can share a highlighted block and remain accessible using passage navigation. Very complex layouts need teacher preview. Scanned/partially textless pages are rejected; OCR is outside the MVP.

Playback uses one media element. Every click pauses and replaces its source, aborting the old media request, then calls `play()` directly from the user gesture. A generation counter fences late play promises. Pause/stop invalidate pending completions. Speed is local media playback rate; no resynthesis occurs.
