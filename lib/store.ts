import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Firestore } from "@google-cloud/firestore";
import { config } from "./config";
import { AppError, type ReaderDocument, type Task } from "./model";
type Mutation = (doc: ReaderDocument) => ReaderDocument;
export interface DocumentStore {
  get(id: string): Promise<ReaderDocument | null>;
  findToken(hash: string): Promise<ReaderDocument | null>;
  list(ownerId: string): Promise<ReaderDocument[]>;
  create(doc: ReaderDocument): Promise<void>;
  update(id: string, mutate: Mutation): Promise<ReaderDocument | null>;
  reserveCharacters(
    id: string,
    version: string,
    characters: number,
  ): Promise<void>;
  tombstone(id: string, owner: string): Promise<void>;
}
let localDb: DatabaseSync | undefined;
export function database() {
  const cfg = config();
  if (!cfg.local) throw new Error("Local database unavailable.");
  if (!localDb) {
    mkdirSync(cfg.dataDir, { recursive: true });
    localDb = new DatabaseSync(join(cfg.dataDir, "metadata.sqlite"));
    localDb.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, owner TEXT NOT NULL, tokenHash TEXT NOT NULL, data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS document_owner ON documents(owner); CREATE UNIQUE INDEX IF NOT EXISTS document_token ON documents(tokenHash); CREATE TABLE IF NOT EXISTS usage (id TEXT PRIMARY KEY, uploads INTEGER NOT NULL DEFAULT 0, characters INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL, available INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);",
    );
  }
  return localDb;
}
function atomic<T>(fn: () => T): T {
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    db.exec("COMMIT");
    return value;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
const usageId = (doc: ReaderDocument) =>
  `${doc.ownerId}:${new Date(doc.createdAt).toISOString().slice(0, 10)}`;
const parseDoc = (row: unknown) =>
  row ? (JSON.parse((row as { data: string }).data) as ReaderDocument) : null;
class LocalStore implements DocumentStore {
  async get(id: string) {
    return parseDoc(
      database().prepare("SELECT data FROM documents WHERE id=?").get(id),
    );
  }
  async findToken(hash: string) {
    return parseDoc(
      database()
        .prepare("SELECT data FROM documents WHERE tokenHash=?")
        .get(hash),
    );
  }
  async list(owner: string) {
    return database()
      .prepare("SELECT data FROM documents WHERE owner=?")
      .all(owner)
      .map(parseDoc)
      .filter((d) => d && d.status !== "deleted") as ReaderDocument[];
  }
  async create(doc: ReaderDocument) {
    atomic(() => {
      const cfg = config(),
        db = database();
      const count = db
        .prepare("SELECT data FROM documents WHERE owner=?")
        .all(doc.ownerId)
        .map(parseDoc)
        .filter((d) => d?.status !== "deleted").length;
      const usage = db
        .prepare("SELECT uploads FROM usage WHERE id=?")
        .get(usageId(doc)) as { uploads: number } | undefined;
      if (count >= cfg.maxDocuments || (usage?.uploads || 0) >= cfg.maxUploads)
        throw new AppError(
          429,
          "Your document or daily upload limit has been reached.",
        );
      db.prepare("INSERT INTO documents VALUES (?,?,?,?)").run(
        doc.id,
        doc.ownerId,
        doc.tokenHash,
        JSON.stringify(doc),
      );
      db.prepare(
        "INSERT INTO usage(id,uploads,characters) VALUES (?,1,0) ON CONFLICT(id) DO UPDATE SET uploads=uploads+1",
      ).run(usageId(doc));
    });
  }
  async update(id: string, mutate: Mutation) {
    return atomic(() => {
      const current = parseDoc(
        database().prepare("SELECT data FROM documents WHERE id=?").get(id),
      );
      if (!current) return null;
      const next = mutate(current);
      database()
        .prepare("UPDATE documents SET data=?,tokenHash=? WHERE id=?")
        .run(JSON.stringify(next), next.tokenHash, id);
      return next;
    });
  }
  async reserveCharacters(id: string, version: string, chars: number) {
    atomic(() => {
      const db = database(),
        doc = parseDoc(
          db.prepare("SELECT data FROM documents WHERE id=?").get(id),
        );
      if (!doc || doc.status === "deleted" || doc.version !== version)
        throw new AppError(409, "Processing version is no longer current.");
      if (doc.quotaReserved) return;
      const usage = db
        .prepare("SELECT characters FROM usage WHERE id=?")
        .get(usageId(doc)) as { characters: number };
      if (usage.characters + chars > config().dailyChars)
        throw new AppError(
          422,
          "Your daily speech character limit has been reached. Retry on another day or upload a shorter assessment.",
        );
      db.prepare("UPDATE usage SET characters=characters+? WHERE id=?").run(
        chars,
        usageId(doc),
      );
      db.prepare("UPDATE documents SET data=? WHERE id=?").run(
        JSON.stringify({ ...doc, quotaReserved: true }),
        id,
      );
    });
  }
  async tombstone(id: string, owner: string) {
    await this.update(id, (d) => {
      if (d.ownerId !== owner || d.status === "deleted")
        throw new AppError(404, "Document not found.");
      return {
        ...d,
        status: "deleted",
        enabled: false,
        updatedAt: Date.now(),
        leaseId: null,
        leaseUntil: 0,
      };
    });
  }
}
class CloudStore implements DocumentStore {
  db = new Firestore({ projectId: config().project });
  docs = this.db.collection("documents");
  async get(id: string) {
    const snapshot = await this.docs.doc(id).get();
    return snapshot.exists ? (snapshot.data() as ReaderDocument) : null;
  }
  async findToken(hash: string) {
    const result = await this.docs
      .where("tokenHash", "==", hash)
      .limit(1)
      .get();
    return result.empty ? null : (result.docs[0].data() as ReaderDocument);
  }
  async list(ownerId: string) {
    const result = await this.docs.where("ownerId", "==", ownerId).get();
    return result.docs
      .map((d) => d.data() as ReaderDocument)
      .filter((d) => d.status !== "deleted");
  }
  async create(doc: ReaderDocument) {
    await this.db.runTransaction(async (tx) => {
      const statsRef = this.db.collection("owners").doc(doc.ownerId),
        usageRef = this.db.collection("usage").doc(usageId(doc));
      const [stats, usage] = await tx.getAll(statsRef, usageRef),
        cfg = config();
      const count = stats.data()?.count || 0,
        uploads = usage.data()?.uploads || 0;
      if (count >= cfg.maxDocuments || uploads >= cfg.maxUploads)
        throw new AppError(
          429,
          "Your document or daily upload limit has been reached.",
        );
      tx.create(this.docs.doc(doc.id), doc);
      tx.set(statsRef, { count: count + 1 });
      tx.set(usageRef, {
        uploads: uploads + 1,
        characters: usage.data()?.characters || 0,
      });
    });
  }
  async update(id: string, mutate: Mutation) {
    return this.db.runTransaction(async (tx) => {
      const ref = this.docs.doc(id),
        snapshot = await tx.get(ref);
      if (!snapshot.exists) return null;
      const next = mutate(snapshot.data() as ReaderDocument);
      tx.set(ref, next);
      return next;
    });
  }
  async reserveCharacters(id: string, version: string, characters: number) {
    await this.db.runTransaction(async (tx) => {
      const ref = this.docs.doc(id),
        snapshot = await tx.get(ref),
        doc = snapshot.data() as ReaderDocument;
      if (!doc || doc.status === "deleted" || doc.version !== version)
        throw new AppError(409, "Processing version is no longer current.");
      if (doc.quotaReserved) return;
      const usageRef = this.db.collection("usage").doc(usageId(doc)),
        usage = await tx.get(usageRef);
      const count = usage.data()?.characters || 0;
      if (count + characters > config().dailyChars)
        throw new AppError(
          422,
          "Your daily speech character limit has been reached. Upload a shorter assessment or try a new upload tomorrow.",
        );
      tx.update(usageRef, { characters: count + characters });
      tx.update(ref, { quotaReserved: true });
    });
  }
  async tombstone(id: string, owner: string) {
    await this.db.runTransaction(async (tx) => {
      const ref = this.docs.doc(id),
        snapshot = await tx.get(ref),
        doc = snapshot.data() as ReaderDocument;
      if (!doc || doc.ownerId !== owner || doc.status === "deleted")
        throw new AppError(404, "Document not found.");
      const statsRef = this.db.collection("owners").doc(owner),
        stats = await tx.get(statsRef);
      tx.update(ref, {
        status: "deleted",
        enabled: false,
        updatedAt: Date.now(),
        leaseId: null,
        leaseUntil: 0,
      });
      tx.set(statsRef, { count: Math.max(0, (stats.data()?.count || 1) - 1) });
    });
  }
}
let adapter: DocumentStore | undefined;
export const store = () =>
  (adapter ||= config().local ? new LocalStore() : new CloudStore());
export function takeLocalTask(): {
  id: string;
  task: Task;
  attempts: number;
} | null {
  return atomic(() => {
    const row = database()
      .prepare(
        "SELECT * FROM tasks WHERE available<=? ORDER BY available LIMIT 1",
      )
      .get(Date.now()) as
      { id: string; data: string; attempts: number } | undefined;
    if (!row) return null;
    database()
      .prepare("UPDATE tasks SET available=?,attempts=attempts+1 WHERE id=?")
      .run(Date.now() + 300000, row.id);
    return {
      id: row.id,
      task: JSON.parse(row.data),
      attempts: row.attempts + 1,
    };
  });
}
