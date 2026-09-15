import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, collection, query, where, orderBy, onSnapshot, doc, getDoc, setDoc, terminate } from "firebase/firestore";
import { app } from "./app.js";
import { firebaseAuth, firestore } from "./config/firebase.js";
import { env } from "./config/env.js";
import { writeNotification, listNotifications } from "./services/notificationService.js";
import { updateSiteStatus } from "./services/superadminService.js";
import { reconcileSiteOperation, recoverSiteOperations } from "./services/siteOperationService.js";
import { recordSystemEvent } from "./services/systemService.js";

const run = process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST ? describe : describe.skip;

run("platform operations", () => {
  const suffix = randomUUID();
  const siteId = `ops-site-${suffix}`;
  const uid = `ops-root-${suffix}`;
  const email = `${uid}@example.test`;
  const regularUid = `ops-regular-${suffix}`;
  const regularEmail = `${regularUid}@example.test`;
  const password = "ops-test-password-123";
  const sdk = initializeApp({ projectId: env.firebaseProjectId, apiKey: "emulator-key" }, `ops-${suffix}`);
  const regularSdk = initializeApp({ projectId: env.firebaseProjectId, apiKey: "emulator-key" }, `ops-regular-${suffix}`);
  const auth = getAuth(sdk);
  const regularAuth = getAuth(regularSdk);
  const db = getFirestore(sdk, env.firebaseDatabaseId);
  let token = "";
  let regularToken = "";
  const notification = {
    siteId, recipientUid: uid, recipientRole: "supervisor" as const, type: "assignment_failed", eventKey: "test-event",
    title: "Assignment needs attention", body: "No Cleaner available", entityType: "orchestrator_run" as const, entityId: "test-run",
    cameraId: null, alertId: null, workOrderId: null, severity: null, isSimulation: true,
  };
  beforeAll(async () => {
    await Promise.all([
      firebaseAuth.createUser({ uid, email, password }),
      firebaseAuth.createUser({ uid: regularUid, email: regularEmail, password }),
    ]);
    await firestore.collection("sites").doc(siteId).set({ schemaVersion: 2, siteId, name: "Operations Site", status: "active", revision: 1 });
    await firestore.collection("userAccounts").doc(uid).set({ schemaVersion: 2, uid, profileId: uid, role: "supervisor", authority: "root", siteId, status: "active" });
    await firestore.collection("supervisors").doc(uid).set({ schemaVersion: 2, uid, siteId, authority: "root", status: "active" });
    await firestore.collection("userAccounts").doc(regularUid).set({ schemaVersion: 2, uid: regularUid, profileId: regularUid, role: "supervisor", authority: "regular", siteId, status: "active" });
    await firestore.collection("supervisors").doc(regularUid).set({ schemaVersion: 2, uid: regularUid, siteId, authority: "regular", fullName: "Regular Supervisor", status: "active" });
    await firestore.collection("orchestratorConfigs").doc(siteId).set({ schemaVersion: 2, siteId, status: "running", assignmentEnabled: true, reviewEnabled: true });
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(":");
    connectFirestoreEmulator(db, host, Number(port));
    connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
    connectAuthEmulator(regularAuth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
    const credential = await signInWithEmailAndPassword(auth, email, password);
    token = await credential.user.getIdToken();
    const regularCredential = await signInWithEmailAndPassword(regularAuth, regularEmail, password);
    regularToken = await regularCredential.user.getIdToken();
  });
  afterAll(async () => { await terminate(db); await Promise.all([deleteApp(sdk), deleteApp(regularSdk)]); await Promise.all([firebaseAuth.deleteUser(uid), firebaseAuth.deleteUser(regularUid)]); });

  it("delivers an immutable event to the client listener and reloads the persisted inbox", async () => {
    let unsubscribe = () => {};
    let timeout: ReturnType<typeof setTimeout>;
    const ready = new Promise<void>((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("No notification delivered")), 5000);
      unsubscribe = onSnapshot(query(collection(db, "notifications"), where("recipientUid", "==", uid), where("siteId", "==", siteId), orderBy("createdAt", "desc")), snapshot => {
        if (snapshot.docs.some(item => item.data().title === notification.title)) resolve();
      }, reject);
    });
    let id = "";
    try { id = await writeNotification(notification); await ready; }
    finally { clearTimeout(timeout!); unsubscribe(); }
    await writeNotification({ ...notification, title: "Must not overwrite" });
    const persisted = await getDoc(doc(db, "notifications", id));
    expect(persisted.data()?.title).toBe(notification.title);
    expect(await listNotifications(siteId, uid)).toHaveLength(1);
    const inbox = await request(app).get("/api/operations/v2/notifications").set("Authorization", `Bearer ${token}`);
    expect(inbox.status).toBe(200);
    expect(inbox.body.notifications[0].createdAt).toEqual(expect.any(String));
    await expect(setDoc(doc(db, "notifications", id), { title: "forged" })).rejects.toMatchObject({ code: "permission-denied" });
    const other = await writeNotification({ ...notification, recipientUid: "other-user", eventKey: "other" });
    await expect(getDoc(doc(db, "notifications", other))).rejects.toMatchObject({ code: "permission-denied" });
    await firestore.collection("sites").doc(`${siteId}-other`).set({ status: "active" });
    const crossSite = await writeNotification({ ...notification, siteId: `${siteId}-other`, eventKey: "cross-site" });
    await expect(getDoc(doc(db, "notifications", crossSite))).rejects.toMatchObject({ code: "permission-denied" });
    await firestore.collection("userAccounts").doc(uid).update({ status: "inactive" });
    await expect(getDoc(doc(db, "notifications", id))).rejects.toMatchObject({ code: "permission-denied" });
    await firestore.collection("userAccounts").doc(uid).update({ status: "active" });
  });

  it("reconciles deactivation, closes Work and Alerts, releases Cleaners and preserves history on reactivation", async () => {
    const workId = `ops-work-${suffix}`, alertId = `ops-alert-${suffix}`, cleanerId = `ops-cleaner-${suffix}`;
    const seed = async (name: string, id: string, data: object) => firestore.collection(name).doc(id).set({ schemaVersion: 2, siteId, ...data });
    await seed("cleaners", cleanerId, { authUid: uid, activeWorkOrderId: workId, revision: 1, lastResolvedWorkOrderId: "prior-resolved" });
    await seed("workOrders", workId, { status: "in_progress", assignedCleanerId: cleanerId, alertId, revision: 1 });
    await seed("alerts", alertId, { status: "in_progress", activeWorkOrderId: workId, revision: 1 });
    await seed("orchestratorRuns", `ops-run-${suffix}`, { status: "running" });
    await seed("orchestratorOutbox", `ops-trigger-${suffix}`, { status: "pending" });
    await seed("activeAlertKeys", `ops-key-${suffix}`, { alertId });
    await seed("monitoringSessions", siteId, { status: "active" });
    const actor = { uid: "test-superadmin", role: "superadmin" as const, displayName: "Superadmin" };
    const result = await updateSiteStatus(siteId, "inactive", "testing", actor, suffix);
    for (let i = 0; i < 15; i++) {
      if ((await reconcileSiteOperation(siteId, result.operationId)).status === "completed") break;
    }
    expect((await firestore.collection("workOrders").doc(workId).get()).data()?.status).toBe("dismissed");
    expect((await firestore.collection("alerts").doc(alertId).get()).data()?.status).toBe("dismissed");
    expect((await firestore.collection("cleaners").doc(cleanerId).get()).data()).toMatchObject({ activeWorkOrderId: null, lastResolvedWorkOrderId: "prior-resolved" });
    expect((await firestore.collection("orchestratorRuns").doc(`ops-run-${suffix}`).get()).data()?.status).toBe("cancelled");
    expect((await firestore.collection("activeAlertKeys").doc(`ops-key-${suffix}`).get()).exists).toBe(false);
    expect((await request(app).get("/api/me").set("Authorization", `Bearer ${token}`)).status).toBe(403);
    const inbox = await listNotifications(siteId, uid);
    await expect(getDoc(doc(db, "notifications", inbox[0].id))).rejects.toMatchObject({ code: "permission-denied" });
    await updateSiteStatus(siteId, "active", "testing complete", actor, suffix);
    expect((await firestore.collection("workOrders").doc(workId).get()).data()?.status).toBe("dismissed");
    expect((await firestore.collection("workOrders").doc(workId).collection("events").get()).size).toBe(1);
    const audit = await request(app).get("/api/operations/v2/audit-events").query({ siteId: "other-site" }).set("Authorization", `Bearer ${token}`);
    expect(audit.status).toBe(200);
    expect(audit.body.events.every((event: any) => event.siteId === siteId)).toBe(true);
    expect(JSON.stringify(audit.body)).not.toContain(password);
    const system = await request(app).get("/api/operations/v2/system").set("Authorization", `Bearer ${token}`);
    expect(system.status).toBe(200);
    expect(system.body.configuration.status).toBe("paused");
  });

  it("refuses reactivation until a paged cleanup finishes and resumes safely", async () => {
    const site = `${siteId}-paged`, opId = `paged-${suffix}`;
    await firestore.collection("sites").doc(site).set({ schemaVersion: 2, siteId: site, status: "inactive", deactivationOperationId: opId, revision: 1 });
    await firestore.collection("siteOperations").doc(opId).set({ schemaVersion: 2, siteId: site, operationId: opId, type: "deactivate", status: "pending", cursorState: {}, counts: {} });
    for (let i = 0; i < 3; i++) await firestore.collection("alerts").doc(`${opId}-${i}`).set({ schemaVersion: 2, siteId: site, status: "waiting_for_cleaner", revision: 1 });
    const actor = { uid: "test-superadmin", role: "superadmin" as const, displayName: "Superadmin" };
    await expect(updateSiteStatus(site, "active", "too early", actor, suffix)).rejects.toMatchObject({ status: 409 });
    for (let i = 0; i < 30; i++) {
      if ((await reconcileSiteOperation(site, opId, 1)).status === "completed") break;
    }
    const finished = await reconcileSiteOperation(site, opId, 1);
    expect(finished.status).toBe("completed");
    expect(finished.counts.alerts).toBe(3);
    await updateSiteStatus(site, "active", "finished", actor, suffix);
    const alerts = await firestore.collection("alerts").where("siteId", "==", site).get();
    expect(alerts.docs.every(doc => doc.data().status === "dismissed")).toBe(true);
  });

  it("marks an invalid recovery operation failed instead of retrying it forever", async () => {
    const site = `${siteId}-invalid-recovery`, operationId = `invalid-recovery-${suffix}`;
    await firestore.collection("sites").doc(site).set({ schemaVersion: 2, siteId: site, status: "inactive", deactivationOperationId: operationId });
    const reference = firestore.collection("siteOperations").doc(operationId);
    await reference.set({ schemaVersion: 2, siteId: site, operationId, type: "deactivate", status: "pending", cursorState: { stage: 999 }, counts: {} });
    await recoverSiteOperations();
    expect((await reference.get()).data()).toMatchObject({ status: "failed", lastErrorCode: "reconciliation_failed" });
    expect(await recoverSiteOperations()).toBe(0);
  });

  it("aggregates safe System events and records recovery", async () => {
    await recordSystemEvent(siteId, "assignment_failed");
    await recordSystemEvent(siteId, "assignment_failed");
    await recordSystemEvent(siteId, "assignment_failed", true);
    const result = await request(app).get("/api/operations/v2/system").set("Authorization", `Bearer ${token}`);
    expect(result.status).toBe(200);
    expect(result.body.events).toEqual(expect.arrayContaining([expect.objectContaining({ code: "assignment_failed", status: "recovered", occurrenceCount: 2 })]));
  });

  it("returns a bounded operational view to a Regular Supervisor", async () => {
    const alertId = `system-alert-${suffix}`;
    const cleanerId = `system-cleaner-${suffix}`;
    const workOrderId = `system-work-${suffix}`;
    const runId = `system-run-${suffix}`;
    const noOpRunId = `system-no-op-run-${suffix}`;
    await firestore.collection("orchestratorConfigs").doc(siteId).update({ status: "running", revision: 10 });
    const paused = await request(app).post("/api/orchestrator/v2/status")
      .set("Authorization", `Bearer ${regularToken}`)
      .send({ status: "paused", reason: "Testing the safe System view" });
    expect(paused.status).toBe(200);
    await firestore.collection("alerts").doc(alertId).set({ schemaVersion: 2, siteId, status: "waiting_for_cleaner" });
    await firestore.collection("workOrders").doc(workOrderId).set({ schemaVersion: 2, siteId, status: "awaiting_review" });
    await firestore.collection("orchestratorRuns").doc(runId).set({
      schemaVersion: 2,
      runId,
      siteId,
      type: "assignment",
      status: "succeeded",
      selectedAlertId: alertId,
      selectedCleanerId: cleanerId,
      workOrderId,
      providerRequestCount: 2,
      candidateAttemptCount: 1,
      toolCallCount: 2,
      inputSnapshot: {
        alerts: [{ alertId, issueType: "floor_litter", observedCondition: "litter", severity: "warning", zoneId: "zone-1", zoneName: "Main Entrance", cameraId: "camera-1", cameraName: "Entrance Camera" }],
        cleaners: [{ cleanerId, fullName: "Aina Rahman" }],
      },
      commandResult: { workOrder: { id: workOrderId, title: "Clean floor litter at Entrance Camera, Main Entrance", status: "assigned", target: { type: "camera" } } },
      createdAt: new Date(),
      completedAt: new Date(),
    });
    await firestore.collection("orchestratorRuns").doc(noOpRunId).set({
      schemaVersion: 2,
      runId: noOpRunId,
      siteId,
      type: "assignment",
      status: "exhausted",
      resultCode: "no_waiting_alerts",
      providerRequestCount: 0,
      candidateAttemptCount: 0,
      toolCallCount: 1,
      createdAt: new Date(),
      completedAt: new Date(),
    });

    const result = await request(app).get("/api/operations/v2/system").set("Authorization", `Bearer ${regularToken}`);
    expect(result.status).toBe(200);
    expect(result.body.runtime.backlog).toEqual({ waitingAlertCount: 1, awaitingReviewWorkOrderCount: 1 });
    expect(result.body.controlHistory[0]).toMatchObject({ status: "paused", actorUid: regularUid, actorNameSnapshot: "Regular Supervisor", reason: "Testing the safe System view" });
    expect(result.body.recentRuns).toEqual(expect.arrayContaining([expect.objectContaining({
      id: runId,
      retryCount: 1,
      references: {
        alert: expect.objectContaining({ id: alertId, zoneName: "Main Entrance", cameraName: "Entrance Camera" }),
        cleaner: { id: cleanerId, name: "Aina Rahman" },
        workOrder: expect.objectContaining({ id: workOrderId, title: "Clean floor litter at Entrance Camera, Main Entrance" }),
      },
    })]));
    expect(result.body.recentRuns).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: noOpRunId })]));
  });
});
