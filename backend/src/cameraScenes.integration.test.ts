import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { firestore } from "./config/firebase.js";
import { selectCameraScene, assertDemoScenesEnabled } from "./services/cameraScenes.js";
const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
run("Demo scenes preserve monitoring continuity", () => {
  it("changes playback without resetting episode, sequence, Registration, or Work", async () => {
    const cameraId = randomUUID(); const siteId = randomUUID(); const episodeId = randomUUID();
    const ref = firestore.collection("cameras").doc(cameraId);
    await ref.set({ schemaVersion: 2, siteId, status: "active", sourceType: "looped_video", monitoringEnabled: true, activeSourceRevisionId: "source-1", activeRegistrationRevisionId: "reg-1", revision: 7 });
    await firestore.collection("monitoringEpisodes").doc(episodeId).set({ siteId, cameraId, lastSequence: 42, endedAt: null });
    await ref.collection("demoScenes").doc("clean").set({ sourceRevisionId: "source-1", registrationRevisionId: "reg-1", mediaId: "clean-video" });
    const old = process.env.CAMERA_DEMO_SCENES_ENABLED;
    try {
      delete process.env.CAMERA_DEMO_SCENES_ENABLED; expect(() => assertDemoScenesEnabled()).toThrow();
      process.env.CAMERA_DEMO_SCENES_ENABLED = "true";
      await selectCameraScene(siteId, cameraId, "clean", "dev-root");
      expect((await ref.get()).data()).toMatchObject({ revision: 7, monitoringEnabled: true, activeSourceRevisionId: "source-1", activeRegistrationRevisionId: "reg-1", demoPlayback: { mediaId: "clean-video", generation: 1 } });
      expect((await firestore.collection("monitoringEpisodes").doc(episodeId).get()).data()).toMatchObject({ lastSequence: 42, endedAt: null });
      await ref.update({ activeRegistrationRevisionId: "reg-2" });
      await expect(selectCameraScene(siteId, cameraId, "clean", "dev-root")).rejects.toThrow("does not match");
    } finally { if (old === undefined) delete process.env.CAMERA_DEMO_SCENES_ENABLED; else process.env.CAMERA_DEMO_SCENES_ENABLED = old; }
  });
});
