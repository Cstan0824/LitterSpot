import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const firebaseCli = join(root, "node_modules", "firebase-tools", "lib", "bin", "firebase.js");
const emulatorCache = join(root, ".local", "firebase-emulators");
const firebaseConfig = join(root, ".local", "firebase-config");
const sentinel = join(root, ".local", "firebase-emulator-smokes.passed");
const mediaRoot = join(root, ".local", "firebase-emulator-media");
const videoTempRoot = join(mediaRoot, ".incoming");
const testConfig = join(root, ".local", "firebase-emulator-test.json");
mkdirSync(emulatorCache, { recursive: true });
mkdirSync(firebaseConfig, { recursive: true });
rmSync(mediaRoot, { recursive: true, force: true });
mkdirSync(videoTempRoot, { recursive: true });
try { unlinkSync(sentinel); } catch {}
writeFileSync(testConfig, JSON.stringify({
  firestore: { database: "(default)", rules: join(root, "firestore.rules"), indexes: join(root, "firestore.indexes.json") },
  emulators: { auth: { host: "127.0.0.1", port: 9299 }, firestore: { host: "127.0.0.1", port: 8280 }, ui: { enabled: false }, singleProjectMode: true },
}, null, 2));

const customCommand = process.argv.slice(2).join(" ");
const childCommand = customCommand || "node scripts/run-emulator-smokes.mjs";
const requiresSentinel = !customCommand;
const environment = {
  ...process.env,
  APP_ENV: "local-emulator",
  EXPECTED_FIREBASE_PROJECT_ID: "demo-litterspot",
  FIREBASE_EMULATORS_PATH: emulatorCache,
  XDG_CONFIG_HOME: firebaseConfig,
  FIREBASE_PROJECT_ID: "demo-litterspot",
  FIREBASE_DATABASE_ID: "(default)",
  GCLOUD_PROJECT: "demo-litterspot",
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8280",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9299",
  LITTERSPOT_EMULATOR_SENTINEL: sentinel,
  MEDIA_STORAGE_ROOT: mediaRoot,
  VIDEO_UPLOAD_TEMP_ROOT: videoTempRoot,
  ORCHESTRATOR_INTERNAL_TOKEN: "emulator-orchestrator-token",
};
delete environment.GOOGLE_APPLICATION_CREDENTIALS;

const child = spawn(process.execPath, [
  firebaseCli,
  "emulators:exec",
  "--only", "firestore,auth",
  "--project", "demo-litterspot",
  "--config", testConfig,
  childCommand,
], { cwd: root, env: environment, stdio: "inherit" });

child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) console.error(`Firebase emulator test process ended with ${signal}.`);
  if (requiresSentinel && !existsSync(sentinel)) {
    console.error("Firestore emulator smoke command did not complete; treating the run as failed.");
    process.exitCode = 1;
  } else {
    try { unlinkSync(sentinel); } catch {}
    process.exitCode = code ?? 1;
  }
  rmSync(mediaRoot, { recursive: true, force: true });
});
