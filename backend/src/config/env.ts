import "dotenv/config";
import { fileURLToPath } from "node:url";

const defaultMediaStorageRoot = fileURLToPath(new URL("../../../data/media-store/", import.meta.url));
const defaultVideoUploadTempRoot = fileURLToPath(new URL("../../../data/media-store/.incoming/", import.meta.url));

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

export const env = {
  port: numberSetting("PORT", 3000, { integer: true, minimum: 1, maximum: 65_535 }),
  aiServiceUrl: process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8000",
  aiServiceToken: process.env.AI_SERVICE_TOKEN,
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID ?? "litterspot",
  firebaseDatabaseId: process.env.FIREBASE_DATABASE_ID ?? "litterspot",
  mediaStorageRoot: process.env.MEDIA_STORAGE_ROOT ?? defaultMediaStorageRoot,
  videoUploadTempRoot: process.env.VIDEO_UPLOAD_TEMP_ROOT ?? defaultVideoUploadTempRoot,
  videoMaxBytes: numberSetting("VIDEO_MAX_BYTES", 250 * 1024 * 1024, { integer: true, minimum: 1, maximum: 2 * 1024 * 1024 * 1024 }),
  videoMaxDurationSeconds: numberSetting("VIDEO_MAX_DURATION_SECONDS", 600, { minimum: 1, maximum: 86_400 }),
  videoDefaultFrameIntervalSeconds: numberSetting("VIDEO_FRAME_INTERVAL_SECONDS", 2, { minimum: 0.1, maximum: 3_600 }),
  videoMaxFrames: numberSetting("VIDEO_MAX_FRAMES", 300, { integer: true, minimum: 1, maximum: 10_000 }),
  videoLeaseSeconds: numberSetting("VIDEO_LEASE_SECONDS", 300, { integer: true, minimum: 30, maximum: 86_400 }),
  ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg",
  ffprobePath: process.env.FFPROBE_PATH ?? "ffprobe",
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://127.0.0.1:5173,http://localhost:5173")
    .split(",").map((value) => value.trim()).filter(Boolean),
  generalRateLimitPerMinute: numberSetting("GENERAL_RATE_LIMIT_PER_MINUTE", 300, { integer: true, minimum: 1, maximum: 100_000 }),
  inferenceRateLimitPerMinute: numberSetting("INFERENCE_RATE_LIMIT_PER_MINUTE", 120, { integer: true, minimum: 1, maximum: 100_000 }),
  uploadRateLimitPerMinute: numberSetting("UPLOAD_RATE_LIMIT_PER_MINUTE", 20, { integer: true, minimum: 1, maximum: 100_000 }),
  processingMutationRateLimitPerMinute: numberSetting("PROCESSING_MUTATION_RATE_LIMIT_PER_MINUTE", 60, { integer: true, minimum: 1, maximum: 100_000 }),
  orchestratorInternalToken: process.env.ORCHESTRATOR_INTERNAL_TOKEN,
  orchestratorLeaseSeconds: numberSetting("ORCHESTRATOR_LEASE_SECONDS", 300, { integer: true, minimum: 30, maximum: 900 }),
};
