import { cpSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const localRoot = join(root, ".local");
const servicesFile = join(localRoot, "local-services.json");
const fixtureRoot = join(root, "fixtures", "emulator");
const fixtureExport = join(fixtureRoot, "firebase-emulator-data");
const fixtureMedia = join(fixtureRoot, "media");
const localExport = join(localRoot, "firebase-emulator-data");
const localMedia = join(localRoot, "emulator-media");
const dryRun = process.argv.includes("--dry-run");

if (existsSync(servicesFile)) throw new Error("Stop the local stack with `npm stop` before resetting emulator data.");
if (!existsSync(join(fixtureExport, "firebase-export-metadata.json")) || !existsSync(join(fixtureRoot, "manifest.json"))) throw new Error("The shared emulator fixture is incomplete.");
if (!existsSync(fixtureMedia)) throw new Error("The shared emulator media fixture is missing.");

if (dryRun) {
  console.log(JSON.stringify({ status: "ready", fixtureRoot, localStateExists: existsSync(localExport) || existsSync(localMedia), action: "Run without --dry-run to back up local state and restore the team fixture." }, null, 2));
  process.exit(0);
}

mkdirSync(localRoot, { recursive: true });
const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const backupRoot = join(localRoot, "backups", `before-team-reset-${stamp}`);
if (existsSync(localExport) || existsSync(localMedia)) {
  mkdirSync(backupRoot, { recursive: true });
  if (existsSync(localExport)) renameSync(localExport, join(backupRoot, "firebase-emulator-data"));
  if (existsSync(localMedia)) renameSync(localMedia, join(backupRoot, "emulator-media"));
}
cpSync(fixtureExport, localExport, { recursive: true, errorOnExist: true });
cpSync(fixtureMedia, localMedia, { recursive: true, errorOnExist: true });

console.log(JSON.stringify({ status: "complete", restoredFrom: fixtureRoot, previousLocalState: existsSync(backupRoot) ? backupRoot : null, next: "Run npm run start:emulator" }, null, 2));
