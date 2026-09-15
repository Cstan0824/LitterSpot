import { beforeEach, describe, expect, it, vi } from "vitest";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./http", () => ({ apiRequest: request }));

import { getBinPlacementComparison, getBinPlacementInterventions, getBinPlacementRecommendations, implementBinPlacement, refreshBinPlacementRecommendations } from "./binPlacement";

describe("Bin Placement client", () => {
  beforeEach(() => request.mockReset().mockResolvedValue({}));

  it("uses the requested free-form lookback for cached and explicit refresh calls", async () => {
    await getBinPlacementRecommendations();
    expect(request).toHaveBeenCalledWith("/api/bin-placement/recommendations", { signal: undefined });
    await getBinPlacementRecommendations(11);
    expect(request).toHaveBeenCalledWith("/api/bin-placement/recommendations?days=11", { signal: undefined });
    await refreshBinPlacementRecommendations(9);
    expect(request).toHaveBeenLastCalledWith("/api/bin-placement/recommendations/refresh", { method: "POST", json: { days: 9 } });
  });

  it("implements the exact snapshot the Supervisor reviewed", async () => {
    await implementBinPlacement("food/court", "2026-09-04T00:00:00.000Z", "Installed near seating");
    expect(request).toHaveBeenCalledWith("/api/bin-placement/zones/food%2Fcourt/implement", {
      method: "POST",
      json: { snapshotCalculatedAt: "2026-09-04T00:00:00.000Z", note: "Installed near seating" },
    });
  });

  it("lists interventions and loads a freely selected comparison range", async () => {
    await getBinPlacementInterventions();
    expect(request).toHaveBeenCalledWith("/api/bin-placement/interventions", { signal: undefined });
    await getBinPlacementComparison("intervention/1", 13);
    expect(request).toHaveBeenLastCalledWith("/api/bin-placement/interventions/intervention%2F1/comparison?days=13", { signal: undefined });
  });
});
