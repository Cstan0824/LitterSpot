import { describe, expect, it } from "vitest";
import {
  systemEventOccurrenceInputSchema,
  systemEventRecoveryInputSchema,
  systemEventSafeDetailsSchema,
} from "./systemEvent.js";

describe("system-event schemas", () => {
  it.each([
    { dependency: "ai_service", eventCode: "inference_unavailable", scope: { type: "global" } },
    { dependency: "video_processing", eventCode: "frame_extraction_failed", scope: { type: "job", id: "job-123" } },
    { dependency: "analytics_rebuild", eventCode: "bucket_rebuild_failed", scope: { type: "site", id: "site-1" } },
  ])("accepts a supported dependency identity: $dependency", (identity) => {
    const parsed = systemEventOccurrenceInputSchema.parse({
      occurrenceId: "attempt:job-123:1",
      identity,
      severity: "critical",
      occurredAt: "2026-08-13T10:00:00.000Z",
      safeDetails: {
        operation: "analyze_frame",
        reasonCode: "upstream_timeout",
        retryable: true,
        httpStatus: 503,
        jobId: "job-123",
        frameIndex: 4,
        durationMs: 12_000,
      },
    });
    expect(parsed.identity).toEqual(identity);
  });

  it("defaults safe details to an empty allowlisted object", () => {
    const occurrence = systemEventOccurrenceInputSchema.parse({
      occurrenceId: "occurrence-1",
      identity: { dependency: "ai_service", eventCode: "health_check_failed", scope: { type: "global" } },
      severity: "warning",
      occurredAt: "2026-08-13T10:00:00.000Z",
    });
    const recovery = systemEventRecoveryInputSchema.parse({
      recoveryId: "recovery-1",
      expectedGeneration: 1,
      recoveredAt: "2026-08-13T10:01:00.000Z",
    });
    expect(occurrence.safeDetails).toEqual({});
    expect(recovery.safeDetails).toEqual({});
  });

  it.each([
    { authorization: "Bearer secret" },
    { token: "secret" },
    { apiKey: "secret" },
    { requestHeaders: { cookie: "secret" } },
    { errorMessage: "https://user:password@example.test" },
    { stack: "stack trace" },
  ])("rejects non-allowlisted or secret-bearing details", (safeDetails) => {
    expect(systemEventSafeDetailsSchema.safeParse(safeDetails).success).toBe(false);
  });

  it("rejects unsafe identifiers, raw messages, and invalid time ranges", () => {
    expect(systemEventOccurrenceInputSchema.safeParse({
      occurrenceId: "contains whitespace",
      identity: { dependency: "video_processing", eventCode: "Bad-Code", scope: { type: "job", id: "job/child" } },
      severity: "critical",
      occurredAt: "not-a-date",
      safeDetails: { reasonCode: "bad reason", message: "raw failure" },
    }).success).toBe(false);
    expect(systemEventSafeDetailsSchema.safeParse({
      periodStart: "2026-08-13T11:00:00.000Z",
      periodEnd: "2026-08-13T10:00:00.000Z",
    }).success).toBe(false);
  });

  it("enforces scope shape", () => {
    const base = {
      occurrenceId: "occurrence-1",
      severity: "warning",
      occurredAt: "2026-08-13T10:00:00.000Z",
    };
    expect(systemEventOccurrenceInputSchema.safeParse({
      ...base,
      identity: { dependency: "ai_service", eventCode: "failed", scope: { type: "global", id: "not-allowed" } },
    }).success).toBe(false);
    expect(systemEventOccurrenceInputSchema.safeParse({
      ...base,
      identity: { dependency: "analytics_rebuild", eventCode: "failed", scope: { type: "site" } },
    }).success).toBe(false);
  });

});
