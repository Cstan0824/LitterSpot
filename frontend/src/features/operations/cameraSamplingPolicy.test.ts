import { describe, expect, it } from "vitest";
import { adaptiveCameraSampleInterval } from "../../../../shared/cameraMonitoring";

describe("adaptive Camera sampling policy", () => {
  it("reserves two-Hz sampling for Detail and reduces background work", () => {
    expect(adaptiveCameraSampleInterval({ detail: true, visibleCard: false, positiveBurst: false, verification: false })).toBe(500);
    expect(adaptiveCameraSampleInterval({ detail: false, visibleCard: true, positiveBurst: false, verification: false })).toBe(1_000);
    expect(adaptiveCameraSampleInterval({ detail: false, visibleCard: false, positiveBurst: false, verification: false })).toBe(4_000);
  });

  it("temporarily promotes positive and Verification Cameras", () => {
    expect(adaptiveCameraSampleInterval({ detail: false, visibleCard: false, positiveBurst: true, verification: false })).toBe(1_000);
    expect(adaptiveCameraSampleInterval({ detail: false, visibleCard: false, positiveBurst: false, verification: true })).toBe(1_000);
  });
});
