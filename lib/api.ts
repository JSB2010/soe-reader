import { randomUUID } from "node:crypto";
import { z } from "zod";
import { config } from "./config";
import {
  AppError,
  basePath,
  pdfPath,
  manifestPath,
  type Manifest,
  type ReaderDocument,
  type Task,
} from "./model";
import { store } from "./store";
import { putAsset, readAsset, assetSize, deleteAssets } from "./assets";
import {
  encrypt,
  decrypt,
  makeToken,
  hashToken,
  availability,
  assertOwner,
  parseRange,
} from "./security";
import {
  cookie,
  cookies,
  verifyOrigin,
  identity,
  sessionCookie,
  beginOAuth,
  finishOAuth,
} from "./auth";
import { parseWallTime, validateWindow } from "./time";
import { enqueue } from "./tasks";
import { limitedBody } from "./http";
import { verifyTask, processTask } from "./worker";
const noStore = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
};
export const json = (
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
) => Response.json(value, { status, headers: { ...noStore, ...headers } });
function redirect(url: string, setCookies: string[] = []) {
  const headers = new Headers({ ...noStore, Location: url });
  setCookies.forEach((c) => headers.append("Set-Cookie", c));
  return new Response(null, { status: 303, headers });
}
const metadata = z.object({
  title: z.string().trim().min(1).max(160),
  start: z.string(),
  end: z.string(),
  timezone: z.string().min(1).max(100),
  voice: z.string(),
});
const idSchema = z.string().uuid();
async function requestJson(request: Request) {
  const text = new TextDecoder().decode(await limitedBody(request, 10000));
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(400, "Invalid JSON request.");
  }
}
async function ownerDoc(request: Request, id: string) {
  idSchema.parse(id);
  const user = identity(request),
    doc = await store().get(id);
  assertOwner(doc, user.id);
  return doc;
}
function publicDocument(doc: ReaderDocument) {
  const {
    ownerId: _owner,
    tokenHash: _hash,
    encryptedToken: _encrypted,
    leaseId: _lease,
    leaseUntil: _until,
    ...safe
  } = doc;
  return {
    ...safe,
    shareUrl: `${config().origin}/read#${decrypt<string>(doc.encryptedToken, "share-token")}`,
  };
}
async function readerDoc(request: Request, id: string, preview: boolean) {
  if (preview) {
    const doc = await ownerDoc(request, id);
    if (doc.status !== "ready")
      throw new AppError(409, "This document is not ready for preview.");
    return doc;
  }
  idSchema.parse(id);
  const capValue = cookies(request)[`soe_cap_${id}`];
  if (!capValue) throw new AppError(401, "Open your assessment link again.");
  const cap = decrypt<{ id: string; hash: string; expires: number }>(
    capValue,
    "reader-capability",
  );
  const doc = await store().get(id);
  if (
    !doc ||
    cap.id !== id ||
    cap.expires <= Date.now() ||
    doc.tokenHash !== cap.hash
  )
    throw new AppError(403, "This assessment link is no longer valid.");
  const state = availability(doc);
  if (state !== "open")
    throw new AppError(403, accessMessage(state, doc), state);
  return doc;
}
function accessMessage(state: string, doc: ReaderDocument) {
  if (state === "early")
    return `This assessment opens ${new Date(doc.availableAt).toISOString()}.`;
  if (state === "expired") return "This assessment has ended.";
  if (state === "processing") return "This assessment is still being prepared.";
  return "This assessment is unavailable.";
}
async function assetResponse(request: Request, key: string, type: string) {
  const size = await assetSize(key);
  let range;
  try {
    range = parseRange(request.headers.get("range"), size);
  } catch (e) {
    if (e instanceof AppError && e.status === 416)
      return json({ error: e.message }, 416, {
        "Content-Range": `bytes */${size}`,
      });
    throw e;
  }
  const headers: Record<string, string> = {
    ...noStore,
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Content-Length": String(range ? range.end - range.start + 1 : size),
  };
  if (range)
    headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
  return new Response(
    request.method === "HEAD"
      ? null
      : new Uint8Array(await readAsset(key, range)),
    { status: range ? 206 : 200, headers },
  );
}
async function handler(request: Request, path: string[]) {
  const cfg = config(),
    method = request.method,
    route = path.join("/");
  if (route === "health")
    return json({
      ok: true,
      mode: cfg.local ? "local" : "cloud",
      role: cfg.role,
      authConfigured: cfg.local || !!(cfg.clientId && cfg.clientSecret),
    });
  if (route === "tasks/process" && method === "POST") {
    await verifyTask(request);
    const task = z
      .object({
        documentId: z.string().uuid(),
        version: z.string().uuid(),
        generation: z.string().min(1).max(100),
      })
      .parse(await requestJson(request));
    await processTask(task);
    return json({ accepted: true });
  }
  if (cfg.role !== "web") throw new AppError(404, "Not found.");
  if (route === "config" && method === "GET")
    return json({
      local: cfg.local,
      authConfigured: cfg.local || !!(cfg.clientId && cfg.clientSecret),
      voices: cfg.voices,
      timezone: cfg.timezone,
      maxUpload: cfg.maxUpload,
      maxPages: cfg.maxPages,
    });
  if (route === "auth/login" && method === "GET") {
    const flow = await beginOAuth();
    return redirect(flow.url, [cookie("soe_oauth_flow", flow.flow, 600)]);
  }
  if (route === "auth/callback" && method === "GET") {
    const user = await finishOAuth(request);
    return redirect(cfg.origin, [
      sessionCookie(user),
      cookie("soe_oauth_flow", "", 0),
    ]);
  }
  if (route === "auth/me" && method === "GET") return json(identity(request));
  if (["POST", "PATCH", "DELETE"].includes(method)) verifyOrigin(request);
  if (route === "auth/local" && method === "POST") {
    if (!cfg.local) throw new AppError(404, "Not found.");
    const data = z
      .object({ account: z.enum(["one", "two"]) })
      .parse(await requestJson(request));
    const user = {
      id: `local-${data.account}`,
      email: `account-${data.account}@example.test`,
      name: data.account === "one" ? "Demo educator" : "Second demo account",
    };
    return json(user, 200, { "Set-Cookie": sessionCookie(user) });
  }
  if (route === "auth/logout" && method === "POST")
    return json({ ok: true }, 200, {
      "Set-Cookie": cookie("soe_session", "", 0),
    });
  if (route === "reader/session" && method === "POST") {
    const data = z
      .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
      .parse(await requestJson(request));
    const doc = await store().findToken(hashToken(data.token));
    if (!doc || doc.status === "deleted")
      throw new AppError(404, "This assessment link is invalid.");
    const state = availability(doc);
    if (state !== "open")
      return json(
        {
          state,
          availableAt: doc.availableAt,
          expiresAt: doc.expiresAt,
          message: accessMessage(state, doc),
          serverNow: Date.now(),
        },
        403,
      );
    const cap = encrypt(
      {
        id: doc.id,
        hash: doc.tokenHash,
        expires: Math.min(doc.expiresAt, Date.now() + 12 * 3600000),
      },
      "reader-capability",
    );
    return json(
      {
        id: doc.id,
        title: doc.title,
        expiresAt: doc.expiresAt,
        serverNow: Date.now(),
      },
      200,
      {
        "Set-Cookie": cookie(
          `soe_cap_${doc.id}`,
          cap,
          Math.min(43200, Math.ceil((doc.expiresAt - Date.now()) / 1000)),
          `/api/reader/${doc.id}`,
          "Strict",
        ),
      },
    );
  }
  if (path[0] === "reader" && path[1] && ["GET", "HEAD"].includes(method)) {
    const preview = new URL(request.url).searchParams.get("preview") === "1",
      doc = await readerDoc(request, path[1], preview),
      kind = path[2];
    if (kind === "policy" && path.length === 3)
      return json({
        title: doc.title,
        expiresAt: preview ? null : doc.expiresAt,
        serverNow: Date.now(),
        state: "open",
      });
    if (kind === "pdf" && path.length === 3)
      return assetResponse(request, pdfPath(doc), "application/pdf");
    if (kind === "manifest" && path.length === 3)
      return assetResponse(request, manifestPath(doc), "application/json");
    if (
      kind === "audio" &&
      path.length === 4 &&
      /^[a-f0-9]{32}\.mp3$/.test(path[3])
    ) {
      const manifest: Manifest = JSON.parse(
        (await readAsset(manifestPath(doc))).toString(),
      );
      const segment = manifest.segments.find(
        (s) => s.audio === `audio/${path[3]}`,
      );
      if (!segment) throw new AppError(404, "Audio segment not found.");
      return assetResponse(
        request,
        `${basePath(doc)}/${segment.audio}`,
        "audio/mpeg",
      );
    }
    throw new AppError(404, "Asset not found.");
  }
  if (route === "documents" && method === "GET") {
    const user = identity(request),
      docs = await store().list(user.id);
    return json(
      docs.sort((a, b) => b.createdAt - a.createdAt).map(publicDocument),
    );
  }
  if (route === "documents" && method === "POST") {
    const user = identity(request);
    if (Number(request.headers.get("content-length")) > cfg.maxUpload + 65536)
      throw new AppError(413, "This upload exceeds the configured size limit.");
    const body = await limitedBody(request, cfg.maxUpload + 65536);
    const form = await new Response(body as Uint8Array<ArrayBuffer>, {
        headers: { "Content-Type": request.headers.get("content-type") || "" },
      }).formData(),
      file = form.get("file");
    if (
      !(file instanceof File) ||
      !file.size ||
      file.size > cfg.maxUpload ||
      file.type !== "application/pdf"
    )
      throw new AppError(
        400,
        `Upload a PDF smaller than ${Math.round(cfg.maxUpload / 1024 / 1024)} MB.`,
      );
    const data = metadata.parse(
      Object.fromEntries(
        ["title", "start", "end", "timezone", "voice"].map((k) => [
          k,
          form.get(k),
        ]),
      ),
    );
    const availableAt = parseWallTime(data.start, data.timezone),
      expiresAt = parseWallTime(data.end, data.timezone);
    validateWindow(availableAt, expiresAt);
    if (!cfg.voices.includes(data.voice))
      throw new AppError(400, "Choose a configured speech voice.");
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-")))
      throw new AppError(400, "The uploaded file is not a PDF.");
    const token = makeToken(),
      now = Date.now(),
      doc: ReaderDocument = {
        id: randomUUID(),
        ownerId: user.id,
        title: data.title,
        version: randomUUID(),
        status: "queued",
        enabled: true,
        availableAt,
        expiresAt,
        timezone: data.timezone,
        voice: data.voice,
        createdAt: now,
        updatedAt: now,
        pdfBytes: bytes.length,
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
    await store().create(doc);
    try {
      await putAsset(pdfPath(doc), bytes, "application/pdf");
      await enqueue({
        documentId: doc.id,
        version: doc.version,
        generation: randomUUID(),
      });
    } catch {
      await store().update(doc.id, (d) =>
        d.status === "deleted"
          ? d
          : {
              ...d,
              status: "failed",
              error:
                "Upload or queue delivery failed. Retry this document or upload it again.",
            },
      );
    }
    return json(publicDocument((await store().get(doc.id))!), 202);
  }
  if (path[0] === "documents" && path[1]) {
    const doc = await ownerDoc(request, path[1]);
    if (path.length === 2 && method === "GET") return json(publicDocument(doc));
    if (path.length === 2 && method === "PATCH") {
      const data = z
        .object({
          start: z.string(),
          end: z.string(),
          timezone: z.string(),
          enabled: z.boolean(),
        })
        .parse(await requestJson(request));
      const availableAt = parseWallTime(data.start, data.timezone),
        expiresAt = parseWallTime(data.end, data.timezone);
      validateWindow(availableAt, expiresAt);
      const updated = await store().update(doc.id, (d) => {
        assertOwner(d, doc.ownerId);
        return {
          ...d,
          availableAt,
          expiresAt,
          timezone: data.timezone,
          enabled: data.enabled,
          updatedAt: Date.now(),
        };
      });
      return json(publicDocument(updated!));
    }
    if (path.length === 2 && method === "DELETE") {
      await store().tombstone(doc.id, doc.ownerId);
      await deleteAssets(`documents/${doc.id}`);
      return json({ deleted: true });
    }
    if (path[2] === "disable" && path.length === 3 && method === "POST") {
      const updated = await store().update(doc.id, (d) => {
        assertOwner(d, doc.ownerId);
        return { ...d, enabled: false, updatedAt: Date.now() };
      });
      return json(publicDocument(updated!));
    }
    if (path[2] === "rotate" && path.length === 3 && method === "POST") {
      const token = makeToken();
      const updated = await store().update(doc.id, (d) => {
        assertOwner(d, doc.ownerId);
        return {
          ...d,
          tokenHash: token.hash,
          encryptedToken: token.encrypted,
          updatedAt: Date.now(),
        };
      });
      return json(publicDocument(updated!));
    }
    if (path[2] === "retry" && path.length === 3 && method === "POST") {
      const updated = await store().update(doc.id, (d) => {
        assertOwner(d, doc.ownerId);
        if (d.status === "ready")
          throw new AppError(409, "This document is already ready.");
        if (d.leaseUntil > Date.now())
          throw new AppError(409, "Processing is already running.");
        return {
          ...d,
          status: "queued",
          attempts: 0,
          error: null,
          leaseId: null,
          leaseUntil: 0,
          updatedAt: Date.now(),
        };
      });
      try {
        await enqueue({
          documentId: doc.id,
          version: doc.version,
          generation: randomUUID(),
        });
      } catch {
        await store().update(doc.id, (d) =>
          d.status === "deleted"
            ? d
            : {
                ...d,
                status: "failed",
                error: "Queue delivery failed. Try again.",
              },
        );
        throw new AppError(503, "Queue delivery failed. Try again.");
      }
      return json(publicDocument(updated!));
    }
  }
  throw new AppError(404, "Not found.");
}
export async function api(request: Request, path: string[]) {
  try {
    return await handler(request, path);
  } catch (e) {
    if (e instanceof z.ZodError)
      return json(
        {
          error: "Please check the request fields.",
          details: e.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
          })),
        },
        400,
      );
    if (e instanceof AppError)
      return json({ error: e.message, code: e.code }, e.status);
    // Never log the request URL, headers, tokens, PDF text, OAuth response, or provider error bodies.
    console.error(
      JSON.stringify({
        event: "request_failed",
        category: (e as Error)?.name || "Error",
      }),
    );
    return json(
      { error: "The request could not be completed. Please try again." },
      500,
    );
  }
}
