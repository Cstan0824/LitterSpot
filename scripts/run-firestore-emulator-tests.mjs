import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const firebaseCli = join(root, "node_modules", "firebase-tools", "lib", "bin", "firebase.js");
const emulatorCache = join(root, ".local", "firebase-emulators");
const firebaseConfig = join(root, ".local", "firebase-config");
const sentinel = join(root, ".local", "firebase-emulator-smokes.passed");
const mediaRoot = join(root, ".local", "firebase-emulator-media");
const videoTempRoot = join(mediaRoot, ".incoming");
mkdirSync(emulatorCache, { recursive: true });
mkdirSync(firebaseConfig, { recursive: true });
rmSync(mediaRoot, { recursive: true, force: true });
mkdirSync(videoTempRoot, { recursive: true });
try { unlinkSync(sentinel); } catch {}

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
  FIREBASE_DATABASE_ID: "litterspot",
  GCLOUD_PROJECT: "demo-litterspot",
  LITTERSPOT_EMULATOR_SENTINEL: sentinel,
  MEDIA_STORAGE_ROOT: mediaRoot,
  VIDEO_UPLOAD_TEMP_ROOT: videoTempRoot,
};
delete environment.GOOGLE_APPLICATION_CREDENTIALS;

const child = spawn(process.execPath, [
  firebaseCli,
  "emulators:exec",
  "--only", "firestore,auth",
  "--project", "demo-litterspot",
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
