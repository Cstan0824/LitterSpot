import { describe, expect, it } from "vitest";
import { completedSiteMapGesture, SITE_MAP_WHEEL_LISTENER_OPTIONS, siteMapButtonZoomFactor, siteMapCameraMarkerScale, siteMapDrawingPoints, siteMapGestureShouldPan, siteMapWheelZoomFactor } from "./siteMapInteraction";

describe("Site Map pointer gestures", () => {
  it("selects the Zone pressed at the start of an unmoved gesture", () => {
    expect(completedSiteMapGesture({ moved: false, pointerCount: 1, pressedZoneId: "zone-hall", drawingZone: false, placingPoint: false })).toEqual({ type: "select-zone", zoneId: "zone-hall" });
  });

  it("does not select a Zone after the map was dragged", () => {
    expect(completedSiteMapGesture({ moved: true, pointerCount: 1, pressedZoneId: "zone-hall", drawingZone: false, placingPoint: false })).toBeNull();
  });

  it("keeps Zone drawing and point placement ahead of Zone selection", () => {
    expect(completedSiteMapGesture({ moved: false, pointerCount: 1, pressedZoneId: "zone-hall", drawingZone: true, placingPoint: false })).toEqual({ type: "add-zone-point" });
    expect(completedSiteMapGesture({ moved: false, pointerCount: 1, pressedZoneId: "zone-hall", drawingZone: false, placingPoint: true })).toEqual({ type: "place-point" });
  });

  it("ignores multi-touch releases and empty map taps", () => {
    expect(completedSiteMapGesture({ moved: false, pointerCount: 2, pressedZoneId: "zone-hall", drawingZone: false, placingPoint: false })).toBeNull();
    expect(completedSiteMapGesture({ moved: false, pointerCount: 1, drawingZone: false, placingPoint: false })).toBeNull();
  });

  it("exposes the first draft vertex before a polygon can be drawn", () => {
    const firstPoint = { xMeters: 42, yMeters: 18 };
    expect(siteMapDrawingPoints([{ id: "draft-zone", polygon: [firstPoint] }], "draft-zone")).toEqual([firstPoint]);
    expect(siteMapDrawingPoints([{ id: "draft-zone", polygon: [firstPoint] }], null)).toEqual([]);
  });

  it("pans after a deliberate drag while drawing or placing a point", () => {
    expect(siteMapGestureShouldPan({ drawingZone: false, placingPoint: true, screenDistance: 8, mapDistance: .2 })).toBe(true);
    expect(siteMapGestureShouldPan({ drawingZone: true, placingPoint: false, screenDistance: 8, mapDistance: .2 })).toBe(true);
    expect(siteMapGestureShouldPan({ drawingZone: false, placingPoint: true, screenDistance: 3, mapDistance: .2 })).toBe(false);
  });

  it("uses smaller, symmetrical zoom button steps", () => {
    expect(siteMapButtonZoomFactor("in")).toBe(1.15);
    expect(siteMapButtonZoomFactor("in") * siteMapButtonZoomFactor("out")).toBeCloseTo(1);
  });

  it("scales wheel zoom to the actual scroll movement", () => {
    expect(siteMapWheelZoomFactor(-4, 0)).toBeCloseTo(1.0048, 3);
    expect(siteMapWheelZoomFactor(-100, 0)).toBeLessThanOrEqual(1.1);
    expect(siteMapWheelZoomFactor(100, 0)).toBeGreaterThanOrEqual(.9);
    expect(siteMapWheelZoomFactor(Number.NaN, 0)).toBe(1);
  });

  it("registers wheel handling as non-passive so the map can contain scrolling", () => {
    expect(SITE_MAP_WHEEL_LISTENER_OPTIONS).toEqual({ passive: false });
  });

  it("keeps Camera markers at a stable screen size while the map zooms", () => {
    expect(siteMapCameraMarkerScale(2)).toBe(.5);
    expect(siteMapCameraMarkerScale(8)).toBe(.125);
    expect(siteMapCameraMarkerScale(0)).toBe(1);
  });
});
