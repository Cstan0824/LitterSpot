import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureRoot = join(root, "fixtures", "emulator");
const exportRoot = join(fixtureRoot, "firebase-emulator-data");
const mediaRoot = join(fixtureRoot, "media");
const manifestPath = join(fixtureRoot, "manifest.json");
if (!existsSync(manifestPath)) throw new Error("Shared emulator manifest is missing.");
if (!existsSync(join(exportRoot, "firebase-export-metadata.json"))) throw new Error("Shared Firebase export metadata is missing.");
if (!existsSync(mediaRoot)) throw new Error("Shared emulator media is missing.");

function collect(directory) {
  const output = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) output.push(path);
    }
  };
  visit(directory);
  return output;
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.firebaseProjectId !== "demo-litterspot" || manifest.firestoreDatabaseId !== "(default)") throw new Error("Shared fixture targets an unexpected Firebase project.");
const exportFiles = collect(exportRoot);
const mediaFiles = collect(mediaRoot);
const mediaBytes = mediaFiles.reduce((sum, path) => sum + statSync(path).size, 0);
const largestMedia = mediaFiles.map((path) => ({ path: relative(mediaRoot, path), bytes: statSync(path).size })).sort((left, right) => right.bytes - left.bytes)[0] ?? null;
if (exportFiles.length !== manifest.firebaseExportFileCount) throw new Error(`Firebase export file count changed: expected ${manifest.firebaseExportFileCount}, found ${exportFiles.length}.`);
if (mediaFiles.length !== manifest.mediaFileCount) throw new Error(`Media file count changed: expected ${manifest.mediaFileCount}, found ${mediaFiles.length}.`);
if (mediaBytes !== manifest.mediaBytes) throw new Error(`Media byte count changed: expected ${manifest.mediaBytes}, found ${mediaBytes}.`);
if (largestMedia?.path !== manifest.largestMedia?.path || largestMedia?.bytes !== manifest.largestMedia?.bytes) throw new Error("Largest fixture media no longer matches the manifest.");
if (mediaFiles.some((path) => statSync(path).size >= 100 * 1024 * 1024)) throw new Error("A fixture file exceeds GitHub's 100 MB limit.");

console.log(JSON.stringify({ status: "valid", firebaseExportFileCount: exportFiles.length, mediaFileCount: mediaFiles.length, mediaMiB: Number((mediaBytes / 1024 / 1024).toFixed(1)), largestMedia }, null, 2));
