import axios from "axios";
import FormData from "form-data";
import { env } from "../config/env.js";
import {
  pipelineAnalysisResponseSchema,
  type PipelineAnalysisResponse,
  type PipelineOptions,
} from "../schemas/detection.js";

const serviceHeaders = () => env.aiServiceToken ? { "x-internal-token": env.aiServiceToken } : {};

export const pipelineClient = {
  async analyzeFrame(file: Express.Multer.File, options: PipelineOptions): Promise<PipelineAnalysisResponse> {
    const body = new FormData();
    body.append("file", file.buffer, { filename: file.originalname, contentType: file.mimetype });
    if (options.cameraId) body.append("camera_id", options.cameraId);
    body.append("floor_confidence", String(options.floorConfidence));
    body.append("localizer_confidence", String(options.localizerConfidence));
    body.append("confirmation_frames", String(options.confirmationFrames));
    if (options.focusRegion) body.append("focus_region", options.focusRegion);
    const response = await axios.post(`${env.aiServiceUrl}/analyze/frame`, body, {
      headers: { ...body.getHeaders(), ...serviceHeaders() },
      maxBodyLength: 10 * 1024 * 1024,
      timeout: 60_000,
    });
    return pipelineAnalysisResponseSchema.parse(response.data);
  },

  async recent() {
    const response = await axios.get(`${env.aiServiceUrl}/analysis/recent`, { headers: serviceHeaders(), timeout: 5_000 });
    return response.data;
  },

  async placement(cameraId: string) {
    const response = await axios.get(`${env.aiServiceUrl}/placement/recommendation/${encodeURIComponent(cameraId)}`, {
      headers: serviceHeaders(), timeout: 5_000,
    });
    return response.data;
  },

  async updatePlacementWindow(cameraId: string, windowDays: number) {
    const response = await axios.patch(
      `${env.aiServiceUrl}/placement/recommendation/${encodeURIComponent(cameraId)}/settings`,
      { windowDays },
      { headers: serviceHeaders(), timeout: 5_000 },
    );
    return response.data;
  },
};
