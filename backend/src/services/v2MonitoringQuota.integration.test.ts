import { randomUUID } from "node:crypto";
import { DocumentReference, Query, Transaction, WriteBatch } from "firebase-admin/firestore";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { app } from "../app.js";
import { firebaseAuth, firestore } from "../config/firebase.js";
import { writeMedia } from "./localMediaStorage.js";
import { resetMonitoringRuntime } from "./monitoringRuntimeRegistry.js";
import { resetV2LiveMemory, setV2LiveInferenceForTests } from "./v2LiveMonitoringService.js";
import { recordV2CameraVerificationObservation } from "./v2WorkOrderService.js";
import { getLiveCameraConfiguration, invalidateSiteCameraConfiguration } from "./cameraConfigurationCache.js";

const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

async function measureFirestoreOperations<T>(work: () => Promise<T>) {
  const originals = {
    documentGet: DocumentReference.prototype.get, queryGet: Query.prototype.get,
    documentCreate: DocumentReference.prototype.create, documentSet: DocumentReference.prototype.set,
    documentUpdate: DocumentReference.prototype.update, documentDelete: DocumentReference.prototype.delete,
    transactionGet: Transaction.prototype.get, transactionGetAll: Transaction.prototype.getAll,
    transactionCreate: Transaction.prototype.create, transactionSet: Transaction.prototype.set,
    transactionUpdate: Transaction.prototype.update, transactionDelete: Transaction.prototype.delete,
    batchCreate: WriteBatch.prototype.create, batchSet: WriteBatch.prototype.set,
    batchUpdate: WriteBatch.prototype.update, batchDelete: WriteBatch.prototype.delete,
  };
  let reads = 0; let writes = 0;
  const countRead = (original: Function) => function (this: unknown, ...args: unknown[]) { reads += 1; return original.apply(this, args); };
  const countWrite = (original: Function) => function (this: unknown, ...args: unknown[]) { writes += 1; return original.apply(this, args); };
  DocumentReference.prototype.get = countRead(originals.documentGet) as typeof DocumentReference.prototype.get;
  Query.prototype.get = countRead(originals.queryGet) as typeof Query.prototype.get;
  Transaction.prototype.get = countRead(originals.transactionGet) as typeof Transaction.prototype.get;
  Transaction.prototype.getAll = countRead(originals.transactionGetAll) as typeof Transaction.prototype.getAll;
  DocumentReference.prototype.create = countWrite(originals.documentCreate) as typeof DocumentReference.prototype.create;
  DocumentReference.prototype.set = countWrite(originals.documentSet) as typeof DocumentReference.prototype.set;
  DocumentReference.prototype.update = countWrite(originals.documentUpdate) as typeof DocumentReference.prototype.update;
  DocumentReference.prototype.delete = countWrite(originals.documentDelete) as typeof DocumentReference.prototype.delete;
  Transaction.prototype.create = countWrite(originals.transactionCreate) as typeof Transaction.prototype.create;
  Transaction.prototype.set = countWrite(originals.transactionSet) as typeof Transaction.prototype.set;
  Transaction.prototype.update = countWrite(originals.transactionUpdate) as typeof Transaction.prototype.update;
  Transaction.prototype.delete = countWrite(originals.transactionDelete) as typeof Transaction.prototype.delete;
  WriteBatch.prototype.create = countWrite(originals.batchCreate) as typeof WriteBatch.prototype.create;
  WriteBatch.prototype.set = countWrite(originals.batchSet) as typeof WriteBatch.prototype.set;
  WriteBatch.prototype.update = countWrite(originals.batchUpdate) as typeof WriteBatch.prototype.update;
  WriteBatch.prototype.delete = countWrite(originals.batchDelete) as typeof WriteBatch.prototype.delete;
  try {
    return { result: await work(), reads, writes };
  } finally {
    DocumentReference.prototype.get = originals.documentGet; Query.prototype.get = originals.queryGet;
    DocumentReference.prototype.create = originals.documentCreate; DocumentReference.prototype.set = originals.documentSet;
    DocumentReference.prototype.update = originals.documentUpdate; DocumentReference.prototype.delete = originals.documentDelete;
    Transaction.prototype.get = originals.transactionGet; Transaction.prototype.getAll = originals.transactionGetAll;
    Transaction.prototype.create = originals.transactionCreate; Transaction.prototype.set = originals.transactionSet;
    Transaction.prototype.update = originals.transactionUpdate; Transaction.prototype.delete = originals.transactionDelete;
    WriteBatch.prototype.create = originals.batchCreate; WriteBatch.prototype.set = originals.batchSet;
    WriteBatch.prototype.update = originals.batchUpdate; WriteBatch.prototype.delete = originals.batchDelete;
  }
}

run("V2 monitoring Firestore budget", () => {
  afterEach(() => {
    setV2LiveInferenceForTests(null);
    resetMonitoringRuntime();
    resetV2LiveMemory();
  });

  it("does not query Work Orders for an ordinary frame when no verification collector is active", async () => {
    const originalGet = Query.prototype.get;
    let reads = 0;
    Query.prototype.get = function (...args: Parameters<Query["get"]>) {
      reads += 1;
      return originalGet.apply(this, args);
    };

    try {
      const suffix = randomUUID();
      const applied = await recordV2CameraVerificationObservation(
        `quota-site-${suffix}`,
        `quota-camera-${suffix}`,
        {
          sampleId: `quota-sample-${suffix}`,
          capturedAtMs: Date.now(),
          peopleCount: 0,
          people: [],
          bins: [],
          issues: [],
          binStates: [],
          modelVersions: {},
          isSimulation: true,
        },
      );

      expect(applied).toBe(0);
      expect(reads).toBe(0);
    } finally {
      Query.prototype.get = originalGet;
    }
  });

  it("serves repeated live configuration reads from the Site snapshot", async () => {
    const siteId = `quota-config-${randomUUID()}`;
    invalidateSiteCameraConfiguration(siteId);
    await getLiveCameraConfiguration(siteId);
    const originalDocumentGet = DocumentReference.prototype.get;
    const originalQueryGet = Query.prototype.get;
    let reads = 0;
    DocumentReference.prototype.get = function (...args: Parameters<DocumentReference["get"]>) { reads += 1; return originalDocumentGet.apply(this, args); };
    Query.prototype.get = function (...args: Parameters<Query["get"]>) { reads += 1; return originalQueryGet.apply(this, args); };
    try {
      await getLiveCameraConfiguration(siteId);
      expect(reads).toBe(0);
    } finally {
      DocumentReference.prototype.get = originalDocumentGet;
      Query.prototype.get = originalQueryGet;
      invalidateSiteCameraConfiguration(siteId);
    }
  });

  it("uses no Firestore reads or writes for a warm ordinary monitoring sample", async () => {
    const suffix = randomUUID();
    const uid = `quota-root-${suffix}`; const email = `${uid}@example.test`; const password = "Quota-password-123!";
    const siteId = `quota-site-${suffix}`; const mapId = `quota-map-${suffix}`; const zoneId = `quota-zone-${suffix}`;
    const cameraId = `quota-camera-${suffix}`; const sourceId = `quota-source-${suffix}`; const registrationId = `quota-registration-${suffix}`;
    const referenceId = `quota-reference-${suffix}`; const storageKey = `test/${referenceId}.jpg`; const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const refs = [
      firestore.collection("userAccounts").doc(uid), firestore.collection("supervisors").doc(uid), firestore.collection("sites").doc(siteId),
      firestore.collection("siteMapRevisions").doc(mapId), firestore.collection("siteMapRevisions").doc(mapId).collection("cameraPlacements").doc(cameraId),
      firestore.collection("cameras").doc(cameraId), firestore.collection("mediaAssets").doc(referenceId), firestore.collection("cameraRegistrationRevisions").doc(registrationId),
      firestore.collection("monitoringSessions").doc(siteId), firestore.collection("cameraRuntimeStates").doc(cameraId),
    ];
    let episodeId = "";
    try {
      await firebaseAuth.createUser({ uid, email, password, displayName: "Quota Root" });
      await Promise.all([
        refs[0].set({ schemaVersion: 2, uid, role: "supervisor", siteId, profileId: uid, authority: "root", emailNormalized: email, displayName: "Quota Root", status: "active", revision: 1 }),
        refs[1].set({ schemaVersion: 2, uid, siteId, authority: "root", fullName: "Quota Root", status: "active", revision: 1 }),
        refs[2].set({ schemaVersion: 2, siteId, name: "Quota Site", status: "active", activeMapRevisionId: mapId, revision: 1 }),
        refs[3].set({ schemaVersion: 2, revisionId: mapId, siteId, revisionNumber: 1 }),
        refs[4].set({ schemaVersion: 2, siteId, cameraId, zoneId, zoneNameSnapshot: "Quota Zone", point: { xMeters: 1, yMeters: 1 } }),
        refs[5].set({ schemaVersion: 2, cameraId, siteId, name: "Quota Camera", status: "active", monitoringEnabled: true, activeSourceRevisionId: sourceId, activeRegistrationRevisionId: registrationId, sourceType: "looped_video", isSimulation: true, revision: 1 }),
        refs[6].set({ schemaVersion: 2, mediaId: referenceId, siteId, storageStatus: "available", storageKey, mimeType: "image/jpeg", originalFileName: "reference.jpg" }),
        refs[7].set({ schemaVersion: 2, registrationRevisionId: registrationId, siteId, cameraId, sourceRevisionId: sourceId, referenceMediaId: referenceId, walkableFloorPolygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], bins: [] }),
        writeMedia(storageKey, jpeg),
      ]);
      let spill = false;
      setV2LiveInferenceForTests(async () => ({ image: { width: 640, height: 480 }, focusRegion: [], peopleCount: 0, people: [], bins: [], floorHazards: spill ? [{ className: "floor_spill", confidence: 0.9, bbox: { x1: 1, y1: 1, x2: 2, y2: 2 }, polygon: [] }] : [], modelVersions: {}, processingTimeMs: 1 } as any));
      const signIn = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=x`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
      const token = String((await signIn.json() as { idToken: string }).idToken);
      const claim = await request(app).post("/api/monitoring/sessions/claim").set("Authorization", `Bearer ${token}`).send({});
      expect(claim.status).toBe(201);
      const started = await request(app).post(`/api/monitoring/sessions/${claim.body.sessionId}/cameras/${cameraId}/start`).set("Authorization", `Bearer ${token}`).set("x-monitoring-token", claim.body.leaseToken).send({});
      expect(started.status).toBe(201); episodeId = started.body.episodeId;
      const sendSample = (sequence: number) => request(app).post(`/api/monitoring/sessions/${claim.body.sessionId}/cameras/${cameraId}/samples`).set("Authorization", `Bearer ${token}`).set("x-monitoring-token", claim.body.leaseToken).field("episodeId", episodeId).field("sequence", String(sequence)).field("capturedAt", new Date().toISOString()).attach("frame", jpeg, { filename: "frame.jpg", contentType: "image/jpeg" });
      expect((await sendSample(1)).status).toBe(200);

      const heartbeat = await measureFirestoreOperations(() => request(app).post(`/api/monitoring/sessions/${claim.body.sessionId}/heartbeat`).set("Authorization", `Bearer ${token}`).set("x-monitoring-token", claim.body.leaseToken).send({}));
      expect(heartbeat.result.status).toBe(200);
      expect({ reads: heartbeat.reads, writes: heartbeat.writes }).toEqual({ reads: 0, writes: 0 });

      const ordinary = await measureFirestoreOperations(() => sendSample(2));
      expect(ordinary.result.status).toBe(200);
      expect({ reads: ordinary.reads, writes: ordinary.writes }).toEqual({ reads: 0, writes: 0 });

      spill = true;
      expect((await sendSample(3)).status).toBe(200);
      const continuing = await measureFirestoreOperations(() => sendSample(4));
      expect(continuing.result.status).toBe(200);
      expect({ reads: continuing.reads, writes: continuing.writes }).toEqual({ reads: 0, writes: 0 });
    } finally {
      if (episodeId) refs.push(firestore.collection("monitoringEpisodes").doc(episodeId));
      await Promise.all(refs.map((ref) => ref.delete().catch(() => undefined)));
      for (const collection of ["flags", "alerts", "activeAlertKeys", "orchestratorOutbox", "mediaAssets"]) {
        const documents = await firestore.collection(collection).where("siteId", "==", siteId).get().catch(() => null);
        if (documents) await Promise.all(documents.docs.map((document) => firestore.recursiveDelete(document.ref).catch(() => undefined)));
      }
      await firebaseAuth.deleteUser(uid).catch(() => undefined);
    }
  });
});
