import { resolve } from "node:path";
import { AppError } from "./model";
export function config() {
  const local = process.env.APP_MODE === "local";
  if (
    local &&
    (process.env.K_SERVICE || process.env.NODE_ENV === "production")
  ) {
    throw new AppError(503, "Local adapters are forbidden in production.");
  }
  const num = (key: string, fallback: number) => {
    const n = Number(process.env[key] || fallback);
    if (!Number.isSafeInteger(n) || n < 1)
      throw new AppError(503, `Invalid ${key} configuration.`);
    return n;
  };
  const origin =
    process.env.APP_ORIGIN || (local ? "http://127.0.0.1:3000" : "");
  if (!origin || (!local && !origin.startsWith("https://")))
    throw new AppError(503, "APP_ORIGIN must be configured with HTTPS.");
  return {
    local,
    origin: new URL(origin).origin,
    dataDir: resolve(
      /* turbopackIgnore: true */ process.env.LOCAL_DATA_DIR || ".data",
    ),
    secret: process.env.APP_SECRET_KEY || "",
    role: process.env.SERVICE_ROLE || "web",
    project: process.env.GOOGLE_CLOUD_PROJECT || "",
    region: process.env.GCP_REGION || "us-central1",
    bucket: process.env.STORAGE_BUCKET || "",
    queue: process.env.TASK_QUEUE || "reader-processing",
    workerUrl: process.env.WORKER_URL || "",
    taskAccount: process.env.TASK_SERVICE_ACCOUNT || "",
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
    timezone: process.env.DEFAULT_TIMEZONE || "America/Denver",
    voices: (process.env.TTS_VOICES || "en-US-Standard-C,en-US-Standard-D")
      .split(",")
      .map((v) => v.trim()),
    maxUpload: num("MAX_UPLOAD_BYTES", 12 * 1024 * 1024),
    maxPages: num("MAX_PAGES", 30),
    maxSegments: num("MAX_SEGMENTS", 500),
    maxChars: num("MAX_DOCUMENT_CHARACTERS", 60000),
    maxDocuments: num("MAX_DOCUMENTS_PER_OWNER", 30),
    maxUploads: num("MAX_UPLOADS_PER_DAY", 10),
    dailyChars: num("MAX_CHARACTERS_PER_DAY", 150000),
    batchSize: num("WORKER_BATCH_SIZE", 12),
  };
}
