import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
async function runNpm(arguments_, extraEnvironment = {}) {
  return new Promise((resolveExit, reject) => {
    const child = spawn(npm, arguments_, {
      cwd: root,
      env: { ...process.env, ...extraEnvironment },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) return reject(new Error(`${arguments_.join(" ")} ended with ${signal}.`));
      return resolveExit(code ?? 1);
    });
  });
}

const integrationTests = [
  ["src/app.test.ts", { RUN_HTTP_TESTS: "1" }],
  ["src/auth.integration.test.ts", {}],
  ["src/services/firestoreCursorPagination.integration.test.ts", {}],
  ["src/services/imageUpload.integration.test.ts", {}],
  ["src/cleanerOperations.integration.test.ts", {}],
  ["src/services/mediaRetention.integration.test.ts", {}],
];

for (const [testFile, environment] of integrationTests) {
  const exitCode = await runNpm(
    ["--workspace=backend", "run", "test", "--", "--run", testFile],
    environment,
  );
  if (exitCode !== 0) process.exit(exitCode);
}

const smokeScripts = ["smoke:alerts", "smoke:dashboard", "smoke:analytics", "smoke:system-events"];

for (const script of smokeScripts) {
  const exitCode = await runNpm(["--workspace=backend", "run", script]);
  if (exitCode !== 0) process.exit(exitCode);
}

console.log("All Firestore emulator smoke workflows passed.");
if (process.env.LITTERSPOT_EMULATOR_SENTINEL) {
  await writeFile(process.env.LITTERSPOT_EMULATOR_SENTINEL, new Date().toISOString(), { flag: "wx" });
}
