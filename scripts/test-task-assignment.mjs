import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const python = process.platform === "win32" ? "python" : "python3";

function run(label, command, args, environment = {}) {
  console.log(`\n[assignment test] ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...environment },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(
  "isolated JSON tools and LLM/provider contract tests (no backend or Firestore)",
  python,
  ["-m", "unittest", "discover", "-s", "task-assignment-llm/tests", "-v"],
  { PYTHONPATH: resolve(root, "task-assignment-llm") },
);

console.log("\nAll isolated task-assignment tests passed.");
