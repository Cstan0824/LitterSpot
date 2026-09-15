import "dotenv/config";
import { fileURLToPath } from "node:url";

const defaultMediaStorageRoot = fileURLToPath(new URL("../../../data/media-store/", import.meta.url));
const defaultOrchestratorDebugRoot = fileURLToPath(new URL("../../../data/orchestrator-debug/", import.meta.url));
const defaultOrchestratorPythonPath = fileURLToPath(new URL(
  process.platform === "win32" ? "../../../.venv/Scripts/python.exe" : "../../../.venv/bin/python",
  import.meta.url,
));

function numberSetting(name: string, fallback: number, options: { integer?: boolean; minimum: number; maximum: number }) {
  const raw = process.env[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isFinite(value)
    || options.integer && !Number.isInteger(value)
    || value < options.minimum
    || value > options.maximum) {
    throw new Error(`${name} must be ${options.integer ? "an integer" : "a number"} between ${options.minimum} and ${options.maximum}.`);
  }
  return value;
}

function appEnvironmentSetting(): "test" | "local-emulator" | "development-cloud" | "production-cloud" {
  const value = process.env.APP_ENV;
  if (!value && process.env.NODE_ENV === "test") return "test" as const;
  if (value === "local-emulator" || value === "development-cloud" || value === "production-cloud") return value;
  throw new Error("APP_ENV must be local-emulator, development-cloud, or production-cloud.");
}

function booleanSetting(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

export const env = {
  appEnvironment: appEnvironmentSetting(),
  port: numberSetting("PORT", 3000, { integer: true, minimum: 1, maximum: 65_535 }),
  aiServiceUrl: process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8000",
  aiServiceToken: process.env.AI_SERVICE_TOKEN,
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID ?? "litterspot",
  firebaseDatabaseId: process.env.FIREBASE_DATABASE_ID ?? "litterspot",
  expectedFirebaseProjectId: process.env.EXPECTED_FIREBASE_PROJECT_ID ?? "",
  mediaStorageRoot: process.env.MEDIA_STORAGE_ROOT ?? defaultMediaStorageRoot,
  videoMaxBytes: numberSetting("VIDEO_MAX_BYTES", 250 * 1024 * 1024, { integer: true, minimum: 1, maximum: 2 * 1024 * 1024 * 1024 }),
  videoMaxDurationSeconds: numberSetting("VIDEO_MAX_DURATION_SECONDS", 600, { minimum: 1, maximum: 86_400 }),
  ffprobePath: process.env.FFPROBE_PATH ?? "ffprobe",
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5174,http://localhost:5174")
    .split(",").map((value) => value.trim()).filter(Boolean),
  generalRateLimitPerMinute: numberSetting("GENERAL_RATE_LIMIT_PER_MINUTE", 300, { integer: true, minimum: 1, maximum: 100_000 }),
  inferenceRateLimitPerMinute: numberSetting("INFERENCE_RATE_LIMIT_PER_MINUTE", 120, { integer: true, minimum: 1, maximum: 100_000 }),
  uploadRateLimitPerMinute: numberSetting("UPLOAD_RATE_LIMIT_PER_MINUTE", 20, { integer: true, minimum: 1, maximum: 100_000 }),
  processingMutationRateLimitPerMinute: numberSetting("PROCESSING_MUTATION_RATE_LIMIT_PER_MINUTE", 60, { integer: true, minimum: 1, maximum: 100_000 }),
  orchestratorInternalToken: process.env.ORCHESTRATOR_INTERNAL_TOKEN,
  orchestratorLeaseSeconds: numberSetting("ORCHESTRATOR_LEASE_SECONDS", 300, { integer: true, minimum: 30, maximum: 900 }),
  orchestratorPythonPath: process.env.ORCHESTRATOR_PYTHON_PATH ?? defaultOrchestratorPythonPath,
  orchestratorDebugOutput: booleanSetting("ORCHESTRATOR_DEBUG_OUTPUT", false),
  orchestratorDebugRoot: process.env.ORCHESTRATOR_DEBUG_ROOT ?? defaultOrchestratorDebugRoot,
  orchestratorWorkerEnabled: booleanSetting("ORCHESTRATOR_WORKER_ENABLED", true),
  analyticsWorkerEnabled: booleanSetting("ANALYTICS_WORKER_ENABLED", false),
  siteOperationRecoveryIntervalMs: numberSetting("SITE_OPERATION_RECOVERY_INTERVAL_MS", 300_000, { integer: true, minimum: 10_000, maximum: 86_400_000 }),
  siteOperationRecoveryMaxBackoffMs: numberSetting("SITE_OPERATION_RECOVERY_MAX_BACKOFF_MS", 3_600_000, { integer: true, minimum: 60_000, maximum: 86_400_000 }),
};
