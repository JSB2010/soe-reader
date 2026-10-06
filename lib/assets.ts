import { readFile, writeFile, mkdir, stat, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Storage } from "@google-cloud/storage";
import { config } from "./config";
let storage: Storage | undefined;
const bucket = () =>
  (storage ||= new Storage({ projectId: config().project })).bucket(
    config().bucket,
  );
function localPath(key: string) {
  const base = resolve(config().dataDir, "assets"),
    path = resolve(base, key);
  if (!path.startsWith(base + sep)) throw new Error("Invalid asset key.");
  return path;
}
export async function putAsset(
  key: string,
  data: Buffer | string,
  type: string,
) {
  if (config().local) {
    const path = localPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  } else
    await bucket()
      .file(key)
      .save(data, {
        resumable: false,
        contentType: type,
        metadata: { cacheControl: "private, no-store" },
      });
}
export async function assetSize(key: string) {
  if (config().local) return (await stat(localPath(key))).size;
  const [metadata] = await bucket().file(key).getMetadata();
  return Number(metadata.size);
}
export async function hasAsset(key: string) {
  try {
    return (await assetSize(key)) > 0;
  } catch (e) {
    const code = (e as { code?: string | number }).code;
    if (code === "ENOENT" || code === 404) return false;
    throw e;
  }
}
export async function readAsset(
  key: string,
  range?: { start: number; end: number } | null,
): Promise<Buffer> {
  if (config().local) {
    const data = await readFile(localPath(key));
    return range ? data.subarray(range.start, range.end + 1) : data;
  }
  const [data] = await bucket()
    .file(key)
    .download(range || {});
  return data;
}
export async function deleteAssets(prefix: string) {
  if (config().local)
    await rm(localPath(prefix), { recursive: true, force: true });
  else
    await bucket().deleteFiles({
      prefix: prefix.endsWith("/") ? prefix : prefix + "/",
    });
}
export async function fixtureAudio(text: string): Promise<Buffer> {
  const { hashToken } = await import("./security");
  try {
    return await readFile(
      join(process.cwd(), "fixtures", "audio", `${hashToken(text)}.mp3`),
    );
  } catch {
    return readFile(join(process.cwd(), "fixtures", "audio", "mock.mp3"));
  }
}
