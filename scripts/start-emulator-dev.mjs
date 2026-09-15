import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { get } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const localRoot = join(root, ".local");
const exportRoot = join(localRoot, "firebase-emulator-data");
const mediaRoot = join(localRoot, "emulator-media");
const configPath = join(localRoot, "firebase-emulator-dev.json");
const pidFile = join(localRoot, "local-services.json");
const fixtureRoot = join(root, "fixtures", "emulator");
const fixtureExportRoot = join(fixtureRoot, "firebase-emulator-data");
const fixtureMediaRoot = join(fixtureRoot, "media");
const firebaseCli = join(root, "node_modules", "firebase-tools", "lib", "bin", "firebase.js");
const python = process.platform === "win32" ? join(root, ".venv", "Scripts", "python.exe") : join(root, ".venv", "bin", "python");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const token = "local-playground-token";
const project = "demo-litterspot";
const children = [];
mkdirSync(localRoot, { recursive: true });
const localSnapshotExists = existsSync(join(exportRoot, "firebase-export-metadata.json"));
const teamFixtureExists = existsSync(join(fixtureExportRoot, "firebase-export-metadata.json")) && existsSync(fixtureMediaRoot);
if (!localSnapshotExists && teamFixtureExists) {
  cpSync(fixtureExportRoot, exportRoot, { recursive: true, errorOnExist: true });
  cpSync(fixtureMediaRoot, mediaRoot, { recursive: true, errorOnExist: true });
  console.log("Initialized local Firebase and media data from the shared team fixture.");
}
mkdirSync(mediaRoot, { recursive: true });

writeFileSync(configPath, JSON.stringify({
  firestore: { database: "(default)", rules: join(root, "firestore.rules"), indexes: join(root, "firestore.indexes.json") },
  emulators: { auth: { host: "127.0.0.1", port: 9199 }, firestore: { host: "127.0.0.1", port: 8180 }, ui: { enabled: true, host: "127.0.0.1", port: 4100 }, singleProjectMode: true },
}, null, 2));

const common = {
  APP_ENV: "local-emulator", FIREBASE_PROJECT_ID: project, EXPECTED_FIREBASE_PROJECT_ID: project, FIREBASE_DATABASE_ID: "(default)", GCLOUD_PROJECT: project,
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8180", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9199", MEDIA_STORAGE_ROOT: mediaRoot,
  ORCHESTRATOR_WORKER_ENABLED: process.env.ORCHESTRATOR_WORKER_ENABLED ?? "true", ANALYTICS_WORKER_ENABLED: "false", CAMERA_DEMO_SCENES_ENABLED: "true", ORCHESTRATOR_INTERNAL_TOKEN: "emulator-orchestrator-token",
};

function portInUse(port) { return new Promise(resolvePort => { const socket = createConnection({ host: "127.0.0.1", port }); socket.once("connect", () => { socket.destroy(); resolvePort(true); }); socket.once("error", () => resolvePort(false)); }); }
async function waitForPort(port, label) { for (let attempt = 0; attempt < 60; attempt++) { if (await portInUse(port)) return; await new Promise(resolveWait => setTimeout(resolveWait, 250)); } throw new Error(`${label} did not start on port ${port}.`); }
async function waitForHttp(url, label) { for (let attempt = 0; attempt < 60; attempt++) { try { await new Promise((resolveRequest, rejectRequest) => get(url, response => { response.resume(); response.statusCode && response.statusCode < 500 ? resolveRequest() : rejectRequest(); }).on("error", rejectRequest)); return; } catch { await new Promise(resolveWait => setTimeout(resolveWait, 500)); } } throw new Error(`${label} did not become ready.`); }
function start(name, command, args, extra = {}) { const executable = process.platform === "win32" && command === npm ? process.env.ComSpec : command; const launchArgs = process.platform === "win32" && command === npm ? ["/d", "/s", "/c", [command, ...args].join(" ")] : args; const child = spawn(executable, launchArgs, { cwd: root, env: { ...process.env, ...common, ...extra }, stdio: "inherit", detached: process.platform !== "win32" }); children.push({ name, child }); return child; }
async function exportEmulatorData() {
  if (!children.some(entry => entry.name === "firebase" && entry.child.exitCode === null)) return;
  await new Promise((resolveExport, rejectExport) => {
    const exporter = spawn(process.execPath, [firebaseCli, "emulators:export", exportRoot, "--force", "--project", project, "--config", configPath], {
      cwd: root, env: { ...process.env, ...common, FIREBASE_EMULATORS_PATH: join(localRoot, "firebase-emulators"), XDG_CONFIG_HOME: join(localRoot, "firebase-config") }, stdio: "inherit",
    });
    exporter.once("error", rejectExport); exporter.once("exit", code => code === 0 ? resolveExport() : rejectExport(new Error(`Local Firebase export failed with exit code ${code}.`)));
  });
}
async function stopProcess(name, pid) {
  try {
    if (process.platform === "win32") process.kill(pid);
    else if (name === "firebase") { process.kill(pid, "SIGINT"); await new Promise(resolveWait => setTimeout(resolveWait, 1500)); try { process.kill(-pid, "SIGTERM"); } catch {} }
    else process.kill(-pid, "SIGTERM");
  } catch { try { process.kill(pid, "SIGTERM"); } catch {} }
}
let cleaning = false;
async function cleanup() {
  if (cleaning) return false; cleaning = true;
  try { await exportEmulatorData(); }
  catch (error) { cleaning = false; throw error; }
  for (const entry of children.slice().reverse()) await stopProcess(entry.name, entry.child.pid);
  return true;
}
let failing = false;
async function fail(error) { if (failing) return; failing = true; console.error(error); try { await cleanup(); } catch (cleanupError) { console.error(cleanupError); } process.exit(1); }
process.once("uncaughtException", error => { void fail(error); });
process.once("unhandledRejection", error => { void fail(error); });
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void cleanup().then(stopped => { if (stopped) process.exit(0); }).catch(error => console.error(error)); });

for (const [port, label] of [[3000, "Node"], [8000, "FastAPI"], [5173, "frontend"], [8180, "Firestore emulator"], [9199, "Auth emulator"], [4100, "Emulator UI"]]) if (await portInUse(port)) throw new Error(`${label} port ${port} is already in use. Run npm stop for this workspace first.`);

const emulatorArgs = [firebaseCli, "emulators:start", "--only", "auth,firestore", "--project", project, "--config", configPath];
if (existsSync(join(exportRoot, "firebase-export-metadata.json"))) emulatorArgs.push("--import", exportRoot);
start("firebase", process.execPath, emulatorArgs, { FIREBASE_EMULATORS_PATH: join(localRoot, "firebase-emulators"), XDG_CONFIG_HOME: join(localRoot, "firebase-config") });
await Promise.all([waitForPort(8180, "Firestore emulator"), waitForPort(9199, "Auth emulator")]);

await new Promise((resolveSeed, rejectSeed) => {
  const seed = spawn(process.execPath, [join(root, "node_modules", "tsx", "dist", "cli.mjs"), join(root, "backend", "src", "scripts", "bootstrapDevelopmentSite.ts")], {
    cwd: root, env: { ...process.env, ...common, ROOT_SUPERVISOR_EMAIL: "root@sunway-test.com", ROOT_SUPERVISOR_PASSWORD: "password123", ROOT_SUPERVISOR_DISPLAY_NAME: "Sunway Root Supervisor", SUPERADMIN_EMAIL: "superadmin@litterspot.com", SUPERADMIN_PASSWORD: "password123", SUPERADMIN_DISPLAY_NAME: "LitterSpot Superadmin" }, stdio: "inherit",
  });
  seed.once("error", rejectSeed); seed.once("exit", code => code === 0 ? resolveSeed() : rejectSeed(new Error(`Local bootstrap failed with exit code ${code}.`)));
});

const classifier = process.env.STATE_CLASSIFIER_PATH || join(root, "runs", "state_classifier", "multitask_gco_gbs_v2", "production.pt");
start("fastapi", python, ["-m", "uvicorn", "app.main:app", "--app-dir", "ai-service", "--host", "127.0.0.1", "--port", "8000"], { STATE_CLASSIFIER_PATH: classifier, STATE_CLASSIFIER_VERSION: "multitask-mobilenet-gco-gbs-v2", DEVICE: "0", INTERNAL_API_TOKEN: token });
start("node", npm, ["--workspace=backend", "run", "dev"], { PORT: "3000", AI_SERVICE_URL: "http://127.0.0.1:8000", AI_SERVICE_TOKEN: token, CORS_ORIGINS: "http://127.0.0.1:5173,http://localhost:5173" });
start("frontend", npm, ["--workspace=frontend", "run", "dev", "--", "--port", "5173", "--strictPort"], {
  VITE_FIREBASE_API_KEY: "emulator", VITE_FIREBASE_AUTH_DOMAIN: `${project}.firebaseapp.com`, VITE_FIREBASE_PROJECT_ID: project,
  VITE_FIREBASE_STORAGE_BUCKET: `${project}.appspot.com`, VITE_FIREBASE_MESSAGING_SENDER_ID: "123", VITE_FIREBASE_APP_ID: "local-emulator",
  VITE_FIREBASE_AUTH_EMULATOR_URL: "http://127.0.0.1:9199", VITE_FIRESTORE_EMULATOR_HOST: "127.0.0.1", VITE_FIRESTORE_EMULATOR_PORT: "8180", VITE_BACKEND_PROXY_TARGET: "http://127.0.0.1:3000",
});
writeFileSync(pidFile, JSON.stringify(Object.fromEntries(children.map(entry => [entry.name, entry.child.pid])), null, 2));
await Promise.all([waitForHttp("http://127.0.0.1:3000/api/health/live", "Node"), waitForHttp("http://127.0.0.1:5173", "frontend")]);
console.log("\nLocal LitterSpot is ready:"); console.log("  App: http://127.0.0.1:5173"); console.log("  Firebase emulator UI: http://127.0.0.1:4100"); console.log("  Root: root@sunway-test.com / password123"); console.log("  Superadmin: superadmin@litterspot.com / password123"); console.log("Press Ctrl+C or run npm stop from another terminal to export local data and stop all services.");
await new Promise(() => {});
