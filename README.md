# SOE Reader

SOE Reader turns digital assessment PDFs into a timed, anonymous reader with cached speech. Teachers sign in through their own Internal Google OAuth application, upload a PDF, preview the result, and share an access link. Students see the original PDF and click mapped passages to hear prerecorded audio.

The application is a standalone Next.js/React service, with an IAM-protected Cloud Run worker, Cloud Tasks, Firestore, private Cloud Storage, and Google Cloud Text-to-Speech. No institution domain, hosting URL, project ID, credentials, or teacher allowlist is embedded in the source.

## Local demo

Requires Node 24 and npm. The checked-in synthetic PDF and matching MP3s work without cloud credentials.

```sh
npm ci
npm run setup:local
npm run fixture
```

Start these in two terminals:

```sh
npm run dev
```

```sh
npm run worker:local
```

Open `http://127.0.0.1:3000`, choose **Open demo workspace**, and open the seeded assessment. Teacher preview opens before the student window. Copy the student link into another browser/private session to try anonymous playback. A second demo account demonstrates owner isolation.

The local worker polls a durable SQLite queue and must remain running. Uploading the fixture uses its matching clips; other local PDFs use an explicitly identified mock clip. Local mode never performs live TTS. Local adapters and demo sign-in are rejected when `NODE_ENV=production` or `K_SERVICE` is present. Ordinary production builds cannot enable demo auth.

`npm run fixture` seeds a fresh demo record. On a new checkout it uses the already committed audio; regenerating changed audio requires macOS `say` and `ffmpeg`. The PDF fixture is downloadable from `/fixture.pdf` and contains no actual assessment/student data.

## Verification

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium webkit
# Keep the explicit local worker running for these checks:
npm run test:e2e
```

Unit/service tests cover time boundaries, UTC conversion/DST ambiguity, ownership, token encryption and rotation, byte ranges, PDF segmentation/geometry, rapid-click media fencing, quotas, checkpoint reuse, task leases, duplicate deliveries, stale versions, malformed PDFs, and pages missing a text layer. Browser checks exercise upload-to-Ready, owner preview, actual MP3 playback, pause, zoom, rotation, page navigation, anonymous reload, Disable Now, and a second account.

See [deployment](docs/DEPLOYMENT.md), [architecture and limits](docs/ARCHITECTURE.md), and [native SEB acceptance](docs/SEB-ACCEPTANCE.md).

## Workflow

1. Sign in with the configured Internal Google OAuth client. Every accepted account may upload and manage its own PDFs.
2. Upload a digital PDF and set title, voice, opening time, closing time, and an explicit IANA timezone.
3. The durable worker extracts literal text, creates stable passage IDs/rectangles, and generates all MP3s in bounded batches.
4. Ready means the manifest and every required audio object exist. Preview is protected by owner authentication and does not open anonymous access early.
5. Share the generated fragment link. Each new manifest/PDF/audio/policy request requires a current document capability and checks Ready, enabled, and `availableAt <= serverNow < expiresAt`.
6. Edit availability, disable access, replace a link, retry processing, or delete the PDF and audio from the dashboard.

Scanned/encrypted/malformed files and pages lacking readable text are rejected. Mathematical notation is read literally and flagged for preview; OCR and mathematical interpretation are not implemented. Review every assessment’s extracted passages before distribution. Complex tables, unusual PDF text order, and more than two columns may need a clearer PDF export.

## Licensing

MIT. The adapted Paper Voice sentence-boundary function retains its upstream copyright and license in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). PDF.js is pinned and its worker, fonts, CMaps, decoder assets, and stylesheet are served locally.
