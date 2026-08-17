import { HttpError } from "../shared/httpError.js";

export type VideoJobStatus = "uploading" | "queued" | "processing" | "completed" | "failed" | "cancelled";

export function decideVideoJobClaim(status: unknown, leaseExpiresAtMillis: number | null, nowMillis: number) {
  if (status === "completed") return "completed" as const;
  if (status === "uploading") throw new HttpError(409, "The source video is still being stored.");
  if (status === "failed") throw new HttpError(409, "Failed jobs must be retried before processing.");
  if (status === "cancelled") throw new HttpError(409, "Cancelled jobs cannot be processed.");
  if (status === "queued") return "claim" as const;
  if (status === "processing") {
    if (leaseExpiresAtMillis !== null && leaseExpiresAtMillis > nowMillis) {
      throw new HttpError(409, "Processing job is already being handled.");
    }
    return "claim" as const;
  }
  throw new HttpError(409, "Video job has an unsupported status.");
}
