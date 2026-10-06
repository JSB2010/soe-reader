// Operator-only, bounded generation of public synthetic samples. Never uses assessment text.
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { VOICES } from "../lib/voices";
const { PROJECT_ID, GCP_ACCOUNT } = process.env;
if (!PROJECT_ID || !GCP_ACCOUNT)
  throw new Error("Set PROJECT_ID and GCP_ACCOUNT.");
const token = execFileSync(
  "gcloud",
  [
    "auth",
    "print-access-token",
    `--account=${GCP_ACCOUNT}`,
    `--project=${PROJECT_ID}`,
  ],
  { encoding: "utf8" },
).trim();
await mkdir("public/voices", { recursive: true });
for (const voice of VOICES) {
  const response = await fetch(
    "https://texttospeech.googleapis.com/v1/text:synthesize",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Goog-User-Project": PROJECT_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: {
          text: "Welcome to Safe Online Exam Reader. Select a passage to hear it read aloud, or press play to listen to the whole assessment.",
        },
        voice: { languageCode: "en-US", name: voice.id },
        audioConfig: { audioEncoding: "MP3" },
      }),
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Sample generation failed for ${voice.id} (${response.status}).`,
    );
  const result = await response.json();
  await writeFile(
    `public/voices/${voice.id}.mp3`,
    Buffer.from(result.audioContent, "base64"),
  );
  console.log(`Generated ${voice.family}: ${voice.name}`);
}
