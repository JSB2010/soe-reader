// Bounded operator integration test. It creates only a synthetic fixture and cleans it up.
// This deliberately does not bypass or claim to test Google teacher sign-in.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, webkit, expect } from "@playwright/test";
import { makeToken } from "../lib/security";
import type { ReaderDocument, Manifest } from "../lib/model";
const { PROJECT_ID, GCP_ACCOUNT, APP_ORIGIN, WORKER_URL, STORAGE_BUCKET } =
  process.env;
if (
  !PROJECT_ID ||
  !GCP_ACCOUNT ||
  !APP_ORIGIN ||
  !WORKER_URL ||
  !STORAGE_BUCKET
)
  throw new Error(
    "Set PROJECT_ID, GCP_ACCOUNT, APP_ORIGIN, WORKER_URL and STORAGE_BUCKET.",
  );
const health = await fetch(APP_ORIGIN + "/api/health");
if (!health.ok || !(await health.json()).ok)
  throw new Error(
    "Production web health failed; no validation resources created.",
  );
const gc = (args: string[]) =>
  execFileSync(
    "gcloud",
    [...args, `--account=${GCP_ACCOUNT}`, `--project=${PROJECT_ID}`, "--quiet"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim();
const accessToken = gc(["auth", "print-access-token"]);
Object.assign(process.env, {
  APP_MODE: "cloud",
  GOOGLE_CLOUD_PROJECT: PROJECT_ID,
  APP_SECRET_KEY: gc([
    "secrets",
    "versions",
    "access",
    "latest",
    "--secret=reader-app-key",
  ]),
});
const headers = {
  Authorization: `Bearer ${accessToken}`,
  "Content-Type": "application/json",
  "X-Goog-User-Project": PROJECT_ID,
};
const firestore = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
function value(v: unknown): unknown {
  if (v === null) return { nullValue: null };
  if (typeof v === "number") return { integerValue: String(v) };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(value) } };
  return { mapValue: { fields: fields(v as Record<string, unknown>) } };
}
function fields(v: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(v).map(([k, v]) => [k, value(v)]));
}
function decode(v: any): any {
  if ("integerValue" in v) return Number(v.integerValue);
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decode);
  return Object.fromEntries(
    Object.entries(v.mapValue?.fields || {}).map(([k, val]) => [
      k,
      decode(val),
    ]),
  );
}
async function cloud(path: string, method = "GET", data?: unknown) {
  const response = await fetch(firestore + "/" + path, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });
  if (!response.ok)
    throw new Error(`Firestore operation failed (${response.status}).`);
  return method === "DELETE" ? {} : response.json();
}
async function patch(id: string, update: Record<string, unknown>) {
  const query = Object.keys(update)
    .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join("&");
  await cloud(`documents/${id}?${query}`, "PATCH", { fields: fields(update) });
}
const token = makeToken(),
  now = Date.now(),
  doc: ReaderDocument = {
    id: randomUUID(),
    ownerId: `validation-${randomUUID()}`,
    version: randomUUID(),
    title: "Synthetic cloud integration fixture",
    status: "queued",
    enabled: true,
    availableAt: now + 300000,
    expiresAt: now + 600000,
    timezone: "UTC",
    voice: process.env.SMOKE_VOICE || "en-US-Neural2-F",
    createdAt: now,
    updatedAt: now,
    pdfBytes: 1,
    tokenHash: token.hash,
    encryptedToken: token.encrypted,
    pages: 0,
    totalSegments: 0,
    completedSegments: 0,
    warnings: [],
    error: null,
    leaseId: null,
    leaseUntil: 0,
    attempts: 0,
    quotaReserved: false,
  };
const usageId = `${doc.ownerId}:${new Date(now).toISOString().slice(0, 10)}`,
  prefix = `gs://${STORAGE_BUCKET}/documents/${doc.id}/`;
let createdTaskName: string | undefined;
const checks: Record<string, boolean | number> = {};
await mkdir(".data/deploy", { recursive: true });
try {
  await cloud(`usage/${usageId}`, "PATCH", {
    fields: fields({ uploads: 1, characters: 0 }),
  });
  await cloud(`documents/${doc.id}`, "PATCH", { fields: fields(doc) });
  gc([
    "storage",
    "cp",
    "fixtures/assessment.pdf",
    `${prefix}${doc.version}/original.pdf`,
  ]);
  const taskResponse = await fetch(
    `https://cloudtasks.googleapis.com/v2/projects/${PROJECT_ID}/locations/${process.env.GCP_REGION || "us-central1"}/queues/reader-processing/tasks`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        task: {
          dispatchDeadline: "240s",
          httpRequest: {
            httpMethod: "POST",
            url: `${WORKER_URL}/api/tasks/process`,
            headers: { "Content-Type": "application/json" },
            body: Buffer.from(
              JSON.stringify({
                documentId: doc.id,
                version: doc.version,
                generation: randomUUID(),
              }),
            ).toString("base64"),
            oidcToken: {
              serviceAccountEmail: `reader-tasks@${PROJECT_ID}.iam.gserviceaccount.com`,
              audience: WORKER_URL,
            },
          },
        },
      }),
    },
  );
  if (!taskResponse.ok)
    throw new Error(`Task creation failed (${taskResponse.status}).`);
  createdTaskName = (await taskResponse.json()).name;
  checks.realTaskCreated = true;
  let state: ReaderDocument | undefined;
  for (let n = 0; n < 60; n++) {
    const response = await cloud(`documents/${doc.id}`);
    state = decode({ mapValue: { fields: response.fields } });
    if (state?.status === "ready") break;
    if (state?.status === "failed")
      throw new Error(`Worker failed: ${state.error}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (state?.status !== "ready")
    throw new Error("Worker did not complete within the bounded smoke test.");
  checks.realGoogleSpeechReady = true;
  checks.cachedAudioSegments = state.completedSegments;
  console.log(
    `Real task/TTS integration Ready: ${state.completedSegments} cached clips.`,
  );
  const studentHeaders = {
    Origin: APP_ORIGIN,
    "Content-Type": "application/json",
  };
  const session = () =>
    fetch(APP_ORIGIN + "/api/reader/session", {
      method: "POST",
      headers: studentHeaders,
      body: JSON.stringify({ token: token.token }),
    });
  if ((await session()).status !== 403)
    throw new Error("Early access was not blocked.");
  checks.beforeStartDenied = true;
  const unauthWorker = await fetch(WORKER_URL + "/api/health");
  if (![401, 403].includes(unauthWorker.status))
    throw new Error("Worker was publicly accessible.");
  checks.workerIamProtected = true;
  await patch(doc.id, {
    availableAt: Date.now() - 60000,
    expiresAt: Date.now() + 600000,
  });
  const opened = await session();
  if (!opened.ok) throw new Error("Student capability exchange failed.");
  const capCookie = opened.headers.get("set-cookie")!.split(";")[0];
  const asset = async (name: string, more: Record<string, string> = {}) =>
    fetch(`${APP_ORIGIN}/api/reader/${doc.id}/${name}`, {
      headers: { Cookie: capCookie, ...more },
    });
  const pdf = await asset("pdf", { Range: "bytes=0-3" });
  if (pdf.status !== 206 || (await pdf.text()) !== "%PDF")
    throw new Error("Authorized PDF range failed.");
  checks.privatePdfRange = true;
  const manifestResponse = await asset("manifest");
  if (!manifestResponse.ok) throw new Error("Manifest unavailable.");
  const manifest: Manifest = await manifestResponse.json();
  const clip = await asset(manifest.segments[0].audio);
  if (!clip.ok || (await clip.arrayBuffer()).byteLength < 100)
    throw new Error("Cached MP3 unavailable.");
  checks.cachedAudioDelivered = true;
  checks.audioDurationsPresent = manifest.segments.every(
    (s) => !!s.durationSeconds && s.durationSeconds > 0,
  );
  if (!checks.audioDurationsPresent)
    throw new Error("New audio duration metadata is missing.");
  const wrongPath = await asset("audio/" + "0".repeat(32) + ".mp3");
  if (wrongPath.status !== 404)
    throw new Error("Changed audio path was not rejected.");
  checks.changedAssetPathDenied = true;
  const unauthorized = await fetch(`${APP_ORIGIN}/api/reader/${doc.id}/pdf`, {
    headers: { Range: "bytes=0-3" },
  });
  if (unauthorized.status !== 401)
    throw new Error("Unauthenticated range was accepted.");
  checks.unauthorizedRangeDenied = true;
  for (const [name, engine] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ] as const) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({
          viewport: { width: 1365, height: 950 },
        }),
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${APP_ORIGIN}/read#${token.token}`);
      await expect(page.locator(".speech-region").first()).toBeVisible();
      await page
        .getByRole("button", { name: /Read: 1\. Dr\. Rivera/ })
        .first()
        .click();
      await expect(
        page.getByRole("button", { name: "Pause speech" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Pause speech" }).click();
      await page.getByRole("button", { name: "Zoom in", exact: true }).click();
      await page.getByRole("button", { name: "Rotate page clockwise" }).click();
      await page.reload();
      await expect(page.locator(".speech-region").first()).toBeVisible();
      await page.screenshot({
        path: `/private/tmp/soe-cloud-reader-${name}.png`,
        fullPage: false,
      });
      if (errors.length) throw new Error(`Browser runtime errors in ${name}.`);
      checks[`${name}LivePlayback`] = true;
      await patch(doc.id, { enabled: false });
      await expect(page.locator(".pdf-page canvas")).toHaveCount(0, {
        timeout: 12000,
      });
      checks[`${name}DisableClears`] = true;
      await patch(doc.id, { enabled: true });
    } finally {
      await browser.close();
    }
  }
  await patch(doc.id, { expiresAt: Date.now() + 8000 });
  const expiryBrowser = await chromium.launch();
  try {
    const page = await expiryBrowser.newPage();
    await page.goto(`${APP_ORIGIN}/read#${token.token}`);
    await expect(page.locator(".speech-region").first()).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "This assessment has ended." }),
    ).toBeVisible({ timeout: 12000 });
    checks.openReaderExpires = true;
  } finally {
    await expiryBrowser.close();
  }
  if (
    (await session()).status !== 403 ||
    (await asset("manifest")).status !== 403
  )
    throw new Error("Expired content was delivered.");
  checks.expiryDenied = true;
  checks.teacherOAuthConfigured = !!(
    await (await fetch(APP_ORIGIN + "/api/health")).json()
  ).authConfigured; // Configuration only; this test does not simulate Google login.
  await writeFile(
    ".data/deploy/cloud-smoke-result.json",
    JSON.stringify({ at: new Date().toISOString(), checks }, null, 2) + "\n",
  );
  console.log(JSON.stringify(checks));
} finally {
  // Tombstone first; delayed jobs are harmless. Then remove all QA assets and usage metadata.
  await patch(doc.id, {
    status: "deleted",
    enabled: false,
    leaseId: null,
    leaseUntil: 0,
  }).catch(() => {});
  try {
    gc(["storage", "rm", "--recursive", prefix]);
  } catch {}
  await cloud(`usage/${usageId}`, "DELETE").catch(() => {});
  await cloud(`documents/${doc.id}`, "DELETE").catch(() => {});
  if (createdTaskName)
    await fetch(`https://cloudtasks.googleapis.com/v2/${createdTaskName}`, {
      method: "DELETE",
      headers,
    }).catch(() => {});
  console.log("Synthetic cloud fixture cleaned up.");
}
