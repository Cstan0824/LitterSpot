import { describe, expect, it } from "vitest";
import { cameraPlacementChangeSchema, siteMapDraftInputSchema } from "./siteMap.js";

const base = { baseRevisionId: "revision-1", widthMeters: 100, heightMeters: 80, gridSizeMeters: 5, zones: [] };

describe("Site Map API contracts", () => {
  it("requires a complete background alignment with background media", () => {
    expect(siteMapDraftInputSchema.safeParse({ ...base, backgroundMediaId: "map-image" }).success).toBe(false);
    expect(siteMapDraftInputSchema.safeParse({ ...base, backgroundTransform: { xMeters: 0, yMeters: 0, widthMeters: 100, heightMeters: 80, opacity: 1 } }).success).toBe(false);
    expect(siteMapDraftInputSchema.safeParse({ ...base, backgroundMediaId: "map-image", backgroundTransform: { xMeters: 0, yMeters: 0, widthMeters: 100, heightMeters: 80, opacity: 1 } }).success).toBe(true);
  });

  it("rejects incomplete or unconfirmed Camera placement changes", () => {
    expect(cameraPlacementChangeSchema.safeParse({ point: { xMeters: 10, yMeters: 10 }, mode: "map_position_correction", reason: "Wrong pin", expectedCameraRevision: 1, expectedMapRevisionId: "map-1", confirmation: false }).success).toBe(false);
    expect(cameraPlacementChangeSchema.safeParse({ point: { xMeters: 10, yMeters: 10 }, mode: "physical_camera_move", reason: "Camera moved", expectedCameraRevision: 1, expectedMapRevisionId: "map-1", confirmation: true }).success).toBe(true);
  });

  it("does not let a Site Map draft bypass the Physical Camera Move workflow", () => {
    const input = { ...base, cameraPlacementChanges: [{ cameraId: "camera-1", mode: "physical_camera_move", reason: "Moved", confirmation: true }] };
    expect(siteMapDraftInputSchema.safeParse(input).success).toBe(false);
  });
});
