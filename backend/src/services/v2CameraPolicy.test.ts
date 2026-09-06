import { describe, expect, it } from "vitest";
import { publishCameraState, validateCameraSource } from "./v2CameraPolicy.js";

describe("V2 Camera source policy", () => {
  it("allows either source regardless of creation order", () => {
    expect(validateCameraSource({ existingCameraCount: 0, sourceType: "looped_video", sourceMediaId: "m1" }).valid).toBe(true);
    expect(validateCameraSource({ existingCameraCount: 1, existingLaptopCameraId: "c1", sourceType: "laptop_camera" }).valid).toBe(true);
    expect(publishCameraState({ sourceType: "laptop_camera", replacement: false }).monitoringEnabled).toBe(false);
  });
  it("defaults simulation monitoring off and preserves it on replacement", () => {
    expect(publishCameraState({ sourceType: "looped_video", replacement: false })).toMatchObject({ status: "active", monitoringEnabled: false, isSimulation: true });
    expect(publishCameraState({ sourceType: "looped_video", previousMonitoringEnabled: true, replacement: true })).toMatchObject({ monitoringEnabled: true });
  });
});
