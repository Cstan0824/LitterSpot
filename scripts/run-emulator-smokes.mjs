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
  ["src/retiredProcessingRoutes.integration.test.ts", {}],
  ["src/services/mediaRetention.integration.test.ts", {}],
  ["src/foundation.integration.test.ts", {}],
  ["src/identity.integration.test.ts", {}],
  ["src/siteMap.integration.test.ts", {}],
  ["src/cleaner.integration.test.ts", {}],
  ["src/camera.integration.test.ts", {}],
  ["src/cameraRemoval.integration.test.ts", {}],
  ["src/cameraScenes.integration.test.ts", {}],
  ["src/monitoring.integration.test.ts", {}],
  ["src/services/monitoringQuota.integration.test.ts", {}],
  ["src/workOrder.integration.test.ts", {}],
  ["src/orchestrator.integration.test.ts", {}],
  ["src/testSupport.integration.test.ts", {}],
  ["src/operations.integration.test.ts", {}],
  ["src/phase11.integration.test.ts", {}],
];

for (const [testFile, environment] of integrationTests) {
  const exitCode = await runNpm(
    ["--workspace=backend", "run", "test", "--", "--run", "--testTimeout=15000", testFile],
    environment,
  );
  if (exitCode !== 0) process.exit(exitCode);
}

const smokeScripts = ["smoke:system-events"];

for (const script of smokeScripts) {
  const exitCode = await runNpm(["--workspace=backend", "run", script]);
  if (exitCode !== 0) process.exit(exitCode);
}

console.log("All Firestore emulator smoke workflows passed.");
if (process.env.LITTERSPOT_EMULATOR_SENTINEL) {
  await writeFile(process.env.LITTERSPOT_EMULATOR_SENTINEL, new Date().toISOString(), { flag: "wx" });
}
