import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const bundledPython = process.platform === "win32"
  ? join(root, ".venv", "Scripts", "python.exe")
  : join(root, ".venv", "bin", "python");
const python = existsSync(bundledPython) ? bundledPython : (process.platform === "win32" ? "python" : "python3");

const result = spawnSync(
  python,
  ["task-assignment-llm/scripts/demo_isolated_assignment.py", ...process.argv.slice(2)],
  {
    cwd: root,
    env: { ...process.env, PYTHONPATH: resolve(root, "task-assignment-llm") },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
