import { createHash } from "node:crypto";
import {
  systemEventIdentitySchema,
  systemEventKeySchema,
  systemEventSafeDetailsSchema,
  systemEventSeveritySchema,
  systemEventStatusSchema,
  type SystemEventIdentity,
  type SystemEventSafeDetails,
  type SystemEventSeverity,
  type SystemEventStatus,
} from "../schemas/systemEvent.js";

export type SystemEventLifecycleState = {
  status: SystemEventStatus;
  generation: number;
  occurrenceCount: number;
  lifetimeOccurrenceCount: number;
  resolutionCount: number;
  reopenCount: number;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  firstEverSeenAtMs: number;
  resolvedAtMs: number | null;
  maximumSeverity: SystemEventSeverity;
  severity: SystemEventSeverity;
};

export type SystemEventOccurrenceAction =
  | "opened"
  | "occurrence_recorded"
  | "reopened"
  | "stale_occurrence";

export type SystemEventRecoveryAction =
  | "not_found"
  | "resolved"
  | "already_resolved"
  | "stale_generation"
  | "stale_recovery";

const severityRank: Record<SystemEventSeverity, number> = { warning: 0, critical: 1 };

function hashParts(namespace: string, parts: string[]) {
  const hash = createHash("sha256");
  hash.update(namespace);
  for (const part of parts) hash.update("\0").update(part);
  return hash.digest("hex");
}

export function deterministicSystemEventKey(rawIdentity: unknown) {
  const identity = systemEventIdentitySchema.parse(rawIdentity);
  const scopeId = identity.scope.type === "global" ? "" : identity.scope.id;
  return hashParts("system-event-v1", [
    identity.dependency,
    identity.eventCode,
    identity.scope.type,
    scopeId,
  ]);
}

export function deterministicSystemEventOccurrenceKey(eventKey: string, occurrenceId: string) {
  return hashParts("system-event-occurrence-v1", [systemEventKeySchema.parse(eventKey), occurrenceId]);
}

export function deterministicSystemEventRecoveryKey(eventKey: string, recoveryId: string) {
  return hashParts("system-event-recovery-v1", [systemEventKeySchema.parse(eventKey), recoveryId]);
}

function validMillis(value: number, label: string) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be a finite millisecond timestamp.`);
  return value;
}

function strongerSeverity(left: SystemEventSeverity, right: SystemEventSeverity) {
  return severityRank[right] > severityRank[left] ? right : left;
}

export function decideSystemEventOccurrence(
  current: SystemEventLifecycleState | null,
  input: { occurredAtMs: number; severity: SystemEventSeverity },
): {
  action: SystemEventOccurrenceAction;
  next: SystemEventLifecycleState | null;
  replaceLatestDetails: boolean;
} {
  const occurredAtMs = validMillis(input.occurredAtMs, "occurredAtMs");
  const severity = systemEventSeveritySchema.parse(input.severity);

  if (!current) {
    return {
      action: "opened",
      replaceLatestDetails: true,
      next: {
        status: "open",
        generation: 1,
        occurrenceCount: 1,
        lifetimeOccurrenceCount: 1,
        resolutionCount: 0,
        reopenCount: 0,
        firstSeenAtMs: occurredAtMs,
        lastSeenAtMs: occurredAtMs,
        firstEverSeenAtMs: occurredAtMs,
        resolvedAtMs: null,
        maximumSeverity: severity,
        severity,
      },
    };
  }

  if (current.status === "resolved") {
    if (current.resolvedAtMs === null) throw new TypeError("A resolved event must have resolvedAtMs.");
    if (occurredAtMs <= current.resolvedAtMs) {
      return { action: "stale_occurrence", next: current, replaceLatestDetails: false };
    }
    return {
      action: "reopened",
      replaceLatestDetails: true,
      next: {
        ...current,
        status: "open",
        generation: current.generation + 1,
        occurrenceCount: 1,
        lifetimeOccurrenceCount: current.lifetimeOccurrenceCount + 1,
        reopenCount: current.reopenCount + 1,
        firstSeenAtMs: occurredAtMs,
        lastSeenAtMs: occurredAtMs,
        firstEverSeenAtMs: Math.min(current.firstEverSeenAtMs, occurredAtMs),
        resolvedAtMs: null,
        maximumSeverity: severity,
        severity,
      },
    };
  }

  const replaceLatestDetails = occurredAtMs >= current.lastSeenAtMs;
  return {
    action: "occurrence_recorded",
    replaceLatestDetails,
    next: {
      ...current,
      occurrenceCount: current.occurrenceCount + 1,
      lifetimeOccurrenceCount: current.lifetimeOccurrenceCount + 1,
      firstSeenAtMs: Math.min(current.firstSeenAtMs, occurredAtMs),
      lastSeenAtMs: Math.max(current.lastSeenAtMs, occurredAtMs),
      firstEverSeenAtMs: Math.min(current.firstEverSeenAtMs, occurredAtMs),
      maximumSeverity: strongerSeverity(current.maximumSeverity, severity),
      severity: replaceLatestDetails ? severity : current.severity,
    },
  };
}

export function decideSystemEventRecovery(
  current: SystemEventLifecycleState | null,
  input: { expectedGeneration: number; recoveredAtMs: number },
): { action: SystemEventRecoveryAction; next: SystemEventLifecycleState | null } {
  const recoveredAtMs = validMillis(input.recoveredAtMs, "recoveredAtMs");
  if (!Number.isInteger(input.expectedGeneration) || input.expectedGeneration < 1) {
    throw new TypeError("expectedGeneration must be a positive integer.");
  }
  if (!current) return { action: "not_found", next: null };
  if (input.expectedGeneration !== current.generation) {
    return { action: "stale_generation", next: current };
  }
  if (current.status === "resolved") {
    return { action: "already_resolved", next: current };
  }
  if (recoveredAtMs < current.lastSeenAtMs) {
    return { action: "stale_recovery", next: current };
  }
  return {
    action: "resolved",
    next: {
      ...current,
      status: "resolved",
      resolutionCount: current.resolutionCount + 1,
      resolvedAtMs: recoveredAtMs,
    },
  };
}

type TimestampLike = { toDate: () => Date };

function instant(value: unknown, label: string): string {
  const date = value instanceof Date
    ? value
    : value && typeof value === "object" && typeof (value as TimestampLike).toDate === "function"
      ? (value as TimestampLike).toDate()
      : null;
  if (!date || !Number.isFinite(date.getTime())) throw new TypeError(`${label} must be a timestamp.`);
  return date.toISOString();
}

function nullableInstant(value: unknown, label: string) {
  return value == null ? null : instant(value, label);
}

function positiveInteger(value: unknown, label: string) {
  if (!Number.isInteger(value) || Number(value) < 1) throw new TypeError(`${label} must be a positive integer.`);
  return Number(value);
}

function nonnegativeInteger(value: unknown, label: string) {
  if (!Number.isInteger(value) || Number(value) < 0) throw new TypeError(`${label} must be a nonnegative integer.`);
  return Number(value);
}

function generatedTitle(identity: SystemEventIdentity) {
  const dependency = {
    ai_service: "AI service",
    video_processing: "Video processing",
    analytics_rebuild: "Analytics rebuild",
  }[identity.dependency];
  const event = identity.eventCode.split("_").join(" ");
  return `${dependency}: ${event}`;
}

/** Selectively presents known fields so an accidental raw error field is never returned. */
export function presentSystemEventRecord(eventKey: string, rawData: Record<string, unknown>) {
  const parsedEventKey = systemEventKeySchema.parse(eventKey);
  if (rawData.eventKey !== parsedEventKey) throw new TypeError("Stored system-event key does not match its document ID.");
  const scopeType = rawData.scopeType;
  const identity = systemEventIdentitySchema.parse({
    dependency: rawData.dependency,
    eventCode: rawData.eventCode,
    scope: scopeType === "global"
      ? { type: "global" }
      : { type: scopeType, id: rawData.scopeId },
  });
  const status = systemEventStatusSchema.parse(rawData.status);
  const resolvedAt = nullableInstant(rawData.resolvedAt, "resolvedAt");
  if ((status === "resolved") !== (resolvedAt !== null)) {
    throw new TypeError("Stored system-event status and resolvedAt are inconsistent.");
  }

  return {
    id: parsedEventKey,
    eventKey: parsedEventKey,
    dependency: identity.dependency,
    eventCode: identity.eventCode,
    title: generatedTitle(identity),
    scope: identity.scope,
    status,
    severity: systemEventSeveritySchema.parse(rawData.severity),
    maximumSeverity: systemEventSeveritySchema.parse(rawData.maximumSeverity),
    generation: positiveInteger(rawData.generation, "generation"),
    occurrenceCount: positiveInteger(rawData.occurrenceCount, "occurrenceCount"),
    lifetimeOccurrenceCount: positiveInteger(rawData.lifetimeOccurrenceCount, "lifetimeOccurrenceCount"),
    resolutionCount: nonnegativeInteger(rawData.resolutionCount, "resolutionCount"),
    reopenCount: nonnegativeInteger(rawData.reopenCount, "reopenCount"),
    firstSeenAt: instant(rawData.firstSeenAt, "firstSeenAt"),
    lastSeenAt: instant(rawData.lastSeenAt, "lastSeenAt"),
    firstEverSeenAt: instant(rawData.firstEverSeenAt, "firstEverSeenAt"),
    resolvedAt,
    lastResolvedAt: nullableInstant(rawData.lastResolvedAt, "lastResolvedAt"),
    reopenedAt: nullableInstant(rawData.reopenedAt, "reopenedAt"),
    latestSafeDetails: systemEventSafeDetailsSchema.parse(rawData.latestSafeDetails ?? {}),
    latestRecoverySafeDetails: rawData.latestRecoverySafeDetails == null
      ? null
      : systemEventSafeDetailsSchema.parse(rawData.latestRecoverySafeDetails),
    createdAt: instant(rawData.createdAt, "createdAt"),
    updatedAt: instant(rawData.updatedAt, "updatedAt"),
  } satisfies {
    id: string;
    eventKey: string;
    dependency: SystemEventIdentity["dependency"];
    eventCode: string;
    title: string;
    scope: SystemEventIdentity["scope"];
    status: SystemEventStatus;
    severity: SystemEventSeverity;
    maximumSeverity: SystemEventSeverity;
    generation: number;
    occurrenceCount: number;
    lifetimeOccurrenceCount: number;
    resolutionCount: number;
    reopenCount: number;
    firstSeenAt: string;
    lastSeenAt: string;
    firstEverSeenAt: string;
    resolvedAt: string | null;
    lastResolvedAt: string | null;
    reopenedAt: string | null;
    latestSafeDetails: SystemEventSafeDetails;
    latestRecoverySafeDetails: SystemEventSafeDetails | null;
    createdAt: string;
    updatedAt: string;
  };
}
