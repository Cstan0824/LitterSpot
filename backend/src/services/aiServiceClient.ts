import axios from "axios";
import FormData from "form-data";
import { env } from "../config/env.js";
import { imageBinAnalysisResponseSchema, stateClassificationResponseSchema, type BatchAnalysisOptions, type ImageBinAnalysisResponse, type StateClassificationOptions, type StateClassificationResponse } from "../schemas/detection.js";

export async function checkAiHealth() {
  const response = await axios.get(`${env.aiServiceUrl}/health`, { timeout: 3_000 });
  return response.data;
}

export async function classifyBinState(file: Express.Multer.File, options: StateClassificationOptions): Promise<StateClassificationResponse> {
  const body = new FormData();
  body.append("file", file.buffer, { filename: file.originalname, contentType: file.mimetype });
  if (options.cameraId) body.append("camera_id", options.cameraId);
  if (options.binId) body.append("bin_id", options.binId);
  body.append("auto_locate", String(options.autoLocate));
  for (const coordinate of ["x1", "y1", "x2", "y2"] as const) if (options[coordinate] !== undefined) body.append(coordinate, String(options[coordinate]));
  body.append("confirmation_frames", String(options.confirmationFrames));
  const response = await axios.post(`${env.aiServiceUrl}/classify/bin`, body, {
    headers: { ...body.getHeaders(), ...(env.aiServiceToken ? { "x-internal-token": env.aiServiceToken } : {}) },
    maxBodyLength: 10 * 1024 * 1024,
    timeout: 30_000,
  });
  return stateClassificationResponseSchema.parse(response.data);
}

export async function analyzeImageBins(
  file: Express.Multer.File,
  options: BatchAnalysisOptions,
  imageId: string,
): Promise<ImageBinAnalysisResponse> {
  const body = new FormData();
  body.append("file", file.buffer, { filename: file.originalname, contentType: file.mimetype });
  body.append("localizer_confidence", String(options.localizerConfidence));
  body.append("max_bins", String(options.maxBins));
  body.append("confirmation_frames", String(options.confirmationFrames));
  body.append("image_id", imageId);
  const response = await axios.post(`${env.aiServiceUrl}/classify/image-bins`, body, {
    headers: { ...body.getHeaders(), ...(env.aiServiceToken ? { "x-internal-token": env.aiServiceToken } : {}) },
    maxBodyLength: 10 * 1024 * 1024,
    timeout: 30_000,
  });
  return imageBinAnalysisResponseSchema.parse(response.data);
}
