import { describe, expect, it } from "vitest";
import {
  cleanerWorkOrderActionSchema,
  createWorkOrderSchema,
  notificationListQuerySchema,
  updateCleanerPresenceSchema,
  workOrderListQuerySchema,
} from "./cleanerOperations.js";

describe("Cleaner operations API schemas", () => {
  it("requires consent-aware location idempotency fields", () => {
    expect(updateCleanerPresenceSchema.safeParse({}).success).toBe(false);
    expect(updateCleanerPresenceSchema.safeParse({
      location: { latitude: 3, longitude: 101, accuracyMeters: 10, capturedAt: "2026-08-18T00:00:00.000Z" },
    }).success).toBe(false);
    expect(updateCleanerPresenceSchema.parse({
      availability: "online",
      locationConsent: true,
      clientHeartbeatId: "heartbeat-001",
      location: { latitude: 3, longitude: 101, accuracyMeters: 10, capturedAt: "2026-08-18T00:00:00.000Z" },
    }).location?.source).toBe("browser_geolocation");
    expect(updateCleanerPresenceSchema.safeParse({ availability: "busy" }).success).toBe(false);
  });

  it("bounds and defaults work-order creation", () => {
    expect(createWorkOrderSchema.parse({
      alertId: "alert-1",
      assignedCleanerId: "cleaner-1",
      instructions: "Clean the staircase",
      assignmentDecisionId: "decision-1",
      idempotencyKey: "work-order-001",
    }).overrideAvailability).toBe(false);
    expect(createWorkOrderSchema.safeParse({
      alertId: "alert-1",
      assignedCleanerId: "cleaner-1",
      instructions: "",
      assignmentDecisionId: "decision-1",
      idempotencyKey: "short",
    }).success).toBe(false);
  });

  it("uses bounded list cursors and strict Cleaner actions", () => {
    expect(workOrderListQuerySchema.parse({})).toMatchObject({ status: "active", limit: 25 });
    expect(workOrderListQuerySchema.safeParse({ alertId: "a", cleanerId: "b" }).success).toBe(false);
    expect(notificationListQuerySchema.parse({})).toMatchObject({ status: "unread", limit: 25 });
    expect(cleanerWorkOrderActionSchema.safeParse({ idempotencyKey: "action-001", surprise: true }).success).toBe(false);
    expect(cleanerWorkOrderActionSchema.parse({
      idempotencyKey: "action-001",
      evidenceMediaIds: ["media-1", "media-2"],
    }).evidenceMediaIds).toEqual(["media-1", "media-2"]);
  });
});
