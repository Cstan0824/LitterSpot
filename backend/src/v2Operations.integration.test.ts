import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, collection, query, where, orderBy, onSnapshot, doc, getDoc, setDoc, terminate } from "firebase/firestore";
import { app } from "./app.js";
import { firebaseAuth, firestore } from "./config/firebase.js";
import { env } from "./config/env.js";
import { writeV2Notification, listV2Notifications } from "./services/v2NotificationService.js";
import { updateV2SiteStatus } from "./services/v2SuperadminService.js";
import { reconcileV2SiteOperation } from "./services/v2SiteOperationService.js";
import { recordV2SystemEvent } from "./services/v2SystemService.js";

const run = process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST ? describe : describe.skip;

run("V2 platform operations", () => {
  const suffix = randomUUID();
  const siteId = `ops-site-${suffix}`;
  const uid = `ops-root-${suffix}`;
  const email = `${uid}@example.test`;
  const password = "ops-test-password-123";
  const sdk = initializeApp({ projectId: env.firebaseProjectId, apiKey: "emulator-key" }, `ops-${suffix}`);
  const auth = getAuth(sdk);
  const db = getFirestore(sdk, env.firebaseDatabaseId);
  let token = "";
  const notification = {
    siteId, recipientUid: uid, recipientRole: "supervisor" as const, type: "assignment_failed", eventKey: "test-event",
    title: "Assignment needs attention", body: "No Cleaner available", entityType: "orchestrator_run" as const, entityId: "test-run",
    cameraId: null, alertId: null, workOrderId: null, severity: null, isSimulation: true,
  };
  beforeAll(async () => {
    await firebaseAuth.createUser({ uid, email, password });
    await firestore.collection("sites").doc(siteId).set({ schemaVersion: 2, siteId, name: "Operations Site", status: "active", revision: 1 });
    await firestore.collection("userAccounts").doc(uid).set({ schemaVersion: 2, uid, profileId: uid, role: "supervisor", authority: "root", siteId, status: "active" });
    await firestore.collection("supervisors").doc(uid).set({ schemaVersion: 2, uid, siteId, authority: "root", status: "active" });
    await firestore.collection("orchestratorConfigs").doc(siteId).set({ schemaVersion: 2, siteId, status: "running", assignmentEnabled: true, reviewEnabled: true });
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(":");
    connectFirestoreEmulator(db, host, Number(port));
    connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
    const credential = await signInWithEmailAndPassword(auth, email, password);
    token = await credential.user.getIdToken();
  });
  afterAll(async () => { await terminate(db); await deleteApp(sdk); await firebaseAuth.deleteUser(uid); });

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
    try { id = await writeV2Notification(notification); await ready; }
    finally { clearTimeout(timeout!); unsubscribe(); }
    await writeV2Notification({ ...notification, title: "Must not overwrite" });
    const persisted = await getDoc(doc(db, "notifications", id));
    expect(persisted.data()?.title).toBe(notification.title);
    expect(await listV2Notifications(siteId, uid)).toHaveLength(1);
    const inbox = await request(app).get("/api/operations/v2/notifications").set("Authorization", `Bearer ${token}`);
    expect(inbox.status).toBe(200);
    expect(inbox.body.notifications[0].createdAt).toEqual(expect.any(String));
    await expect(setDoc(doc(db, "notifications", id), { title: "forged" })).rejects.toMatchObject({ code: "permission-denied" });
    const other = await writeV2Notification({ ...notification, recipientUid: "other-user", eventKey: "other" });
    await expect(getDoc(doc(db, "notifications", other))).rejects.toMatchObject({ code: "permission-denied" });
    await firestore.collection("sites").doc(`${siteId}-other`).set({ status: "active" });
    const crossSite = await writeV2Notification({ ...notification, siteId: `${siteId}-other`, eventKey: "cross-site" });
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
    const result = await updateV2SiteStatus(siteId, "inactive", "testing", actor, suffix);
    for (let i = 0; i < 15; i++) {
      if ((await reconcileV2SiteOperation(siteId, result.operationId)).status === "completed") break;
    }
    expect((await firestore.collection("workOrders").doc(workId).get()).data()?.status).toBe("dismissed");
    expect((await firestore.collection("alerts").doc(alertId).get()).data()?.status).toBe("dismissed");
    expect((await firestore.collection("cleaners").doc(cleanerId).get()).data()).toMatchObject({ activeWorkOrderId: null, lastResolvedWorkOrderId: "prior-resolved" });
    expect((await firestore.collection("orchestratorRuns").doc(`ops-run-${suffix}`).get()).data()?.status).toBe("cancelled");
    expect((await firestore.collection("activeAlertKeys").doc(`ops-key-${suffix}`).get()).exists).toBe(false);
    expect((await request(app).get("/api/me").set("Authorization", `Bearer ${token}`)).status).toBe(403);
    const inbox = await listV2Notifications(siteId, uid);
    await expect(getDoc(doc(db, "notifications", inbox[0].id))).rejects.toMatchObject({ code: "permission-denied" });
    await updateV2SiteStatus(siteId, "active", "testing complete", actor, suffix);
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
    await expect(updateV2SiteStatus(site, "active", "too early", actor, suffix)).rejects.toMatchObject({ status: 409 });
    for (let i = 0; i < 30; i++) {
      if ((await reconcileV2SiteOperation(site, opId, 1)).status === "completed") break;
    }
    const finished = await reconcileV2SiteOperation(site, opId, 1);
    expect(finished.status).toBe("completed");
    expect(finished.counts.alerts).toBe(3);
    await updateV2SiteStatus(site, "active", "finished", actor, suffix);
    const alerts = await firestore.collection("alerts").where("siteId", "==", site).get();
    expect(alerts.docs.every(doc => doc.data().status === "dismissed")).toBe(true);
  });

  it("aggregates safe System events and records recovery", async () => {
    await recordV2SystemEvent(siteId, "assignment_failed");
    await recordV2SystemEvent(siteId, "assignment_failed");
    await recordV2SystemEvent(siteId, "assignment_failed", true);
    const result = await request(app).get("/api/operations/v2/system").set("Authorization", `Bearer ${token}`);
    expect(result.status).toBe(200);
    expect(result.body.events).toEqual(expect.arrayContaining([expect.objectContaining({ code: "assignment_failed", status: "recovered", occurrenceCount: 2 })]));
  });
});
