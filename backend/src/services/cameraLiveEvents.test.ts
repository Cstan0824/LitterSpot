import { describe, it, expect } from "vitest";
import { cameraFramesForSite, publishCameraFrame, subscribeCameraEvents, publishCameraControl } from "./cameraLiveEvents.js";
describe("ephemeral Camera delivery", () => {
  it("pairs frames with observations and isolates Sites", () => {
    const received: unknown[] = []; const close = subscribeCameraEvents("live-test", e => received.push(e));
    publishCameraFrame("live-test", "c", { sampleId: "episode:5" }, Buffer.from("frame5"), "image/jpeg");
    expect(received).toHaveLength(1);
    expect(cameraFramesForSite("live-test")[0]).toMatchObject({ observation: { sampleId: "episode:5" }, frameDataUrl: "data:image/jpeg;base64,ZnJhbWU1" });
    expect(cameraFramesForSite("other-site")).toEqual([]);
    publishCameraControl("live-test", "c"); expect(cameraFramesForSite("live-test")).toEqual([]); close();
  });
});
