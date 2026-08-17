import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { firestore } from "../config/firebase.js";
import { ALERT_WORKFLOW_VERSION } from "../shared/workflowVersions.js";
import {
  listAlertHistory,
  listAlertOccurrences,
  listAlerts,
  listFlags,
  listIssueObservations,
} from "./alertWorkflowService.js";
import { listAnalysisRuns, listDetections } from "./jobProcessingService.js";
import { listMedia, listProcessingJobs } from "./mediaService.js";

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const prefix = `pagination-integration-${process.pid}`;
const cameraId = `${prefix}-camera`;
const siteId = `${prefix}-site`;
const analysisRunId = `${prefix}-run`;
const alertId = `${prefix}-alert-c`;
const latest = Timestamp.fromMillis(2_000);
const older = Timestamp.fromMillis(1_000);
const suffixes = ["a", "b", "c", "d"] as const;
const timestampFor = (suffix: string) => suffix === "d" ? older : latest;
const id = (collection: string, suffix: string) => `${prefix}-${collection}-${suffix}`;

emulatorDescribe("Firestore list API cursor integration", () => {
  beforeAll(async () => {
    const batch = firestore.batch();
    for (const suffix of suffixes) {
      const createdAt = timestampFor(suffix);
      batch.set(firestore.collection("mediaAssets").doc(id("media", suffix)), {
        kind: "original_upload", sourceType: "image_upload", originalFileName: `${suffix}.jpg`,
        storageStatus: "available", mimeType: "image/jpeg", byteSize: 1, sha256: suffix,
        width: 1, height: 1, durationSeconds: null, parentMediaId: null, frameIndex: null,
        videoOffsetSeconds: null, siteId, siteNameSnapshot: "Pagination Site", zoneId: `${prefix}-zone`,
        zoneNameSnapshot: "Pagination Zone", cameraId, cameraCodeSnapshot: "CAM-PAGE",
        cameraNameSnapshot: "Pagination Camera", capturedAt: createdAt, isTest: true, createdAt,
      });
      batch.set(firestore.collection("processingJobs").doc(id("job", suffix)), {
        type: "image", status: "completed", sourceMediaId: id("media", suffix), sourceType: "image_upload",
        siteId, zoneId: `${prefix}-zone`, cameraId, requestedByUid: `${prefix}-user`, requestedAt: createdAt,
        captureStartedAt: createdAt, startedAt: createdAt, completedAt: createdAt, analyticsEligible: false,
        isTest: true, clientRequestId: id("request", suffix), options: {}, progress: {}, summary: {}, error: null,
        attemptCount: 1, analysisRunId, createdAt, updatedAt: createdAt,
      });
      batch.set(firestore.collection("detections").doc(id("detection", suffix)), {
        analysisRunId, jobId: id("job", suffix), cameraId, issueType: "floor_litter", evidenceMediaId: id("media", suffix),
        confidence: 0.9, qualificationStatus: "qualified", qualifiedForFlag: true, createdAt,
      });
      batch.set(firestore.collection("analysisRuns").doc(id("run", suffix)), {
        jobId: analysisRunId,
        cameraId,
        sourceMediaId: id("media", suffix),
        evidenceMediaId: id("media", suffix),
        sourceType: "image_upload",
        capturedAt: createdAt,
        createdAt,
      });
      batch.set(firestore.collection("issueObservations").doc(id("observation", suffix)), {
        analysisRunId, cameraId, issueType: "floor_litter", positive: true, capturedAt: createdAt, createdAt,
      });
      batch.set(firestore.collection("flags").doc(id("flag", suffix)), {
        workflowVersion: ALERT_WORKFLOW_VERSION, analysisRunId, alertId, detectionIds: [id("detection", suffix)],
        cameraId, issueType: "floor_litter", createdAt,
      });
      batch.set(firestore.collection("alerts").doc(id("alert", suffix)), {
        workflowVersion: ALERT_WORKFLOW_VERSION, status: "new", issueType: "floor_litter", severity: "warning",
        siteId, zoneId: `${prefix}-zone`, cameraId, cameraIds: [cameraId], lastDetectedAt: createdAt,
        firstEvidenceMediaId: id("media", suffix), latestEvidenceMediaId: id("media", suffix),
      });
      batch.set(firestore.collection("alerts").doc(alertId).collection("statusHistory").doc(id("history", suffix)), {
        newStatus: "new", changedAt: createdAt,
      });
      batch.set(firestore.collection("alerts").doc(alertId).collection("occurrences").doc(id("occurrence", suffix)), {
        evidenceMediaId: id("media", suffix), capturedAt: createdAt,
      });
    }
    batch.set(firestore.collection("flags").doc(id("legacy-flag", "a")), {
      analysisRunId: `${prefix}-legacy-run`, detectionIds: [id("legacy-detection", "a")], createdAt: latest,
    });
    batch.set(firestore.collection("flags").doc(id("legacy-flag", "b")), {
      workflowVersion: "prototype-v1", analysisRunId: `${prefix}-legacy-run`,
      detectionIds: [id("legacy-detection", "b")], createdAt: older,
    });
    await batch.commit();
  });

  afterAll(async () => {
    const batch = firestore.batch();
    for (const suffix of suffixes) {
      batch.delete(firestore.collection("alerts").doc(alertId).collection("statusHistory").doc(id("history", suffix)));
      batch.delete(firestore.collection("alerts").doc(alertId).collection("occurrences").doc(id("occurrence", suffix)));
      for (const collection of ["mediaAssets", "processingJobs", "detections", "analysisRuns", "issueObservations", "flags", "alerts"]) {
        const stem = collection === "mediaAssets" ? "media"
          : collection === "processingJobs" ? "job"
            : collection === "analysisRuns" ? "run"
              : collection === "issueObservations" ? "observation"
              : collection.slice(0, -1);
        batch.delete(firestore.collection(collection).doc(id(stem, suffix)));
      }
    }
    batch.delete(firestore.collection("flags").doc(id("legacy-flag", "a")));
    batch.delete(firestore.collection("flags").doc(id("legacy-flag", "b")));
    await batch.commit();
  });

  it("paginates media and jobs with timestamp/document-ID tie breaking", async () => {
    const mediaFirst = await listMedia({ cameraId, isTest: true, limit: 2 });
    expect(mediaFirst.items.map((item) => item.id)).toEqual([id("media", "c"), id("media", "b")]);
    expect(mediaFirst.nextCursor).toEqual(expect.any(String));
    const mediaSecond = await listMedia({ cameraId, isTest: true, limit: 2, cursor: mediaFirst.nextCursor! });
    expect(mediaSecond.items.map((item) => item.id)).toEqual([id("media", "a"), id("media", "d")]);
    expect(mediaSecond.nextCursor).toBeNull();

    const jobFirst = await listProcessingJobs({ status: "completed", limit: 3 });
    const ownedJobs = jobFirst.items.filter((item) => item.cameraId === cameraId);
    expect(ownedJobs.map((item) => item.id)).toContain(id("job", "c"));
  });

  it("applies detection and observation filters before cursor pagination", async () => {
    const detectionFirst = await listDetections({ cameraId, issueType: "floor_litter", limit: 2 });
    expect(detectionFirst.items.map((item) => item.id)).toEqual([id("detection", "c"), id("detection", "b")]);
    const detectionSecond = await listDetections({
      cameraId, issueType: "floor_litter", limit: 2, cursor: detectionFirst.nextCursor!,
    });
    expect(detectionSecond.items.map((item) => item.id)).toEqual([id("detection", "a"), id("detection", "d")]);

    const observationFirst = await listIssueObservations({
      cameraId, issueType: "floor_litter", positive: true, limit: 2,
    });
    expect(observationFirst.items.map((item) => item.id)).toEqual([id("observation", "c"), id("observation", "b")]);
    await expect(listIssueObservations({
      cameraId, issueType: "bin_overflow", positive: true, limit: 2, cursor: observationFirst.nextCursor!,
    })).rejects.toThrow(/cursor is invalid for this query/i);
  });

  it("paginates analysis runs instead of truncating an in-memory scan", async () => {
    const first = await listAnalysisRuns({ jobId: analysisRunId, limit: 2 });
    expect(first.items.map((item) => item.id)).toEqual([id("run", "c"), id("run", "b")]);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await listAnalysisRuns({ jobId: analysisRunId, limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((item) => item.id)).toEqual([id("run", "a"), id("run", "d")]);
    expect(second.nextCursor).toBeNull();
  });

  it("paginates current flags and alerts while preserving bounded legacy access", async () => {
    const flags = await listFlags({ analysisRunId, workflow: "current", limit: 2 });
    expect(flags.items.map((item) => item.id)).toEqual([id("flag", "c"), id("flag", "b")]);
    expect(flags.nextCursor).toEqual(expect.any(String));

    const alerts = await listAlerts({
      status: "new", siteId, cameraId, workflow: "current", limit: 2,
    });
    expect(alerts.items.map((item) => item.id)).toEqual([id("alert", "c"), id("alert", "b")]);
    expect(alerts.nextCursor).toEqual(expect.any(String));

    const legacy = await listFlags({ analysisRunId: `${prefix}-legacy-run`, workflow: "legacy", limit: 10 });
    expect(legacy.items.map((item) => item.id)).toEqual([id("legacy-flag", "a"), id("legacy-flag", "b")]);
    expect(legacy).toMatchObject({ nextCursor: null, paginationMode: "bounded_legacy_scan", resultCompleteness: "complete" });
  });

  it("paginates alert history and occurrences newest first", async () => {
    const history = await listAlertHistory(alertId, { limit: 2 });
    expect(history.items.map((item) => item.id)).toEqual([id("history", "c"), id("history", "b")]);
    const occurrences = await listAlertOccurrences(alertId, { limit: 2 });
    expect(occurrences.items.map((item) => item.id)).toEqual([id("occurrence", "c"), id("occurrence", "b")]);
    expect(history.nextCursor).toEqual(expect.any(String));
    expect(occurrences.nextCursor).toEqual(expect.any(String));
  });
});
