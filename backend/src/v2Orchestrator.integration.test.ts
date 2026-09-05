import { randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "./app.js";
import { firebaseAuth, firestore } from "./config/firebase.js";
import {
  getV2AssignmentContext,
  runV2AssignmentCycle,
  createV2AssignmentRun,
  getV2AssignmentContextTool,
  assignV2CleanerByIdsTool,
  recoverV2OrchestratorRuns,
  runV2ReviewCycle,
  createV2ReviewRun,
  resolveV2VerifiedWork,
  requestV2Rework,
} from "./services/v2OrchestratorService.js";
import { createV2AlertWorkOrder, transitionV2WorkOrder, recordV2CameraVerificationObservation } from "./services/v2WorkOrderService.js";
import type { AssignmentSelector } from "./services/v2OrchestratorProvider.js";
import { enqueueV2ImmediateAssignmentTrigger } from "./services/v2OrchestratorTriggers.js";
import { processV2OrchestratorTriggers } from "./services/v2OrchestratorWorker.js";

const run = process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const allDay = { mon: { startMinute: 0, endMinute: 0 }, tue: { startMinute: 0, endMinute: 0 }, wed: { startMinute: 0, endMinute: 0 }, thu: { startMinute: 0, endMinute: 0 }, fri: { startMinute: 0, endMinute: 0 }, sat: { startMinute: 0, endMinute: 0 }, sun: { startMinute: 0, endMinute: 0 } };

async function seedScenario(options: { cleanerUnavailable?: boolean; recentMapMismatch?: boolean } = {}) {
  const suffix = randomUUID();
  const siteId = `orchestrator-site-${suffix}`;
  const mapId = `orchestrator-map-${suffix}`;
  const zoneId = `orchestrator-zone-${suffix}`;
  const supervisorUid = `orchestrator-supervisor-${suffix}`;
  const cleanerIds = [`orchestrator-cleaner-a-${suffix}`, `orchestrator-cleaner-b-${suffix}`];
  const cleanerUids = [`orchestrator-cleaner-auth-a-${suffix}`, `orchestrator-cleaner-auth-b-${suffix}`];
  const cameraIds = [`orchestrator-camera-a-${suffix}`, `orchestrator-camera-b-${suffix}`];
  const alertIds = [`orchestrator-alert-a-${suffix}`, `orchestrator-alert-b-${suffix}`];
  const now = new Date("2026-08-30T12:00:00.000Z");

  await firestore.collection("sites").doc(siteId).set({ schemaVersion: 2, siteId, name: "Orchestrator Test Site", timeZone: "Asia/Kuala_Lumpur", status: "active", activeMapRevisionId: mapId, revision: 1 });
  await firestore.collection("supervisors").doc(supervisorUid).set({ schemaVersion: 2, uid: supervisorUid, siteId, authority: "root", fullName: "Test Supervisor", status: "active", revision: 1 });
  await firestore.collection("orchestratorConfigs").doc(siteId).set({ schemaVersion: 2, siteId, status: "running", assignmentEnabled: true, reviewEnabled: true, provider: "fake", model: "fake-pair-model", assignmentPolicyVersion: "assignment-v2", reviewPolicyVersion: "review-v2", technicalRetryLimit: 3, technicalRetryDelaysMs: [1000, 2000, 4000], requestTimeoutMs: 1000, lastRunAt: null, lastSuccessfulRunAt: null, lastFailureAt: null, lastFailureCode: null, revision: 1 });
  const map = firestore.collection("siteMapRevisions").doc(mapId);
  await map.set({ schemaVersion: 2, revisionId: mapId, siteId, revisionNumber: 1, widthMeters: 100, heightMeters: 100 });
  await map.collection("zoneGeometry").doc(zoneId).set({ schemaVersion: 2, siteId, zoneId, zoneNameSnapshot: "Main Zone", polygon: [{ xMeters: 0, yMeters: 0 }, { xMeters: 100, yMeters: 0 }, { xMeters: 100, yMeters: 100 }, { xMeters: 0, yMeters: 100 }] });

  for (let index = 0; index < cleanerIds.length; index += 1) {
    await firebaseAuth.createUser({ uid: cleanerUids[index], email: `${cleanerUids[index]}@example.test`, password: "Orchestrator-test-password-123!" });
    await firestore.collection("userAccounts").doc(cleanerUids[index]).set({ schemaVersion: 2, uid: cleanerUids[index], role: "cleaner", siteId, profileId: cleanerIds[index], status: "active" });
    await firestore.collection("cleaners").doc(cleanerIds[index]).set({
      schemaVersion: 2,
      cleanerId: cleanerIds[index],
      authUid: cleanerUids[index],
      siteId,
      fullName: `Cleaner ${index + 1}`,
      status: "active",
      availabilityOverride: options.cleanerUnavailable ? "unavailable" : "none",
      weeklySchedule: allDay,
      scheduleTimeZone: "Asia/Kuala_Lumpur",
      activeWorkOrderId: null,
      lastResolvedWorkOrderId: index === 0 ? `recent-work-${suffix}` : null,
      lastResolvedWorkTarget: index === 0 ? { type: "coordinate", mapRevisionId: mapId, zoneId, point: { xMeters: 78, yMeters: 80 } } : null,
      lastResolvedWorkAt: index === 0 ? Timestamp.fromMillis(now.getTime() - 2 * 60_000) : null,
      lastResolvedMapRevisionId: index === 0 ? options.recentMapMismatch ? `old-map-${suffix}` : mapId : null,
      revision: 1,
    });
    await map.collection("cleanerStations").doc(cleanerIds[index]).set({ schemaVersion: 2, siteId, cleanerId: cleanerIds[index], zoneId, point: index === 0 ? { xMeters: 5, yMeters: 5 } : { xMeters: 75, yMeters: 75 } });
  }

  for (let index = 0; index < alertIds.length; index += 1) {
    await firestore.collection("cameras").doc(cameraIds[index]).set({ schemaVersion: 2, cameraId: cameraIds[index], siteId, name: `Camera ${index + 1}`, status: "active" });
    await map.collection("cameraPlacements").doc(cameraIds[index]).set({ schemaVersion: 2, siteId, cameraId: cameraIds[index], zoneId, zoneNameSnapshot: "Main Zone", point: index === 0 ? { xMeters: 10, yMeters: 10 } : { xMeters: 80, yMeters: 80 } });
    await firestore.collection("alerts").doc(alertIds[index]).set({ schemaVersion: 2, alertId: alertIds[index], siteId, mapRevisionId: mapId, zoneId, zoneNameSnapshot: "Main Zone", cameraId: cameraIds[index], cameraNameSnapshot: `Camera ${index + 1}`, issueType: "floor_litter", observedCondition: "litter", status: "waiting_for_cleaner", severity: index === 0 ? "critical" : "warning", highestSeverity: index === 0 ? "critical" : "warning", priorityScore: index === 0 ? 100 : 30, activeWorkOrderId: null, managementMode: "orchestrated", isSimulation: false, createdAt: Timestamp.fromMillis(now.getTime() - (index === 0 ? 20 : 5) * 60_000), revision: 1 });
  }

  return { siteId, mapId, cleanerIds, cleanerUids, alertIds, now, supervisorUid };
}

run("V2 Orchestrator integration", () => {
  const internalHeaders = (workerId: string) => ({ "x-orchestrator-token": "emulator-orchestrator-token", "x-orchestrator-worker-id": workerId });

  it("builds pair context with Station and fresh recent Work distances", async () => {
    const scenario = await seedScenario();
    const context = await getV2AssignmentContext(scenario.siteId, { now: scenario.now });
    expect(context.alerts.map((alert) => alert.alertId)).toEqual(scenario.alertIds);
    expect(context.cleaners).toHaveLength(2);
    expect(context.eligiblePairs).toHaveLength(4);
    expect(context.cleaners[0].recentWorkLocation).toMatchObject({ strength: "strong", uncertainty: "returning_to_station" });
    const recentPair = context.eligiblePairs.find((pair) => pair.alertId === scenario.alertIds[1] && pair.cleanerId === scenario.cleanerIds[0]);
    expect(recentPair?.recentWorkDistanceMeters).toBeCloseTo(2, 5);
    await Promise.all(scenario.cleanerUids.map((uid) => firebaseAuth.deleteUser(uid).catch(() => undefined)));
  });

  it("ignores recent Work from another map revision", async () => {
    const scenario = await seedScenario({ recentMapMismatch: true });
    const context = await getV2AssignmentContext(scenario.siteId, { now: scenario.now });
    expect(context.cleaners[0].recentWorkLocation).toBeNull();
    expect(context.eligiblePairs.find((pair) => pair.cleanerId === scenario.cleanerIds[0])?.recentWorkDistanceMeters).toBeNull();
    await Promise.all(scenario.cleanerUids.map((uid) => firebaseAuth.deleteUser(uid).catch(() => undefined)));
  });

  it("lets the model choose both the Alert and Cleaner from the supplied pairs", async () => {
    const scenario = await seedScenario();
    await firestore.collection("alerts").doc(scenario.alertIds[1]).update({ isSimulation: true });
    const selector: AssignmentSelector = {
      async select() {
        return { alertId: scenario.alertIds[1], cleanerId: scenario.cleanerIds[0], rationaleSummary: "Recent Work places this Cleaner near the selected Alert.", provider: "fake", model: "fake-pair-model" };
      },
    };
    const result = await runV2AssignmentCycle(scenario.siteId, { selector, now: scenario.now, workerId: `worker-${randomUUID()}`, sleep: async () => undefined });
    expect(result.run).toMatchObject({ status: "succeeded", selectedAlertId: scenario.alertIds[1], selectedCleanerId: scenario.cleanerIds[0], resultCode: "assigned" });
    expect(result.run.references).toMatchObject({
      alert: { id: scenario.alertIds[1], zoneName: "Main Zone", cameraName: "Camera 2" },
      cleaner: { id: scenario.cleanerIds[0], name: "Cleaner 1" },
      workOrder: { id: result.run.workOrderId, status: "assigned", targetType: "camera" },
    });
    expect(result.run.isSimulation).toBe(true);
    expect(result.attempts[0].startedAt).toEqual(expect.any(String));
    expect((await firestore.collection("alerts").doc(scenario.alertIds[0]).get()).data()?.status).toBe("waiting_for_cleaner");
    expect((await firestore.collection("alerts").doc(scenario.alertIds[1]).get()).data()?.status).toBe("assigned");
    expect((await firestore.collection("workOrders").doc(String(result.run.workOrderId)).get()).data()).toMatchObject({ assignedCleanerId: scenario.cleanerIds[0], alertId: scenario.alertIds[1], managementMode: "orchestrated" });
    await Promise.all(scenario.cleanerUids.map((uid) => firebaseAuth.deleteUser(uid).catch(() => undefined)));
  });

  it("retries provider failures at 1, 2, and 4 seconds without deterministic fallback", async () => {
    const scenario = await seedScenario();
    const delays: number[] = [];
    let calls = 0;
    const selector: AssignmentSelector = { async select() { calls += 1; throw new Error("provider unavailable"); } };
    const result = await runV2AssignmentCycle(scenario.siteId, { selector, now: scenario.now, workerId: `worker-${randomUUID()}`, sleep: async (milliseconds) => { delays.push(milliseconds); } });
    expect(calls).toBe(4);
    expect(delays).toEqual([1000, 2000, 4000]);
    expect(result.run).toMatchObject({ status: "failed", resultCode: "provider_failed", errorCode: "provider_failed" });
    expect((await firestore.collection("workOrders").where("siteId", "==", scenario.siteId).get()).empty).toBe(true);
    expect((await firestore.collection("notifications").where("siteId", "==", scenario.siteId).get()).docs.some((document) => document.data().type === "assignment_failed")).toBe(true);
    expect((await firestore.collection("systemEvents").where("siteId", "==", scenario.siteId).get()).docs.some((document) => document.data().code === "orchestrator_provider_unavailable")).toBe(true);
    await Promise.all(scenario.cleanerUids.map((uid) => firebaseAuth.deleteUser(uid).catch(() => undefined)));
  });

  it("excludes a Cleaner after a reservation conflict and asks the model again", async () => {
    const scenario = await seedScenario();
    let calls = 0;
    const selector: AssignmentSelector = {
      async select(context: any) {
        calls += 1;
        if (calls === 1) {
          await firestore.collection("cleaners").doc(scenario.cleanerIds[0]).update({ activeWorkOrderId: `concurrent-work-${randomUUID()}` });
          return { alertId: scenario.alertIds[0], cleanerId: scenario.cleanerIds[0], rationaleSummary: "First valid pair.", provider: "fake", model: "fake-pair-model" };
        }
        expect(context.cleaners.map((cleaner: { cleanerId: string }) => cleaner.cleanerId)).not.toContain(scenario.cleanerIds[0]);
        return { alertId: scenario.alertIds[0], cleanerId: scenario.cleanerIds[1], rationaleSummary: "Retry with the remaining available Cleaner.", provider: "fake", model: "fake-pair-model" };
      },
    };
    const result = await runV2AssignmentCycle(scenario.siteId, { selector, now: scenario.now, workerId: `worker-${randomUUID()}`, sleep: async () => undefined });
    expect(calls).toBe(2);
    expect(result.run).toMatchObject({ status: "succeeded", selectedCleanerId: scenario.cleanerIds[1], candidateAttemptCount: 2 });
    expect((result.attempts as Array<Record<string, any>>).filter((attempt) => attempt.kind === "cleaner_reservation").map((attempt) => attempt.outcome)).toEqual(["reservation_conflict", "reserved"]);
    await Promise.all(scenario.cleanerUids.map((uid) => firebaseAuth.deleteUser(uid).catch(() => undefined)));
  });

  it("leaves Alerts waiting when no Cleaner is available", async () => {
    const scenario = await seedScenario({ cleanerUnavailable: true });
    const selector: AssignmentSelector = { async select() { throw new Error("selector must not run"); } };
    const result = await runV2AssignmentCycle(scenario.siteId, { selector, now: scenario.now, workerId: `worker-${randomUUID()}` });
    expect(result.run).toMatchObject({ status: "exhausted", resultCode: "no_candidates" });
    expect((await firestore.collection("alerts").doc(scenario.alertIds[0]).get()).data()?.status).toBe("waiting_for_cleaner");
    expect((await firestore.collection("workOrders").where("siteId", "==", scenario.siteId).get()).empty).toBe(true);
    expect((await firestore.collection("systemEvents").where("siteId", "==", scenario.siteId).get()).docs.some((document) => document.data().code === "orchestrator_no_available_cleaner")).toBe(true);
    await Promise.all(scenario.cleanerUids.map((uid) => firebaseAuth.deleteUser(uid).catch(() => undefined)));
  });

  it("exhausts invalid model selections without retaining the last invalid decision", async () => {
    const scenario = await seedScenario();
    let calls = 0;
    const selector: AssignmentSelector = { async select() { calls++; return { alertId: "invented-alert", cleanerId: "invented-cleaner", rationaleSummary: "Invalid", provider: "fake", model: "fake" }; } };
    const result = await runV2AssignmentCycle(scenario.siteId, { selector, now: scenario.now, sleep: async () => undefined });
    expect(calls).toBe(4);
    expect(result.run).toMatchObject({ status: "failed", resultCode: "provider_failed", selectedCleanerId: null });
    expect((await firestore.collection("systemEvents").where("siteId", "==", scenario.siteId).get()).docs.some((document) => document.data().code === "orchestrator_invalid_selection")).toBe(true);
    expect((await firestore.collection("workOrders").where("siteId", "==", scenario.siteId).get()).empty).toBe(true);
    await Promise.all(scenario.cleanerUids.map(uid => firebaseAuth.deleteUser(uid)));
  });

  it("exposes assignment only through a leased Node-controlled run", async () => {
    const scenario = await seedScenario();
    const workerId = `external-worker-${randomUUID()}`;
    const created = await request(app).post("/internal/orchestrator/v2/assignment-runs").set(internalHeaders(workerId)).send({ siteId: scenario.siteId, triggerType: "integration_test" });
    expect(created.status).toBe(201);
    const context = await request(app).get(`/internal/orchestrator/v2/runs/${created.body.runId}/assignment-context`).query({ siteId: scenario.siteId }).set(internalHeaders(workerId));
    expect(context.status).toBe(200);
    expect(context.body.context.eligiblePairs).toHaveLength(4);
    const assigned = await request(app).post(`/internal/orchestrator/v2/runs/${created.body.runId}/assign-cleaner`).set(internalHeaders(workerId)).send({ siteId: scenario.siteId, alertId: scenario.alertIds[0], cleanerId: scenario.cleanerIds[1], rationaleSummary: "Critical Alert selected with an available Cleaner." });
    expect(assigned.status).toBe(201);
    expect(assigned.body.workOrder).toMatchObject({ alertId: scenario.alertIds[0], assignedCleanerId: scenario.cleanerIds[1], managementMode: "orchestrated" });
    const runDetails = await firestore.collection("orchestratorRuns").doc(created.body.runId).get();
    expect(runDetails.data()).toMatchObject({ status: "succeeded", selectedAlertId: scenario.alertIds[0], selectedCleanerId: scenario.cleanerIds[1] });
    await Promise.all(scenario.cleanerUids.map((uid) => firebaseAuth.deleteUser(uid).catch(() => undefined)));
  });

  it("consumes a durable outbox trigger and runs assignment automatically", async () => {
    const scenario = await seedScenario();
    const selector: AssignmentSelector = { async select() { return { alertId: scenario.alertIds[0], cleanerId: scenario.cleanerIds[0], rationaleSummary: "Automatic outbox assignment.", provider: "fake", model: "fake-pair-model" }; } };
    const eventId = await enqueueV2ImmediateAssignmentTrigger(scenario.siteId, "integration_trigger", `integration:${randomUUID()}`);
    expect(await processV2OrchestratorTriggers(10, { selector, sleep: async () => undefined, now: scenario.now, scheduleScan: false })).toBeGreaterThan(0);
    expect((await firestore.collection("orchestratorOutbox").doc(eventId).get()).data()?.status).toBe("completed");
    expect((await firestore.collection("alerts").doc(scenario.alertIds[0]).get()).data()?.status).toBe("assigned");
    await Promise.all(scenario.cleanerUids.map((uid) => firebaseAuth.deleteUser(uid).catch(() => undefined)));
  });

  it("uses the deterministic review tools and records the recent resolved Work target", async () => {
    const scenario = await seedScenario();
    const selector: AssignmentSelector = { async select() { return { alertId: scenario.alertIds[0], cleanerId: scenario.cleanerIds[0], rationaleSummary: "Critical Alert selected.", provider: "fake", model: "fake-pair-model" }; } };
    const assignment = await runV2AssignmentCycle(scenario.siteId, { selector, now: scenario.now, workerId: `assignment-worker-${randomUUID()}`, sleep: async () => undefined });
    const workOrderId = String(assignment.run.workOrderId);
    const verificationId = `verification-${randomUUID()}`;
    await firestore.collection("workOrders").doc(workOrderId).update({ status: "awaiting_review", latestVerificationId: verificationId, latestVerificationOutcome: null, revision: 2 });
    await firestore.collection("alerts").doc(scenario.alertIds[0]).update({ status: "awaiting_review", revision: 3 });
    await firestore.collection("workOrders").doc(workOrderId).collection("verifications").doc(verificationId).set({ schemaVersion: 2, siteId: scenario.siteId, workOrderId, alertId: scenario.alertIds[0], status: "ready", outcome: "passed", outcomeReasonCodes: ["required_clear_samples_observed"], sampleSummaries: [], requestedAt: Timestamp.fromDate(scenario.now) });

    const workerId = `review-worker-${randomUUID()}`;
    const reviewRun = await request(app).post("/internal/orchestrator/v2/review-runs").set(internalHeaders(workerId)).send({ siteId: scenario.siteId, workOrderId, triggerType: "integration_test" });
    expect(reviewRun.status).toBe(201);
    const context = await request(app).get(`/internal/orchestrator/v2/runs/${reviewRun.body.runId}/review-context`).query({ siteId: scenario.siteId, workOrderId }).set(internalHeaders(workerId));
    expect(context.status).toBe(200);
    expect(context.body.context.verificationOutcome).toBe("passed");
    const resolved = await request(app).post(`/internal/orchestrator/v2/runs/${reviewRun.body.runId}/resolve-verified-work`).set(internalHeaders(workerId)).send({ siteId: scenario.siteId, workOrderId });
    expect(resolved.status).toBe(200);
    expect(resolved.body.workOrder.status).toBe("resolved");
    const cleaner = await firestore.collection("cleaners").doc(scenario.cleanerIds[0]).get();
    expect(cleaner.data()).toMatchObject({ activeWorkOrderId: null, lastResolvedWorkOrderId: workOrderId, lastResolvedMapRevisionId: scenario.mapId });
    expect(cleaner.data()?.lastResolvedWorkTarget.point).toEqual({ xMeters: 10, yMeters: 10 });
    await Promise.all(scenario.cleanerUids.map((uid) => firebaseAuth.deleteUser(uid).catch(() => undefined)));
  });

  it("returns failed Verification to the same Cleaner through the rework tool", async () => {
    const scenario = await seedScenario();
    const selector: AssignmentSelector = { async select() { return { alertId: scenario.alertIds[0], cleanerId: scenario.cleanerIds[0], rationaleSummary: "Critical Alert selected.", provider: "fake", model: "fake-pair-model" }; } };
    const assignment = await runV2AssignmentCycle(scenario.siteId, { selector, now: scenario.now, workerId: `assignment-worker-${randomUUID()}`, sleep: async () => undefined });
    const workOrderId = String(assignment.run.workOrderId);
    const verificationId = `verification-${randomUUID()}`;
    await firestore.collection("workOrders").doc(workOrderId).update({ status: "awaiting_review", latestVerificationId: verificationId, latestVerificationOutcome: null, revision: 2 });
    await firestore.collection("alerts").doc(scenario.alertIds[0]).update({ status: "awaiting_review", revision: 3 });
    await firestore.collection("workOrders").doc(workOrderId).collection("verifications").doc(verificationId).set({ schemaVersion: 2, siteId: scenario.siteId, workOrderId, alertId: scenario.alertIds[0], status: "ready", outcome: "failed", outcomeReasonCodes: ["issue_still_visible"], sampleSummaries: [], requestedAt: Timestamp.fromDate(scenario.now) });

    const workerId = `review-worker-${randomUUID()}`;
    const reviewRun = await request(app).post("/internal/orchestrator/v2/review-runs").set(internalHeaders(workerId)).send({ siteId: scenario.siteId, workOrderId, triggerType: "integration_test" });
    const rework = await request(app).post(`/internal/orchestrator/v2/runs/${reviewRun.body.runId}/request-rework`).set(internalHeaders(workerId)).send({ siteId: scenario.siteId, workOrderId });
    expect(rework.status).toBe(200);
    expect(rework.body.workOrder).toMatchObject({ status: "in_progress", assignedCleanerId: scenario.cleanerIds[0], reworkCount: 1 });
    expect((await firestore.collection("cleaners").doc(scenario.cleanerIds[0]).get()).data()?.activeWorkOrderId).toBe(workOrderId);
    await Promise.all(scenario.cleanerUids.map((uid) => firebaseAuth.deleteUser(uid).catch(() => undefined)));
  });

  it("rejects assignment context while the Site Orchestrator is paused", async () => {
    const scenario = await seedScenario();
    await firestore.collection("orchestratorConfigs").doc(scenario.siteId).update({ status: "paused" });
    await expect(getV2AssignmentContext(scenario.siteId, { now: scenario.now })).rejects.toMatchObject({ status: 409, message: "Orchestrator is paused." });
    await Promise.all(scenario.cleanerUids.map((uid) => firebaseAuth.deleteUser(uid).catch(() => undefined)));
  });

  it("serializes Site runs, binds their Site/worker and replays an atomic assignment after completion", async () => {
    const s = await seedScenario();
    const concurrent = await Promise.allSettled([createV2AssignmentRun(s.siteId, "owner"), createV2AssignmentRun(s.siteId, "owner")]);
    expect(concurrent.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const runId = (concurrent.find(r => r.status === "fulfilled") as PromiseFulfilledResult<any>).value.runId;
    await expect(getV2AssignmentContextTool("other-site", runId, "owner")).rejects.toMatchObject({ status: 404 });
    await expect(getV2AssignmentContextTool(s.siteId, runId, "other-worker")).rejects.toMatchObject({ status: 409 });
    await getV2AssignmentContextTool(s.siteId, runId, "owner");
    const command = { siteId: s.siteId, runId, workerId: "owner", alertId: s.alertIds[0], cleanerId: s.cleanerIds[0], rationaleSummary: "Selected pair", requestId: "test" };
    await expect(assignV2CleanerByIdsTool({ ...command, alertId: "not-in-snapshot" })).rejects.toMatchObject({ status: 409 });
    const work = await assignV2CleanerByIdsTool(command);
    // No finishRun call is necessary: both the Work and result are already committed.
    const committed = (await firestore.collection("orchestratorRuns").doc(runId).get()).data()!;
    expect(committed.status).toBe("succeeded");
    expect(committed.commandResult.workOrder.id).toBe(work.id);
    const replay = await assignV2CleanerByIdsTool(command);
    expect(replay.id).toBe(work.id);
    await expect(assignV2CleanerByIdsTool({ ...command, cleanerId: s.cleanerIds[1] })).rejects.toMatchObject({ status: 409 });
    expect((await firestore.collection("workOrders").where("siteId", "==", s.siteId).get()).size).toBe(1);
    await Promise.all(s.cleanerUids.map(uid => firebaseAuth.deleteUser(uid)));
  });

  it.each(["pause", "map", "manual", "expiry", "site"])("rejects %s changes during a provider call without assigning Work", async change => {
    const s = await seedScenario();
    const selector: AssignmentSelector = { async select(_context, _config, runId) {
      if (change === "pause") await firestore.collection("orchestratorConfigs").doc(s.siteId).update({ status: "paused" });
      if (change === "map") await firestore.collection("sites").doc(s.siteId).update({ activeMapRevisionId: "new-map" });
      if (change === "manual") await firestore.collection("alerts").doc(s.alertIds[0]).update({ managementMode: "manual" });
      if (change === "expiry") await firestore.collection("orchestratorRuns").doc(runId).update({ leaseExpiresAt: Timestamp.fromMillis(0) });
      if (change === "site") await firestore.collection("sites").doc(s.siteId).update({ status: "inactive" });
      return { alertId: s.alertIds[0], cleanerId: s.cleanerIds[0], rationaleSummary: "Old decision", provider: "fake", model: "fake" };
    } };
    const result = await runV2AssignmentCycle(s.siteId, { selector, sleep: async () => undefined });
    expect(result.run.status).toBe("cancelled");
    expect((await firestore.collection("workOrders").where("siteId", "==", s.siteId).get()).empty).toBe(true);
    await Promise.all(s.cleanerUids.map(uid => firebaseAuth.deleteUser(uid)));
  });

  it("recovers expired runs and prevents the old worker from committing afterwards", async () => {
    const s = await seedScenario();
    const run = await createV2AssignmentRun(s.siteId, "old");
    await getV2AssignmentContextTool(s.siteId, run.runId, "old");
    await firestore.collection("orchestratorRuns").doc(run.runId).update({ leaseExpiresAt: Timestamp.fromMillis(0) });
    await recoverV2OrchestratorRuns();
    await createV2AssignmentRun(s.siteId, "new");
    await expect(assignV2CleanerByIdsTool({ siteId: s.siteId, runId: run.runId, workerId: "old", alertId: s.alertIds[0], cleanerId: s.cleanerIds[0], rationaleSummary: "stale", requestId: "stale" })).rejects.toMatchObject({ status: 409 });
    expect((await firestore.collection("orchestratorRuns").doc(run.runId).get()).data()?.status).toBe("failed");
    await Promise.all(s.cleanerUids.map(uid => firebaseAuth.deleteUser(uid)));
  });

  it("queues fresh Camera verification, respects pause, then resolves through the review worker", async () => {
    const s = await seedScenario();
    const actor = { uid: "test", role: "supervisor" as const, type: "orchestrator" as const, authority: null, displayName: "Test" };
    const work = await createV2AlertWorkOrder({ siteId: s.siteId, alertId: s.alertIds[0], assignedCleanerId: s.cleanerIds[0], idempotencyKey: "review-queue" }, actor, "test");
    await transitionV2WorkOrder(s.siteId, work.id, "in_progress", actor, { idempotencyKey: "start-review" }, "test");
    await transitionV2WorkOrder(s.siteId, work.id, "awaiting_review", actor, { idempotencyKey: "submit-review" }, "test");
    const cameraId = work.cameraId;
    const sample = { sampleId: "old", capturedAtMs: 1, peopleCount: 0, people: [], bins: [], issues: [], binStates: [], modelVersions: {}, isSimulation: false };
    expect(await recordV2CameraVerificationObservation(s.siteId, cameraId, sample)).toBe(0);
    for (let i = 0; i < 3; i++) await recordV2CameraVerificationObservation(s.siteId, cameraId, { ...sample, sampleId: `clear-${i}`, capturedAtMs: Date.now() + i });
    expect((await firestore.collection("workOrders").doc(work.id).get()).data()?.status).toBe("awaiting_review");
    await firestore.collection("orchestratorConfigs").doc(s.siteId).update({ status: "paused" });
    await expect(runV2ReviewCycle(s.siteId, work.id)).rejects.toMatchObject({ status: 409 });
    await firestore.collection("orchestratorConfigs").doc(s.siteId).update({ status: "running" });
    await processV2OrchestratorTriggers(100, { scheduleScan: false, siteId: s.siteId, sleep: async () => undefined, selector: { async select() { throw new Error("No model required for review"); } } });
    expect((await firestore.collection("workOrders").doc(work.id).get()).data()?.status).toBe("resolved");
    const notifications = await firestore.collection("notifications").where("workOrderId", "==", work.id).get();
    expect(notifications.docs.filter(doc => doc.data().type === "work_resolved")).toHaveLength(1);
    await Promise.all(s.cleanerUids.map(uid => firebaseAuth.deleteUser(uid)));
  });

  it("recovers a trigger after the command committed but before trigger acknowledgement", async () => {
    const s = await seedScenario();
    const eventId = await enqueueV2ImmediateAssignmentTrigger(s.siteId, "crash-test", randomUUID());
    const event = firestore.collection("orchestratorOutbox").doc(eventId);
    await event.update({ status: "claimed", claimedBy: "crashed", claimExpiresAt: Timestamp.fromMillis(Date.now() + 300000) });
    const run = await createV2AssignmentRun(s.siteId, "crashed", "crash-test", eventId);
    await getV2AssignmentContextTool(s.siteId, run.runId, "crashed");
    const work = await assignV2CleanerByIdsTool({ siteId: s.siteId, runId: run.runId, workerId: "crashed", alertId: s.alertIds[0], cleanerId: s.cleanerIds[0], rationaleSummary: "Selected", requestId: "crash-test" });
    await event.update({ claimExpiresAt: Timestamp.fromMillis(0) });
    let called = false;
    await processV2OrchestratorTriggers(10, { siteId: s.siteId, scheduleScan: false, sleep: async () => undefined, selector: { async select() { called = true; throw new Error("Should not call"); } } });
    expect(called).toBe(false);
    expect((await event.get()).data()).toMatchObject({ status: "completed", runId: run.runId });
    expect((await firestore.collection("workOrders").where("siteId", "==", s.siteId).get()).docs.map(doc => doc.id)).toEqual([work.id]);
    await Promise.all(s.cleanerUids.map(uid => firebaseAuth.deleteUser(uid)));
  });

  it("guards review outcome, manual takeover and replay without duplicate rework", async () => {
    const s = await seedScenario();
    const work = await createV2AlertWorkOrder({ siteId: s.siteId, alertId: s.alertIds[0], assignedCleanerId: s.cleanerIds[0], idempotencyKey: "review-test" }, { uid: "test", role: "supervisor", type: "orchestrator", displayName: "test" }, "test");
    const workRef = firestore.collection("workOrders").doc(work.id);
    const verificationId = randomUUID();
    await workRef.update({ status: "awaiting_review", latestVerificationId: verificationId });
    await workRef.collection("verifications").doc(verificationId).set({ status: "ready", outcome: "failed", outcomeReasonCodes: ["still_visible"] });
    const run = await createV2ReviewRun(s.siteId, work.id, "reviewer");
    const command = { siteId: s.siteId, runId: run.runId, workOrderId: work.id, workerId: "reviewer", requestId: "test" };
    await expect(resolveV2VerifiedWork(command)).rejects.toMatchObject({ status: 409 });
    await workRef.update({ managementMode: "manual" });
    await expect(requestV2Rework(command)).rejects.toMatchObject({ status: 409 });
    await workRef.update({ managementMode: "orchestrated" });
    const result = await requestV2Rework(command);
    const replay = await requestV2Rework(command);
    expect(result.workOrder.reworkCount).toBe(1);
    expect(replay.workOrder.reworkCount).toBe(1);
    expect((await workRef.collection("events").where("type", "==", "verification_failed").get()).size).toBe(1);
    await Promise.all(s.cleanerUids.map(uid => firebaseAuth.deleteUser(uid)));
  });
});
