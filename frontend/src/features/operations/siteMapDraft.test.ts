import { describe, expect, it } from "vitest";
import { siteMapDraftIssues, siteMapDraftSaveInput } from "./siteMapDraft";
import type { SiteMapDraft } from "../../services/v2/siteMap";

const draft: SiteMapDraft = { id: "site", siteId: "site", baseRevisionId: "map-1", widthMeters: 100, heightMeters: 80, gridSizeMeters: 5, backgroundMediaId: null, backgroundTransform: null, coordinateOrigin: "top_left", xAxisDirection: "right", yAxisDirection: "down", validationStatus: "not_validated", validationErrors: [], revision: 3, zones: [{ id: "zone-a", zoneId: "zone-a", zoneNameSnapshot: "Zone A", polygon: [{ xMeters: 0, yMeters: 0 }, { xMeters: 40, yMeters: 0 }, { xMeters: 40, yMeters: 40 }, { xMeters: 0, yMeters: 40 }] }], cameraPlacements: [{ id: "camera-a", cameraId: "camera-a", cameraNameSnapshot: "Camera A", point: { xMeters: 10, yMeters: 10 }, zoneId: "zone-a" }], cleanerStations: [{ id: "cleaner-a", cleanerId: "cleaner-a", cleanerNameSnapshot: "Gan", point: { xMeters: 80, yMeters: 70 }, zoneId: null }] };

describe("Site Map draft presentation", () => {
  it("keeps valid unzoned Station Points while rejecting affected Cameras", () => {
    expect(siteMapDraftIssues(draft, null)).toEqual([]);
    const withoutZone = { ...draft, zones: [] };
    expect(siteMapDraftIssues(withoutZone, null)).toEqual([expect.objectContaining({ kind: "camera", code: "camera_camera-a_outside_zone" })]);
  });

  it("reports touching Zone names before a save", () => {
    const touching = { ...draft, zones: [...draft.zones, { id: "zone-b", zoneId: "zone-b", zoneNameSnapshot: "Zone B", polygon: [{ xMeters: 40, yMeters: 10 }, { xMeters: 60, yMeters: 10 }, { xMeters: 60, yMeters: 30 }, { xMeters: 40, yMeters: 30 }] }] };
    expect(siteMapDraftIssues(touching, null)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "zone", code: "shared_edge", reason: "shared_edge" })]));
    expect(siteMapDraftIssues(touching, null)[0].message).toMatch(/Zone A|Zone B/);
  });

  it("serializes the complete snapshot with its current revision", () => {
    expect(siteMapDraftSaveInput(draft)).toMatchObject({ baseRevisionId: "map-1", expectedRevision: 3, zones: [{ zoneId: "zone-a" }], cameraPlacements: [{ id: "camera-a" }], cleanerStations: [{ id: "cleaner-a" }] });
  });
});
