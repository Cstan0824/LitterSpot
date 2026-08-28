import { describe, expect, it } from "vitest";
import { cameraRegistrationDraftSchema, cameraRegistrationPreviewSourceSchema } from "./cameraRegistration.js";

const floor = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
];

function draft(bins: unknown[]) {
  return {
    schemaVersion: 2,
    referenceMediaId: "reference-1",
    sourceWidth: 1280,
    sourceHeight: 720,
    walkableFloorPolygon: floor,
    bins,
    quality: {},
  };
}

describe("camera registration bin geometry", () => {
  it("accepts only explicit image or video preview sources", () => {
    expect(cameraRegistrationPreviewSourceSchema.parse("image")).toBe("image");
    expect(cameraRegistrationPreviewSourceSchema.parse("video")).toBe("video");
    expect(cameraRegistrationPreviewSourceSchema.safeParse("stream").success).toBe(false);
  });

  it("accepts a camera view without registered bins", () => {
    expect(cameraRegistrationDraftSchema.parse(draft([])).bins).toEqual([]);
  });

  it("still rejects an invalid bin when an operator supplies one", () => {
    expect(() => cameraRegistrationDraftSchema.parse(draft([{
      binId: "bin-1",
      displayName: "Entrance bin",
      binType: "unknown",
      binPolygon: [{ x: 0.1, y: 0.1 }, { x: 0.1, y: 0.1 }, { x: 0.1, y: 0.1 }],
    }]))).toThrow();
  });
});
