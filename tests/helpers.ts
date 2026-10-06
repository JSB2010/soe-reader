import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeToken } from "../lib/security";
import type { ReaderDocument } from "../lib/model";
export function testConfig() {
  process.env.APP_MODE = "local";
  process.env.APP_ORIGIN = "http://127.0.0.1:3000";
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.APP_SECRET_KEY = randomBytes(32).toString("base64");
  process.env.LOCAL_DATA_DIR = mkdtempSync(join(tmpdir(), "soe-reader-test-"));
  process.env.MAX_UPLOADS_PER_DAY = "100";
  process.env.MAX_DOCUMENTS_PER_OWNER = "100";
}
export function document(
  overrides: Partial<ReaderDocument> = {},
): ReaderDocument {
  const token = makeToken(),
    now = Date.now();
  return {
    id: randomUUID(),
    ownerId: "test-owner",
    title: "Test assessment",
    version: randomUUID(),
    status: "queued",
    enabled: true,
    availableAt: now - 60000,
    expiresAt: now + 3600000,
    timezone: "America/Denver",
    voice: "en-US-Standard-C",
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
    ...overrides,
  };
}
