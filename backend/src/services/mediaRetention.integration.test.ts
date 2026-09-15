import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { firestore } from "../config/firebase.js";
import { deleteStoredMedia, inspectMedia, writeMedia } from "./localMediaStorage.js";
import { runMediaRetention } from "./mediaRetentionService.js";
import { getMediaContent } from "./mediaService.js";

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const prefix = `retention-integration-${process.pid}`;
const ids = {
  eligible: `${prefix}-eligible`,
  alertProtected: `${prefix}-alert-protected`,
  jobProtected: `${prefix}-job-protected`,
  recent: `${prefix}-recent`,
  recoverable: `${prefix}-recoverable`,
};
const paths = Object.fromEntries(Object.entries(ids).map(([name, id]) => [name, `media/${id}/original.jpg`])) as Record<keyof typeof ids, string>;
const now = new Date("2026-08-17T00:00:00.000Z");
const old = Timestamp.fromDate(new Date("2026-06-01T00:00:00.000Z"));
const recent = Timestamp.fromDate(new Date("2026-08-16T00:00:00.000Z"));

function mediaDocument(id: string, storageKey: string, createdAt: Timestamp) {
  return {
    kind: "original_upload",
    storageStatus: "available",
    storageProvider: "local",
    storageKey,
    createdAt,
    originalFileName: `${id}.jpg`,
  };
}

emulatorDescribe("media retention execution", () => {
  beforeAll(async () => {
    await Promise.all(Object.values(paths).map((storageKey) => writeMedia(storageKey, Buffer.from("retention-test"))));
    const batch = firestore.batch();
    batch.set(firestore.collection("mediaAssets").doc(ids.eligible), mediaDocument(ids.eligible, paths.eligible, old));
    batch.set(firestore.collection("mediaAssets").doc(ids.alertProtected), mediaDocument(ids.alertProtected, paths.alertProtected, old));
    batch.set(firestore.collection("mediaAssets").doc(ids.jobProtected), mediaDocument(ids.jobProtected, paths.jobProtected, old));
    batch.set(firestore.collection("mediaAssets").doc(ids.recent), mediaDocument(ids.recent, paths.recent, recent));
    batch.set(firestore.collection("mediaAssets").doc(ids.recoverable), { ...mediaDocument(ids.recoverable, paths.recoverable, recent), storageStatus: "missing", mimeType: "image/jpeg" });
    batch.set(firestore.collection("alerts").doc(`${prefix}-alert`), {
      schemaVersion: 2,
      status: "waiting_for_cleaner",
      latestEvidenceMediaId: ids.alertProtected,
    });
    batch.set(firestore.collection("processingJobs").doc(`${prefix}-job`), {
      status: "processing",
      sourceMediaId: ids.jobProtected,
    });
    await batch.commit();
  });

  afterAll(async () => {
    const batch = firestore.batch();
    Object.values(ids).forEach((id) => batch.delete(firestore.collection("mediaAssets").doc(id)));
    batch.delete(firestore.collection("alerts").doc(`${prefix}-alert`));
    batch.delete(firestore.collection("processingJobs").doc(`${prefix}-job`));
    await batch.commit().catch(() => undefined);
    await Promise.all(Object.values(paths).map((storageKey) => deleteStoredMedia(storageKey).catch(() => undefined)));
  });

  it("dry-runs safely, then deletes only unreferenced expired local media", async () => {
    const options = { execute: false, cutoffDays: 30, pageSize: 2 };
    const dryRun = await runMediaRetention(options, now);
    expect(dryRun).toMatchObject({ mode: "dry_run", eligibleMedia: 1, deletedMedia: 0 });
    await expect(inspectMedia(paths.eligible)).resolves.toMatchObject({ byteSize: 14 });

    const executed = await runMediaRetention({ ...options, execute: true }, now);
    expect(executed).toMatchObject({ mode: "execute", eligibleMedia: 1, deletedMedia: 1 });
    const eligible = await firestore.collection("mediaAssets").doc(ids.eligible).get();
    expect(eligible.data()).toMatchObject({
      storageStatus: "deleted",
      deletionReason: "retention_policy",
      retentionPolicyVersion: "local-media-retention-v1",
    });
    expect(eligible.data()).not.toHaveProperty("storageKey");
    await expect(inspectMedia(paths.eligible)).rejects.toThrow("unavailable");

    for (const protectedId of [ids.alertProtected, ids.jobProtected, ids.recent]) {
      const snapshot = await firestore.collection("mediaAssets").doc(protectedId).get();
      expect(snapshot.data()?.storageStatus).toBe("available");
    }
  });

  it("recovers a stale missing status when the configured file exists", async () => {
    await firestore.collection("mediaAssets").doc(ids.recoverable).update({ storageStatus: "missing" });
    await expect(getMediaContent(ids.recoverable)).resolves.toMatchObject({ byteSize: 14, mimeType: "image/jpeg" });
    expect((await firestore.collection("mediaAssets").doc(ids.recoverable).get()).data()?.storageStatus).toBe("available");
  });
});
