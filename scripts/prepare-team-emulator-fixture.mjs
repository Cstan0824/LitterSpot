import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const localRoot = join(root, ".local");
const localExport = join(localRoot, "firebase-emulator-data");
const localMedia = join(localRoot, "emulator-media");
const servicesFile = join(localRoot, "local-services.json");
const fixtureRoot = join(root, "fixtures", "emulator");
const fixtureExport = join(fixtureRoot, "firebase-emulator-data");
const fixtureMedia = join(fixtureRoot, "media");

if (existsSync(servicesFile)) throw new Error("Stop the local stack with `npm stop` before updating the shared emulator fixture.");
if (!existsSync(join(localExport, "firebase-export-metadata.json"))) throw new Error("No exported emulator state was found. Start the emulator, finish the data changes, then run `npm stop`.");
if (!existsSync(localMedia)) throw new Error("The local emulator media directory is missing.");

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

const sourceExportFiles = collect(localExport);
const sourceMediaFiles = collect(localMedia);
const mediaBytes = sourceMediaFiles.reduce((sum, path) => sum + statSync(path).size, 0);
const largestMedia = sourceMediaFiles.map((path) => ({ path: relative(localMedia, path), bytes: statSync(path).size })).sort((left, right) => right.bytes - left.bytes)[0] ?? null;
const githubFileLimit = 100 * 1024 * 1024;
if (largestMedia && largestMedia.bytes >= githubFileLimit) {
  throw new Error(`Fixture media ${largestMedia.path} is ${largestMedia.bytes} bytes and exceeds GitHub's 100 MB file limit.`);
}

rmSync(fixtureExport, { recursive: true, force: true });
rmSync(fixtureMedia, { recursive: true, force: true });
mkdirSync(fixtureRoot, { recursive: true });
cpSync(localExport, fixtureExport, { recursive: true, errorOnExist: true });
cpSync(localMedia, fixtureMedia, { recursive: true, errorOnExist: true });

writeFileSync(join(fixtureRoot, "manifest.json"), `${JSON.stringify({
  schemaVersion: 1,
  firebaseProjectId: "demo-litterspot",
  firestoreDatabaseId: "(default)",
  generatedAt: new Date().toISOString(),
  firebaseExportFileCount: sourceExportFiles.length,
  mediaFileCount: sourceMediaFiles.length,
  mediaBytes,
  largestMedia,
  developmentAccounts: [
    { role: "superadmin", email: "superadmin@litterspot.com", password: "password123" },
    { role: "root", email: "root@sunway-test.com", password: "password123" },
    { role: "cleaner", email: "gan@sunway-cleaner.com", password: "password123" },
  ],
}, null, 2)}\n`);

console.log(JSON.stringify({ status: "complete", fixtureRoot, firebaseExportFileCount: sourceExportFiles.length, mediaFileCount: sourceMediaFiles.length, mediaMiB: Number((mediaBytes / 1024 / 1024).toFixed(1)), largestMedia }, null, 2));
