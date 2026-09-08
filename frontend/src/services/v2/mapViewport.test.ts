import { describe, expect, it } from "vitest";
import { fitSiteMap, mapPointToViewer, panMap, roundStoredMapPoint, viewerPointToMap, zoomMapAt } from "./mapViewport";

describe("Site Map viewer transforms", () => {
  it("fits arbitrary Site aspect ratios without stretching", () => {
    expect(fitSiteMap({ widthMeters: 2_000, heightMeters: 1_200 }, { width: 1_000, height: 600 })).toEqual({ pixelsPerMeter: 0.5, offsetX: 0, offsetY: 0 });
    expect(fitSiteMap({ widthMeters: 500, heightMeters: 100 }, { width: 1_000, height: 600 })).toEqual({ pixelsPerMeter: 2, offsetX: 0, offsetY: 200 });
  });

  it("preserves the map coordinate beneath the zoom anchor", () => {
    const fit = fitSiteMap({ widthMeters: 2_000, heightMeters: 1_200 }, { width: 1_000, height: 600 });
    const anchor = { x: 750, y: 420 };
    const before = viewerPointToMap(anchor, fit);
    const zoomed = zoomMapAt(fit, 3, anchor);
    expect(viewerPointToMap(anchor, zoomed)).toEqual(before);
    expect(mapPointToViewer(before, zoomed)).toEqual(anchor);
  });

  it("keeps pan in viewer space and rounds persisted metres independently", () => {
    const fit = fitSiteMap({ widthMeters: 100, heightMeters: 100 }, { width: 500, height: 500 });
    const panned = panMap(fit, { x: 40, y: -20 });
    expect(viewerPointToMap({ x: 290, y: 230 }, panned)).toEqual({ xMeters: 50, yMeters: 50 });
    expect(roundStoredMapPoint({ xMeters: 50.126, yMeters: 50.124 })).toEqual({ xMeters: 50.13, yMeters: 50.12 });
  });
});
