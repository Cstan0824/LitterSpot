import type { DocumentData } from "firebase-admin/firestore";
import { cameraRegistrationDraftV2Schema, type CameraRegistrationDraftV2 } from "../schemas/cameraRegistration.js";
import { HttpError } from "../shared/httpError.js";

export const REGISTERED_FRAME_INFERENCE_CONTRACT_VERSION = "registered-frame-v1";

export type PinnedCameraRegistration = CameraRegistrationDraftV2 & {
  cameraId: string;
  revision: number;
  status: "ready";
};

function registrationError(message: string, code: string, status = 409) {
  return new HttpError(status, message, { code });
}

/**
 * Copy the published registration fields that a processing job is allowed to
 * use. The copy is stored on the job so a later registration publication
 * cannot change the meaning of queued media.
 */
export function pinCameraRegistration(cameraId: string, data: DocumentData | Record<string, unknown> | undefined): PinnedCameraRegistration {
  if (!data || data.status !== "ready") {
    throw registrationError("Camera registration is required before processing media.", "REGISTRATION_REQUIRED");
  }
  const revision = Number(data.revision);
  if (!Number.isInteger(revision) || revision < 1) {
    throw registrationError("The published camera registration has an invalid revision.", "REGISTRATION_INVALID");
  }
  try {
    const draft = cameraRegistrationDraftV2Schema.parse({
      schemaVersion: data.schemaVersion,
      referenceMediaId: data.referenceMediaId,
      referenceSource: data.referenceSource,
      sourceWidth: data.sourceWidth,
      sourceHeight: data.sourceHeight,
      walkableFloorPolygon: data.walkableFloorPolygon,
      bins: data.bins,
      quality: data.quality,
    });
    return { cameraId, revision, status: "ready", ...draft };
  } catch {
    throw registrationError("The published camera registration is invalid.", "REGISTRATION_INVALID");
  }
}

export function pinnedRegistrationFromJob(job: DocumentData): PinnedCameraRegistration | null {
  const data = job.cameraRegistration;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return pinCameraRegistration(String(job.cameraId), data as Record<string, unknown>);
}

export function assertRegistrationFrameDimensions(
  registration: PinnedCameraRegistration,
  image: { width: number; height: number },
) {
  if (image.width !== registration.sourceWidth || image.height !== registration.sourceHeight) {
    throw registrationError(
      `Media dimensions ${image.width} x ${image.height} do not match camera registration ${registration.sourceWidth} x ${registration.sourceHeight}.`,
      "FRAME_DIMENSION_MISMATCH",
      422,
    );
  }
}

export function rejectOperationalFocusRegion(points: Array<{ x: number; y: number }>) {
  if (points.length > 0) {
    throw new HttpError(400, "Operational processing uses the registered walkable-floor polygon. Remove the upload focusRegion.", {
      code: "REGISTERED_FLOOR_REQUIRED",
    });
  }
}
