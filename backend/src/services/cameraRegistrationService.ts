import { randomUUID } from "node:crypto";
import { FieldValue, Timestamp, type DocumentData, type DocumentSnapshot } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { normalizeCameraRegistrationDraft, type CameraRegistrationDraft, type CameraRegistrationDraftV2 } from "../schemas/cameraRegistration.js";
import { HttpError } from "../shared/httpError.js";
import { getMedia } from "./mediaService.js";
import { getCamera } from "./locationService.js";

const ACTIVE_COLLECTION = "cameraRegistrations";
const REVISION_COLLECTION = "cameraRegistrationRevisions";
const DRAFT_COLLECTION = "cameraRegistrationDrafts";

export type CameraRegistrationWorkspace = {
  camera: Awaited<ReturnType<typeof getCamera>>;
  source: "draft" | "published" | "empty";
  publishedRevision: number;
  draftUpdatedAt: string | null;
  registration: CameraRegistrationDraftV2 | null;
  reference: {
    id: string;
    contentUrl: string;
    originalFileName: string;
    mimeType: string;
    byteSize: number;
    width: number;
    height: number;
    available: boolean;
  } | null;
};

function timestamp(value: unknown) {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

function serialize(snapshot: DocumentSnapshot) {
  if (!snapshot.exists) return null;
  const data = snapshot.data()!;
  const legacyBins = Array.isArray(data.bins) ? data.bins : [];
  const bins = legacyBins.map((bin): CameraRegistrationDraftV2["bins"][number] => {
    const value = bin as Record<string, unknown>;
    return {
      binId: String(value.binId ?? ""),
      displayName: String(value.displayName ?? value.binId ?? "Registered bin"),
      binType: (value.binType === "lid" ? "lidded" : value.binType === "open_top" ? "open_top" : "unknown") as CameraRegistrationDraftV2["bins"][number]["binType"],
      binPolygon: (Array.isArray(value.binPolygon) ? value.binPolygon : (value.bodyPolygon ?? [])) as CameraRegistrationDraftV2["bins"][number]["binPolygon"],
    };
  });
  return {
    id: snapshot.id,
    cameraId: String(data.cameraId),
    revision: Number(data.revision ?? 0),
    status: String(data.status ?? "ready") as "ready" | "stale" | "invalid",
    schemaVersion: 2,
    referenceMediaId: String(data.referenceMediaId),
    sourceWidth: Number(data.sourceWidth),
    sourceHeight: Number(data.sourceHeight),
    walkableFloorPolygon: data.walkableFloorPolygon ?? [],
    bins,
    quality: data.quality ?? {},
    validation: data.validation ?? null,
    publishedAt: timestamp(data.publishedAt),
    publishedByUid: data.publishedByUid == null ? null : String(data.publishedByUid),
    updatedAt: timestamp(data.updatedAt),
  };
}

function registrationDraftFromPublished(value: ReturnType<typeof serialize>): CameraRegistrationDraftV2 | null {
  if (!value) return null;
  return {
    schemaVersion: 2 as const,
    referenceMediaId: value.referenceMediaId,
    sourceWidth: value.sourceWidth,
    sourceHeight: value.sourceHeight,
    walkableFloorPolygon: value.walkableFloorPolygon as CameraRegistrationDraftV2["walkableFloorPolygon"],
    bins: value.bins,
    quality: value.quality as CameraRegistrationDraftV2["quality"],
  };
}

async function referenceDescriptor(draft: CameraRegistrationDraftV2 | null) {
  if (!draft) return null;
  const fallback = {
    id: draft.referenceMediaId,
    contentUrl: `/api/media/${encodeURIComponent(draft.referenceMediaId)}/content`,
    originalFileName: "Reference frame",
    mimeType: "image/*",
    byteSize: 0,
    width: draft.sourceWidth,
    height: draft.sourceHeight,
    available: false,
  };
  try {
    const media = await getMedia(draft.referenceMediaId);
    return {
      id: media.id,
      contentUrl: media.contentUrl,
      originalFileName: media.originalFileName,
      mimeType: media.mimeType,
      byteSize: media.byteSize,
      width: draft.sourceWidth,
      height: draft.sourceHeight,
      available: media.storageStatus === "available",
    };
  } catch {
    return fallback;
  }
}

function assertCameraId(cameraId: string) {
  if (!cameraId.trim() || cameraId.length > 128) throw new HttpError(400, "A valid cameraId is required.");
}

function geometryChecks(draft: CameraRegistrationDraftV2) {
  const checks: Array<{ code: string; passed: boolean; message: string }> = [];
  checks.push({ code: "reference_dimensions", passed: draft.sourceWidth >= 320 && draft.sourceHeight >= 240, message: "Reference frame is large enough for stable alignment." });
  checks.push({ code: "floor_roi", passed: draft.walkableFloorPolygon.length >= 3, message: "A walkable floor polygon is present." });
  checks.push({ code: "bin_geometry", passed: draft.bins.every((bin) => validRegisteredPolygon(bin.binPolygon)), message: "Registered bins are optional; every supplied bin has one valid in-frame polygon." });
  checks.push({ code: "bin_ids_unique", passed: new Set(draft.bins.map((bin) => bin.binId.toLowerCase())).size === draft.bins.length, message: "Bin identifiers are unique." });
  return checks;
}

function validRegisteredPolygon(points: Array<{ x: number; y: number }>) {
  return points.length >= 3 && points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

async function assertReferenceMedia(cameraId: string, mediaId: string, sourceWidth: number, sourceHeight: number) {
  const media = await getMedia(mediaId);
  if (media.cameraId !== cameraId) throw new HttpError(409, "Reference media belongs to a different camera.");
  if (media.storageStatus !== "available") throw new HttpError(409, "Reference media is not available.");
  if (media.kind !== "original_upload" && media.kind !== "extracted_frame") throw new HttpError(409, "Reference media must be an image frame.");
  if (media.width && media.height && (media.width !== sourceWidth || media.height !== sourceHeight)) {
    throw new HttpError(409, "Reference dimensions do not match the selected media asset.");
  }
}

export async function getCameraRegistration(cameraId: string) {
  assertCameraId(cameraId);
  return serialize(await firestore.collection(ACTIVE_COLLECTION).doc(cameraId).get());
}

export async function getCameraRegistrationDraft(cameraId: string) {
  assertCameraId(cameraId);
  const snapshot = await firestore.collection(DRAFT_COLLECTION).doc(cameraId).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data()!;
  return {
    cameraId,
    referenceContentUrl: `/api/media/${String(data.referenceMediaId)}/content`,
    draft: {
      schemaVersion: 2 as const,
      referenceMediaId: String(data.referenceMediaId),
      sourceWidth: Number(data.sourceWidth),
      sourceHeight: Number(data.sourceHeight),
      walkableFloorPolygon: data.walkableFloorPolygon ?? [],
      bins: data.bins ?? [],
      quality: data.quality ?? {},
    },
    updatedAt: timestamp(data.updatedAt),
  };
}

/**
 * Hydrate the complete registration editor in one read model.  The caller
 * should not need to know whether an operator left a draft or whether the
 * camera only has a published revision; the effective registration is always
 * resolved in the order draft -> published -> empty.
 */
export async function getCameraRegistrationWorkspace(cameraId: string): Promise<CameraRegistrationWorkspace> {
  assertCameraId(cameraId);
  const camera = await getCamera(cameraId);
  const [published, savedDraft] = await Promise.all([
    getCameraRegistration(cameraId),
    getCameraRegistrationDraft(cameraId),
  ]);
  const publishedDraft = registrationDraftFromPublished(published);
  const registration = savedDraft?.draft ?? publishedDraft;
  const source: CameraRegistrationWorkspace["source"] = savedDraft ? "draft" : publishedDraft ? "published" : "empty";
  return {
    camera,
    source,
    publishedRevision: published?.revision ?? camera.registrationRevision,
    draftUpdatedAt: savedDraft?.updatedAt ?? null,
    registration,
    reference: await referenceDescriptor(registration),
  };
}

export async function saveCameraRegistrationDraft(cameraId: string, draft: CameraRegistrationDraft, actorUid: string) {
  assertCameraId(cameraId);
  const normalized = normalizeCameraRegistrationDraft(draft);
  await assertReferenceMedia(cameraId, normalized.referenceMediaId, normalized.sourceWidth, normalized.sourceHeight);
  await firestore.collection(DRAFT_COLLECTION).doc(cameraId).set({
    cameraId,
    ...normalized,
    updatedAt: FieldValue.serverTimestamp(),
    updatedByUid: actorUid,
  }, { merge: false });
  return getCameraRegistrationDraft(cameraId);
}

export async function listCameraRegistrationRevisions(cameraId: string) {
  assertCameraId(cameraId);
  const snapshot = await firestore.collection(REVISION_COLLECTION)
    .where("cameraId", "==", cameraId)
    .limit(100)
    .get();
  return snapshot.docs
    .map((revision) => serialize(revision))
    .filter((revision): revision is NonNullable<typeof revision> => revision !== null)
    .sort((left, right) => right.revision - left.revision);
}

export async function validateCameraRegistration(cameraId: string, draft: CameraRegistrationDraft) {
  assertCameraId(cameraId);
  const normalized = normalizeCameraRegistrationDraft(draft);
  await assertReferenceMedia(cameraId, normalized.referenceMediaId, normalized.sourceWidth, normalized.sourceHeight);
  const checks = geometryChecks(normalized);
  const errors = checks.filter((check) => !check.passed).map((check) => ({ code: check.code, message: check.message }));
  return {
    ready: errors.length === 0,
    checks,
    errors,
    warnings: normalized.bins.length === 0
      ? [{ code: "no_registered_bins", message: "No physical bins are enrolled for this camera view; bin-state monitoring is disabled for this registration." }]
      : [],
  };
}

export async function publishCameraRegistration(cameraId: string, draft: CameraRegistrationDraft, expectedRevision: number, actorUid: string) {
  const normalized = normalizeCameraRegistrationDraft(draft);
  const validation = await validateCameraRegistration(cameraId, normalized);
  if (!validation.ready) throw new HttpError(422, "Camera registration failed validation.", validation);
  const activeReference = firestore.collection(ACTIVE_COLLECTION).doc(cameraId);
  const revisionReference = firestore.collection(REVISION_COLLECTION).doc(randomUUID());
  const cameraReference = firestore.collection("cameras").doc(cameraId);
  await firestore.runTransaction(async (transaction) => {
    const [cameraSnapshot, activeSnapshot] = await Promise.all([
      transaction.get(cameraReference),
      transaction.get(activeReference),
    ]);
    if (!cameraSnapshot.exists || cameraSnapshot.data()?.status !== "active") throw new HttpError(404, "Camera not found or inactive.");
    const currentRevision = Number(activeSnapshot.data()?.revision ?? 0);
    if (currentRevision !== expectedRevision) throw new HttpError(409, "Camera registration changed. Reload the latest revision before publishing.", { currentRevision });
    const revision = currentRevision + 1;
    const common = {
      cameraId,
      revision,
      status: "ready",
      ...normalized,
      validation: { ...validation, validatedAt: FieldValue.serverTimestamp() },
      publishedAt: FieldValue.serverTimestamp(),
      publishedByUid: actorUid,
      updatedAt: FieldValue.serverTimestamp(),
    } satisfies DocumentData;
    transaction.create(revisionReference, { ...common, createdAt: FieldValue.serverTimestamp() });
    transaction.set(activeReference, { id: activeReference.id, ...common }, { merge: false });
    transaction.update(cameraReference, {
      registrationStatus: "ready",
      registrationRevision: revision,
      registrationUpdatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: actorUid,
    });
  });
  return serialize(await activeReference.get());
}
