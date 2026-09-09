import { afterEach, describe, expect, it, vi } from "vitest";
import { SiteCameraMonitoring } from "../../../../shared/cameraMonitoring";

describe("Camera sample display when event delivery is unavailable", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("renders the captured frame and returned detections instead of a blank Online tile", async () => {
    const observation = { sampleId: "episode:1", cameraId: "camera", episodeId: "episode", sequence: 1, capturedAtMs: Date.now(), image: { width: 640, height: 480 }, processingTimeMs: 12, playbackGeneration: 0, registrationRevisionId: "registration", peopleCount: 1, people: [{ confidence: .9, bbox: { x1: 10, y1: 20, x2: 30, y2: 40 } }], bins: [], issues: [] };
    const transport = vi.fn(async () => new Response(JSON.stringify({ observation, nextSequence: 2 }), { status: 200 }));
    const monitor = new SiteCameraMonitoring(transport);
    const runtime = monitor as any;
    const camera = { id: "camera", name: "Camera", status: "active", monitoringEnabled: true, revision: 1, sourceType: "looped_video", activeSourceRevisionId: "source", activeRegistrationRevisionId: "registration", playbackGeneration: 0, source: { contentUrl: "/source", sampleIntervalSeconds: 1 } };
    runtime.state.cameras.camera = { camera, message: "Connecting", controlBusy: false };
    runtime.active = true; runtime.lease = { sessionId: "session", leaseToken: "fixture" };
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: () => {} }), toBlob: (callback: (b: Blob) => void) => callback(new Blob(["captured-frame"], { type: "image/jpeg" })) }) });
    const driver = { camera, episodeId: "episode", sequence: 1, nextAt: 0, busy: false, stopped: false, loading: false, video: { videoWidth: 640, videoHeight: 480, currentTime: 2 } };
    await runtime.sample(driver);
    const view = monitor.snapshot().cameras.camera;
    expect(view.message).toBe("Live monitoring");
    expect(view.observation).toMatchObject({ sampleId: "episode:1", peopleCount: 1 });
    expect(view.frameDataUrl).toMatch(/^blob:/);
    expect(await fetch(view.frameDataUrl!).then(r => r.text())).toBe("captured-frame");
    URL.revokeObjectURL(view.frameDataUrl!);
  });
});
