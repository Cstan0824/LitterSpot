import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { SCHEMA_VERSION } from "../shared/firestoreSchema.js";
import { deleteStoredMedia, writeMedia } from "./localMediaStorage.js";
import { detectSupportedImage, readImageDimensions, validateDeclaredImageType } from "./imageUploadValidation.js";
import { auditEventData, type AuditActor } from "./auditService.js";
import type { SiteBackgroundTransform } from "../schemas/siteMap.js";

export async function assertSiteBackground(siteId: string, mediaId: string | null | undefined, transform: SiteBackgroundTransform | null | undefined, boundary?: { widthMeters: number; heightMeters: number }) {
  if (!mediaId && !transform) return null;
  if (!mediaId || !transform) throw new HttpError(400, "A Site background image and its alignment are required together.");
  const media = await firestore.collection("mediaAssets").doc(mediaId).get();
  const data = media.data();
  if (!media.exists || data?.siteId !== siteId || data?.purpose !== "site_map_background" || data?.ownerType !== "site" || data?.ownerId !== siteId
    || data?.storageStatus !== "available" || !String(data?.mimeType).startsWith("image/")) throw new HttpError(400, "A valid Site background image is required.");
  const width = Number(data?.width);
  const height = Number(data?.height);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) throw new HttpError(409, "The Site background is missing valid image dimensions.");
  const sourceRatio = width / height;
  const renderedRatio = transform.widthMeters / transform.heightMeters;
  if (Math.abs(sourceRatio - renderedRatio) / sourceRatio > 0.001) throw new HttpError(400, "Site background alignment must preserve the image aspect ratio.", { code: "background_aspect_ratio_mismatch", sourceWidth: width, sourceHeight: height });
  if (boundary && (transform.xMeters < 0 || transform.yMeters < 0 || transform.xMeters + transform.widthMeters > boundary.widthMeters || transform.yMeters + transform.heightMeters > boundary.heightMeters)) throw new HttpError(422, "Site background alignment must stay inside the Site Map boundary.", { code: "background_outside_site_boundary" });
  return { mediaId: media.id, width, height, mimeType: String(data?.mimeType), contentUrl: `/api/media/${media.id}/content` };
}

export async function uploadSiteBackground(input: { siteId: string; file: Express.Multer.File; actor: AuditActor; requestId: string }) {
  const site = await firestore.collection("sites").doc(input.siteId).get();
  if (!site.exists || site.data()?.status !== "active") throw new HttpError(404, "Active Site not found.");
  const detected = detectSupportedImage(input.file.buffer);
  validateDeclaredImageType(input.file.mimetype, detected.mimeType);
  const dimensions = readImageDimensions(input.file.buffer, detected);
  if (dimensions.width <= 0 || dimensions.height <= 0) throw new HttpError(415, "The Site background has invalid dimensions.");
  const mediaRef = firestore.collection("mediaAssets").doc();
  const storageKey = `media/${mediaRef.id}/site-background.${detected.extension}`;
  await writeMedia(storageKey, input.file.buffer);
  const auditRef = firestore.collection("auditEvents").doc();
  try {
    await firestore.runTransaction(async (transaction) => {
      const latestSite = await transaction.get(site.ref);
      if (!latestSite.exists || latestSite.data()?.status !== "active") throw new HttpError(409, "Site is inactive.");
      transaction.create(mediaRef, {
        schemaVersion: SCHEMA_VERSION,
        mediaId: mediaRef.id,
        siteId: input.siteId,
        purpose: "site_map_background",
        ownerType: "site",
        ownerId: input.siteId,
        cameraId: null,
        mimeType: detected.mimeType,
        originalFileName: input.file.originalname.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) || "site-background",
        byteSize: input.file.size,
        sha256: createHash("sha256").update(input.file.buffer).digest("hex"),
        storageKey,
        storageStatus: "available",
        width: dimensions.width,
        height: dimensions.height,
        durationSeconds: null,
        capturedAt: null,
        retentionClass: "configuration",
        expiresAt: null,
        createdAt: FieldValue.serverTimestamp(),
        createdByUid: input.actor.uid,
        deletedAt: null,
        revision: 1,
      });
      transaction.create(auditRef, auditEventData({
        auditEventId: auditRef.id,
        actor: input.actor,
        siteId: input.siteId,
        siteNameSnapshot: String(latestSite.data()?.name ?? input.siteId),
        action: "site_background_uploaded",
        resourceType: "MediaAsset",
        resourceId: mediaRef.id,
        outcome: "succeeded",
        after: { width: dimensions.width, height: dimensions.height, mimeType: detected.mimeType },
        requestId: input.requestId,
      }));
    });
  } catch (error) {
    await deleteStoredMedia(storageKey).catch(() => undefined);
    throw error;
  }
  return { mediaId: mediaRef.id, contentUrl: `/api/media/${mediaRef.id}/content`, mimeType: detected.mimeType, width: dimensions.width, height: dimensions.height };
}
