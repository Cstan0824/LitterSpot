import { describe, expect, it } from "vitest";
import { buildProcessResponse, presentAnalysisRun, presentDetection } from "./analysisPresentation.js";

describe("analysis API presentation", () => {
  it("hides raw inference flags and adds an evidence URL", () => {
    const result = presentAnalysisRun("run-1", { evidenceMediaId: "media-1", inferenceFlags: [{ kind: "floor_litter" }] });
    expect(result).not.toHaveProperty("inferenceFlags");
    expect(result.evidenceContentUrl).toBe("/api/media/media-1/content");
  });

  it("omits polygons from lists and caps geometry in details", () => {
    const polygon = Array.from({ length: 1_000 }, (_, index) => ({ x: index / 1_000, y: index / 1_000 }));
    const listItem = presentDetection("detection-1", { evidenceMediaId: "media-1", polygonNormalized: polygon, qualificationReason: "alert_policy_pending", qualifiedForFlag: false }, false);
    expect(listItem).not.toHaveProperty("polygonNormalized");
    expect(listItem.qualifiedForFlag).toBeNull();
    expect(listItem.qualificationStatus).toBe("pending_evaluation");
    const detail = presentDetection("detection-1", { polygonNormalized: polygon }, true);
    expect(detail.polygonNormalized).toHaveLength(128);
  });

  it("returns a compact processing summary", () => {
    const response = buildProcessResponse(
      { id: "job-1", status: "completed", attemptCount: 1, analysisRunId: "run-1" },
      { id: "run-1", evidenceMediaId: "media-1", evidenceContentUrl: "/api/media/media-1/content", peopleCount: 2, issueKinds: ["floor_litter"], issueCounts: { floorLitter: 1 }, processingTimeMs: 100 },
      [{ id: "detection-1", polygonNormalized: [{ x: 0, y: 0 }] }],
      false,
    );
    expect(response.result.detectionIds).toEqual(["detection-1"]);
    expect(response).not.toHaveProperty("analysisRun");
    expect(response).not.toHaveProperty("detections");
  });
});
