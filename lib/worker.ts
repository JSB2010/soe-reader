import { randomUUID } from "node:crypto";
import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import { OAuth2Client } from "google-auth-library";
import { config } from "./config";
import { store } from "./store";
import {
  AppError,
  basePath,
  manifestPath,
  pdfPath,
  type Manifest,
  type Task,
  type ReaderDocument,
} from "./model";
import { extractPdf } from "./extraction";
import { hasAsset, readAsset, putAsset, fixtureAudio } from "./assets";
import { enqueue } from "./tasks";
let speech: TextToSpeechClient | undefined;
export async function verifyTask(request: Request) {
  const cfg = config();
  if (cfg.local || cfg.role !== "worker" || !cfg.taskAccount || !cfg.workerUrl)
    throw new AppError(403, "Worker invocation is not permitted.");
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new AppError(401, "Worker authentication required.");
  const ticket = await new OAuth2Client().verifyIdToken({
    idToken: token,
    audience: cfg.workerUrl,
  });
  if (
    ticket.getPayload()?.email !== cfg.taskAccount ||
    !ticket.getPayload()?.email_verified
  )
    throw new AppError(403, "Worker identity not permitted.");
}
function guard(doc: ReaderDocument, version: string, lease: string) {
  if (
    doc.status === "deleted" ||
    doc.version !== version ||
    doc.leaseId !== lease
  )
    throw new AppError(409, "Processing lease is no longer current.");
}
async function synthesize(text: string, voice: string) {
  if (Buffer.byteLength(text) > 4800)
    throw new AppError(422, "Speech input exceeds the safe byte limit.");
  if (config().local) return fixtureAudio(text);
  speech ||= new TextToSpeechClient();
  for (let retry = 0; ; retry++) {
    try {
      const [response] = await speech.synthesizeSpeech(
        {
          input: { text },
          voice: { languageCode: voice.slice(0, 5), name: voice },
          audioConfig: { audioEncoding: "MP3", speakingRate: 1 },
        },
        { timeout: 15000, retry: null },
      );
      if (!response.audioContent?.length)
        throw new Error("Speech provider returned empty audio.");
      return Buffer.from(response.audioContent as Uint8Array);
    } catch (e) {
      const code = (e as { code?: number }).code;
      if (retry >= 2 || ![4, 8, 13, 14].includes(code || 0)) throw e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** retry));
    }
  }
}
export async function processTask(task: Task) {
  const db = store(),
    cfg = config(),
    leaseId = randomUUID(),
    began = Date.now();
  const current = await db.get(task.documentId);
  if (
    !current ||
    current.version !== task.version ||
    ["ready", "deleted", "failed"].includes(current.status)
  )
    return;
  const leased = await db.update(task.documentId, (d) => {
    if (
      d.version !== task.version ||
      ["ready", "deleted", "failed"].includes(d.status)
    )
      return d;
    if (d.leaseUntil > Date.now())
      throw new AppError(503, "Another delivery holds the processing lease.");
    return {
      ...d,
      status: "processing",
      leaseId,
      leaseUntil: Date.now() + 240000,
      attempts: d.attempts + 1,
      updatedAt: Date.now(),
      error: null,
    };
  });
  if (!leased || leased.leaseId !== leaseId) return;
  let count = leased.completedSegments;
  try {
    let manifest: Manifest;
    if (await hasAsset(manifestPath(leased)))
      manifest = JSON.parse((await readAsset(manifestPath(leased))).toString());
    else {
      manifest = await extractPdf(await readAsset(pdfPath(leased)));
      await putAsset(
        manifestPath(leased),
        JSON.stringify(manifest),
        "application/json",
      );
    }
    await db.reserveCharacters(
      leased.id,
      leased.version,
      manifest.segments.reduce((sum, s) => sum + s.text.length, 0),
    );
    await db.update(leased.id, (d) => {
      guard(d, task.version, leaseId);
      return {
        ...d,
        pages: manifest.pages.length,
        totalSegments: manifest.segments.length,
        warnings: manifest.warnings,
      };
    });
    const missing = [];
    for (const segment of manifest.segments)
      if (!(await hasAsset(`${basePath(leased)}/${segment.audio}`)))
        missing.push(segment);
    count = manifest.segments.length - missing.length;
    for (const segment of missing.slice(0, cfg.batchSize)) {
      if (Date.now() - began > 130000) break;
      const latest = await db.get(leased.id);
      if (!latest) return;
      guard(latest, task.version, leaseId);
      const audio = await synthesize(segment.text, leased.voice);
      const after = await db.get(leased.id);
      if (!after) return;
      guard(after, task.version, leaseId);
      await putAsset(
        `${basePath(leased)}/${segment.audio}`,
        audio,
        "audio/mpeg",
      );
      count++;
      await db.update(leased.id, (d) => {
        guard(d, task.version, leaseId);
        return { ...d, completedSegments: count, updatedAt: Date.now() };
      });
    }
    const ready = count === manifest.segments.length;
    if (ready) {
      for (const segment of manifest.segments)
        if (!(await hasAsset(`${basePath(leased)}/${segment.audio}`)))
          throw new Error("Audio validation failed.");
    } else await enqueue(task, count);
    await db.update(leased.id, (d) => {
      guard(d, task.version, leaseId);
      return {
        ...d,
        status: ready ? "ready" : "processing",
        completedSegments: count,
        updatedAt: Date.now(),
        leaseId: null,
        leaseUntil: 0,
        attempts: 0,
      };
    });
  } catch (e) {
    if (e instanceof AppError && e.status === 409) return;
    const permanent = e instanceof AppError && e.status === 422;
    const exhausted = leased.attempts >= 8;
    await db.update(leased.id, (d) => {
      if (
        d.version !== task.version ||
        d.status === "deleted" ||
        d.leaseId !== leaseId
      )
        return d;
      return {
        ...d,
        status: permanent || exhausted ? "failed" : "processing",
        error: permanent
          ? (e as Error).message
          : "Processing was interrupted. It will retry automatically; you can also retry from the dashboard.",
        leaseId: null,
        leaseUntil: 0,
        updatedAt: Date.now(),
      };
    });
    if (!permanent && !exhausted)
      throw new AppError(503, "Temporary processing failure.");
  }
}
