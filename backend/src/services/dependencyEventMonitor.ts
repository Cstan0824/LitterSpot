import {
  deterministicSystemEventKey,
} from "./systemEventState.js";
import {
  getSystemEvent,
  recordSystemEventOccurrence,
  recoverSystemEvent,
} from "./systemEventService.js";
import type {
  SystemEventIdentity,
  SystemEventSafeDetails,
  SystemEventSeverity,
} from "../schemas/systemEvent.js";
import { HttpError } from "../shared/httpError.js";

const RECOVERY_CHECK_INTERVAL_MS = 60_000;
const knownOpenEvents = new Set<string>();
const nextRecoveryCheckAt = new Map<string, number>();

function monitoringWriteFailure(operation: string, identity: SystemEventIdentity) {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "error",
    event: "system_event_monitoring_failed",
    operation,
    dependency: identity.dependency,
    eventCode: identity.eventCode,
    scopeType: identity.scope.type,
  }));
}

/**
 * Operational monitoring is deliberately best-effort: a Firestore monitoring
 * outage must never replace the original processing error or fail successful
 * business work.
 */
export async function recordOperationalFailure(options: {
  identity: SystemEventIdentity;
  occurrenceId: string;
  severity: SystemEventSeverity;
  occurredAt?: Date;
  safeDetails?: SystemEventSafeDetails;
}) {
  const eventKey = deterministicSystemEventKey(options.identity);
  try {
    const result = await recordSystemEventOccurrence({
      occurrenceId: options.occurrenceId,
      identity: options.identity,
      severity: options.severity,
      occurredAt: (options.occurredAt ?? new Date()).toISOString(),
      safeDetails: options.safeDetails ?? {},
    });
    knownOpenEvents.add(eventKey);
    nextRecoveryCheckAt.delete(eventKey);
    return result;
  } catch {
    monitoringWriteFailure("record_occurrence", options.identity);
    return null;
  }
}

/**
 * The short negative cache avoids a Firestore read after every successful
 * video frame while still checking once immediately after process startup and
 * immediately after this process records a failure.
 */
export async function recoverOperationalEvent(options: {
  identity: SystemEventIdentity;
  recoveryId: string;
  recoveredAt?: Date;
  safeDetails?: SystemEventSafeDetails;
}) {
  const eventKey = deterministicSystemEventKey(options.identity);
  const now = options.recoveredAt ?? new Date();
  if (!knownOpenEvents.has(eventKey) && (nextRecoveryCheckAt.get(eventKey) ?? 0) > now.getTime()) return null;
  try {
    const event = await getSystemEvent(eventKey);
    nextRecoveryCheckAt.set(eventKey, now.getTime() + RECOVERY_CHECK_INTERVAL_MS);
    if (event.status !== "open") {
      knownOpenEvents.delete(eventKey);
      return null;
    }
    const result = await recoverSystemEvent(eventKey, {
      recoveryId: options.recoveryId,
      expectedGeneration: event.generation,
      recoveredAt: now.toISOString(),
      safeDetails: options.safeDetails ?? {},
    });
    if (result.event.status === "resolved") knownOpenEvents.delete(eventKey);
    return result;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      knownOpenEvents.delete(eventKey);
      nextRecoveryCheckAt.set(eventKey, now.getTime() + RECOVERY_CHECK_INTERVAL_MS);
      return null;
    }
    monitoringWriteFailure("recover_event", options.identity);
    return null;
  }
}
