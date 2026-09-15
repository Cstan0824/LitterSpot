import { mkdir, open, rename, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { HttpError } from "../shared/httpError.js";

export function resolveStorageKey(storageKey: string, root = env.mediaStorageRoot) {
  if (!storageKey || isAbsolute(storageKey) || storageKey.includes("\\") || storageKey.includes("\0")) {
    throw new HttpError(400, "Invalid storage key.");
  }
  const rootPath = resolve(root);
  const filePath = resolve(rootPath, storageKey);
  const relativePath = relative(rootPath, filePath);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new HttpError(400, "Invalid storage key.");
  }
  return filePath;
}

export async function writeMedia(storageKey: string, contents: Buffer, root = env.mediaStorageRoot) {
  const filePath = resolveStorageKey(storageKey, root);
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    await rename(temporaryPath, filePath);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return filePath;
}

export async function inspectMedia(storageKey: string, root = env.mediaStorageRoot) {
  const filePath = resolveStorageKey(storageKey, root);
  try {
    const details = await stat(filePath);
    if (!details.isFile()) throw new Error("Stored media is not a file.");
    return { filePath, byteSize: details.size };
  } catch {
    throw new HttpError(410, "Stored media file is unavailable.");
  }
}

export async function deleteStoredMedia(storageKey: string, root = env.mediaStorageRoot) {
  const filePath = resolveStorageKey(storageKey, root);
  await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}
