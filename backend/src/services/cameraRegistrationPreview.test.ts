import { describe, expect, it } from "vitest";
import type { PipelineAnalysisResponse } from "../schemas/detection.js";
import { finalizeRegistrationPreview } from "./cameraRegistrationPreview.js";

function previewBin(overrides: Record<string, unknown> = {}): PipelineAnalysisResponse {
  return {
    image: { width: 1280, height: 720 },
    focusRegion: [],
    peopleCount: 0,
    people: [],
    bins: [{
      binIndex: 1,
      binId: "bin-1",
      localizerConfidence: 1,
      bbox: { x1: 100, y1: 100, x2: 300, y2: 500 },
      classificationRegion: { x1: 90, y1: 90, x2: 310, y2: 510 },
      state: "review",
      stateConfidence: 0.83,
      signals: { binPresence: 0.68, fullness: 0.66, overflow: 0.83 },
      unknownReasons: ["overflow_without_exterior_evidence"],
      evidence: { topChangeRatio: 0, outsideChangeRatio: 0, exteriorEvidence: false },
      processingTimeMs: 10,
      ...overrides,
    }],
    floorHazards: [],
    modelVersions: { floorHazard: "floor", people: "people", binLocalizer: "localizer", binState: "state" },
    processingTimeMs: 100,
  } as PipelineAnalysisResponse;
}

describe("registration preview final bin state", () => {
  it("preserves a review result when the current bin matches its clean reference", () => {
    const result = finalizeRegistrationPreview(previewBin());

    expect(result.bins[0]).toMatchObject({ state: "review", unknownReasons: ["overflow_without_exterior_evidence"] });
  });

  it("keeps contained change without exterior evidence in review", () => {
    const result = finalizeRegistrationPreview(previewBin({
      evidence: { topChangeRatio: 0.18, outsideChangeRatio: 0.01, exteriorEvidence: false },
    }));

    expect(result.bins[0]).toMatchObject({ state: "review", unknownReasons: ["overflow_without_exterior_evidence"] });
  });

  it("preserves an uncertain registered frame when it matches the reference", () => {
    const result = finalizeRegistrationPreview(previewBin({
      state: "unknown",
      unknownReasons: ["uncertain_overflow"],
      evidence: { topChangeRatio: 0.004, outsideChangeRatio: 0.003, exteriorEvidence: false },
    }));

    expect(result.bins[0]).toMatchObject({ state: "unknown", unknownReasons: ["uncertain_overflow"] });
  });
});
