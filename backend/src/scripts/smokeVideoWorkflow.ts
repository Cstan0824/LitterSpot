import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { env } from "../config/env.js";
import { deleteStoredMedia, discardTemporaryMedia } from "../services/localMediaStorage.js";
import { processVideoJob } from "../services/videoJobProcessingService.js";
import { createVideoUpload } from "../services/videoMediaService.js";

const runFile = promisify(execFile);
const smokeId = randomUUID();
const siteId = `smoke-video-site-${smokeId}`;
const zoneId = `smoke-video-zone-${smokeId}`;
const cameraId = `smoke-video-camera-${smokeId}`;
const clientRequestId = `smoke-video-${smokeId}`;
const actorUid = `smoke-video-supervisor-${smokeId}`;
const uploadPath = join(env.videoUploadTempRoot, `${smokeId}.mp4.upload`);
const replayPath = join(env.videoUploadTempRoot, `${smokeId}.replay.mp4.upload`);

async function generateVideo() {
  await mkdir(env.videoUploadTempRoot, { recursive: true });
  await runFile(env.ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=size=320x240:rate=2",
    "-t", "4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-f", "mp4",
    uploadPath,
  ], { timeout: 30_000 });
  await copyFile(uploadPath, replayPath);
}

async function multerFile(filePath: string): Promise<Express.Multer.File> {
  const details = await stat(filePath);
  return {
    fieldname: "video",
    originalname: "phase-6-smoke.mp4",
    encoding: "7bit",
    mimetype: "video/mp4",
    size: details.size,
    destination: env.videoUploadTempRoot,
    filename: filePath.split("/").pop()!,
    path: filePath,
    buffer: Buffer.alloc(0),
    stream: null as never,
  };
}

async function seedLocation() {
  const now = Timestamp.now();
  await Promise.all([
    firestore.collection("sites").doc(siteId).set({
      name: "Phase 6 video smoke site", timezone: "Asia/Kuala_Lumpur", status: "active", createdAt: now, updatedAt: now,
    }),
    firestore.collection("zones").doc(zoneId).set({
      siteId, siteNameSnapshot: "Phase 6 video smoke site", name: "Phase 6 video smoke zone", status: "active", createdAt: now,
    }),
    firestore.collection("cameras").doc(cameraId).set({
      siteId,
      siteNameSnapshot: "Phase 6 video smoke site",
      zoneId,
      zoneNameSnapshot: "Phase 6 video smoke zone",
      code: `SMOKE-${smokeId.slice(0, 8)}`,
      name: "Phase 6 video smoke camera",
      status: "active",
      availability: "unknown",
      sourceMode: "upload",
      focusRegionNormalized: [],
      latestAnalysisRunId: null,
      latestAnalysisAt: null,
      latestCapturedAt: null,
      createdAt: now,
      updatedAt: now,
    }),
  ]);
}

async function cleanup() {
  await Promise.all([
    discardTemporaryMedia(uploadPath).catch(() => undefined),
    discardTemporaryMedia(replayPath).catch(() => undefined),
  ]);
  const media = await firestore.collection("mediaAssets").where("siteId", "==", siteId).get();
  for (const document of media.docs) {
    const storageKey = document.data().storageKey;
    if (typeof storageKey === "string") await deleteStoredMedia(storageKey).catch(() => undefined);
  }
  for (const collection of [
    "alerts",
    "activeAlertKeys",
    "alertConfirmationResets",
    "alertConfirmationStates",
    "flags",
    "issueObservations",
    "detections",
    "analysisRuns",
    "processingJobs",
    "mediaAssets",
    "cameras",
    "zones",
  ]) {
    const snapshot = await firestore.collection(collection).where("siteId", "==", siteId).get();
    for (const document of snapshot.docs) await firestore.recursiveDelete(document.ref);
  }
  await firestore.collection("sites").doc(siteId).delete();
}

async function main() {
  try {
    await generateVideo();
    await seedLocation();
    const request = {
      cameraId,
      clientRequestId,
      capturedAt: new Date().toISOString(),
      isTest: true,
      frameIntervalSeconds: 2,
      floorConfidence: 0.25,
      binLocalizerConfidence: 0.80,
      focusRegion: [],
    };
    const upload = await createVideoUpload(await multerFile(uploadPath), request, actorUid);
    assert.equal(upload.idempotent, false);
    assert.equal(upload.job.type, "video");
    assert.equal(upload.job.status, "queued");
    assert.equal(upload.job.progress.plannedFrames, 2);

    const replay = await createVideoUpload(await multerFile(replayPath), request, actorUid);
    assert.equal(replay.idempotent, true);
    assert.equal(replay.job.id, upload.job.id);
    assert.equal(replay.media.id, upload.media.id);

    const completed = await processVideoJob(upload.job.id);
    assert.equal(completed.status, "completed");
    assert.equal(completed.progress.plannedFrames, 2);
    assert.equal(completed.progress.processedFrames, 2);
    assert.equal(completed.progress.successfulFrames, 2);
    assert.equal(completed.progress.failedFrames, 0);
    assert.equal(completed.summary.analysisRunCount, 2);

    const runs = await firestore.collection("analysisRuns").where("jobId", "==", upload.job.id).get();
    assert.equal(runs.size, 2);
    for (const run of runs.docs) {
      assert.equal(run.data().sourceType, "video_upload");
      assert.equal(run.data().isTest, true);
      assert.equal(run.data().analyticsEligible, false);
      assert.equal(run.data().alertEvaluationStatus, "completed");
      assert.equal(typeof run.data().frameIndex, "number");
      assert.equal(typeof run.data().videoOffsetSeconds, "number");
    }
    const observations = await firestore.collection("issueObservations").where("siteId", "==", siteId).get();
    assert.equal(observations.size, 6, "Each frame records one test observation for every supported operational issue.");
    assert(observations.docs.every((document) => (
      document.data().excluded === true && document.data().temporalStatus === "excluded"
    )));
    assert.equal((await firestore.collection("flags").where("siteId", "==", siteId).get()).size, 0);
    assert.equal((await firestore.collection("alerts").where("siteId", "==", siteId).get()).size, 0);

    const replayedCompletion = await processVideoJob(upload.job.id);
    assert.equal(replayedCompletion.status, "completed");
    assert.equal(replayedCompletion.summary.analysisRunCount, 2);
    console.log("Phase 6 video smoke test passed: disk upload, ffprobe validation, idempotency, extraction, AI inference, tracking checkpoints, Firestore persistence, test exclusion, and completed-job replay.");
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
