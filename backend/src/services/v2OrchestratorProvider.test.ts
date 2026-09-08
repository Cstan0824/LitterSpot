import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { env } from "../config/env.js";
import { assignmentChildEnvironment, createPythonAssignmentSelector, writeAssignmentDebug } from "./v2OrchestratorProvider.js";

const directories: string[] = [];
const systemPythonPath = process.platform === "win32" ? "python" : "python3";
async function script(source: string) {
  const directory = await mkdtemp(join(tmpdir(), "litterspot-provider-")); directories.push(directory);
  const path = join(directory, "provider.py"); await writeFile(path, source); return path;
}
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe("V2 Python assignment bridge", () => {
  it("passes only allowlisted environment values to Python", () => {
    const result = assignmentChildEnvironment({ PATH: "/bin", HOME: "/tmp", GEMINI_API_KEY: "allowed-provider-secret", GOOGLE_APPLICATION_CREDENTIALS: "must-not-pass", ORCHESTRATOR_INTERNAL_TOKEN: "must-not-pass", FIREBASE_CONFIG: "must-not-pass" });
    expect(result).toMatchObject({ PATH: "/bin", HOME: "/tmp", GEMINI_API_KEY: "allowed-provider-secret", PYTHONDONTWRITEBYTECODE: "1" });
    expect(result).not.toHaveProperty("GOOGLE_APPLICATION_CREDENTIALS");
    expect(result).not.toHaveProperty("ORCHESTRATOR_INTERNAL_TOKEN");
    expect(result).not.toHaveProperty("FIREBASE_CONFIG");
  });

  it("parses one strict decision through stdin/stdout", async () => {
    const path = await script(`import json,sys\np=json.load(sys.stdin)\njson.dump({"alertId":p["context"]["eligiblePairs"][0]["alertId"],"cleanerId":"cleaner","rationaleSummary":"selected","provider":"fake","model":"fake"},sys.stdout)\n`);
    const selector = createPythonAssignmentSelector({ pythonPath: systemPythonPath, scriptPath: path });
    await expect(selector.select({ eligiblePairs: [{ alertId: "alert", cleanerId: "cleaner" }] }, { provider: "fake", model: "fake", requestTimeoutMs: 1000 }, "run")).resolves.toMatchObject({ alertId: "alert", cleanerId: "cleaner" });
  });

  it("rejects malformed and oversized output without exposing stderr", async () => {
    const malformed = createPythonAssignmentSelector({ pythonPath: systemPythonPath, scriptPath: await script(`print("not-json")\n`) });
    await expect(malformed.select({}, { provider: "fake", model: "fake", requestTimeoutMs: 1000 }, "run")).rejects.toThrow();
    const oversized = createPythonAssignmentSelector({ pythonPath: systemPythonPath, scriptPath: await script(`print("x"*140000)\n`) });
    await expect(oversized.select({}, { provider: "fake", model: "fake", requestTimeoutMs: 1000 }, "run")).rejects.toThrow("provider_output_limit");
  });

  it("caps developer output, uses private permissions and disables it in production", async () => {
    const directory = await mkdtemp(join(tmpdir(), "litterspot-debug-")); directories.push(directory);
    const previous = { root: env.orchestratorDebugRoot, enabled: env.orchestratorDebugOutput, app: env.appEnvironment };
    Object.assign(env, { orchestratorDebugRoot: directory, orchestratorDebugOutput: true, appEnvironment: "development-cloud" });
    try {
      await writeAssignmentDebug("unsafe/../run", Buffer.alloc(70000, 120));
      const files = (await import("node:fs/promises")).readdir(directory); const name = (await files)[0];
      expect((await readFile(join(directory, name))).length).toBe(65536);
      expect((await stat(join(directory, name))).mode & 0o077).toBe(0);
      Object.assign(env, { appEnvironment: "production-cloud" });
      await writeAssignmentDebug("second", Buffer.from("secret"));
      expect((await (await import("node:fs/promises")).readdir(directory))).toHaveLength(1);
    } finally { Object.assign(env, { orchestratorDebugRoot: previous.root, orchestratorDebugOutput: previous.enabled, appEnvironment: previous.app }); }
  });
});
