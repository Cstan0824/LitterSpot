import { describe, expect, it } from "vitest";
import { cameraDetailBackTarget, cameraMovePointAllowed } from "./CameraOperationsPage";

describe("Camera detail return navigation", () => {
  it("returns direct links to the unfiltered Camera wall", () => {
    expect(cameraDetailBackTarget(new URLSearchParams("cameraId=cam-1"))).toEqual({ hash: "/cameras", label: "Back to all cameras" });
  });

  it("preserves the Camera wall Zone and enabled-state filters", () => {
    expect(cameraDetailBackTarget(new URLSearchParams("cameraId=cam-1&from=cameras&zoneId=food-court&cameraState=disabled"))).toEqual({ hash: "/cameras?zoneId=food-court&cameraState=disabled", label: "Back to cameras" });
  });

  it("returns Work and Team origins to their own pages", () => {
    expect(cameraDetailBackTarget(new URLSearchParams("cameraId=cam-1&from=work"))).toEqual({ hash: "/history", label: "Back to Work" });
    expect(cameraDetailBackTarget(new URLSearchParams("cameraId=cam-1&from=team"))).toEqual({ hash: "/admin", label: "Back to Team" });
  });

  it("returns Dashboard Camera links to the Dashboard", () => {
    expect(cameraDetailBackTarget(new URLSearchParams("cameraId=cam-1&from=dashboard"))).toEqual({ hash: "/", label: "Back to Dashboard" });
  });
});

describe("Camera movement placement policy", () => {
  it("keeps Map Position Correction inside the current Zone", () => {
    expect(cameraMovePointAllowed("map_position_correction", "zone-a", "zone-a")).toBe(true);
    expect(cameraMovePointAllowed("map_position_correction", "zone-a", "zone-b")).toBe(false);
    expect(cameraMovePointAllowed("map_position_correction", "zone-a", null)).toBe(false);
  });

  it("allows a Physical Camera Move into any valid destination Zone", () => {
    expect(cameraMovePointAllowed("physical_camera_move", "zone-a", "zone-a")).toBe(true);
    expect(cameraMovePointAllowed("physical_camera_move", "zone-a", "zone-b")).toBe(true);
  });
});
