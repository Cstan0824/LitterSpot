import { describe, expect, it } from "vitest";
import {
  createCameraSchema,
  createSiteSchema,
  createZoneSchema,
  updateCameraSchema,
  updateSiteSchema,
  updateZoneSchema,
} from "./location.js";

describe("location request schemas", () => {
  it("accepts the Site -> Zone -> Camera hierarchy", () => {
    expect(createSiteSchema.safeParse({ name: "Batu Caves" }).success).toBe(true);
    expect(createZoneSchema.safeParse({ siteId: "site-1", name: "Lower Staircase", code: "LOWER_STAIRS" }).success).toBe(true);
    expect(createCameraSchema.safeParse({ zoneId: "zone-1", code: "CAMERA-1", name: "Lower staircase view" }).success).toBe(true);
  });

  it("rejects area fields and malformed camera codes", () => {
    expect(createCameraSchema.safeParse({ areaId: "area-1", zoneId: "zone-1", code: "CAMERA-1", name: "Camera" }).success).toBe(false);
  });

  it("supports soft-deactivation updates", () => {
    expect(updateSiteSchema.safeParse({ status: "inactive" }).success).toBe(true);
    expect(updateZoneSchema.safeParse({ status: "inactive" }).success).toBe(true);
    expect(updateCameraSchema.safeParse({ status: "inactive" }).success).toBe(true);
  });

  it("rejects empty updates", () => {
    expect(updateSiteSchema.safeParse({}).success).toBe(false);
    expect(updateZoneSchema.safeParse({}).success).toBe(false);
    expect(updateCameraSchema.safeParse({}).success).toBe(false);
  });
});
