import axios from "axios";
import FormData from "form-data";
import { env } from "../config/env.js";
import { detectionResponseSchema, type DetectionOptions, type DetectionResponse } from "../schemas/detection.js";

export async function checkAiHealth() {
  const response = await axios.get(`${env.aiServiceUrl}/health`, { timeout: 3_000 });
  return response.data;
}

export async function detectImage(file: Express.Multer.File, options: DetectionOptions): Promise<DetectionResponse> {
  const body = new FormData();
  body.append("file", file.buffer, { filename: file.originalname, contentType: file.mimetype });
  body.append("confidence", String(options.confidence));
  body.append("iou", String(options.iou));
  body.append("imgsz", String(options.imgsz));
  body.append("max_detections", String(options.maxDetections));
  if (options.cameraId) body.append("camera_id", options.cameraId);
  body.append("confirmation_frames", String(options.confirmationFrames));
  const response = await axios.post(`${env.aiServiceUrl}/detect/image`, body, {
    headers: { ...body.getHeaders(), ...(env.aiServiceToken ? { "x-internal-token": env.aiServiceToken } : {}) },
    maxBodyLength: 10 * 1024 * 1024,
    timeout: 30_000,
  });
  return detectionResponseSchema.parse(response.data);
}
