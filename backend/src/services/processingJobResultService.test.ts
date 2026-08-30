import { describe, expect, it } from "vitest";
import { assembleProcessingJobResults } from "./processingJobResultService.js";
import { pinCameraRegistration } from "./processingRegistration.js";

const registration = pinCameraRegistration("camera-1", {
  status: "ready",
  revision: 2,
  schemaVersion: 2,
  referenceMediaId: "reference-1",
  referenceSource: { type: "image" },
  sourceWidth: 1000,
  sourceHeight: 500,
  walkableFloorPolygon: [{ x: 0, y: 0.4 }, { x: 1, y: 0.4 }, { x: 1, y: 1 }],
  bins: [],
  quality: { minAlignmentScore: 0.82, minRimVisibility: 0.75, maxFrameAgeSeconds: 300 },
});

describe("processing job result read model", () => {
  it("orders frames and attaches detections to their analysis run", () => {
    const result = assembleProcessingJobResults({
      processingJob: { id: "job-1", sourceMediaId: "media-1", status: "completed" } as never,
      sourceMedia: { id: "media-1", contentUrl: "/api/media/media-1/content" } as never,
      registration,
      analysisRuns: [
        { id: "run-2", videoOffsetSeconds: 2, people: [], bins: [], floorHazards: [], peopleCount: 0 },
        { id: "run-1", videoOffsetSeconds: 0, people: [], bins: [], floorHazards: [], peopleCount: 1 },
      ],
      detections: [{ id: "detection-1", analysisRunId: "run-1", issueType: "floor_litter", bboxNormalized: { x1: 0.1, y1: 0.2, x2: 0.2, y2: 0.3 } }],
    });

    expect(result.registration).toMatchObject({ revision: 2, referenceContentUrl: "/api/media/reference-1/content" });
    expect(result.frames.map((frame) => frame.analysisRunId)).toEqual(["run-1", "run-2"]);
    expect(result.frames[0].detections).toHaveLength(1);
    expect(result.frames[1].detections).toHaveLength(0);
  });

  it("reconstructs legacy floor hazards from stored detections", () => {
    const result = assembleProcessingJobResults({
      processingJob: { id: "job-1", sourceMediaId: "media-1", status: "completed" } as never,
      sourceMedia: { id: "media-1", contentUrl: "/api/media/media-1/content" } as never,
      registration,
      analysisRuns: [{ id: "run-1", people: [], bins: [], peopleCount: 0 }],
      detections: [{
        id: "detection-1",
        analysisRunId: "run-1",
        issueType: "floor_spill",
        confidence: 0.7,
        entityId: "floor-1",
        bboxNormalized: { x1: 0.1, y1: 0.2, x2: 0.2, y2: 0.3 },
        polygonNormalized: [],
      }],
    });
    expect(result.frames[0].floorHazards).toEqual([expect.objectContaining({ className: "floor_spill", confidence: 0.7 })]);
  });
});
