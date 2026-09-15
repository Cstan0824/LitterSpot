import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type DocumentSnapshot,
} from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import {
  systemEventIdentitySchema,
  systemEventKeySchema,
  systemEventOccurrenceInputSchema,
  systemEventRecoveryInputSchema,
  systemEventSeveritySchema,
  systemEventStatusSchema,
} from "../schemas/systemEvent.js";
import { HttpError } from "../shared/httpError.js";
import {
  decideSystemEventOccurrence,
  decideSystemEventRecovery,
  deterministicSystemEventKey,
  deterministicSystemEventOccurrenceKey,
  deterministicSystemEventRecoveryKey,
  presentSystemEventRecord,
  type SystemEventLifecycleState,
  type SystemEventOccurrenceAction,
  type SystemEventRecoveryAction,
} from "./systemEventState.js";

const COLLECTION = "systemEvents";

function requireTimestamp(data: DocumentData, field: string) {
  const value = data[field];
  if (!(value instanceof Timestamp)) throw new TypeError(`Stored system event is missing ${field}.`);
  return value;
}

function optionalTimestamp(data: DocumentData, field: string) {
  const value = data[field];
  if (value == null) return null;
  if (!(value instanceof Timestamp)) throw new TypeError(`Stored system event has invalid ${field}.`);
  return value;
}

function requirePositiveInteger(data: DocumentData, field: string) {
  const value = data[field];
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new TypeError(`Stored system event has invalid ${field}.`);
  }
  return Number(value);
}

function requireNonnegativeInteger(data: DocumentData, field: string) {
  const value = data[field];
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new TypeError(`Stored system event has invalid ${field}.`);
  }
  return Number(value);
}

function lifecycleState(snapshot: DocumentSnapshot): SystemEventLifecycleState | null {
  if (!snapshot.exists) return null;
  const data = snapshot.data()!;
  return {
    status: systemEventStatusSchema.parse(data.status),
    generation: requirePositiveInteger(data, "generation"),
    occurrenceCount: requirePositiveInteger(data, "occurrenceCount"),
    lifetimeOccurrenceCount: requirePositiveInteger(data, "lifetimeOccurrenceCount"),
    resolutionCount: requireNonnegativeInteger(data, "resolutionCount"),
    reopenCount: requireNonnegativeInteger(data, "reopenCount"),
    firstSeenAtMs: requireTimestamp(data, "firstSeenAt").toMillis(),
    lastSeenAtMs: requireTimestamp(data, "lastSeenAt").toMillis(),
    firstEverSeenAtMs: requireTimestamp(data, "firstEverSeenAt").toMillis(),
    resolvedAtMs: optionalTimestamp(data, "resolvedAt")?.toMillis() ?? null,
    maximumSeverity: systemEventSeveritySchema.parse(data.maximumSeverity),
    severity: systemEventSeveritySchema.parse(data.severity),
  };
}

function timestamp(milliseconds: number) {
  return Timestamp.fromMillis(milliseconds);
}

function eventReference(eventKey: string) {
  return firestore.collection(COLLECTION).doc(eventKey);
}

function presentSnapshot(snapshot: DocumentSnapshot) {
  if (!snapshot.exists) throw new HttpError(404, "System event not found.");
  return presentSystemEventRecord(snapshot.id, snapshot.data()!);
}

export async function getSystemEvent(rawEventKey: unknown) {
  const eventKey = systemEventKeySchema.parse(rawEventKey);
  return presentSnapshot(await eventReference(eventKey).get());
}

export async function recordSystemEventOccurrence(rawInput: unknown) {
  const input = systemEventOccurrenceInputSchema.parse(rawInput);
  const eventKey = deterministicSystemEventKey(input.identity);
  const eventRef = eventReference(eventKey);
  const occurrenceKey = deterministicSystemEventOccurrenceKey(eventKey, input.occurrenceId);
  const occurrenceRef = eventRef.collection("occurrences").doc(occurrenceKey);
  const occurredAt = Timestamp.fromDate(new Date(input.occurredAt));

  const outcome = await firestore.runTransaction(async (transaction) => {
    const [eventSnapshot, markerSnapshot] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(occurrenceRef),
    ]);
    const current = lifecycleState(eventSnapshot);

    if (markerSnapshot.exists) {
      const marker = markerSnapshot.data()!;
      return {
        action: "duplicate" as const,
        originalAction: String(marker.action) as SystemEventOccurrenceAction,
        appliedGeneration: requirePositiveInteger(marker, "appliedGeneration"),
      };
    }

    const decision = decideSystemEventOccurrence(current, {
      occurredAtMs: occurredAt.toMillis(),
      severity: input.severity,
    });
    const appliedGeneration = decision.next?.generation ?? current?.generation ?? 1;

    if (decision.action !== "stale_occurrence") {
      const next = decision.next!;
      const identity = systemEventIdentitySchema.parse(input.identity);
      const scopeId = identity.scope.type === "global" ? null : identity.scope.id;
      const lifecycleFields = {
        status: next.status,
        generation: next.generation,
        occurrenceCount: next.occurrenceCount,
        lifetimeOccurrenceCount: next.lifetimeOccurrenceCount,
        resolutionCount: next.resolutionCount,
        reopenCount: next.reopenCount,
        firstSeenAt: timestamp(next.firstSeenAtMs),
        lastSeenAt: timestamp(next.lastSeenAtMs),
        firstEverSeenAt: timestamp(next.firstEverSeenAtMs),
        resolvedAt: next.resolvedAtMs === null ? null : timestamp(next.resolvedAtMs),
        severity: next.severity,
        maximumSeverity: next.maximumSeverity,
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (decision.action === "opened") {
        transaction.create(eventRef, {
          eventKey,
          dependency: identity.dependency,
          eventCode: identity.eventCode,
          scopeType: identity.scope.type,
          scopeId,
          ...lifecycleFields,
          lastResolvedAt: null,
          reopenedAt: null,
          latestSafeDetails: input.safeDetails,
          latestRecoverySafeDetails: null,
          createdAt: FieldValue.serverTimestamp(),
        });
      } else {
        transaction.update(eventRef, {
          ...lifecycleFields,
          ...(decision.replaceLatestDetails ? { latestSafeDetails: input.safeDetails } : {}),
          ...(decision.action === "reopened" ? {
            reopenedAt: occurredAt,
            latestRecoverySafeDetails: null,
          } : {}),
        });
      }
    }

    transaction.create(occurrenceRef, {
      eventKey,
      action: decision.action,
      appliedGeneration,
      occurredAt,
      createdAt: FieldValue.serverTimestamp(),
    });
    return {
      action: decision.action,
      originalAction: null,
      appliedGeneration,
    };
  });

  return {
    ...outcome,
    event: await getSystemEvent(eventKey),
  };
}

export async function recoverSystemEvent(rawEventKey: unknown, rawInput: unknown) {
  const eventKey = systemEventKeySchema.parse(rawEventKey);
  const input = systemEventRecoveryInputSchema.parse(rawInput);
  const eventRef = eventReference(eventKey);
  const recoveryKey = deterministicSystemEventRecoveryKey(eventKey, input.recoveryId);
  const recoveryRef = eventRef.collection("recoveries").doc(recoveryKey);
  const recoveredAt = Timestamp.fromDate(new Date(input.recoveredAt));

  const outcome = await firestore.runTransaction(async (transaction) => {
    const [eventSnapshot, markerSnapshot] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(recoveryRef),
    ]);
    const current = lifecycleState(eventSnapshot);
    if (!current) throw new HttpError(404, "System event not found.");

    if (markerSnapshot.exists) {
      const marker = markerSnapshot.data()!;
      return {
        action: "duplicate" as const,
        originalAction: String(marker.action) as Exclude<SystemEventRecoveryAction, "not_found">,
        appliedGeneration: requirePositiveInteger(marker, "appliedGeneration"),
      };
    }

    const decision = decideSystemEventRecovery(current, {
      expectedGeneration: input.expectedGeneration,
      recoveredAtMs: recoveredAt.toMillis(),
    });
    if (decision.action === "not_found") throw new HttpError(404, "System event not found.");

    if (decision.action === "resolved") {
      const next = decision.next!;
      transaction.update(eventRef, {
        status: next.status,
        resolutionCount: next.resolutionCount,
        resolvedAt: recoveredAt,
        lastResolvedAt: recoveredAt,
        latestRecoverySafeDetails: input.safeDetails,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    transaction.create(recoveryRef, {
      eventKey,
      action: decision.action,
      appliedGeneration: current.generation,
      expectedGeneration: input.expectedGeneration,
      recoveredAt,
      createdAt: FieldValue.serverTimestamp(),
    });
    return {
      action: decision.action,
      originalAction: null,
      appliedGeneration: current.generation,
    };
  });

  return {
    ...outcome,
    event: await getSystemEvent(eventKey),
  };
}
