import { createHash } from "node:crypto";
import { FieldValue, Timestamp, type DocumentData, type DocumentSnapshot, type Query } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import type { AuthenticatedCleaner } from "../middleware/authenticateUser.js";
import type { UpdateCleanerPresenceInput } from "../schemas/cleanerOperations.js";
import { HttpError } from "../shared/httpError.js";
import { queryCursorPage } from "./firestoreCursorPagination.js";

export const LOCATION_FRESHNESS_SECONDS = 300;
export const LOCATION_HISTORY_RETENTION_DAYS = 7;

function instant(value: unknown) {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

function timestampMillis(value: unknown) {
  return value instanceof Timestamp ? value.toMillis() : null;
}

function locationHistoryId(cleanerId: string, heartbeatId: string) {
  return createHash("sha256").update("cleaner-location-v1\0").update(cleanerId).update("\0").update(heartbeatId).digest("hex");
}

function locationRequestFingerprint(input: UpdateCleanerPresenceInput) {
  return createHash("sha256").update(JSON.stringify({
    availability: input.availability ?? null,
    locationConsent: input.locationConsent ?? null,
    location: input.location ?? null,
  })).digest("hex");
}

function presentPresence(cleanerId: string, snapshot: DocumentSnapshot, nowMillis = Date.now()) {
  const data = snapshot.exists ? snapshot.data()! : {};
  const availability = ["online", "busy", "break", "offline"].includes(String(data.availability))
    ? String(data.availability)
    : "offline";
  const lastHeartbeatAtMillis = timestampMillis(data.lastHeartbeatAt);
  const lastLocation = data.lastLocation && typeof data.lastLocation === "object"
    ? data.lastLocation as Record<string, unknown>
    : null;
  const capturedAtMillis = timestampMillis(lastLocation?.capturedAt);
  const consent = data.locationConsent === true;
  const fresh = consent
    && availability !== "offline"
    && lastHeartbeatAtMillis !== null
    && capturedAtMillis !== null
    && nowMillis - lastHeartbeatAtMillis <= LOCATION_FRESHNESS_SECONDS * 1_000
    && nowMillis - capturedAtMillis <= LOCATION_FRESHNESS_SECONDS * 1_000;
  const locationStatus = !consent || !lastLocation ? "unavailable" : fresh ? "fresh" : "stale";
  return {
    cleanerId,
    availability,
    activeWorkOrderId: data.activeWorkOrderId == null ? null : String(data.activeWorkOrderId),
    locationConsent: consent,
    lastHeartbeatAt: instant(data.lastHeartbeatAt),
    lastLocation: lastLocation ? {
      latitude: Number(lastLocation.latitude),
      longitude: Number(lastLocation.longitude),
      accuracyMeters: Number(lastLocation.accuracyMeters),
      capturedAt: instant(lastLocation.capturedAt),
      source: String(lastLocation.source),
    } : null,
    locationStatus,
    freshnessSeconds: LOCATION_FRESHNESS_SECONDS,
    updatedAt: instant(data.updatedAt),
  };
}

export async function getCleanerPresence(cleanerId: string, nowMillis = Date.now()) {
  return presentPresence(cleanerId, await firestore.collection("cleanerPresence").doc(cleanerId).get(), nowMillis);
}

export async function updateCleanerPresence(
  cleaner: AuthenticatedCleaner,
  input: UpdateCleanerPresenceInput,
  now = new Date(),
) {
  const nowMillis = now.getTime();
  if (!Number.isFinite(nowMillis)) throw new Error("Presence update time must be valid.");
  const locationTimestamp = input.location ? Timestamp.fromDate(new Date(input.location.capturedAt)) : null;
  if (locationTimestamp && locationTimestamp.toMillis() > nowMillis + 5 * 60_000) {
    throw new HttpError(400, "Location capture time is too far in the future.");
  }
  if (locationTimestamp && locationTimestamp.toMillis() < nowMillis - 24 * 60 * 60_000) {
    throw new HttpError(400, "Location capture time is too old for a live heartbeat.");
  }

  const presenceReference = firestore.collection("cleanerPresence").doc(cleaner.cleanerId);
  const cleanerReference = firestore.collection("cleaners").doc(cleaner.cleanerId);
  const historyReference = input.location && input.clientHeartbeatId
    ? cleanerReference.collection("locationHistory").doc(locationHistoryId(cleaner.cleanerId, input.clientHeartbeatId))
    : null;
  const requestFingerprint = input.location ? locationRequestFingerprint(input) : null;

  const outcome = await firestore.runTransaction(async (transaction) => {
    const reads = await Promise.all([
      transaction.get(cleanerReference),
      transaction.get(presenceReference),
      historyReference ? transaction.get(historyReference) : Promise.resolve(null),
    ]);
    const [cleanerSnapshot, presenceSnapshot, historySnapshot] = reads;
    if (!cleanerSnapshot.exists || cleanerSnapshot.data()?.status !== "active" || cleanerSnapshot.data()?.authUid !== cleaner.uid) {
      throw new HttpError(403, "Cleaner access is inactive.");
    }
    if (historySnapshot?.exists) {
      if (historySnapshot.data()?.requestFingerprint !== requestFingerprint) {
        throw new HttpError(409, "clientHeartbeatId is already used by a different location heartbeat.");
      }
      return { duplicate: true };
    }
    const current = presenceSnapshot.exists ? presenceSnapshot.data()! : {};
    const consent = input.locationConsent ?? current.locationConsent === true;
    if (input.location && !consent) throw new HttpError(409, "Location consent is required before submitting a location heartbeat.");

    const update: Record<string, unknown> = {
      cleanerId: cleaner.cleanerId,
      availability: input.availability ?? current.availability ?? "offline",
      activeWorkOrderId: current.activeWorkOrderId ?? null,
      locationConsent: consent,
      lastHeartbeatAt: Timestamp.fromDate(now),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (input.locationConsent === false) update.lastLocation = null;
    if (input.location && locationTimestamp) {
      const currentCaptured = timestampMillis((current.lastLocation as Record<string, unknown> | undefined)?.capturedAt);
      if (currentCaptured === null || locationTimestamp.toMillis() >= currentCaptured) {
        update.lastLocation = {
          latitude: input.location.latitude,
          longitude: input.location.longitude,
          accuracyMeters: input.location.accuracyMeters,
          capturedAt: locationTimestamp,
          source: input.location.source,
        };
      }
      transaction.create(historyReference!, {
        cleanerId: cleaner.cleanerId,
        latitude: input.location.latitude,
        longitude: input.location.longitude,
        accuracyMeters: input.location.accuracyMeters,
        capturedAt: locationTimestamp,
        receivedAt: Timestamp.fromDate(now),
        source: input.location.source,
        clientHeartbeatId: input.clientHeartbeatId,
        requestFingerprint,
        retentionExpiresAt: Timestamp.fromMillis(nowMillis + LOCATION_HISTORY_RETENTION_DAYS * 24 * 60 * 60_000),
      });
    }
    transaction.set(presenceReference, update, { merge: true });
    return { duplicate: false };
  });

  return { presence: await getCleanerPresence(cleaner.cleanerId, nowMillis), idempotent: outcome.duplicate };
}

export async function listCleanerLocationHistory(cleanerId: string, input: { limit: number; cursor?: string }) {
  const cleaner = await firestore.collection("cleaners").doc(cleanerId).get();
  if (!cleaner.exists) throw new HttpError(404, "Cleaner not found.");
  const query: Query<DocumentData> = cleaner.ref.collection("locationHistory");
  return queryCursorPage({
    query,
    resource: `cleaner-location-history:${cleanerId}`,
    orderField: "capturedAt",
    filters: { cleanerId },
    limit: input.limit,
    cursor: input.cursor,
    present: (snapshot) => {
      const data = snapshot.data();
      return {
        id: snapshot.id,
        cleanerId,
        latitude: Number(data.latitude),
        longitude: Number(data.longitude),
        accuracyMeters: Number(data.accuracyMeters),
        capturedAt: instant(data.capturedAt),
        receivedAt: instant(data.receivedAt),
        source: String(data.source),
      };
    },
  });
}
