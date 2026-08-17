import { describe, expect, it } from "vitest";
import type { PipelineAnalysisResponse } from "../schemas/detection.js";
import { normalizeAnalysis } from "./analysisNormalization.js";

function overflowResult(): PipelineAnalysisResponse {
  return {
    image: { width: 200, height: 100 },
    focusRegion: [],
    peopleCount: 0,
    people: [],
    bins: [{
      binIndex: 1,
      localizerConfidence: 0.88,
      bbox: { x1: 20, y1: 10, x2: 80, y2: 90 },
      classificationRegion: { x1: 15, y1: 5, x2: 85, y2: 95 },
      state: "overflow",
      stateConfidence: 0.91,
      signals: { binPresence: 0.92, fullness: 0.84, overflow: 0.91 },
      unknownReasons: [],
      processingTimeMs: 2,
    }],
    floorHazards: [],
    modelVersions: {
      floorHazard: "floor-v1",
      people: "people-v1",
      binLocalizer: "localizer-v1",
      binState: "state-v1",
    },
    processingTimeMs: 4,
  };
}

describe("overflow normalization semantics", () => {
  it("retains a raw overflow without Python business confirmation fields", () => {
    const normalized = normalizeAnalysis(overflowResult(), "run-unconfirmed", 0.25);

    expect(normalized.detections).toHaveLength(1);
    expect(normalized.detections[0]).toMatchObject({
      issueType: "bin_overflow",
      confirmed: null,
      stale: false,
    });
    expect(normalized.issueCounts.binOverflow).toBe(1);
  });

  it("does not require Python tracking fields in the combined-frame contract", () => {
    const normalized = normalizeAnalysis(overflowResult(), "run-raw", 0.25);
    expect(normalized.bins[0]).toMatchObject({ state: "overflow", confirmed: null, stale: false });
  });
});
