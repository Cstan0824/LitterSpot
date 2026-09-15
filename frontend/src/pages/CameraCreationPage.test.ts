import { describe, expect, it } from "vitest";
import { cameraPlacementsForRegistration, cameraWorkflowSteps, laptopCameraControlLabel, laptopCaptureEnabled, recoverableCameraDraftId, zoneAtPoint } from "./CameraCreationPage";
import { ApiError } from "../services/api/errors";

const size = { widthMeters: 100, heightMeters: 100 };
const zones = [
  { id: "left", zoneId: "left", zoneNameSnapshot: "Left Zone", polygon: [{ xMeters: 0, yMeters: 0 }, { xMeters: 45, yMeters: 0 }, { xMeters: 45, yMeters: 100 }, { xMeters: 0, yMeters: 100 }] },
  { id: "right", zoneId: "right", zoneNameSnapshot: "Right Zone", polygon: [{ xMeters: 55, yMeters: 0 }, { xMeters: 100, yMeters: 0 }, { xMeters: 100, yMeters: 100 }, { xMeters: 55, yMeters: 100 }] },
];

describe("camera existing-zone map selection", () => {
  it("maps a click in a Zone polygon to that Zone", () => {
    expect(zoneAtPoint({ x: 25, y: 50 }, zones, size)?.zoneId).toBe("left");
    expect(zoneAtPoint({ x: 75, y: 50 }, zones, size)?.zoneId).toBe("right");
  });

  it("does not select the unzoned gap between polygons", () => {
    expect(zoneAtPoint({ x: 50, y: 50 }, zones, size)).toBeUndefined();
  });

  it("shows existing Camera placements without duplicating the Camera being reconfigured", () => {
    const placements = [{ cameraId: "camera-1" }, { cameraId: "camera-2" }];
    expect(cameraPlacementsForRegistration(placements)).toEqual(placements);
    expect(cameraPlacementsForRegistration(placements, "camera-1")).toEqual([{ cameraId: "camera-2" }]);
  });

  it("removes Camera placement from view reconfiguration", () => {
    expect(cameraWorkflowSteps("create").map((step) => step.id)).toEqual(["location", "source", "plot", "review"]);
    expect(cameraWorkflowSteps("reconfigure").map((step) => step.id)).toEqual(["source", "plot", "review"]);
    expect(cameraWorkflowSteps("physical_move").map((step) => step.id)).toEqual(["source", "plot", "review"]);
  });

  it("exposes accurate laptop Camera controls", () => {
    expect(laptopCameraControlLabel("closed")).toBe("Open laptop Camera");
    expect(laptopCameraControlLabel("opening")).toBe("Opening Camera…");
    expect(laptopCameraControlLabel("open")).toBe("Close laptop Camera");
    expect(laptopCaptureEnabled({ state: "open", frameReady: true, busy: false })).toBe(true);
    expect(laptopCaptureEnabled({ state: "open", frameReady: false, busy: false })).toBe(false);
  });

  it("recognizes an unfinished Camera Draft as recoverable", () => {
    const error = new ApiError({ message: "This Camera already has an unfinished configuration draft.", status: 409, details: { code: "camera_draft_exists", draftId: "draft-physical-move" } });
    expect(recoverableCameraDraftId(error)).toBe("draft-physical-move");
    expect(recoverableCameraDraftId(new Error("network failed"))).toBeNull();
  });
});
