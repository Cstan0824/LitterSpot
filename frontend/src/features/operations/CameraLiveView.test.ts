import { describe, expect, it } from "vitest";
import { CAMERA_VIEW_ASPECT_RATIO, cameraMonitoringStatus } from "./CameraLiveView";

describe("cameraMonitoringStatus", () => {
  it("keeps every Camera stage at 16:9 regardless of source dimensions", () => {
    expect(CAMERA_VIEW_ASPECT_RATIO).toBe("16 / 9");
  });
  it("describes a deliberately disabled Camera", () => {
    expect(cameraMonitoringStatus({ available: true, enabled: false, busy: false, stale: true, now: 1_000 })).toEqual({ tone: "disabled", title: "Monitoring stopped", detail: "Enable this Camera to resume detection." });
  });

  it("reports fresh monitored evidence without repeating the Camera name", () => {
    expect(cameraMonitoringStatus({ available: true, enabled: true, busy: false, stale: false, lastReceivedAt: 9_000, peopleCount: 3, processingTimeMs: 82.4, now: 10_000 })).toEqual({ tone: "online", title: "Live monitoring", detail: "Latest frame 1 second ago · 3 people · 82 ms" });
  });

  it("keeps the primary connection status stable while analysis catches up", () => {
    expect(cameraMonitoringStatus({ available: true, enabled: true, busy: false, stale: false, message: "Updating analysis", analysisUpdating: true, lastReceivedAt: 9_000, peopleCount: 3, processingTimeMs: 82.4, now: 10_000 })).toEqual({ tone: "online", title: "Live monitoring", detail: "Latest frame 1 second ago · Analysis is catching up" });
  });

  it("separates an enabled but stale Camera from a stopped Camera", () => {
    expect(cameraMonitoringStatus({ available: true, enabled: true, busy: false, stale: true, now: 10_000 })).toEqual({ tone: "offline", title: "Camera offline", detail: "Enabled, but no fresh frame has arrived." });
  });

  it("reports explicit buffering and analyzed-playback failure states", () => {
    expect(cameraMonitoringStatus({ available: true, enabled: true, busy: false, stale: false, playbackState: "buffering", now: 1_000 }).title).toBe("Connecting to Camera...");
    expect(cameraMonitoringStatus({ available: true, enabled: true, busy: false, stale: false, playbackState: "rebuffering", now: 1_000 }).title).toBe("Rebuffering analysis");
    expect(cameraMonitoringStatus({ available: true, enabled: true, busy: false, stale: false, playbackState: "unavailable", now: 1_000 }).title).toBe("Camera analysis unavailable");
  });
});
