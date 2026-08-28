import { FieldValue, Timestamp, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { cameraLatestPointerReset } from "./cameraLocationState.js";

export type RecordStatus = "active" | "inactive";

function serializeTimestamp(value: unknown) {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

function assertExists(snapshot: DocumentSnapshot, label: string) {
  if (!snapshot.exists) throw new HttpError(404, `${label} not found.`);
  return snapshot.data()!;
}

function auditFields(actorUid: string) {
  return {
    createdAt: FieldValue.serverTimestamp(),
    createdByUid: actorUid,
    updatedAt: FieldValue.serverTimestamp(),
    updatedByUid: actorUid,
    deactivatedAt: null,
    deactivatedByUid: null,
  };
}

function statusFields(status: RecordStatus | undefined, actorUid: string) {
  if (!status) return {};
  return {
    status,
    deactivatedAt: status === "inactive" ? FieldValue.serverTimestamp() : null,
    deactivatedByUid: status === "inactive" ? actorUid : null,
  };
}

function serializeSite(snapshot: DocumentSnapshot) {
  const data = assertExists(snapshot, "Site");
  return {
    id: snapshot.id,
    name: String(data.name),
    description: data.description == null ? null : String(data.description),
    timezone: String(data.timezone ?? "Asia/Kuala_Lumpur"),
    status: data.status as RecordStatus,
    createdAt: serializeTimestamp(data.createdAt),
    updatedAt: serializeTimestamp(data.updatedAt),
  };
}

function serializeZone(snapshot: DocumentSnapshot) {
  const data = assertExists(snapshot, "Zone");
  return {
    id: snapshot.id,
    siteId: String(data.siteId),
    siteName: String(data.siteNameSnapshot),
    name: String(data.name),
    code: data.code == null ? null : String(data.code),
    description: data.description == null ? null : String(data.description),
    status: data.status as RecordStatus,
    createdAt: serializeTimestamp(data.createdAt),
    updatedAt: serializeTimestamp(data.updatedAt),
  };
}

function serializeCamera(snapshot: DocumentSnapshot) {
  const data = assertExists(snapshot, "Camera");
  return {
    id: snapshot.id,
    siteId: String(data.siteId),
    siteName: String(data.siteNameSnapshot),
    zoneId: String(data.zoneId),
    zoneName: String(data.zoneNameSnapshot),
    code: String(data.code),
    name: String(data.name),
    sourceMode: data.sourceMode as "upload" | "stream",
    status: data.status as RecordStatus,
    availability: String(data.availability ?? "unknown") as "unknown" | "available" | "unavailable",
    registrationStatus: String(data.registrationStatus ?? "unregistered") as "unregistered" | "ready" | "stale" | "invalid",
    registrationRevision: Number(data.registrationRevision ?? 0),
    registrationUpdatedAt: serializeTimestamp(data.registrationUpdatedAt),
    createdAt: serializeTimestamp(data.createdAt),
    updatedAt: serializeTimestamp(data.updatedAt),
  };
}

async function readActiveSite(transaction: Transaction, siteId: string) {
  const snapshot = await transaction.get(firestore.collection("sites").doc(siteId));
  const data = snapshot.data();
  if (!snapshot.exists || data?.status !== "active") {
    throw new HttpError(400, "Site does not exist or is inactive.");
  }
  return { id: snapshot.id, name: String(data.name) };
}

async function readActiveZone(transaction: Transaction, zoneId: string) {
  const snapshot = await transaction.get(firestore.collection("zones").doc(zoneId));
  const data = snapshot.data();
  if (!snapshot.exists || data?.status !== "active") {
    throw new HttpError(400, "Zone does not exist or is inactive.");
  }
  return {
    id: snapshot.id,
    name: String(data.name),
    siteId: String(data.siteId),
    siteName: String(data.siteNameSnapshot),
  };
}

export async function listSites(status: RecordStatus | "all" = "all") {
  const snapshot = await firestore.collection("sites").limit(200).get();
  return snapshot.docs.map(serializeSite)
    .filter((site) => status === "all" || site.status === status)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function getSite(siteId: string) {
  return serializeSite(await firestore.collection("sites").doc(siteId).get());
}

export async function createSite(input: { name: string; description?: string | null; timezone?: string }, actorUid: string) {
  const reference = firestore.collection("sites").doc();
  await reference.create({
    name: input.name.trim(),
    nameNormalized: input.name.trim().toLowerCase(),
    description: input.description?.trim() || null,
    timezone: input.timezone ?? "Asia/Kuala_Lumpur",
    status: "active",
    ...auditFields(actorUid),
  });
  return getSite(reference.id);
}

export async function updateSite(siteId: string, input: { name?: string; description?: string | null; status?: RecordStatus }, actorUid: string) {
  const reference = firestore.collection("sites").doc(siteId);
  const current = await reference.get();
  assertExists(current, "Site");

  if (input.status === "inactive") {
    const zones = await firestore.collection("zones").where("siteId", "==", siteId).limit(200).get();
    if (zones.docs.some((zone) => zone.data().status === "active")) {
      throw new HttpError(409, "Deactivate this site's active zones first.");
    }
  }

  await reference.update({
    ...(input.name ? { name: input.name.trim(), nameNormalized: input.name.trim().toLowerCase() } : {}),
    ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
    ...statusFields(input.status, actorUid),
    updatedAt: FieldValue.serverTimestamp(),
    updatedByUid: actorUid,
  });
  return getSite(siteId);
}

export async function listZones(filters: { status?: RecordStatus | "all"; siteId?: string } = {}) {
  const snapshot = filters.siteId
    ? await firestore.collection("zones").where("siteId", "==", filters.siteId).limit(200).get()
    : await firestore.collection("zones").limit(200).get();
  const status = filters.status ?? "all";
  return snapshot.docs.map(serializeZone)
    .filter((zone) => status === "all" || zone.status === status)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function getZone(zoneId: string) {
  return serializeZone(await firestore.collection("zones").doc(zoneId).get());
}

export async function createZone(input: { siteId: string; name: string; code?: string | null; description?: string | null }, actorUid: string) {
  const reference = firestore.collection("zones").doc();
  await firestore.runTransaction(async (transaction) => {
    const site = await readActiveSite(transaction, input.siteId);
    transaction.create(reference, {
      siteId: site.id,
      siteNameSnapshot: site.name,
      name: input.name.trim(),
      nameNormalized: input.name.trim().toLowerCase(),
      code: input.code?.trim().toUpperCase() || null,
      description: input.description?.trim() || null,
      status: "active",
      analyticsEnabled: true,
      mapCentroid: null,
      mapPolygon: [],
      ...auditFields(actorUid),
    });
  });
  return getZone(reference.id);
}

export async function updateZone(zoneId: string, input: { name?: string; code?: string | null; description?: string | null; status?: RecordStatus }, actorUid: string) {
  const reference = firestore.collection("zones").doc(zoneId);
  const current = await reference.get();
  assertExists(current, "Zone");

  if (input.status === "inactive") {
    const [cameras, cleaners] = await Promise.all([
      firestore.collection("cameras").where("zoneId", "==", zoneId).limit(200).get(),
      firestore.collection("cleaners").where("assignedZoneId", "==", zoneId).limit(200).get(),
    ]);
    if (cameras.docs.some((camera) => camera.data().status === "active")) {
      throw new HttpError(409, "Deactivate this zone's active cameras first.");
    }
    if (cleaners.docs.some((cleaner) => cleaner.data().status === "active")) {
      throw new HttpError(409, "Reassign or deactivate this zone's active cleaners first.");
    }
  }

  await firestore.runTransaction(async (transaction) => {
    const latest = await transaction.get(reference);
    const latestData = assertExists(latest, "Zone");
    if (input.status === "active") {
      await readActiveSite(transaction, String(latestData.siteId));
    }
    transaction.update(reference, {
      ...(input.name ? { name: input.name.trim(), nameNormalized: input.name.trim().toLowerCase() } : {}),
      ...(input.code !== undefined ? { code: input.code?.trim().toUpperCase() || null } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...statusFields(input.status, actorUid),
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: actorUid,
    });
  });
  return getZone(zoneId);
}

export async function listCameras(filters: { status?: RecordStatus | "all"; siteId?: string; zoneId?: string } = {}) {
  let snapshot;
  if (filters.zoneId) snapshot = await firestore.collection("cameras").where("zoneId", "==", filters.zoneId).limit(200).get();
  else if (filters.siteId) snapshot = await firestore.collection("cameras").where("siteId", "==", filters.siteId).limit(200).get();
  else snapshot = await firestore.collection("cameras").limit(200).get();
  const status = filters.status ?? "all";
  return snapshot.docs.map(serializeCamera)
    .filter((camera) => status === "all" || camera.status === status)
    .sort((left, right) => left.code.localeCompare(right.code, undefined, { numeric: true }));
}

export async function getCamera(cameraId: string) {
  return serializeCamera(await firestore.collection("cameras").doc(cameraId).get());
}

export async function createCamera(input: { zoneId: string; code: string; name: string; sourceMode?: "upload" | "stream" }, actorUid: string) {
  const reference = firestore.collection("cameras").doc();
  const code = input.code.trim().toUpperCase();
  const codeReference = firestore.collection("cameraCodes").doc(code.toLowerCase());

  await firestore.runTransaction(async (transaction) => {
    const zone = await readActiveZone(transaction, input.zoneId);
    const reservation = await transaction.get(codeReference);
    if (reservation.exists) throw new HttpError(409, "Camera code is already registered.");

    transaction.create(codeReference, {
      cameraId: reference.id,
      code,
      createdAt: FieldValue.serverTimestamp(),
      createdByUid: actorUid,
    });
    transaction.create(reference, {
      siteId: zone.siteId,
      siteNameSnapshot: zone.siteName,
      zoneId: zone.id,
      zoneNameSnapshot: zone.name,
      code,
      name: input.name.trim(),
      nameNormalized: input.name.trim().toLowerCase(),
      sourceMode: input.sourceMode ?? "upload",
      streamProtocol: null,
      streamUri: null,
      status: "active",
      availability: "unknown",
      focusRegionNormalized: [],
      registrationStatus: "unregistered",
      registrationRevision: 0,
      registrationUpdatedAt: null,
      latestAnalysisRunId: null,
      latestAnalysisAt: null,
      latestCapturedAt: null,
      lastHealthCheckAt: null,
      unavailableReason: null,
      ...auditFields(actorUid),
    });
  });
  return getCamera(reference.id);
}

export async function updateCamera(cameraId: string, input: { name?: string; zoneId?: string; sourceMode?: "upload" | "stream"; status?: RecordStatus }, actorUid: string) {
  const reference = firestore.collection("cameras").doc(cameraId);
  await firestore.runTransaction(async (transaction) => {
    const current = await transaction.get(reference);
    const currentData = assertExists(current, "Camera");

    let zoneFields: Record<string, unknown> = {};
    if (input.zoneId) {
      const zone = await readActiveZone(transaction, input.zoneId);
      zoneFields = {
        siteId: zone.siteId,
        siteNameSnapshot: zone.siteName,
        zoneId: zone.id,
        zoneNameSnapshot: zone.name,
      };
    } else if (input.status === "active") {
      await readActiveZone(transaction, String(currentData.zoneId));
    }

    transaction.update(reference, {
      ...(input.name ? { name: input.name.trim(), nameNormalized: input.name.trim().toLowerCase() } : {}),
      ...(input.sourceMode ? { sourceMode: input.sourceMode } : {}),
      ...zoneFields,
      ...cameraLatestPointerReset(currentData.zoneId, input.zoneId),
      ...statusFields(input.status, actorUid),
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: actorUid,
    });
  });
  return getCamera(cameraId);
}
