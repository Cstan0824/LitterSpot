import { describe, expect, it } from "vitest";
import { createVideoMetadataUpdate } from "./videoReferenceState";

describe("createVideoMetadataUpdate", () => {
  it("captures the duration before React releases the media event target", () => {
    let target: { duration: number } | null = { duration: 3.918 };
    const event = {
      get currentTarget() {
        if (!target) throw new Error("currentTarget was released");
        return target;
      },
    };

    const update = createVideoMetadataUpdate(event);
    target = null;

    expect(update({ duration: null, ready: false })).toEqual({
      duration: 3.918,
      ready: false,
    });
  });
});
