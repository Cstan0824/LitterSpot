import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pidFile = join(root, ".local", "local-services.json");
const exportRoot = join(root, ".local", "firebase-emulator-data");
const configPath = join(root, ".local", "firebase-emulator-dev.json");
const firebaseCli = join(root, "node_modules", "firebase-tools", "lib", "bin", "firebase.js");
if (!existsSync(pidFile)) { console.log("No local LitterSpot services are recorded as running."); process.exit(0); }
const services = JSON.parse(readFileSync(pidFile, "utf8"));
if (services.firebase && process.platform !== "win32") {
  try {
    execFileSync(process.execPath, [firebaseCli, "emulators:export", exportRoot, "--force", "--project", "demo-litterspot", "--config", configPath], {
      cwd: root,
      env: { ...process.env, FIREBASE_PROJECT_ID: "demo-litterspot", GCLOUD_PROJECT: "demo-litterspot", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8180", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9199" },
      stdio: "inherit",
    });
    console.log("Exported local Firebase data.");
  } catch { console.error("Local Firebase export failed; services were left running to protect the current data."); process.exit(1); }
}
for (const [name, pid] of Object.entries(services).reverse()) {
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
    else if (name === "firebase") {
      process.kill(pid, "SIGINT");
      await new Promise(resolveWait => setTimeout(resolveWait, 1500));
      try { process.kill(-Number(pid), "SIGTERM"); } catch {}
    }
    else process.kill(-pid, "SIGTERM");
    console.log(`Stopped ${name} and child processes (PID ${pid}).`);
  } catch {}
}
unlinkSync(pidFile);
