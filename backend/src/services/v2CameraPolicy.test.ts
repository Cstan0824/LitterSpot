import { describe, expect, it } from "vitest";
import { publishCameraState, validateCameraSource } from "./v2CameraPolicy.js";

describe("V2 Camera source policy", () => {
  it("enforces the first-laptop and one-laptop rules", () => {
    expect(validateCameraSource({ existingCameraCount: 0, sourceType: "looped_video", sourceMediaId: "m1" }).errors).toContain("first_camera_must_use_laptop_camera");
    expect(validateCameraSource({ existingCameraCount: 1, existingLaptopCameraId: "c1", sourceType: "laptop_camera" }).errors).toContain("only_one_laptop_camera_is_allowed");
  });
  it("defaults simulation monitoring off and preserves it on replacement", () => {
    expect(publishCameraState({ sourceType: "looped_video", replacement: false })).toMatchObject({ status: "active", monitoringEnabled: false, isSimulation: true });
    expect(publishCameraState({ sourceType: "looped_video", previousMonitoringEnabled: true, replacement: true })).toMatchObject({ monitoringEnabled: true });
  });
});

