import { beforeEach, describe, expect, it, vi } from "vitest";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./http", () => ({ v2Request: request }));

import { changeSiteMapCameraPlacement, discardSiteMapDraft, getActiveSiteMap, getRetiredSiteMapZones, getSiteMapAuditEvents, getSiteMapDraft, publishSiteMapDraft, saveSiteMapDraft, siteMapBackgroundCacheKey, startSiteMapDraft, uploadSiteMapBackground, validateSiteMapDraft } from "./siteMap";

const draft = { id: "site-1", siteId: "site-1", baseRevisionId: "map-1", widthMeters: 100, heightMeters: 80, gridSizeMeters: 5, backgroundMediaId: null, backgroundTransform: null, coordinateOrigin: "top_left", xAxisDirection: "right", yAxisDirection: "down", validationStatus: "not_validated", validationErrors: [], revision: 1 };

describe("Site Map API client", () => {
  beforeEach(() => request.mockReset().mockResolvedValue({}));

  it("loads active, Root draft, retired Zone, and audit read models", async () => {
    request.mockResolvedValueOnce({ map: { siteId: "site-1" } });
    await getActiveSiteMap();
    expect(request).toHaveBeenLastCalledWith("/api/site-map", { signal: undefined });
    request.mockResolvedValueOnce({ draft, zones: [], cameraPlacements: [], cleanerStations: [] });
    expect(await getSiteMapDraft()).toMatchObject({ id: "site-1", zones: [], cameraPlacements: [], cleanerStations: [] });
    request.mockResolvedValueOnce({ zones: [] });
    await getRetiredSiteMapZones();
    expect(request).toHaveBeenLastCalledWith("/api/site-map/retired-zones", { signal: undefined });
    request.mockResolvedValueOnce({ events: [] });
    await getSiteMapAuditEvents();
    expect(request).toHaveBeenLastCalledWith("/api/operations/v2/audit-events", { signal: undefined });
  });

  it("uses the complete real draft lifecycle", async () => {
    request.mockResolvedValueOnce({ draft: { ...draft, zones: [], cameraPlacements: [], cleanerStations: [] } });
    await startSiteMapDraft();
    expect(request).toHaveBeenLastCalledWith("/api/site-map/draft/start", { method: "POST", json: {} });
    request.mockResolvedValueOnce({ draft, zones: [], cameraPlacements: [], cleanerStations: [] });
    await saveSiteMapDraft({ baseRevisionId: "map-1", expectedRevision: 1, widthMeters: 100, heightMeters: 80, gridSizeMeters: 5, backgroundMediaId: null, backgroundTransform: null, zones: [], cameraPlacements: [], cleanerStations: [] });
    expect(request).toHaveBeenLastCalledWith("/api/site-map/draft", expect.objectContaining({ method: "POST", json: expect.objectContaining({ expectedRevision: 1 }) }));
    request.mockResolvedValueOnce({ valid: true, errors: [], issues: [], zoneConflicts: [] });
    await validateSiteMapDraft();
    expect(request).toHaveBeenLastCalledWith("/api/site-map/draft/validate", { method: "POST", json: {} });
    request.mockResolvedValueOnce({ map: { siteId: "site-1" } });
    await publishSiteMapDraft();
    expect(request).toHaveBeenLastCalledWith("/api/site-map/draft/publish", { method: "POST", json: {} });
    await discardSiteMapDraft();
    expect(request).toHaveBeenLastCalledWith("/api/site-map/draft", { method: "DELETE" });
  });

  it("uploads a Site background as multipart media", async () => {
    const file = new File(["image"], "map.png", { type: "image/png" });
    request.mockResolvedValueOnce({ background: { mediaId: "media-1" } });
    await uploadSiteMapBackground(file);
    expect(request).toHaveBeenCalledWith("/api/site-map/background", expect.objectContaining({ method: "POST", body: expect.any(FormData) }));
  });

  it("shares one background cache entry across map instances", () => {
    const background = { mediaId: "map-background-1", contentUrl: "/api/media/map-background-1/content", mimeType: "image/png", width: 1536, height: 1024, storageStatus: "available" };
    expect(siteMapBackgroundCacheKey(background, background.contentUrl)).toBe(siteMapBackgroundCacheKey(background, background.contentUrl));
    expect(siteMapBackgroundCacheKey(null, "/api/cleaner/map/background")).toBe("site-map-background:/api/cleaner/map/background");
  });

  it("sends a confirmed Root Camera placement change with concurrency guards", async () => {
    request.mockResolvedValueOnce({ mode: "map_position_correction", status: "published" });
    await changeSiteMapCameraPlacement({ cameraId: "camera-1", point: { xMeters: 12, yMeters: 18 }, mode: "map_position_correction", reason: "Corrected after measuring the installed mount.", expectedCameraRevision: 4, expectedMapRevisionId: "map-3" });
    expect(request).toHaveBeenLastCalledWith("/api/site-map/camera-placements/camera-1", { method: "POST", json: { point: { xMeters: 12, yMeters: 18 }, mode: "map_position_correction", reason: "Corrected after measuring the installed mount.", expectedCameraRevision: 4, expectedMapRevisionId: "map-3", confirmation: true } });
  });
});
