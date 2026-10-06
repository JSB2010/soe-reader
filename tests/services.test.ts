import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { testConfig, document } from "./helpers";
import { store, database } from "../lib/store";
import { api } from "../lib/api";
import { sessionCookie } from "../lib/auth";
import { putAsset, readAsset, hasAsset } from "../lib/assets";
import { pdfPath, manifestPath, basePath, type Manifest } from "../lib/model";
import { processTask } from "../lib/worker";
import { decrypt } from "../lib/security";
testConfig();
const origin = "http://127.0.0.1:3000";
const ownerCookie = (id: string) =>
  sessionCookie({
    id,
    email: `${id}@example.test`,
    name: "Test account",
  }).split(";")[0];
function request(
  path: string,
  method = "GET",
  body?: unknown,
  cookieValue?: string,
) {
  return new Request(origin + "/api/" + path, {
    method,
    headers: {
      Origin: origin,
      ...(cookieValue ? { Cookie: cookieValue } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
test("durable batches reuse completed audio, duplicate deliveries and stale versions are harmless", async () => {
  const doc = document(),
    db = store();
  await db.create(doc);
  await putAsset(
    pdfPath(doc),
    await readFile("fixtures/assessment.pdf"),
    "application/pdf",
  );
  const task = {
    documentId: doc.id,
    version: doc.version,
    generation: randomUUID(),
  };
  await processTask(task);
  const after = (await db.get(doc.id))!;
  assert.equal(after.status, "processing");
  assert.equal(after.completedSegments, 12);
  assert.equal(after.quotaReserved, true);
  const manifest: Manifest = JSON.parse(
    (await readAsset(manifestPath(doc))).toString(),
  );
  const firstAudio = await readAsset(
    `${basePath(doc)}/${manifest.segments[0].audio}`,
  );
  for (let n = 0; n < 10 && (await db.get(doc.id))?.status !== "ready"; n++)
    await processTask(task);
  const ready = (await db.get(doc.id))!;
  assert.equal(ready.status, "ready");
  assert.equal(ready.completedSegments, manifest.segments.length);
  for (const s of manifest.segments)
    assert.ok(await hasAsset(`${basePath(doc)}/${s.audio}`));
  assert.deepEqual(
    await readAsset(`${basePath(doc)}/${manifest.segments[0].audio}`),
    firstAudio,
  );
  await processTask(task);
  assert.deepEqual(await db.get(doc.id), ready);
  await processTask({ ...task, version: randomUUID() });
  assert.deepEqual(await db.get(doc.id), ready);
  await db.tombstone(doc.id, doc.ownerId);
  await processTask(task);
  assert.equal((await db.get(doc.id))?.status, "deleted");
  assert.equal(await hasAsset(pdfPath(doc)), false);
  // Simulate the last in-flight write arriving after the synchronous delete sweep.
  await putAsset(
    `${basePath(doc)}/${manifest.segments[0].audio}`,
    firstAudio,
    "audio/mpeg",
  );
  await processTask(task);
  assert.equal(
    await hasAsset(`${basePath(doc)}/${manifest.segments[0].audio}`),
    false,
  );
});
test("concurrent duplicate task cannot steal a current lease", async () => {
  const doc = document({
    status: "processing",
    leaseId: randomUUID(),
    leaseUntil: Date.now() + 300000,
  });
  await store().create(doc);
  await assert.rejects(
    () =>
      processTask({
        documentId: doc.id,
        version: doc.version,
        generation: randomUUID(),
      }),
    /holds the processing lease/,
  );
});
test("bad PDFs remain failed, never Ready", async () => {
  const doc = document();
  await store().create(doc);
  await putAsset(
    pdfPath(doc),
    Buffer.from("%PDF-1.7 invalid"),
    "application/pdf",
  );
  await processTask({
    documentId: doc.id,
    version: doc.version,
    generation: randomUUID(),
  });
  const result = (await store().get(doc.id))!;
  assert.equal(result.status, "failed");
  assert.match(result.error || "", /could not be parsed/);
});
test("two accounts cannot list, preview, get share links, edit, disable, retry, rotate, or delete each other’s documents", async () => {
  const doc = document({ status: "ready", ownerId: "owner-one" });
  await store().create(doc);
  const cookieOne = ownerCookie("owner-one"),
    cookieTwo = ownerCookie("owner-two");
  const listed = await (
    await api(request("documents", "GET", undefined, cookieOne), ["documents"])
  ).json();
  assert.ok(listed.some((d: { id: string }) => d.id === doc.id));
  assert.ok(listed[0].shareUrl);
  assert.equal(listed[0].tokenHash, undefined);
  assert.equal(listed[0].ownerId, undefined);
  const other = await (
    await api(request("documents", "GET", undefined, cookieTwo), ["documents"])
  ).json();
  assert.ok(!other.some((d: { id: string }) => d.id === doc.id));
  for (const [path, method, body] of [
    [`documents/${doc.id}`, "GET", undefined],
    [
      `documents/${doc.id}`,
      "PATCH",
      {
        start: "2026-10-05T09:00",
        end: "2026-10-05T10:00",
        timezone: "America/Denver",
        enabled: false,
      },
    ],
    ...["disable", "rotate", "retry"].map((action) => [
      `documents/${doc.id}/${action}`,
      "POST",
      {},
    ]),
    [`documents/${doc.id}`, "DELETE", undefined],
    [`reader/${doc.id}/manifest?preview=1`, "GET", undefined],
    [`reader/${doc.id}/pdf?preview=1`, "GET", undefined],
  ] as [string, string, unknown][]) {
    const response = await api(
      request(path, method, body, cookieTwo),
      path.split("?")[0].split("/"),
    );
    assert.equal(response.status, 404, path);
  }
  assert.equal((await api(request("documents"), ["documents"])).status, 401);
  const csrf = new Request(origin + `/api/documents/${doc.id}/disable`, {
    method: "POST",
    headers: { Cookie: cookieOne, Origin: "https://untrusted.example" },
  });
  assert.equal((await api(csrf, ["documents", doc.id, "disable"])).status, 403);
});
test("reader session, PDF ranges, audio allowlist, disable, expiry and rotation enforce one capability", async () => {
  const doc = document({ status: "ready", ownerId: "reader-owner" });
  await store().create(doc);
  await putAsset(
    pdfPath(doc),
    Buffer.from("%PDF-1.7 test bytes"),
    "application/pdf",
  );
  const manifest: Manifest = JSON.parse(
    await readFile("fixtures/manifest.json", "utf8"),
  );
  await putAsset(
    manifestPath(doc),
    JSON.stringify(manifest),
    "application/json",
  );
  await putAsset(
    `${basePath(doc)}/${manifest.segments[0].audio}`,
    Buffer.from("audio"),
    "audio/mpeg",
  );
  const token = decrypt<string>(doc.encryptedToken, "share-token");
  const open = await api(request("reader/session", "POST", { token }), [
    "reader",
    "session",
  ]);
  assert.equal(open.status, 200);
  const cap = open.headers.get("set-cookie")!.split(";")[0];
  const pdfRequest = new Request(origin + `/api/reader/${doc.id}/pdf`, {
    headers: { Cookie: cap, Range: "bytes=0-3" },
  });
  const partial = await api(pdfRequest, ["reader", doc.id, "pdf"]);
  assert.equal(partial.status, 206);
  assert.equal(await partial.text(), "%PDF");
  assert.equal(
    partial.headers.get("cache-control")?.includes("no-store"),
    true,
  );
  assert.equal(
    (await api(request(`reader/${doc.id}/pdf`), ["reader", doc.id, "pdf"]))
      .status,
    401,
  );
  assert.equal(
    (
      await api(
        request(`reader/${doc.id}/audio/unknown.mp3`, "GET", undefined, cap),
        ["reader", doc.id, "audio", "unknown.mp3"],
      )
    ).status,
    404,
  );
  const audioFile = manifest.segments[0].audio.split("/")[1];
  assert.equal(
    (
      await api(
        request(`reader/${doc.id}/audio/${audioFile}`, "GET", undefined, cap),
        ["reader", doc.id, "audio", audioFile],
      )
    ).status,
    200,
  );
  const owner = ownerCookie(doc.ownerId);
  const rotated = await api(
    request(`documents/${doc.id}/rotate`, "POST", {}, owner),
    ["documents", doc.id, "rotate"],
  );
  assert.equal(rotated.status, 200);
  assert.equal(
    (
      await api(request("reader/session", "POST", { token }), [
        "reader",
        "session",
      ])
    ).status,
    404,
  );
  assert.equal(
    (
      await api(request(`reader/${doc.id}/manifest`, "GET", undefined, cap), [
        "reader",
        doc.id,
        "manifest",
      ])
    ).status,
    403,
  );
  const current = (await store().get(doc.id))!,
    newToken = decrypt<string>(current.encryptedToken, "share-token");
  await store().update(doc.id, (d) => ({
    ...d,
    availableAt: Date.now() + 60000,
  }));
  assert.equal(
    (
      await api(request("reader/session", "POST", { token: newToken }), [
        "reader",
        "session",
      ])
    ).status,
    403,
  );
  assert.equal(
    (
      await api(
        request(`reader/${doc.id}/manifest?preview=1`, "GET", undefined, owner),
        ["reader", doc.id, "manifest"],
      )
    ).status,
    200,
  );
  await store().update(doc.id, (d) => ({
    ...d,
    availableAt: Date.now() - 60000,
    expiresAt: Date.now(),
  }));
  assert.equal(
    (
      await api(request("reader/session", "POST", { token: newToken }), [
        "reader",
        "session",
      ])
    ).status,
    403,
  );
  await store().update(doc.id, (d) => ({
    ...d,
    expiresAt: Date.now() + 60000,
    enabled: false,
  }));
  assert.equal(
    (
      await api(request("reader/session", "POST", { token: newToken }), [
        "reader",
        "session",
      ])
    ).status,
    403,
  );
});
test("upload type validation and atomic owner quotas", async () => {
  const doc = document({ ownerId: "quota-owner" });
  process.env.MAX_DOCUMENTS_PER_OWNER = "1";
  await store().create(doc);
  await assert.rejects(
    () => store().create(document({ ownerId: doc.ownerId })),
    /limit/,
  );
  await store().tombstone(doc.id, doc.ownerId);
  await store().create(document({ ownerId: doc.ownerId }));
  process.env.MAX_DOCUMENTS_PER_OWNER = "100";
  const form = new FormData();
  form.set(
    "file",
    new File(["not a pdf"], "bad.pdf", { type: "application/pdf" }),
  );
  form.set("title", "Bad file");
  form.set("start", "2026-10-05T09:00");
  form.set("end", "2026-10-05T10:00");
  form.set("timezone", "America/Denver");
  form.set("voice", "en-US-Standard-C");
  const upload = new Request(origin + "/api/documents", {
    method: "POST",
    headers: { Cookie: ownerCookie("uploader"), Origin: origin },
    body: form,
  });
  assert.equal((await api(upload, ["documents"])).status, 400);
});
