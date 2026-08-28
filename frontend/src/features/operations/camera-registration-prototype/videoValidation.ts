export const VIDEO_VALIDATION_INTERVAL_SECONDS = 1;
export const VIDEO_PLAYBACK_DELAY_MS = 2_000;

export type VideoValidationSample = {
  second: number;
  timestamp: number;
};

export type VideoValidationPhase = "running" | "complete" | "failed";

export function canPlayValidationFrame(delayReleased: boolean, phase: string | undefined) {
  return delayReleased && phase === "complete";
}

export function buildVideoValidationSamples(duration: number): VideoValidationSample[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const count = Math.max(1, Math.ceil(duration / VIDEO_VALIDATION_INTERVAL_SECONDS));
  const finalSafeTimestamp = Math.max(0, duration - 0.05);
  return Array.from({ length: count }, (_, index) => ({
    second: index,
    timestamp: Math.min(index * VIDEO_VALIDATION_INTERVAL_SECONDS + 0.05, finalSafeTimestamp),
  }));
}

export function sampleForPlaybackTime<T extends { second: number }>(samples: T[], currentTime: number): T | undefined {
  if (!samples.length) return undefined;
  const second = Math.max(0, Math.floor(Number.isFinite(currentTime) ? currentTime : 0));
  return samples.find((sample) => sample.second === second) ?? samples[samples.length - 1];
}

export async function runSequentialVideoValidation<T>(
  samples: VideoValidationSample[],
  analyze: (sample: VideoValidationSample) => Promise<T>,
  onProgress: (sample: VideoValidationSample, phase: VideoValidationPhase, result?: T, error?: unknown) => void,
): Promise<T> {
  let latest: T | undefined;
  let completed = false;
  for (const sample of samples) {
    onProgress(sample, "running");
    try {
      latest = await analyze(sample);
      completed = true;
      onProgress(sample, "complete", latest);
    } catch (error) {
      onProgress(sample, "failed", undefined, error);
      throw error;
    }
  }
  if (!completed) throw new Error("Video validation requires at least one sampled frame.");
  return latest as T;
}
