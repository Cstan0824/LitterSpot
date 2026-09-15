import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { TimedResourceCache } from "../../services/api/resourceCache";
import { resourcesAfterMutation, resourcesForPage } from "./operationsRefreshPolicy";

describe("Supervisor operations refresh policy", () => {
  it("refreshes only the resource owned by normal page navigation", () => {
    expect(resourcesForPage("alerts")).toEqual(["alerts"]);
    expect(resourcesForPage("history")).toEqual(["workOrders"]);
    expect(resourcesForPage("cameras")).toEqual(["cameras"]);
    expect(resourcesForPage("dashboard")).toEqual(["dashboard"]);
    expect(resourcesForPage("placement")).toEqual([]);
  });

  it("invalidates every resource affected by a write", () => {
    expect(resourcesAfterMutation("alert_assignment")).toEqual(["alerts", "workOrders", "cleaners", "dashboard"]);
    expect(resourcesAfterMutation("work_decision")).toEqual(["workOrders", "alerts", "cleaners", "dashboard"]);
    expect(resourcesAfterMutation("camera_publish")).toEqual(["cameras", "siteMap", "dashboard"]);
    expect(resourcesAfterMutation("camera_remove")).toEqual(["cameras", "siteMap", "alerts", "workOrders", "cleaners", "dashboard"]);
    expect(resourcesAfterMutation("site_map_publish")).toEqual(["siteMap", "cameras", "cleaners", "dashboard"]);
  });

  it("does not refetch fresh resources during rapid Alerts and Work navigation", async () => {
    const alerts = vi.fn(async () => ["alert"]);
    const workOrders = vi.fn(async () => ["work"]);
    const cache = new TimedResourceCache({ alerts, workOrders });

    for (let index = 0; index < 50; index += 1) {
      const page = index % 2 ? "alerts" : "history";
      await cache.readMany(resourcesForPage(page) as Array<"alerts" | "workOrders">);
    }

    expect(alerts).toHaveBeenCalledTimes(1);
    expect(workOrders).toHaveBeenCalledTimes(1);
  });
});
