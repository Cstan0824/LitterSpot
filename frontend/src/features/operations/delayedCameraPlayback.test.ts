import { describe, expect, it } from "vitest";
import type { CameraObservation } from "../../../../shared/cameraMonitoring";
import { delayedPlaybackDimensions, overlayForDelayedPlayback } from "../../../../shared/delayedCameraPlayback";

const observation = (capturedAtMs: number): CameraObservation => ({ sampleId: String(capturedAtMs), cameraId: "camera", episodeId: "episode", sequence: 1, capturedAtMs, image: { width: 1280, height: 720 }, processingTimeMs: 200, playbackGeneration: 1, peopleCount: 1, people: [{ confidence: .9, bbox: { x1: 1, y1: 1, x2: 2, y2: 2 } }], bins: [{ binId: "bin", state: "normal", confidence: .9, bbox: { x1: 1, y1: 1, x2: 2, y2: 2 } }], issues: [{ issueType: "floor_litter", confidence: .9, geometry: { bbox: { x1: 1, y1: 1, x2: 2, y2: 2 } } }] });

describe("delayed Camera playback policy", () => {
  it("caps presentation at standard 720p without upscaling smaller sources", () => {
    expect(delayedPlaybackDimensions(1920, 1080)).toEqual({ width: 1280, height: 720 });
    expect(delayedPlaybackDimensions(640, 480)).toEqual({ width: 640, height: 480 });
    expect(delayedPlaybackDimensions(1080, 1920)).toEqual({ width: 405, height: 720 });
  });

  it("expires moving boxes before environmental and registered-bin boxes", () => {
    const item = observation(1_000);
    expect(overlayForDelayedPlayback([item], 1_300)).toMatchObject({ people: item.people, issues: item.issues, bins: item.bins });
    expect(overlayForDelayedPlayback([item], 1_500)).toMatchObject({ people: [], issues: item.issues, bins: item.bins });
    expect(overlayForDelayedPlayback([item], 1_800)).toMatchObject({ people: [], issues: [], bins: item.bins });
    expect(overlayForDelayedPlayback([item], 2_100)).toBeUndefined();
  });
});
