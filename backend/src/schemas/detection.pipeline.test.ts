import { describe, expect, it } from "vitest";
import { pipelineAnalysisResponseSchema } from "./detection.js";

const statelessResponse = {
  image: { width: 640, height: 480 },
  focusRegion: [],
  peopleCount: 0,
  people: [],
  bins: [{
    binIndex: 1,
    localizerConfidence: 0.9,
    bbox: { x1: 10, y1: 20, x2: 100, y2: 200 },
    classificationRegion: { x1: 8, y1: 18, x2: 102, y2: 202 },
    state: "overflow",
    stateConfidence: 0.88,
    signals: { binPresence: 0.95, fullness: 0.83, overflow: 0.88 },
    unknownReasons: [],
    processingTimeMs: 3,
  }],
  floorHazards: [],
  modelVersions: {
    floorHazard: "floor-v1",
    people: "people-v1",
    binLocalizer: "localizer-v1",
    binState: "state-v1",
  },
  processingTimeMs: 12,
};

describe("private stateless frame inference contract", () => {
  it("accepts exactly the inference-only FastAPI response", () => {
    expect(pipelineAnalysisResponseSchema.parse(statelessResponse)).toEqual(statelessResponse);
  });

  it("rejects retired Python business and session fields", () => {
    for (const field of ["analysisId", "flags", "cameraId", "videoSessionId"]) {
      expect(pipelineAnalysisResponseSchema.safeParse({ ...statelessResponse, [field]: null }).success).toBe(false);
    }
    expect(pipelineAnalysisResponseSchema.safeParse({
      ...statelessResponse,
      bins: [{ ...statelessResponse.bins[0], confirmed: true }],
    }).success).toBe(false);
  });
});
