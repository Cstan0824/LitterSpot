import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mediaRoot = join(root, ".local", "emulator-media");
const projectId = process.env.GCLOUD_PROJECT ?? "demo-litterspot";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8180";

async function hashFile(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function probe(path) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
    "-show_entries", "format=duration", "-of", "json", path,
  ]);
  const data = JSON.parse(stdout);
  return { width: Number(data.streams?.[0]?.width), height: Number(data.streams?.[0]?.height), durationSeconds: Number(data.format?.duration) };
}

initializeApp({ projectId });
const firestore = getFirestore();
const assets = await firestore.collection("mediaAssets").get();
const updates = [];
for (const document of assets.docs) {
  const data = document.data();
  if (data.purpose !== "camera_source_video" || typeof data.storageKey !== "string") continue;
  const path = join(mediaRoot, data.storageKey);
  const details = await stat(path).catch(() => null);
  if (!details?.isFile()) continue;
  const update = { byteSize: details.size, sha256: await hashFile(path) };
  Object.assign(update, await probe(path));
  if (Number(data.byteSize) !== update.byteSize || String(data.sha256) !== update.sha256 || Number(data.width) !== update.width || Number(data.height) !== update.height || Math.abs(Number(data.durationSeconds) - update.durationSeconds) > 0.01) {
    updates.push({ id: document.id, path: data.storageKey, before: { byteSize: data.byteSize, sha256: data.sha256, width: data.width, height: data.height, durationSeconds: data.durationSeconds }, after: update });
    await document.ref.update(update);
  }
}

console.log(JSON.stringify({ status: "complete", projectId, updatedAssets: updates }, null, 2));
