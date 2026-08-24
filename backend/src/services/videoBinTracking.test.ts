import { describe, expect, it } from "vitest";
import { trackVideoBins, type PixelBoundingBox, type VideoBinTrackingState } from "./videoBinTracking.js";

const image = { width: 1_000, height: 600 };

function bin(name: string, bbox: PixelBoundingBox) {
  return { name, bbox, state: "normal", confirmed: true, stale: true };
}

function frame(bins: ReturnType<typeof bin>[], state?: VideoBinTrackingState | null, dimensions = image) {
  return trackVideoBins({ bins, image: dimensions, state });
}

describe("persisted video bin identity tracking", () => {
  it("keeps an ID across movement and confirms identity on the second consecutive sighting", () => {
    const firstInput = bin("entrance bin", { x1: 100, y1: 100, x2: 220, y2: 260 });
    const first = frame([firstInput]);
    const second = frame([bin("entrance bin", { x1: 118, y1: 104, x2: 238, y2: 264 })], first.state);

    expect(first.bins[0]).toMatchObject({ trackingId: "bin-1", confirmed: false, stale: false, trackingConsecutiveSeen: 1 });
    expect(second.bins[0]).toMatchObject({ trackingId: "bin-1", confirmed: true, trackingConfirmed: true, trackingConsecutiveSeen: 2 });
    expect(firstInput).toMatchObject({ confirmed: true, stale: true });
    expect(second.state.tracks["bin-1"].bbox).toEqual({ x1: 118, y1: 104, x2: 238, y2: 264 });
  });

  it("allocates a new ID for a distant bin without emitting the unseen track", () => {
    const first = frame([bin("left", { x1: 50, y1: 50, x2: 150, y2: 200 })]);
    const second = frame([bin("right", { x1: 800, y1: 300, x2: 920, y2: 500 })], first.state);

    expect(second.bins).toHaveLength(1);
    expect(second.bins[0].trackingId).toBe("bin-2");
    expect(second.state.tracks["bin-1"].missed).toBe(1);
    expect(second.state.tracks).toHaveProperty("bin-2");
  });

  it("keeps identities stable when detection order changes", () => {
    const first = frame([
      bin("left", { x1: 80, y1: 80, x2: 180, y2: 230 }),
      bin("right", { x1: 700, y1: 100, x2: 820, y2: 260 }),
    ]);
    const reordered = frame([
      bin("right", { x1: 710, y1: 105, x2: 830, y2: 265 }),
      bin("left", { x1: 90, y1: 85, x2: 190, y2: 235 }),
    ], first.state);

    expect(reordered.bins.map((item) => [item.name, item.trackingId])).toEqual([
      ["right", "bin-2"],
      ["left", "bin-1"],
    ]);
    expect(reordered.bins.every((item) => item.trackingConfirmed)).toBe(true);
  });

  it("retains identity through one missed frame without carrying a stale detection", () => {
    const first = frame([bin("main", { x1: 300, y1: 100, x2: 440, y2: 290 })]);
    const confirmed = frame([bin("main", { x1: 305, y1: 105, x2: 445, y2: 295 })], first.state);
    const missed = frame([], confirmed.state);
    const returned = frame([bin("main", { x1: 310, y1: 110, x2: 450, y2: 300 })], missed.state);

    expect(missed.bins).toEqual([]);
    expect(missed.state.tracks["bin-1"].missed).toBe(1);
    expect(returned.bins[0]).toMatchObject({ trackingId: "bin-1", trackingConfirmed: true, trackingConsecutiveSeen: 1 });
  });

  it("expires a track after more than two misses and assigns a new ID", () => {
    const first = frame([bin("main", { x1: 300, y1: 100, x2: 440, y2: 290 })]);
    const missOne = frame([], first.state);
    const missTwo = frame([], missOne.state);
    const expired = frame([], missTwo.state);
    const returned = frame([bin("main", { x1: 300, y1: 100, x2: 440, y2: 290 })], expired.state);

    expect(missTwo.state.tracks).toHaveProperty("bin-1");
    expect(expired.state.tracks).not.toHaveProperty("bin-1");
    expect(returned.bins[0].trackingId).toBe("bin-2");
  });

  it("handles invalid image dimensions safely and returns JSON-serializable state", () => {
    const invalidDimensions = { width: 0, height: Number.NaN };
    const first = frame([bin("main", { x1: 10, y1: 20, x2: 110, y2: 220 })], null, invalidDimensions);
    const persistedState = JSON.parse(JSON.stringify(first.state)) as VideoBinTrackingState;
    const second = frame(
      [bin("main", { x1: 10, y1: 20, x2: 110, y2: 220 })],
      persistedState,
      { width: -1, height: Number.POSITIVE_INFINITY },
    );

    expect(second.bins[0].trackingId).toBe("bin-1");
    expect(second.bins[0].trackingConfirmed).toBe(true);
    expect(JSON.parse(JSON.stringify(second.state))).toEqual(second.state);
    expect(Object.values(second.state.tracks).every((track) => Number.isFinite(track.missed))).toBe(true);
  });
});
