import { describe, expect, it } from "vitest";
import { cameraIdentityChangeAllowed, publishCameraState, validateCameraSource } from "./v2CameraPolicy.js";

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
  it("keeps Camera identity changes Root-only during view reconfiguration", () => {
    expect(cameraIdentityChangeAllowed({ authority: "regular", kind: "reconfigure", previousName: "Camera 1", previousDescription: "Entrance", nextName: "Renamed", nextDescription: "Entrance" })).toBe(false);
    expect(cameraIdentityChangeAllowed({ authority: "regular", kind: "reconfigure", previousName: "Camera 1", previousDescription: "Entrance", nextName: "Camera 1", nextDescription: "Entrance" })).toBe(true);
    expect(cameraIdentityChangeAllowed({ authority: "root", kind: "reconfigure", previousName: "Camera 1", previousDescription: "Entrance", nextName: "Renamed", nextDescription: "Updated" })).toBe(true);
  });
});
