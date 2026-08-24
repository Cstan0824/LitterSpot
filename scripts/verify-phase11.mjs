import { spawn } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const code = await new Promise((resolve, reject) => {
  const child = spawn(npm, ["run", "verify:phase9"], { cwd: process.cwd(), env: process.env, stdio: "inherit" });
  child.once("error", reject);
  child.once("exit", (exitCode, signal) => signal
    ? reject(new Error(`Phase 10-11 verification ended with ${signal}.`))
    : resolve(exitCode ?? 1));
});
if (code !== 0) process.exit(code);
console.log("\nCombined Phase 10-11 backend verification passed on top of the Phase 1-9 regression gate.");
