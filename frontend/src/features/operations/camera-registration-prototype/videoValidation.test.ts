import { describe, expect, it } from "vitest";
import { buildVideoValidationSamples, canPlayValidationFrame, displayedVideoBinState, runSequentialVideoValidation, sampleForPlaybackTime, VIDEO_PLAYBACK_DELAY_MS } from "./videoValidation";

describe("video registration validation schedule", () => {
  it("samples the supplied 3.918 second mock video once per displayed second", () => {
    expect(buildVideoValidationSamples(3.918)).toEqual([
      { second: 0, timestamp: 0.05 },
      { second: 1, timestamp: 1.05 },
      { second: 2, timestamp: 2.05 },
      { second: 3, timestamp: 3.05 },
    ]);
  });

  it("selects the result belonging to the currently displayed second", () => {
    const frames = buildVideoValidationSamples(3.918);
    expect(sampleForPlaybackTime(frames, 2.74)?.second).toBe(2);
    expect(VIDEO_PLAYBACK_DELAY_MS).toBe(2_000);
    expect(canPlayValidationFrame(false, "complete")).toBe(false);
    expect(canPlayValidationFrame(true, "running")).toBe(false);
    expect(canPlayValidationFrame(true, "complete")).toBe(true);
  });

  it("uploads each sampled second sequentially and reports its result", async () => {
    const samples = buildVideoValidationSamples(3.918);
    const calls: number[] = [];
    const completed: number[] = [];
    let active = 0;
    let maximumConcurrency = 0;

    const latest = await runSequentialVideoValidation(samples, async (sample) => {
      active += 1;
      maximumConcurrency = Math.max(maximumConcurrency, active);
      calls.push(sample.second);
      await Promise.resolve();
      active -= 1;
      return { second: sample.second };
    }, (sample, phase) => {
      if (phase === "complete") completed.push(sample.second);
    });

    expect(calls).toEqual([0, 1, 2, 3]);
    expect(completed).toEqual(calls);
    expect(maximumConcurrency).toBe(1);
    expect(latest).toEqual({ second: 3 });
  });

  it("shows pending video evidence as review and a confirmed stable state as final", () => {
    expect(displayedVideoBinState({ state: "overflow", confirmed: false, stableState: null })).toBe("review");
    expect(displayedVideoBinState({ state: "overflow", confirmed: true, stableState: "overflow" })).toBe("overflow");
    expect(displayedVideoBinState({ state: "unknown", confirmed: false, stableState: null })).toBe("unknown");
  });

});
