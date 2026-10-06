import test from "node:test";
import assert from "node:assert/strict";
import {
  availability,
  encrypt,
  decrypt,
  hashToken,
  makeToken,
  assertOwner,
  parseRange,
} from "../lib/security";
import { parseWallTime, validateWindow } from "../lib/time";
import { config } from "../lib/config";
import { testConfig, document } from "./helpers";
testConfig();
test("access uses inclusive start and exclusive end, plus Ready/enabled/deleted gates", () => {
  const doc = document({ status: "ready", availableAt: 1000, expiresAt: 2000 });
  assert.equal(availability(doc, 999), "early");
  assert.equal(availability(doc, 1000), "open");
  assert.equal(availability(doc, 1999), "open");
  assert.equal(availability(doc, 2000), "expired");
  assert.equal(availability({ ...doc, enabled: false }, 1500), "disabled");
  assert.equal(availability({ ...doc, status: "queued" }, 1500), "processing");
  assert.equal(availability({ ...doc, status: "deleted" }, 1500), "deleted");
});
test("encrypted token reload, tamper detection, purpose binding, high entropy", () => {
  const first = makeToken(),
    second = makeToken();
  assert.equal(first.token.length, 43);
  assert.notEqual(first.token, second.token);
  assert.equal(hashToken(first.token), first.hash);
  assert.equal(decrypt(first.encrypted, "share-token"), first.token);
  assert.throws(() => decrypt(first.encrypted, "owner-session"));
  const bytes = Buffer.from(first.encrypted, "base64url");
  bytes[30] ^= 1;
  assert.throws(() => decrypt(bytes.toString("base64url"), "share-token"));
});
test("ownership rejects every other owner and deleted records without existence disclosure", () => {
  const doc = document();
  assert.doesNotThrow(() => assertOwner(doc, doc.ownerId));
  assert.throws(() => assertOwner(doc, "another"));
  assert.throws(() => assertOwner({ ...doc, status: "deleted" }, doc.ownerId));
  assert.throws(() => assertOwner(null, doc.ownerId));
});
test("PDF and audio ranges validate suffix, open-ended, clipping and invalid requests", () => {
  assert.equal(parseRange(null, 100), null);
  assert.deepEqual(parseRange("bytes=0-9", 100), { start: 0, end: 9 });
  assert.deepEqual(parseRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=90-120", 100), { start: 90, end: 99 });
  for (const range of [
    "bytes=100-",
    "bytes=10-2",
    "bytes=0-1,5-6",
    "bytes=-0",
    "bytes=-",
    "bytes=NaN-9",
    "bytes=99999999999999999999-",
  ])
    assert.throws(() => parseRange(range, 100));
});
test("timezone conversion rejects DST gaps and repeated times", () => {
  assert.equal(
    parseWallTime("2026-10-05T09:00", "America/Denver"),
    Date.parse("2026-10-05T15:00:00Z"),
  );
  assert.throws(
    () => parseWallTime("2026-03-08T02:30", "America/Denver"),
    /does not exist/,
  );
  assert.throws(
    () => parseWallTime("2026-11-01T01:30", "America/Denver"),
    /ambiguous/,
  );
  assert.throws(() => parseWallTime("2026-10-05T09:00", "Invalid/Zone"));
  assert.throws(() => validateWindow(5, 5));
  assert.throws(() => validateWindow(10, 5));
});
test("local mode fails closed on hosted services and production", () => {
  process.env.K_SERVICE = "hosted";
  assert.throws(config, /forbidden/);
  delete process.env.K_SERVICE;
  Object.assign(process.env, { NODE_ENV: "production" });
  assert.throws(config, /forbidden/);
  Object.assign(process.env, { NODE_ENV: "test" });
});
