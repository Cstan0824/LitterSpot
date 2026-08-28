import { readFile } from "node:fs/promises";
import { cameraRegistrationDraftV2Schema } from "../schemas/cameraRegistration.js";
import type { CameraRegistrationPreviewSource } from "../schemas/cameraRegistration.js";
import type { PipelineAnalysisResponse } from "../schemas/detection.js";
import { HttpError } from "../shared/httpError.js";
import { validateCameraRegistration } from "./cameraRegistrationService.js";
import { analyzeRegistrationPreview } from "./aiServiceClient.js";
import { confirmTemporalBinStates } from "./binTemporalDecision.js";
import { getMediaContent } from "./mediaService.js";
import type { VideoBinTrackingState } from "./videoBinTracking.js";

/**
 * Registration validation is an operator-facing preview. Phase 1 exposes the
 * raw pipeline state and evidence so an operator can adjust the geometry;
 * publication remains a separate action. No reference-match shortcut is
 * applied here because a clean reference must not hide an uncertain result.
 */
export function finalizeRegistrationPreview(result: PipelineAnalysisResponse): PipelineAnalysisResponse {
  return result;
}

export function finalizeVideoRegistrationPreview(
  result: PipelineAnalysisResponse,
  temporalState: VideoBinTrackingState,
  capturedAtMs: number,
  registrationRevision: number,
) {
  const temporal = confirmTemporalBinStates(result.bins, temporalState, capturedAtMs, registrationRevision);
  return {
    preview: { ...result, bins: temporal.bins as PipelineAnalysisResponse["bins"] },
    temporalState: temporal.state,
  };
}

export async function previewCameraRegistration(
  cameraId: string,
  file: Express.Multer.File,
  input: unknown,
  sourceType: CameraRegistrationPreviewSource = "image",
  temporal?: { state: VideoBinTrackingState; capturedAtMs: number; registrationRevision: number },
) {
  const draft = cameraRegistrationDraftV2Schema.parse(input);
  const validation = await validateCameraRegistration(cameraId, draft);
  if (!validation.ready) throw new HttpError(422, "Camera registration failed validation before preview.", validation);
  const reference = await getMediaContent(draft.referenceMediaId);
  const referenceImage = await readFile(reference.filePath);
  const result = await analyzeRegistrationPreview(
    file,
    draft,
    referenceImage,
    sourceType === "video",
  );
  if (sourceType === "video" && temporal) {
    return finalizeVideoRegistrationPreview(result, temporal.state, temporal.capturedAtMs, temporal.registrationRevision);
  }
  return { preview: finalizeRegistrationPreview(result) };
}
