import { constants } from "node:fs";
import { createReadStream } from "node:fs";
import { chmod, copyFile, link, mkdir, open, readdir, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
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

function assertWithinRoot(filePath: string, root: string) {
  const rootPath = resolve(root);
  const candidate = resolve(filePath);
  const relativePath = relative(rootPath, candidate);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new HttpError(400, "Invalid temporary media path.");
  }
  return candidate;
}

export function temporaryMediaName(temporaryPath: string, temporaryRoot = env.videoUploadTempRoot) {
  const sourcePath = assertWithinRoot(temporaryPath, temporaryRoot);
  const name = basename(sourcePath);
  if (resolve(temporaryRoot, name) !== sourcePath) {
    throw new HttpError(400, "Temporary media must be a direct child of the configured staging directory.");
  }
  return name;
}

export function resolveTemporaryMediaName(name: string, temporaryRoot = env.videoUploadTempRoot) {
  if (!name || isAbsolute(name) || name.includes("/") || name.includes("\\") || name.includes("\0")) {
    throw new HttpError(400, "Invalid temporary media name.");
  }
  return assertWithinRoot(resolve(temporaryRoot, name), temporaryRoot);
}

function isCrossDeviceLinkError(error: unknown) {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EXDEV" || code === "EPERM" || code === "ENOSYS" || code === "ENOTSUP";
}

/**
 * Publish a staged upload without ever overwriting an existing stored asset.
 * A hard link is atomic on the common same-filesystem path. For separate
 * filesystems, copy to a private sibling and atomically link that completed
 * copy into place before removing the source.
 */
export async function moveStagedMedia(
  stagingName: string,
  storageKey: string,
  temporaryRoot = env.videoUploadTempRoot,
  storageRoot = env.mediaStorageRoot,
) {
  const sourcePath = resolveTemporaryMediaName(stagingName, temporaryRoot);
  const sourceDetails = await stat(sourcePath).catch(() => null);
  if (!sourceDetails?.isFile()) throw new HttpError(410, "Staged media file is unavailable.");
  const targetPath = resolveStorageKey(storageKey, storageRoot);
  await mkdir(dirname(targetPath), { recursive: true });
  try {
    await link(sourcePath, targetPath);
  } catch (error) {
    if (!isCrossDeviceLinkError(error)) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new HttpError(409, "Stored media already exists.");
      }
      throw error;
    }
    const copiedPath = `${targetPath}.${randomUUID()}.tmp`;
    try {
      await copyFile(sourcePath, copiedPath, constants.COPYFILE_EXCL);
      const handle = await open(copiedPath, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await link(copiedPath, targetPath);
    } catch (copyError) {
      if ((copyError as NodeJS.ErrnoException).code === "EEXIST") {
        throw new HttpError(409, "Stored media already exists.");
      }
      throw copyError;
    } finally {
      await unlink(copiedPath).catch(() => undefined);
    }
  }
  try {
    await chmod(targetPath, 0o600);
  } catch (error) {
    await unlink(targetPath).catch(() => undefined);
    throw error;
  }
  await unlink(sourcePath).catch(() => undefined);
  return targetPath;
}

export async function moveTemporaryMedia(
  temporaryPath: string,
  storageKey: string,
  temporaryRoot = env.videoUploadTempRoot,
  storageRoot = env.mediaStorageRoot,
) {
  return moveStagedMedia(temporaryMediaName(temporaryPath, temporaryRoot), storageKey, temporaryRoot, storageRoot);
}

export async function discardTemporaryMedia(temporaryPath: string, temporaryRoot = env.videoUploadTempRoot) {
  const sourcePath = assertWithinRoot(temporaryPath, temporaryRoot);
  await unlink(sourcePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

export async function discardStagedMedia(stagingName: string, temporaryRoot = env.videoUploadTempRoot) {
  const sourcePath = resolveTemporaryMediaName(stagingName, temporaryRoot);
  await unlink(sourcePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

async function sha256Path(filePath: string) {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolvePromise);
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

async function inspectIntegrity(filePath: string, expectedByteSize: number, expectedSha256: string) {
  const details = await stat(filePath).catch(() => null);
  if (!details?.isFile() || details.size !== expectedByteSize || await sha256Path(filePath) !== expectedSha256) {
    throw new HttpError(410, "Stored media does not match the accepted upload.");
  }
  return { filePath, byteSize: details.size };
}

export async function inspectMediaIntegrity(
  storageKey: string,
  expectedByteSize: number,
  expectedSha256: string,
  storageRoot = env.mediaStorageRoot,
) {
  return inspectIntegrity(resolveStorageKey(storageKey, storageRoot), expectedByteSize, expectedSha256);
}

export async function inspectStagedMedia(
  stagingName: string,
  expectedByteSize: number,
  expectedSha256: string,
  temporaryRoot = env.videoUploadTempRoot,
) {
  return inspectIntegrity(resolveTemporaryMediaName(stagingName, temporaryRoot), expectedByteSize, expectedSha256);
}

export async function cleanupStaleTemporaryMedia(options: {
  preserveNames?: ReadonlySet<string>;
  olderThanMillis: number;
  nowMillis?: number;
  temporaryRoot?: string;
}) {
  if (!Number.isFinite(options.olderThanMillis) || options.olderThanMillis < 0) {
    throw new Error("olderThanMillis must be a non-negative finite number.");
  }
  const temporaryRoot = options.temporaryRoot ?? env.videoUploadTempRoot;
  const entries = await readdir(temporaryRoot, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const cutoff = (options.nowMillis ?? Date.now()) - options.olderThanMillis;
  let deleted = 0;
  for (const entry of entries) {
    if (!entry.isFile() || options.preserveNames?.has(entry.name)) continue;
    let filePath: string;
    try {
      filePath = resolveTemporaryMediaName(entry.name, temporaryRoot);
    } catch {
      continue;
    }
    const details = await stat(filePath).catch(() => null);
    if (!details?.isFile() || details.mtimeMs > cutoff) continue;
    await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    deleted += 1;
  }
  return deleted;
}

export async function deleteStoredMedia(storageKey: string, root = env.mediaStorageRoot) {
  const filePath = resolveStorageKey(storageKey, root);
  await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}
