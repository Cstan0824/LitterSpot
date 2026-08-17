import { FieldValue, Timestamp, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";

export type CleanerStatus = "active" | "inactive";

export type CleanerInput = {
  staffCode: string;
  fullName: string;
  phone: string;
  assignedZoneId: string;
  notes?: string | null;
  capabilities?: string[];
};

export type CleanerUpdate = Partial<Omit<CleanerInput, "staffCode">> & {
  permittedSiteIds?: string[];
  permittedZoneIds?: string[];
  status?: CleanerStatus;
};

function normalizeStaffCode(value: string) {
  return value.trim().toUpperCase();
}

function serializeTimestamp(value: unknown) {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

function serializeCleaner(snapshot: DocumentSnapshot) {
  if (!snapshot.exists) throw new HttpError(404, "Cleaner not found.");
  const data = snapshot.data()!;
  return {
    id: snapshot.id,
    staffCode: String(data.staffCode),
    fullName: String(data.fullName),
    phone: String(data.phone),
    assignedSiteId: String(data.assignedSiteId),
    assignedZoneId: String(data.assignedZoneId),
    assignedZoneName: String(data.assignedZoneNameSnapshot),
    status: data.status as CleanerStatus,
    authUid: data.authUid == null ? null : String(data.authUid),
    email: data.email == null ? null : String(data.email),
    accountStatus: String(data.accountStatus ?? "not_provisioned"),
    permittedSiteIds: Array.isArray(data.permittedSiteIds) ? data.permittedSiteIds.map(String) : [String(data.assignedSiteId)],
    permittedZoneIds: Array.isArray(data.permittedZoneIds) ? data.permittedZoneIds.map(String) : [String(data.assignedZoneId)],
    capabilities: Array.isArray(data.capabilities) ? data.capabilities.map(String) : ["general_cleaning"],
    authLinkedAt: serializeTimestamp(data.authLinkedAt),
    notes: data.notes == null ? null : String(data.notes),
    createdAt: serializeTimestamp(data.createdAt),
    updatedAt: serializeTimestamp(data.updatedAt),
    deactivatedAt: serializeTimestamp(data.deactivatedAt),
  };
}

async function readActiveZone(
  transaction: Transaction,
  zoneId: string,
) {
  const zoneSnapshot = await transaction.get(firestore.collection("zones").doc(zoneId));
  const zone = zoneSnapshot.data();
  if (!zoneSnapshot.exists || zone?.status !== "active") {
    throw new HttpError(400, "Assigned zone does not exist or is inactive.");
  }
  return {
    siteId: String(zone.siteId),
    name: String(zone.name),
  };
}

export async function listCleaners(status: CleanerStatus | "all") {
  const snapshot = await firestore.collection("cleaners").limit(200).get();
  return snapshot.docs
    .map(serializeCleaner)
    .filter((cleaner) => status === "all" || cleaner.status === status)
    .sort((left, right) => left.fullName.localeCompare(right.fullName));
}

export async function getCleaner(cleanerId: string) {
  return serializeCleaner(await firestore.collection("cleaners").doc(cleanerId).get());
}

export async function createCleaner(input: CleanerInput, actorUid: string) {
  const cleanerRef = firestore.collection("cleaners").doc();
  const staffCode = normalizeStaffCode(input.staffCode);
  const reservationRef = firestore.collection("cleanerStaffCodes").doc(staffCode.toLowerCase());

  await firestore.runTransaction(async (transaction) => {
    const zone = await readActiveZone(transaction, input.assignedZoneId);
    const reservation = await transaction.get(reservationRef);
    if (reservation.exists) throw new HttpError(409, "Staff ID is already registered.");

    transaction.create(reservationRef, {
      cleanerId: cleanerRef.id,
      staffCode,
      createdAt: FieldValue.serverTimestamp(),
      createdByUid: actorUid,
    });
    transaction.create(cleanerRef, {
      staffCode,
      staffCodeNormalized: staffCode.toLowerCase(),
      fullName: input.fullName.trim(),
      fullNameNormalized: input.fullName.trim().toLowerCase(),
      phone: input.phone.trim(),
      assignedSiteId: zone.siteId,
      assignedZoneId: input.assignedZoneId,
      assignedZoneNameSnapshot: zone.name,
      status: "active",
      authUid: null,
      email: null,
      accountStatus: "not_provisioned",
      permittedSiteIds: [zone.siteId],
      permittedZoneIds: [input.assignedZoneId],
      capabilities: input.capabilities?.length ? [...new Set(input.capabilities)] : ["general_cleaning"],
      authLinkedAt: null,
      notes: input.notes?.trim() || null,
      createdAt: FieldValue.serverTimestamp(),
      createdByUid: actorUid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: actorUid,
      deactivatedAt: null,
      deactivatedByUid: null,
    });
  });

  return getCleaner(cleanerRef.id);
}

export async function updateCleaner(cleanerId: string, input: CleanerUpdate, actorUid: string) {
  const cleanerRef = firestore.collection("cleaners").doc(cleanerId);

  await firestore.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(cleanerRef);
    if (!currentSnapshot.exists) throw new HttpError(404, "Cleaner not found.");

    let zoneUpdate: Record<string, unknown> = {};
    if (input.assignedZoneId) {
      const zone = await readActiveZone(transaction, input.assignedZoneId);
      zoneUpdate = {
        assignedSiteId: zone.siteId,
        assignedZoneId: input.assignedZoneId,
        assignedZoneNameSnapshot: zone.name,
        permittedSiteIds: FieldValue.arrayUnion(zone.siteId),
        permittedZoneIds: FieldValue.arrayUnion(input.assignedZoneId),
      };
    } else if (input.status === "active") {
      await readActiveZone(transaction, String(currentSnapshot.data()!.assignedZoneId));
    }

    if (input.permittedSiteIds || input.permittedZoneIds) {
      const current = currentSnapshot.data()!;
      const assignedSiteId = String(zoneUpdate.assignedSiteId ?? current.assignedSiteId);
      const assignedZoneId = String(zoneUpdate.assignedZoneId ?? current.assignedZoneId);
      const siteIds = [...new Set(input.permittedSiteIds
        ?? (Array.isArray(current.permittedSiteIds) ? current.permittedSiteIds.map(String) : [assignedSiteId]))];
      const zoneIds = [...new Set(input.permittedZoneIds
        ?? (Array.isArray(current.permittedZoneIds) ? current.permittedZoneIds.map(String) : [assignedZoneId]))];
      if (!siteIds.includes(assignedSiteId) || !zoneIds.includes(assignedZoneId)) {
        throw new HttpError(400, "Cleaner permissions must include the currently assigned site and zone.");
      }
      const [sites, zones] = await Promise.all([
        Promise.all(siteIds.map((siteId) => transaction.get(firestore.collection("sites").doc(siteId)))),
        Promise.all(zoneIds.map((zoneId) => transaction.get(firestore.collection("zones").doc(zoneId)))),
      ]);
      if (sites.some((site) => !site.exists || site.data()?.status !== "active")) {
        throw new HttpError(400, "Every permitted site must exist and be active.");
      }
      if (zones.some((zone) => !zone.exists || zone.data()?.status !== "active" || !siteIds.includes(String(zone.data()?.siteId)))) {
        throw new HttpError(400, "Every permitted zone must be active and belong to a permitted site.");
      }
    }

    const statusUpdate = input.status
      ? {
          status: input.status,
          deactivatedAt: input.status === "inactive" ? FieldValue.serverTimestamp() : null,
          deactivatedByUid: input.status === "inactive" ? actorUid : null,
        }
      : {};

    transaction.update(cleanerRef, {
      ...(input.fullName ? {
        fullName: input.fullName.trim(),
        fullNameNormalized: input.fullName.trim().toLowerCase(),
      } : {}),
      ...(input.phone ? { phone: input.phone.trim() } : {}),
      ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      ...(input.permittedSiteIds ? { permittedSiteIds: [...new Set(input.permittedSiteIds)] } : {}),
      ...(input.permittedZoneIds ? { permittedZoneIds: [...new Set(input.permittedZoneIds)] } : {}),
      ...(input.capabilities ? { capabilities: [...new Set(input.capabilities)] } : {}),
      ...zoneUpdate,
      ...statusUpdate,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: actorUid,
    });
  });

  return getCleaner(cleanerId);
}
