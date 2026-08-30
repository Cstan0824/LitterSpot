import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const python = process.platform === "win32"
  ? join(root, ".venv", "Scripts", "python.exe")
  : join(root, ".venv", "bin", "python");

if (!existsSync(python)) throw new Error(`Python environment missing: ${python}`);

async function run(label, command, arguments_, environment = {}) {
  console.log(`\n[Phase 9] ${label}`);
  const code = await new Promise((resolveExit, reject) => {
    const child = spawn(command, arguments_, {
      cwd: root,
      env: { ...process.env, ...environment },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      if (signal) reject(new Error(`${label} ended with ${signal}.`));
      else resolveExit(exitCode ?? 1);
    });
  });
  if (code !== 0) process.exit(code);
}

await run("Backend unit and contract tests", npm, ["--workspace=backend", "run", "test"]);
await run("Backend TypeScript build", npm, ["--workspace=backend", "run", "build"]);
await run("Isolated assignment provider and pair-contract tests", npm, ["run", "test:assignment"]);
await run("Frontend compatibility build", npm, ["--workspace=frontend", "run", "build"]);
await run("Canonical Postman YAML and scripts", npm, ["run", "validate:postman"]);
await run("FastAPI inference-only contract tests", python, [
  "-m", "unittest", "discover", "-s", "ai-service/tests", "-p", "test_*.py",
], { PYTHONDONTWRITEBYTECODE: "1" });
await run("Firebase Auth/Firestore integration and smoke gate", npm, ["run", "test:emulator"]);

console.log("\nPhase 9 in-repository verification passed.");
