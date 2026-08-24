import { describe, expect, it } from "vitest";
import {
  decideSystemEventOccurrence,
  decideSystemEventRecovery,
  deterministicSystemEventKey,
  deterministicSystemEventOccurrenceKey,
  deterministicSystemEventRecoveryKey,
  presentSystemEventRecord,
  type SystemEventLifecycleState,
} from "./systemEventState.js";

const minute = 60_000;

function openState(overrides: Partial<SystemEventLifecycleState> = {}): SystemEventLifecycleState {
  return {
    status: "open",
    generation: 1,
    occurrenceCount: 2,
    lifetimeOccurrenceCount: 2,
    resolutionCount: 0,
    reopenCount: 0,
    firstSeenAtMs: 10 * minute,
    lastSeenAtMs: 20 * minute,
    firstEverSeenAtMs: 10 * minute,
    resolvedAtMs: null,
    maximumSeverity: "warning",
    severity: "warning",
    ...overrides,
  };
}

describe("system-event deterministic identities", () => {
  it("produces stable keys while separating identity, occurrence, and recovery namespaces", () => {
    const identity = { dependency: "ai_service", eventCode: "inference_unavailable", scope: { type: "global" } } as const;
    const eventKey = deterministicSystemEventKey(identity);
    expect(eventKey).toMatch(/^[a-f0-9]{64}$/);
    expect(deterministicSystemEventKey(identity)).toBe(eventKey);
    expect(deterministicSystemEventKey({ ...identity, scope: { type: "job", id: "job-1" } })).not.toBe(eventKey);
    expect(deterministicSystemEventOccurrenceKey(eventKey, "same-id")).not.toBe(
      deterministicSystemEventRecoveryKey(eventKey, "same-id"),
    );
  });
});

describe("system-event occurrence decisions", () => {
  it("opens generation one with one occurrence", () => {
    expect(decideSystemEventOccurrence(null, { occurredAtMs: 100, severity: "critical" })).toEqual({
      action: "opened",
      replaceLatestDetails: true,
      next: {
        status: "open",
        generation: 1,
        occurrenceCount: 1,
        lifetimeOccurrenceCount: 1,
        resolutionCount: 0,
        reopenCount: 0,
        firstSeenAtMs: 100,
        lastSeenAtMs: 100,
        firstEverSeenAtMs: 100,
        resolvedAtMs: null,
        maximumSeverity: "critical",
        severity: "critical",
      },
    });
  });

  it("counts an open occurrence and promotes maximum severity", () => {
    const result = decideSystemEventOccurrence(openState(), {
      occurredAtMs: 30 * minute,
      severity: "critical",
    });
    expect(result.action).toBe("occurrence_recorded");
    expect(result.replaceLatestDetails).toBe(true);
    expect(result.next).toMatchObject({
      occurrenceCount: 3,
      lifetimeOccurrenceCount: 3,
      firstSeenAtMs: 10 * minute,
      lastSeenAtMs: 30 * minute,
      severity: "critical",
      maximumSeverity: "critical",
    });
  });

  it("counts out-of-order open occurrences without replacing latest details", () => {
    const current = openState({ maximumSeverity: "critical", severity: "warning" });
    const result = decideSystemEventOccurrence(current, {
      occurredAtMs: 5 * minute,
      severity: "warning",
    });
    expect(result.replaceLatestDetails).toBe(false);
    expect(result.next).toMatchObject({
      occurrenceCount: 3,
      lifetimeOccurrenceCount: 3,
      firstSeenAtMs: 5 * minute,
      lastSeenAtMs: 20 * minute,
      severity: "warning",
      maximumSeverity: "critical",
    });
    expect(current.firstSeenAtMs).toBe(10 * minute);
  });

  it("reopens only for an occurrence newer than the resolution and resets generation counters", () => {
    const resolved = openState({
      status: "resolved",
      occurrenceCount: 7,
      lifetimeOccurrenceCount: 12,
      resolutionCount: 1,
      resolvedAtMs: 30 * minute,
      maximumSeverity: "critical",
      severity: "critical",
    });
    const reopened = decideSystemEventOccurrence(resolved, {
      occurredAtMs: 31 * minute,
      severity: "warning",
    });
    expect(reopened).toMatchObject({
      action: "reopened",
      replaceLatestDetails: true,
      next: {
        status: "open",
        generation: 2,
        occurrenceCount: 1,
        lifetimeOccurrenceCount: 13,
        resolutionCount: 1,
        reopenCount: 1,
        firstSeenAtMs: 31 * minute,
        lastSeenAtMs: 31 * minute,
        resolvedAtMs: null,
        maximumSeverity: "warning",
      },
    });

    const stale = decideSystemEventOccurrence(resolved, {
      occurredAtMs: 30 * minute,
      severity: "critical",
    });
    expect(stale).toEqual({ action: "stale_occurrence", next: resolved, replaceLatestDetails: false });
  });

  it("rejects non-finite occurrence times", () => {
    expect(() => decideSystemEventOccurrence(null, { occurredAtMs: Number.NaN, severity: "warning" })).toThrow(
      "finite millisecond timestamp",
    );
  });
});

describe("system-event recovery decisions", () => {
  it("resolves the expected generation only after its latest occurrence", () => {
    const result = decideSystemEventRecovery(openState(), {
      expectedGeneration: 1,
      recoveredAtMs: 21 * minute,
    });
    expect(result).toMatchObject({
      action: "resolved",
      next: { status: "resolved", generation: 1, resolutionCount: 1, resolvedAtMs: 21 * minute },
    });
  });

  it("rejects a stale generation and a recovery timestamp older than the latest failure", () => {
    expect(decideSystemEventRecovery(openState({ generation: 2 }), {
      expectedGeneration: 1,
      recoveredAtMs: 30 * minute,
    }).action).toBe("stale_generation");
    expect(decideSystemEventRecovery(openState(), {
      expectedGeneration: 1,
      recoveredAtMs: 19 * minute,
    }).action).toBe("stale_recovery");
  });

  it("is idempotent for an already resolved generation and handles missing state", () => {
    expect(decideSystemEventRecovery(openState({ status: "resolved", resolvedAtMs: 25 * minute }), {
      expectedGeneration: 1,
      recoveredAtMs: 30 * minute,
    }).action).toBe("already_resolved");
    expect(decideSystemEventRecovery(null, {
      expectedGeneration: 1,
      recoveredAtMs: 30 * minute,
    })).toEqual({ action: "not_found", next: null });
  });

  it("requires a positive generation and finite time", () => {
    expect(() => decideSystemEventRecovery(openState(), { expectedGeneration: 0, recoveredAtMs: 1 })).toThrow(
      "positive integer",
    );
    expect(() => decideSystemEventRecovery(openState(), { expectedGeneration: 1, recoveredAtMs: Infinity })).toThrow(
      "finite millisecond timestamp",
    );
  });
});

describe("system-event presentation", () => {
  it("returns only the stable public fields and converts timestamps", () => {
    const eventKey = deterministicSystemEventKey({
      dependency: "video_processing",
      eventCode: "frame_extraction_failed",
      scope: { type: "job", id: "job-1" },
    });
    const event = presentSystemEventRecord(eventKey, {
      eventKey,
      dependency: "video_processing",
      eventCode: "frame_extraction_failed",
      scopeType: "job",
      scopeId: "job-1",
      status: "open",
      severity: "warning",
      maximumSeverity: "critical",
      generation: 2,
      occurrenceCount: 3,
      lifetimeOccurrenceCount: 8,
      resolutionCount: 1,
      reopenCount: 1,
      firstSeenAt: new Date("2026-08-13T10:00:00.000Z"),
      lastSeenAt: new Date("2026-08-13T10:05:00.000Z"),
      firstEverSeenAt: new Date("2026-08-12T10:00:00.000Z"),
      resolvedAt: null,
      lastResolvedAt: new Date("2026-08-13T09:00:00.000Z"),
      reopenedAt: new Date("2026-08-13T10:00:00.000Z"),
      latestSafeDetails: { operation: "extract_frame", jobId: "job-1", frameIndex: 2 },
      latestRecoverySafeDetails: null,
      createdAt: new Date("2026-08-12T10:00:00.000Z"),
      updatedAt: new Date("2026-08-13T10:05:01.000Z"),
      rawError: "must-not-leak",
      authorization: "must-not-leak",
    });
    expect(event).toMatchObject({
      id: eventKey,
      title: "Video processing: frame extraction failed",
      scope: { type: "job", id: "job-1" },
      lastSeenAt: "2026-08-13T10:05:00.000Z",
      latestSafeDetails: { operation: "extract_frame", jobId: "job-1", frameIndex: 2 },
    });
    expect(event).not.toHaveProperty("rawError");
    expect(event).not.toHaveProperty("authorization");
  });

  it("rejects an inconsistent resolved status and unsafe stored details", () => {
    const eventKey = "a".repeat(64);
    const base = {
      eventKey,
      dependency: "ai_service",
      eventCode: "failed",
      scopeType: "global",
      scopeId: null,
      status: "resolved",
      severity: "warning",
      maximumSeverity: "warning",
      generation: 1,
      occurrenceCount: 1,
      lifetimeOccurrenceCount: 1,
      resolutionCount: 0,
      reopenCount: 0,
      firstSeenAt: new Date(0),
      lastSeenAt: new Date(0),
      firstEverSeenAt: new Date(0),
      resolvedAt: null,
      lastResolvedAt: null,
      reopenedAt: null,
      latestSafeDetails: {},
      latestRecoverySafeDetails: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    expect(() => presentSystemEventRecord(eventKey, base)).toThrow("status and resolvedAt are inconsistent");
    expect(() => presentSystemEventRecord(eventKey, {
      ...base,
      status: "open",
      latestSafeDetails: { token: "secret" },
    })).toThrow();
  });
});
