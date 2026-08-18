import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.ORCHESTRATOR_INTERNAL_TOKEN ||= "orchestrator-integration-token";

const emulatorDescribe = process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST
  ? describe
  : describe.skip;
const prefix = `orchestrator-${process.pid}`;
const supervisorUid = `${prefix}-supervisor`;
const supervisorEmail = `${supervisorUid}@example.test`;
const supervisorPassword = "Orchestrator-supervisor-password-123!";
const alertId = `${prefix}-alert`;
let supervisorToken = "";
let runId = "";
let claimToken = "";

const { app } = await import("./app.js");
const { firebaseAuth, firestore } = await import("./config/firebase.js");

async function signIn() {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST!;
  const response = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: supervisorEmail, password: supervisorPassword, returnSecureToken: true }),
  });
  const result = await response.json() as { idToken?: string };
  if (!response.ok || !result.idToken) throw new Error("Could not sign in to Auth emulator.");
  return result.idToken;
}

emulatorDescribe("Node-owned orchestrator foundation HTTP journey", () => {
  beforeAll(async () => {
    await firebaseAuth.createUser({ uid: supervisorUid, email: supervisorEmail, password: supervisorPassword, displayName: "Orchestrator Supervisor" });
    await firestore.collection("supervisors").doc(supervisorUid).set({ role: "supervisor", status: "active", email: supervisorEmail, displayName: "Orchestrator Supervisor" });
    await firestore.collection("alerts").doc(alertId).set({
      workflowVersion: "grouped-temporal-v2",
      status: "new",
      siteId: `${prefix}-site`,
      zoneId: `${prefix}-zone`,
      siteNameSnapshot: "Orchestrator Test Site",
      zoneNameSnapshot: "Orchestrator Test Zone",
      issueType: "floor_litter",
      severity: "warning",
      lastDetectedAt: new Date(),
    });
    supervisorToken = await signIn();
  });

  afterAll(async () => {
    for (const collection of ["orchestratorRuns", "orchestratorOutbox", "orchestratorDecisions"]) {
      const snapshot = await firestore.collection(collection).where("alertId", "==", alertId).get().catch(() => ({ docs: [] as never[] }));
      await Promise.all(snapshot.docs.map((item) => item.ref.delete()));
    }
    await firestore.collection("alerts").doc(alertId).delete().catch(() => undefined);
    await firestore.collection("supervisors").doc(supervisorUid).delete().catch(() => undefined);
    await firestore.collection("userAccounts").doc(supervisorUid).delete().catch(() => undefined);
    await firebaseAuth.deleteUser(supervisorUid).catch(() => undefined);
  });

  it("creates one durable run, leases it, records decisions, and completes it idempotently", async () => {
    const ensure = await request(app).post("/api/orchestrator/runs/ensure")
      .set("Authorization", `Bearer ${supervisorToken}`)
      .send({ alertId });
    expect(ensure.status).toBe(201);
    runId = ensure.body.run.id;
    expect(ensure.body.run).toMatchObject({ alertId, status: "queued" });

    const replay = await request(app).post("/api/orchestrator/runs/ensure")
      .set("Authorization", `Bearer ${supervisorToken}`)
      .send({ alertId });
    expect(replay.status).toBe(200);
    expect(replay.body.idempotent).toBe(true);
    expect(replay.body.run.id).toBe(runId);

    const claim = await request(app).post(`/internal/orchestrator/runs/${runId}/claim`)
      .set("X-Orchestrator-Token", process.env.ORCHESTRATOR_INTERNAL_TOKEN!)
      .set("X-Orchestrator-Worker-ID", "integration-worker")
      .send({ workerId: "integration-worker", leaseSeconds: 60 });
    expect(claim.status).toBe(200);
    claimToken = claim.body.claimToken;

    const context = await request(app).get(`/internal/orchestrator/runs/${runId}/context`)
      .set("X-Orchestrator-Token", process.env.ORCHESTRATOR_INTERNAL_TOKEN!)
      .set("X-Orchestrator-Worker-ID", "integration-worker");
    expect(context.status).toBe(200);
    expect(context.body.context.alert.id).toBe(alertId);

    const decisionBody = {
      actionId: `${prefix}-decision`,
      claimToken,
      toolName: "get_alert_context",
      outcome: "succeeded",
      input: { alertId },
      result: { contextRead: true },
      idempotencyKey: `${prefix}-decision-key`,
    };
    const decision = await request(app).post(`/internal/orchestrator/runs/${runId}/decisions`)
      .set("X-Orchestrator-Token", process.env.ORCHESTRATOR_INTERNAL_TOKEN!)
      .set("X-Orchestrator-Worker-ID", "integration-worker")
      .send(decisionBody);
    expect(decision.status).toBe(201);
    const decisionReplay = await request(app).post(`/internal/orchestrator/runs/${runId}/decisions`)
      .set("X-Orchestrator-Token", process.env.ORCHESTRATOR_INTERNAL_TOKEN!)
      .set("X-Orchestrator-Worker-ID", "integration-worker")
      .send(decisionBody);
    expect(decisionReplay.status).toBe(200);
    expect(decisionReplay.body.idempotent).toBe(true);

    const complete = await request(app).post(`/internal/orchestrator/runs/${runId}/complete`)
      .set("X-Orchestrator-Token", process.env.ORCHESTRATOR_INTERNAL_TOKEN!)
      .set("X-Orchestrator-Worker-ID", "integration-worker")
      .send({ workerId: "integration-worker", claimToken, status: "completed", result: { smoke: true } });
    expect(complete.status).toBe(200);
    expect(complete.body.run.status).toBe("completed");
  });
});
