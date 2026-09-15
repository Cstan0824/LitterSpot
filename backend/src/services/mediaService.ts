import { FieldValue, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { inspectMedia } from "./localMediaStorage.js";

function serializeTimestamp(value: unknown) {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

function assertExists(snapshot: DocumentSnapshot, label: string) {
  if (!snapshot.exists) throw new HttpError(404, `${label} not found.`);
  return snapshot.data()!;
}

function serializeMedia(snapshot: DocumentSnapshot) {
  const data = assertExists(snapshot, "Media asset");
  return {
    id: snapshot.id,
    kind: String(data.kind),
    sourceType: String(data.sourceType),
    originalFileName: String(data.originalFileName),
    storageStatus: String(data.storageStatus),
    mimeType: String(data.mimeType),
    byteSize: Number(data.byteSize),
    sha256: String(data.sha256),
    width: data.width == null ? null : Number(data.width),
    height: data.height == null ? null : Number(data.height),
    durationSeconds: data.durationSeconds == null ? null : Number(data.durationSeconds),
    parentMediaId: data.parentMediaId == null ? null : String(data.parentMediaId),
    frameIndex: data.frameIndex == null ? null : Number(data.frameIndex),
    videoOffsetSeconds: data.videoOffsetSeconds == null ? null : Number(data.videoOffsetSeconds),
    siteId: String(data.siteId),
    siteName: String(data.siteNameSnapshot),
    zoneId: String(data.zoneId),
    zoneName: String(data.zoneNameSnapshot),
    cameraId: String(data.cameraId),
    cameraCode: String(data.cameraCodeSnapshot),
    cameraName: String(data.cameraNameSnapshot),
    capturedAt: serializeTimestamp(data.capturedAt),
    isTest: Boolean(data.isTest),
    contentUrl: `/api/media/${snapshot.id}/content`,
    createdAt: serializeTimestamp(data.createdAt),
  };
}

async function getMediaSnapshot(mediaId: string) {
  return firestore.collection("mediaAssets").doc(mediaId).get();
}

export async function getMedia(mediaId: string) {
  return serializeMedia(await getMediaSnapshot(mediaId));
}

export async function getMediaContent(mediaId: string) {
  const reference = firestore.collection("mediaAssets").doc(mediaId);
  const snapshot = await reference.get();
  const data = assertExists(snapshot, "Media asset");
  try {
    const stored = await inspectMedia(String(data.storageKey));
    if (data.storageStatus !== "available") await reference.update({ storageStatus: "available", storageCheckedAt: FieldValue.serverTimestamp() });
    return {
      ...stored,
      mimeType: String(data.mimeType),
      originalFileName: String(data.originalFileName),
    };
  } catch (error) {
    await reference.update({ storageStatus: "missing", storageCheckedAt: FieldValue.serverTimestamp() });
    throw error;
  }
}
