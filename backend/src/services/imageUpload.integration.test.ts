import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { firestore } from "../config/firebase.js";
import { imageUploadSchema } from "../schemas/media.js";
import { deleteStoredMedia } from "./localMediaStorage.js";
import { createImageUpload } from "./mediaService.js";

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const prefix = `image-idempotency-${process.pid}`;
const actorUid = `${prefix}-supervisor`;
const cameraId = `${prefix}-camera`;
const clientRequestId = `${prefix}-request`;
let mediaId = "";

function uploadFile(contents: Buffer): Express.Multer.File {
  return {
    fieldname: "image",
    originalname: "test.jpg",
    encoding: "7bit",
    mimetype: "image/jpeg",
    size: contents.length,
    destination: "",
    filename: "",
    path: "",
    buffer: contents,
    stream: null as never,
  };
}

const input = imageUploadSchema.parse({
  cameraId,
  clientRequestId,
  isTest: "true",
  focusRegion: "[]",
});

emulatorDescribe("image upload idempotency", () => {
  beforeAll(async () => {
    await firestore.collection("cameras").doc(cameraId).set({
      status: "active",
      siteId: `${prefix}-site`,
      siteNameSnapshot: "Idempotency Site",
      zoneId: `${prefix}-zone`,
      zoneNameSnapshot: "Idempotency Zone",
      code: "CAM-IDEMPOTENCY",
      name: "Idempotency Camera",
    });
  });

  afterAll(async () => {
    const jobId = (await firestore.collection("processingJobs").where("clientRequestId", "==", clientRequestId).get()).docs[0]?.id;
    if (mediaId) {
      const media = await firestore.collection("mediaAssets").doc(mediaId).get();
      if (typeof media.data()?.storageKey === "string") await deleteStoredMedia(media.data()!.storageKey).catch(() => undefined);
      await media.ref.delete().catch(() => undefined);
    }
    if (jobId) await firestore.collection("processingJobs").doc(jobId).delete().catch(() => undefined);
    await firestore.collection("cameras").doc(cameraId).delete().catch(() => undefined);
  });

  it("reuses an identical request and rejects file or option drift", async () => {
    const contents = Buffer.from([0xff, 0xd8, 0xff, 0x01]);
    const first = await createImageUpload(uploadFile(contents), input, actorUid);
    mediaId = first.media.id;
    expect(first).toMatchObject({ idempotent: false, job: { status: "queued" }, media: { storageStatus: "available" } });

    const replay = await createImageUpload(uploadFile(contents), input, actorUid);
    expect(replay).toMatchObject({ idempotent: true, job: { id: first.job.id }, media: { id: first.media.id } });

    await expect(createImageUpload(uploadFile(Buffer.from([0xff, 0xd8, 0xff, 0x02])), input, actorUid))
      .rejects.toMatchObject({ status: 409 });
    await expect(createImageUpload(uploadFile(contents), { ...input, floorConfidence: 0.5 }, actorUid))
      .rejects.toMatchObject({ status: 409 });
  });
});
