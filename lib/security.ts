import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { config } from "./config";
import { AppError, type ReaderDocument } from "./model";
function key() {
  const value = Buffer.from(config().secret, "base64");
  if (value.length !== 32)
    throw new AppError(503, "The application secret key is not configured.");
  return value;
}
export function encrypt(value: unknown, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(purpose));
  const body = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}
export function decrypt<T>(value: string, purpose: string): T {
  try {
    if (value.length > 10000) throw new Error("size");
    const bytes = Buffer.from(value, "base64url");
    const cipher = createDecipheriv(
      "aes-256-gcm",
      key(),
      bytes.subarray(0, 12),
    );
    cipher.setAAD(Buffer.from(purpose));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        cipher.update(bytes.subarray(28)),
        cipher.final(),
      ]).toString(),
    );
  } catch {
    throw new AppError(401, "Your session is invalid or has expired.");
  }
}
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function makeToken() {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    hash: hashToken(token),
    encrypted: encrypt(token, "share-token"),
  };
}
export function equalSecret(a: string, b: string) {
  const first = Buffer.from(a),
    second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}
export function availability(
  doc: Pick<ReaderDocument, "status" | "enabled" | "availableAt" | "expiresAt">,
  now = Date.now(),
) {
  if (doc.status === "deleted") return "deleted";
  if (!doc.enabled) return "disabled";
  if (doc.status !== "ready") return "processing";
  if (now < doc.availableAt) return "early";
  if (now >= doc.expiresAt) return "expired";
  return "open";
}
export function assertOwner(
  doc: ReaderDocument | null,
  ownerId: string,
): asserts doc is ReaderDocument {
  if (!doc || doc.status === "deleted" || doc.ownerId !== ownerId)
    throw new AppError(404, "Document not found.");
}
export function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!m || (!m[1] && !m[2]))
    throw new AppError(416, "Unsupported byte range.");
  let start: number, end: number;
  if (!m[1]) {
    const suffix = Number(m[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1)
      throw new AppError(416, "Invalid byte range.");
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  )
    throw new AppError(416, "Unsatisfiable byte range.");
  return { start, end };
}
