import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createConnection } from "node:net";
import { get } from "node:http";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const stateDir = join(root, ".local");
const pidFile = join(stateDir, "local-services.json");
const python = process.platform === "win32" ? join(root, ".venv", "Scripts", "python.exe") : join(root, ".venv", "bin", "python");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const classifier = process.env.STATE_CLASSIFIER_PATH || join(root, "runs", "state_classifier", "multitask_gco_gbs_v2", "production.pt");
const token = "local-playground-token";
const children = [];

function backendPortFromEnv() {
  const backendEnv = join(root, "backend", ".env");
  if (!existsSync(backendEnv)) return 3000;
  const entry = readFileSync(backendEnv, "utf8").split(/\r?\n/).map((line) => line.trim())
    .find((line) => line.startsWith("PORT="));
  const value = Number(entry?.slice("PORT=".length).trim().replace(/^['"]|['"]$/g, ""));
  return Number.isInteger(value) && value > 0 && value <= 65_535 ? value : 3000;
}

const backendPort = backendPortFromEnv();
if (!existsSync(python)) throw new Error(`Python environment missing: ${python}`);
if (!existsSync(classifier)) console.warn("No bin-state classifier found; FastAPI will start degraded until STATE_CLASSIFIER_PATH is provided.");
mkdirSync(stateDir, { recursive: true });

function portInUse(port) {
  return new Promise((resolvePort) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolvePort(true); });
    socket.once("error", () => resolvePort(false));
  });
}

async function stopProcess(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    try { execFileSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" }); } catch {}
  } else {
    try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch {} }
  }
}

async function cleanup() {
  await Promise.all(children.map((child) => stopProcess(child.pid)));
  try { unlinkSync(pidFile); } catch {}
}

for (const port of [8000, backendPort]) {
  if (await portInUse(port)) throw new Error(`LitterSpot port ${port} is already in use. Close the existing service, then run npm start again.`);
}

function start(command, args, env = {}, detached = process.platform !== "win32") {
  const executable = process.platform === "win32" && command === npm ? process.env.ComSpec : command;
  const launchArgs = process.platform === "win32" && command === npm ? ["/d", "/s", "/c", [command, ...args].join(" ")] : args;
  const child = spawn(executable, launchArgs, { cwd: root, env: { ...process.env, ...env }, stdio: "inherit", detached });
  children.push(child);
  child.once("exit", (code) => { if (code && !shuttingDown) console.error(`${command} exited with code ${code}`); });
  return child;
}

let shuttingDown = false;
process.once("SIGINT", async () => { shuttingDown = true; await cleanup(); process.exit(0); });
process.once("SIGTERM", async () => { shuttingDown = true; await cleanup(); process.exit(0); });

const fastapi = start(python, ["-m", "uvicorn", "app.main:app", "--app-dir", "ai-service", "--host", "127.0.0.1", "--port", "8000"], {
  STATE_CLASSIFIER_PATH: classifier,
  STATE_CLASSIFIER_VERSION: "multitask-mobilenet-gco-gbs-v2",
  ENABLE_LEGACY_DETECTOR: "false",
  DEVICE: "0",
  INTERNAL_API_TOKEN: token,
});
const backend = start(npm, ["--workspace=backend", "run", "dev"], {
  PORT: String(backendPort),
  AI_SERVICE_URL: "http://127.0.0.1:8000",
  AI_SERVICE_TOKEN: token,
});
writeFileSync(pidFile, JSON.stringify({ fastapi: fastapi.pid, node: backend.pid }, null, 2));

const liveness = `http://127.0.0.1:${backendPort}/api/health/live`;
for (let attempt = 0; attempt < 30; attempt += 1) {
  try {
    await new Promise((resolveRequest, rejectRequest) => get(liveness, (response) => {
      response.resume();
      response.statusCode === 200 ? resolveRequest() : rejectRequest();
    }).on("error", rejectRequest));
    console.log(`LitterSpot API is running: http://127.0.0.1:${backendPort}`);
    console.log("FastAPI is running: http://127.0.0.1:8000");
    console.log("The legacy frontend was not started. Press Ctrl+C to stop both services.");
    break;
  } catch { await new Promise((resolveWait) => setTimeout(resolveWait, 1000)); }
  if (attempt === 29) { await cleanup(); throw new Error("The backend did not start within 30 seconds."); }
}

await new Promise(() => {});
