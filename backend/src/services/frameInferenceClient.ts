import { randomUUID } from "node:crypto";
import axios from "axios";
import FormData from "form-data";
import { env } from "../config/env.js";
import { pipelineAnalysisResponseSchema, type PipelineAnalysisResponse } from "../schemas/detection.js";
import { recordOperationalFailure, recoverOperationalEvent } from "./dependencyEventMonitor.js";
import type { RegistrationReferencePayload } from "./cameraRegistrationReference.js";

export type FrameInferenceInput = {
  contents: Buffer;
  fileName: string;
  mimeType: string;
  floorConfidence: number;
  binLocalizerConfidence: number;
  focusRegion: Array<{ x: number; y: number }>;
  registration?: Record<string, unknown> | null;
  reference?: RegistrationReferencePayload | null;
  binReviewEnabled?: boolean;
};

export async function inferFrame(input: FrameInferenceInput): Promise<PipelineAnalysisResponse> {
  const startedAt = Date.now();
  const identity = {
    dependency: "ai_service" as const,
    eventCode: "inference_request_failed",
    scope: { type: "global" as const },
  };
  const body = new FormData();
  body.append("file", input.contents, { filename: input.fileName, contentType: input.mimeType });
  body.append("floor_confidence", String(input.floorConfidence));
  body.append("localizer_confidence", String(input.binLocalizerConfidence));
  const focusPayload = input.registration
    ? {
      points: input.focusRegion,
      registration: input.registration,
      ...(input.reference ? { referenceImageBase64: input.reference.referenceImageBase64 } : {}),
      binReviewEnabled: input.binReviewEnabled === true,
    }
    : input.focusRegion;
  body.append("focus_region", JSON.stringify(focusPayload));
  try {
    const response = await axios.post(`${env.aiServiceUrl}/analyze/frame`, body, {
      headers: {
        ...body.getHeaders(),
        ...(env.aiServiceToken ? { "x-internal-token": env.aiServiceToken } : {}),
      },
      // A registered frame envelope may include one validated reference image
      // as base64 while the stateless AI adapter remains file-based.
      maxBodyLength: 25 * 1024 * 1024,
      timeout: 60_000,
    });
    const result = pipelineAnalysisResponseSchema.parse(response.data);
    await recoverOperationalEvent({
      identity,
      recoveryId: `inference-recovery-${randomUUID()}`,
      safeDetails: { operation: "analyze_frame", durationMs: Date.now() - startedAt },
    });
    return result;
  } catch (error) {
    const httpStatus = axios.isAxiosError(error) && error.response?.status
      ? error.response.status : undefined;
    const reasonCode = axios.isAxiosError(error)
      ? error.response ? "upstream_http_error" : "upstream_unavailable"
      : "invalid_inference_response";
    await recordOperationalFailure({
      identity,
      occurrenceId: `inference-${Date.now()}-${randomUUID()}`,
      severity: "critical",
      safeDetails: {
        operation: "analyze_frame",
        reasonCode,
        retryable: true,
        ...(httpStatus ? { httpStatus } : {}),
        durationMs: Date.now() - startedAt,
      },
    });
    throw error;
  }
}
