import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pidFile = join(root, ".local", "local-services.json");
if (!existsSync(pidFile)) { console.log("No local LitterSpot services are recorded as running."); process.exit(0); }
const services = JSON.parse(readFileSync(pidFile, "utf8"));
for (const [name, pid] of Object.entries(services)) {
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
    else process.kill(-pid, "SIGTERM");
    console.log(`Stopped ${name} and child processes (PID ${pid}).`);
  } catch {}
}
unlinkSync(pidFile);
