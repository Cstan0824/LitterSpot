import { HttpError } from "../shared/httpError.js";

export function decideImageJobClaim(status: unknown, leaseExpiresAtMs: number | null, nowMs: number) {
  if (status === "completed") return "completed" as const;
  if (status === "failed") throw new HttpError(409, "Failed jobs must be retried before processing.");
  if (status === "cancelled") throw new HttpError(409, "Cancelled jobs cannot be processed.");
  if (status === "processing" && leaseExpiresAtMs !== null && leaseExpiresAtMs > nowMs) {
    throw new HttpError(409, "Processing job is already being handled.");
  }
  return "claim" as const;
}

export function assertImageJobCanRetry(status: unknown) {
  if (status !== "failed") throw new HttpError(409, "Only failed jobs can be retried.");
}

export function shouldAdvanceCameraLatestPointer(input: {
  cameraSiteId: unknown;
  cameraZoneId: unknown;
  runSiteId: string;
  runZoneId: string;
  latestCapturedAtMs: number | null;
  runCapturedAtMs: number;
}) {
  return input.cameraSiteId === input.runSiteId
    && input.cameraZoneId === input.runZoneId
    && (input.latestCapturedAtMs === null || input.runCapturedAtMs >= input.latestCapturedAtMs);
}
