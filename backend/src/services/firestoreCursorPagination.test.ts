import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { decodePageCursor, encodePageCursor, opaqueCursorSchema, paginationQueryFingerprint } from "./firestoreCursorPagination.js";

const context = {
  resource: "detections",
  orderField: "createdAt",
  filters: { cameraId: "camera-1", issueType: "floor_litter" },
};

describe("Firestore cursor pagination", () => {
  it("round-trips an opaque cursor carrying the timestamp and document ID", () => {
    const timestamp = Timestamp.fromDate(new Date("2026-08-13T04:05:06.789Z"));
    const cursor = encodePageCursor(context, timestamp, "detection-z");
    expect(opaqueCursorSchema.parse(cursor)).toBe(cursor);
    expect(cursor).not.toContain("detection-z");
    const decoded = decodePageCursor(cursor, context);
    expect(decoded.orderValue.toMillis()).toBe(timestamp.toMillis());
    expect(decoded.id).toBe("detection-z");
  });

  it("binds cursors to the resource, ordering, and normalized filters", () => {
    const cursor = encodePageCursor(context, Timestamp.now(), "detection-a");
    expect(() => decodePageCursor(cursor, { ...context, filters: { ...context.filters, cameraId: "camera-2" } })).toThrow(/invalid for this query/i);
    expect(() => decodePageCursor(cursor, { ...context, resource: "flags" })).toThrow(/invalid for this query/i);
    expect(() => decodePageCursor(cursor, { ...context, orderField: "capturedAt" })).toThrow(/invalid for this query/i);
  });

  it("rejects malformed payloads and produces stable filter fingerprints", () => {
    expect(() => decodePageCursor("bm90LWpzb24", context)).toThrow(/invalid for this query/i);
    expect(opaqueCursorSchema.safeParse("not+base64").success).toBe(false);
    expect(paginationQueryFingerprint({ b: 2, a: 1 })).toBe(paginationQueryFingerprint({ a: 1, b: 2 }));
  });
});
