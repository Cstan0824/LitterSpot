import { describe, expect, it } from "vitest";
import type { PipelineAnalysisResponse } from "../schemas/detection.js";
import { confirmTemporalBinStates } from "./binTemporalDecision.js";
import { VIDEO_BIN_TRACKING_VERSION, type VideoBinTrackingState } from "./videoBinTracking.js";

const state: VideoBinTrackingState = {
  version: VIDEO_BIN_TRACKING_VERSION,
  nextId: 1,
  tracks: {},
};

function bin(stateName: "normal" | "full" | "overflow" | "review" | "unknown", binId: string | null = "bin-1") {
  return {
    binIndex: 1,
    ...(binId ? { binId } : {}),
    localizerConfidence: 1,
    bbox: { x1: 10, y1: 10, x2: 50, y2: 90 },
    classificationRegion: { x1: 10, y1: 10, x2: 50, y2: 90 },
    state: stateName,
    stateConfidence: 0.9,
    signals: { binPresence: 1, fullness: 0.9, overflow: stateName === "overflow" ? 0.9 : 0.1 },
    unknownReasons: [],
    processingTimeMs: 1,
  } as PipelineAnalysisResponse["bins"][number];
}

describe("registered bin temporal decision", () => {
  it("requires two matching frames inside the five-second window", () => {
    const first = confirmTemporalBinStates([bin("overflow")], state, 1_000, 2);
    expect(first.bins[0]).toMatchObject({ confirmed: false, stableState: null, confirmationFrames: 1 });

    const second = confirmTemporalBinStates([bin("overflow")], first.state, 3_000, 2);
    expect(second.bins[0]).toMatchObject({ confirmed: true, stableState: "overflow", confirmationFrames: 2 });
  });

  it("does not carry a stale state across an unknown/review frame", () => {
    const first = confirmTemporalBinStates([bin("overflow")], state, 1_000, 2);
    const review = confirmTemporalBinStates([bin("review")], first.state, 2_000, 2);
    const next = confirmTemporalBinStates([bin("overflow")], review.state, 3_000, 2);
    expect(next.bins[0]).toMatchObject({ confirmed: false, stableState: null, confirmationFrames: 1 });
  });

  it("never confirms a candidate without a registered binId", () => {
    const result = confirmTemporalBinStates([bin("overflow", null)], state, 1_000, 1);
    expect(result.bins[0]).toMatchObject({ confirmed: false, stableState: null, confirmationFrames: 0 });
  });
});
