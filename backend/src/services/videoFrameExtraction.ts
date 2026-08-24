import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { env } from "../config/env.js";
import { HttpError } from "../shared/httpError.js";

const runFile = promisify(execFile);

export class VideoFrameExtractionError extends HttpError {
  constructor(offsetSeconds: number, reason: string) {
    super(422, `Video frame at ${offsetSeconds.toFixed(3)} seconds could not be extracted.`, {
      code: "VIDEO_FRAME_EXTRACTION_FAILED",
      reason,
    });
    this.name = "VideoFrameExtractionError";
  }
}

export function videoFrameOffset(frameIndex: number, intervalSeconds: number, durationSeconds: number) {
  if (!Number.isInteger(frameIndex) || frameIndex < 0) throw new HttpError(400, "Frame index must be a non-negative integer.");
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) throw new HttpError(400, "Frame interval must be positive.");
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new HttpError(400, "Video duration must be positive.");
  return Math.min(frameIndex * intervalSeconds, Math.max(0, durationSeconds - 0.001));
}

export function buildFrameExtractionArguments(filePath: string, offsetSeconds: number) {
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-ss", offsetSeconds.toFixed(3),
    "-i", filePath,
    "-frames:v", "1",
    "-vf", "scale='min(1920,iw)':-2",
    "-q:v", "3",
    "-f", "image2pipe",
    "-vcodec", "mjpeg",
    "pipe:1",
  ];
}

export async function extractVideoFrame(filePath: string, offsetSeconds: number) {
  try {
    const { stdout } = await runFile(env.ffmpegPath, buildFrameExtractionArguments(filePath, offsetSeconds), {
      encoding: "buffer",
      timeout: 60_000,
      maxBuffer: 12 * 1024 * 1024,
    });
    const contents = Buffer.from(stdout);
    if (contents.length < 4 || contents[0] !== 0xff || contents[1] !== 0xd8) {
      throw new Error("ffmpeg returned no JPEG frame");
    }
    return contents;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT" || code === "EACCES") {
      throw new HttpError(503, "ffmpeg is unavailable for video frame extraction.");
    }
    throw new VideoFrameExtractionError(
      offsetSeconds,
      error instanceof Error ? error.message : "ffmpeg failed",
    );
  }
}
