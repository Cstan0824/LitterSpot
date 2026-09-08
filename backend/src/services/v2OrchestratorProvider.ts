import { spawn } from "node:child_process";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { z } from "zod";
import { env } from "../config/env.js";

export type AssignmentDecision = { alertId: string; cleanerId: string; rationaleSummary: string; provider: string; model: string };
export type AssignmentModelConfig = { provider: string; model: string; requestTimeoutMs: number };
export type AssignmentSelector = { select(context: unknown, config: AssignmentModelConfig, runId: string): Promise<AssignmentDecision> };
const decisionSchema = z.object({
  alertId: z.string().trim().min(1).max(160), cleanerId: z.string().trim().min(1).max(160),
  rationaleSummary: z.string().trim().min(1).max(300), provider: z.string().min(1).max(100), model: z.string().min(1).max(200),
}).strict();
const bridgePath = fileURLToPath(new URL("../../../task-assignment-llm/scripts/decide_assignment.py", import.meta.url));
const assignmentPythonPath = fileURLToPath(new URL("../../../task-assignment-llm", import.meta.url));

export function assignmentChildEnvironment(source: NodeJS.ProcessEnv = process.env) {
  const allowed = ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "SYSTEMROOT", "WINDIR", "LANG", "LC_ALL", "OLLAMA_URL", "GEMINI_API_KEY", "GEMINI_MODEL"];
  const output: NodeJS.ProcessEnv = {};
  for (const name of allowed) if (source[name]) output[name] = source[name];
  return { ...output, PYTHONPATH: assignmentPythonPath, PYTHONDONTWRITEBYTECODE: "1" };
}

export async function writeAssignmentDebug(runId: string, output: Buffer) {
  if (!env.orchestratorDebugOutput || env.appEnvironment === "production-cloud") return;
  const safeId = runId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 160);
  await mkdir(env.orchestratorDebugRoot, { recursive: true, mode: 0o700 });
  await writeFile(join(env.orchestratorDebugRoot, `${Date.now()}-${safeId}.json`), output.subarray(0, 65536), { mode: 0o600 });
  const cutoff = Date.now() - 14 * 86400_000;
  for (const entry of await readdir(env.orchestratorDebugRoot, { withFileTypes: true })) {
    const match = /^(\d+)-[a-zA-Z0-9_-]+\.json$/.exec(entry.name);
    if (entry.isFile() && match && Number(match[1]) < cutoff) await rm(join(env.orchestratorDebugRoot, entry.name));
  }
}

export function createPythonAssignmentSelector(options: { pythonPath?: string; scriptPath?: string } = {}): AssignmentSelector {
  return {
    async select(context, config, runId) {
      const input = JSON.stringify({ context, config: { provider: config.provider, model: config.model, requestTimeoutSeconds: config.requestTimeoutMs / 1000 } });
      if (Buffer.byteLength(input) > 800000) throw new Error("assignment_context_too_large");
      let captured = Buffer.alloc(0);
      try {
        const output = await new Promise<Buffer>((resolve, reject) => {
          const child = spawn(options.pythonPath ?? env.orchestratorPythonPath, [options.scriptPath ?? bridgePath], {
            env: assignmentChildEnvironment(), stdio: ["pipe", "pipe", "pipe"],
          });
          let failure: Error | null = null;
          let stderr = Buffer.alloc(0);
          const timer = setTimeout(() => { failure = new Error("provider_timeout"); child.kill("SIGKILL"); }, config.requestTimeoutMs + 2000);
          child.stdout.on("data", (chunk: Buffer) => {
            if (captured.length + chunk.length > 131072) { failure = new Error("provider_output_limit"); child.kill("SIGKILL"); }
            captured = Buffer.concat([captured, chunk.subarray(0, Math.max(0, 131072 - captured.length))]);
          });
          child.stderr.on("data", (chunk: Buffer) => { stderr = Buffer.concat([stderr, chunk]).subarray(-32768); });
          child.stdin.on("error", () => { failure ??= new Error("provider_input_failed"); });
          child.once("error", () => { clearTimeout(timer); reject(new Error("provider_start_failed")); });
          child.once("close", code => {
            clearTimeout(timer);
            if (failure) return reject(failure);
            if (code !== 0) return reject(new Error("provider_failed"));
            resolve(captured);
          });
          child.stdin.end(input);
        });
        return decisionSchema.parse(JSON.parse(output.toString("utf8")));
      } finally {
        // Debug storage must never turn a valid decision into a duplicate provider retry.
        await writeAssignmentDebug(runId, captured).catch(() => undefined);
      }
    },
  };
}
export const pythonAssignmentSelector = createPythonAssignmentSelector();
