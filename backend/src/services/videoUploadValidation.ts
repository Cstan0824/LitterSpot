import { execFile } from "node:child_process";
import { open, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { env } from "../config/env.js";
import { HttpError } from "../shared/httpError.js";

const runFile = promisify(execFile);

export type SupportedVideo = {
  mimeType: "video/mp4" | "video/webm";
  extension: "mp4" | "webm";
};

export type VideoProbe = SupportedVideo & {
  durationSeconds: number;
  width: number;
  height: number;
  codecName: string | null;
  formatName: string;
};

export function detectSupportedVideo(header: Buffer): SupportedVideo {
  if (header.length >= 12 && header.subarray(4, 8).toString("ascii") === "ftyp") {
    return { mimeType: "video/mp4", extension: "mp4" };
  }
  if (header.length >= 4 && header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    return { mimeType: "video/webm", extension: "webm" };
  }
  throw new HttpError(400, "Only genuine MP4 and WebM video files are supported.");
}

export function validateDeclaredVideoType(declared: string, detected: SupportedVideo) {
  const normalized = declared.split(";", 1)[0]?.trim().toLowerCase();
  const genericBinaryTypes = new Set(["application/octet-stream", "binary/octet-stream"]);
  const compatibleTypes = detected.mimeType === "video/mp4"
    ? new Set(["video/mp4", "application/mp4", "video/quicktime"])
    : new Set(["video/webm", "application/webm"]);

  if (!normalized || (!genericBinaryTypes.has(normalized) && !compatibleTypes.has(normalized))) {
    throw new HttpError(400, "The video content does not match its declared media type.");
  }
}

export function parseVideoProbe(value: unknown, detected: SupportedVideo): VideoProbe {
  if (!value || typeof value !== "object") throw new HttpError(400, "The video metadata could not be read.");
  const payload = value as Record<string, unknown>;
  const format = payload.format && typeof payload.format === "object" ? payload.format as Record<string, unknown> : {};
  const streams = Array.isArray(payload.streams) ? payload.streams : [];
  const videoStream = streams.find((stream) => stream && typeof stream === "object"
    && (stream as Record<string, unknown>).codec_type === "video") as Record<string, unknown> | undefined;
  if (!videoStream) throw new HttpError(400, "The upload does not contain a video stream.");

  const formatName = String(format.format_name ?? "");
  const allowedContainer = detected.mimeType === "video/mp4"
    ? formatName.split(",").some((name) => ["mov", "mp4"].includes(name))
    : formatName.split(",").includes("webm");
  if (!allowedContainer) throw new HttpError(400, "The detected video container is not supported.");

  const durationSeconds = [videoStream.duration, format.duration]
    .map((candidate) => Number(candidate))
    .find((candidate) => Number.isFinite(candidate) && candidate > 0) ?? Number.NaN;
  const width = Number(videoStream.width);
  const height = Number(videoStream.height);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new HttpError(400, "The video duration is missing or invalid.");
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new HttpError(400, "The video dimensions are missing or invalid.");
  }
  return {
    ...detected,
    durationSeconds,
    width,
    height,
    codecName: typeof videoStream.codec_name === "string" ? videoStream.codec_name : null,
    formatName,
  };
}

export function plannedVideoFrames(durationSeconds: number, intervalSeconds: number, maximumFrames = env.videoMaxFrames) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("Video duration must be positive and finite.");
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) throw new Error("Frame interval must be positive and finite.");
  if (!Number.isInteger(maximumFrames) || maximumFrames < 1) throw new Error("Maximum video frames must be a positive integer.");
  return Math.max(1, Math.min(maximumFrames, Math.ceil(durationSeconds / intervalSeconds)));
}

export async function probeVideoFile(filePath: string, detected: SupportedVideo) {
  try {
    const { stdout } = await runFile(env.ffprobePath, [
      "-v", "error",
      "-show_format",
      "-show_streams",
      "-of", "json",
      filePath,
    ], { timeout: 30_000, maxBuffer: 1024 * 1024 });
    return parseVideoProbe(JSON.parse(stdout), detected);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, "ffprobe could not inspect the uploaded video.");
  }
}

export type VideoUploadValidationOptions = {
  maxBytes?: number;
  maxDurationSeconds?: number;
  probe?: (filePath: string, detected: SupportedVideo) => Promise<VideoProbe>;
};

export async function validateVideoUploadFile(
  file: Pick<Express.Multer.File, "path" | "mimetype" | "size">,
  options: VideoUploadValidationOptions = {},
) {
  const maxBytes = options.maxBytes ?? env.videoMaxBytes;
  const maxDurationSeconds = options.maxDurationSeconds ?? env.videoMaxDurationSeconds;
  if (!Number.isFinite(maxBytes) || maxBytes <= 0 || !Number.isFinite(maxDurationSeconds) || maxDurationSeconds <= 0) {
    throw new Error("Video upload limits must be positive and finite.");
  }
  const details = await stat(file.path).catch(() => null);
  if (!details) throw new HttpError(400, "The uploaded video is unavailable.");
  if (!details.isFile()) throw new HttpError(400, "The uploaded video is unavailable.");
  if (details.size <= 0 || details.size !== file.size) throw new HttpError(400, "The uploaded video size is invalid.");
  if (details.size > maxBytes) throw new HttpError(413, "The uploaded video exceeds the configured size limit.");
  const handle = await open(file.path, "r");
  const header = Buffer.alloc(16);
  try {
    await handle.read(header, 0, header.length, 0);
  } finally {
    await handle.close();
  }
  const detected = detectSupportedVideo(header);
  validateDeclaredVideoType(file.mimetype, detected);
  const probe = await (options.probe ?? probeVideoFile)(file.path, detected);
  if (probe.durationSeconds > maxDurationSeconds) {
    throw new HttpError(413, `The uploaded video exceeds ${maxDurationSeconds} seconds.`);
  }
  return probe;
}
