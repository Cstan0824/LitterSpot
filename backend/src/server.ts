import { app } from "./app.js";
import { env } from "./config/env.js";
import { recoverV2OrchestratorRuns } from "./services/v2OrchestratorService.js";
import { startV2OrchestratorWorker, stopV2OrchestratorWorker } from "./services/v2OrchestratorWorker.js";
import { recoverV2SiteOperations } from "./services/v2SiteOperationService.js";
import { startPhase11Worker, stopPhase11Worker } from "./services/phase11Worker.js";
import { isFirestoreQuotaError, safeFirestoreError } from "./shared/firestoreErrors.js";
import { sweepMonitoringRuntime } from "./services/v2LiveMonitoringService.js";
import { recoverV2CameraVerificationCollectors } from "./services/v2WorkOrderService.js";
// Sweep only episodes present in this Node runtime, avoiding a global cloud scan.
const monitoringSweep = setInterval(() => { void sweepMonitoringRuntime().catch(error => console.error(JSON.stringify({ event: "camera_monitoring_sweep_failed", ...safeFirestoreError(error) }))); }, 10000);
monitoringSweep.unref();

let maintenanceRunning = false;
let maintenanceFailures = 0;
let maintenanceTimer: NodeJS.Timeout | null = null;
function scheduleMaintenance(delay: number) {
  if (shuttingDown) return;
  maintenanceTimer = setTimeout(() => { void maintenance(); }, delay);
  maintenanceTimer.unref();
}
async function maintenance() {
  if (maintenanceRunning) return;
  maintenanceRunning = true;
  let delay = env.siteOperationRecoveryIntervalMs;
  try { await recoverV2SiteOperations(); maintenanceFailures = 0; }
  catch (error) {
    maintenanceFailures += 1;
    if (isFirestoreQuotaError(error)) delay = Math.min(env.siteOperationRecoveryMaxBackoffMs, env.siteOperationRecoveryIntervalMs * 2 ** Math.min(maintenanceFailures, 8));
    console.error(JSON.stringify({ event: "site_operation_recovery_failed", ...safeFirestoreError(error), retryAfterMs: delay }));
  } finally { maintenanceRunning = false; scheduleMaintenance(delay); }
}

async function startupRecovery(label: string, operation: () => Promise<number>) {
  try {
    const recovered = await operation();
    if (recovered > 0) console.log(`${label}: recovered ${recovered}.`);
  } catch (error) {
    console.error(JSON.stringify({ event: `${label}_failed`, ...safeFirestoreError(error) }));
  }
}

const server = app.listen(env.port, async () => {
  console.log(`LitterSpot backend listening on port ${env.port}`);
  if (env.analyticsWorkerEnabled) startPhase11Worker();
  await startupRecovery("orchestrator_recovery", recoverV2OrchestratorRuns);
  await startupRecovery("camera_verification_recovery", recoverV2CameraVerificationCollectors);
  if (env.orchestratorWorkerEnabled) startV2OrchestratorWorker();
  scheduleMaintenance(1_000);
});

let shuttingDown = false;
async function shutdown(signal: "SIGINT" | "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: "info", event: "shutdown_started", signal }));
  server.close();
  if (maintenanceTimer) clearTimeout(maintenanceTimer);
  stopV2OrchestratorWorker();
  clearInterval(monitoringSweep);
  const timeout = new Promise<"timeout">((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), 20_000);
    timer.unref();
  });
  const outcome = await Promise.race([stopPhase11Worker().then(() => "idle" as const), timeout]);
  if (outcome === "timeout") {
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: "warn", event: "shutdown_queue_timeout" }));
  }
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void shutdown(signal); });
}
