import { app } from "./app.js";
import { env } from "./config/env.js";
import { recoverVideoJobs, waitForVideoJobsToFinish } from "./services/videoJobProcessingService.js";
import { recoverOrchestratorRuns } from "./services/orchestratorService.js";
import { recoverV2OrchestratorRuns } from "./services/v2OrchestratorService.js";
import { startV2OrchestratorWorker, stopV2OrchestratorWorker } from "./services/v2OrchestratorWorker.js";
import { recoverV2SiteOperations } from "./services/v2SiteOperationService.js";

let maintenanceRunning = false;
async function maintenance() {
  if (maintenanceRunning) return;
  maintenanceRunning = true;
  try { await recoverV2SiteOperations(); }
  catch { console.error(JSON.stringify({ event: "site_operation_recovery_failed" })); }
  finally { maintenanceRunning = false; }
}
const maintenanceTimer = setInterval(() => { void maintenance(); }, 5_000);
maintenanceTimer.unref();

const server = app.listen(env.port, async () => {
  console.log(`LitterSpot backend listening on port ${env.port}`);
  try {
    const recovered = await recoverVideoJobs();
    if (recovered > 0) console.log(`Recovered ${recovered} queued or expired video job(s).`);
    const orchestratorRecovered = await recoverOrchestratorRuns();
    if (orchestratorRecovered > 0) console.log(`Recovered ${orchestratorRecovered} expired orchestrator run(s).`);
    const v2OrchestratorRecovered = await recoverV2OrchestratorRuns();
    if (v2OrchestratorRecovered > 0) console.log(`Recovered ${v2OrchestratorRecovered} expired V2 Orchestrator Run(s).`);
    if (env.orchestratorWorkerEnabled) startV2OrchestratorWorker();
  } catch (error) {
    console.error("Video job recovery failed:", error);
  }
});

let shuttingDown = false;
async function shutdown(signal: "SIGINT" | "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: "info", event: "shutdown_started", signal }));
  server.close();
  clearInterval(maintenanceTimer);
  stopV2OrchestratorWorker();
  const timeout = new Promise<"timeout">((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), 20_000);
    timer.unref();
  });
  const outcome = await Promise.race([waitForVideoJobsToFinish().then(() => "idle" as const), timeout]);
  if (outcome === "timeout") {
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: "warn", event: "shutdown_queue_timeout" }));
  }
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void shutdown(signal); });
}
