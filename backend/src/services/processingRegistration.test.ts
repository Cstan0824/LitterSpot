import { describe, expect, it } from "vitest";
import {
  assertRegistrationFrameDimensions,
  pinCameraRegistration,
  pinnedRegistrationFromJob,
  rejectOperationalFocusRegion,
} from "./processingRegistration.js";

const published = {
  status: "ready",
  revision: 3,
  schemaVersion: 2,
  referenceMediaId: "reference-1",
  referenceSource: { type: "image" },
  sourceWidth: 1920,
  sourceHeight: 1080,
  walkableFloorPolygon: [{ x: 0.1, y: 0.4 }, { x: 0.9, y: 0.4 }, { x: 0.8, y: 0.95 }],
  bins: [{
    binId: "bin-1",
    displayName: "Entrance bin",
    binType: "lidded",
    binPolygon: [{ x: 0.6, y: 0.3 }, { x: 0.75, y: 0.3 }, { x: 0.75, y: 0.8 }],
  }],
  quality: { minAlignmentScore: 0.82, minRimVisibility: 0.75, maxFrameAgeSeconds: 300 },
};

describe("processing registration", () => {
  it("pins only the immutable fields required by an inference job", () => {
    const registration = pinCameraRegistration("camera-1", published);
    expect(registration).toMatchObject({ cameraId: "camera-1", revision: 3, status: "ready", referenceMediaId: "reference-1" });
    expect(pinnedRegistrationFromJob({ cameraId: "camera-1", cameraRegistration: registration })).toEqual(registration);
  });

  it("requires a published ready registration", () => {
    expect(() => pinCameraRegistration("camera-1", undefined)).toThrowError("Camera registration is required");
    expect(() => pinCameraRegistration("camera-1", { ...published, status: "stale" })).toThrowError("Camera registration is required");
  });

  it("rejects frames that no longer match the registered camera view", () => {
    const registration = pinCameraRegistration("camera-1", published);
    expect(() => assertRegistrationFrameDimensions(registration, { width: 1280, height: 720 }))
      .toThrowError("do not match camera registration");
  });

  it("reserves the registered floor polygon for operational processing", () => {
    expect(() => rejectOperationalFocusRegion([{ x: 0, y: 0 }])).toThrowError("registered walkable-floor polygon");
    expect(() => rejectOperationalFocusRegion([])).not.toThrow();
  });
});
