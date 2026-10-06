# Speech voices

The upload dialog offers 14 curated US English voices with Google's catalog gender labels, plain-language quality descriptions, and a recorded sample. Neural2 female is the default for new deployments. Existing documents keep their chosen voice and cached audio. `TTS_VOICES` may restrict or extend the enabled voice IDs; leaving it empty uses the curated catalog. Custom identifiers receive a readable fallback label.

| Family     | Choices                             | Intended use                                | Price per million characters after free allowance |
| ---------- | ----------------------------------- | ------------------------------------------- | ------------------------------------------------- |
| Neural2    | F/H female, D/J male                | Natural speech; recommended for assessments | $16                                               |
| Chirp 3 HD | Aoede/Kore female, Charon/Puck male | Expressive HD speech                        | $30                                               |
| WaveNet    | F female, D male                    | Economical neural speech                    | $4                                                |
| Studio     | O female, Q male                    | Studio narration; highest processing cost   | $160                                              |
| Standard   | C female, D male                    | Economical standard speech                  | $4                                                |

Catalog and pricing checked October 5, 2026 against [Google's supported voices](https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types), [Chirp 3 HD documentation](https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd), [pricing](https://cloud.google.com/text-to-speech/pricing), and the project's live `voices.list` response. Prices and availability can change. Samples were actually synthesized for every offered voice.

Gemini TTS, custom voice cloning, and experimental multispeaker models are outside this assessment reader's single-speaker cached MP3 workflow. No student request generates speech. Playback speed is controlled locally, so it works across the supported families without changing the generated voice settings.

Samples are bundled locally under `public/voices/`. To regenerate the same synthetic samples, use `PROJECT_ID=your-project GCP_ACCOUNT=your-account node --import tsx scripts/generate-voice-samples.ts`. This makes 14 bounded Google synthesis requests and never reads uploaded assessments. It uses explicit account/project flags and does not change gcloud's active account or ADC configuration.
