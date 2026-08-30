import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "./app.js";
import { firebaseAuth, firestore } from "./config/firebase.js";

const run = process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

async function signIn(email: string, password: string) {
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-key`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await response.json() as { idToken?: string; error?: unknown };
  if (!response.ok || !body.idToken) throw new Error(`Sign-in failed: ${JSON.stringify(body.error)}`);
  return body.idToken;
}

run("V2 identity and Site workflow", () => {
  const suffix = randomUUID();
  const superadminUid = `superadmin-${suffix}`;
  const superadminEmail = `superadmin-${suffix}@example.test`;
  const rootEmail = `root-${suffix}@example.test`;
  const regularEmail = `regular-${suffix}@example.test`;
  const replacementRootEmail = `replacement-root-${suffix}@example.test`;
  const password = "Emulator-password-123!";
  let superadminToken = "";
  let rootToken = "";
  let regularToken = "";
  let siteId = "";
  let rootUid = "";
  let regularUid = "";

  beforeAll(async () => {
    await firebaseAuth.createUser({ uid: superadminUid, email: superadminEmail, password, displayName: "V2 Superadmin" });
    await firestore.collection("userAccounts").doc(superadminUid).set({ schemaVersion: 2, uid: superadminUid, role: "superadmin", siteId: null, profileId: superadminUid, authority: null, emailNormalized: superadminEmail, displayName: "V2 Superadmin", status: "active", revision: 1 });
    superadminToken = await signIn(superadminEmail, password);
  });

  afterAll(async () => {
    for (const email of [superadminEmail, rootEmail, regularEmail, replacementRootEmail]) {
      const user = await firebaseAuth.getUserByEmail(email).catch(() => null);
      if (user) await firebaseAuth.deleteUser(user.uid).catch(() => undefined);
    }
  });

  it("creates a Site and usable Root account through a recoverable identity operation", async () => {
    const response = await request(app).post("/api/superadmin/sites").set("Authorization", `Bearer ${superadminToken}`).send({
      name: `Sunway ${suffix}`, timeZone: "Asia/Kuala_Lumpur", widthMeters: 200, heightMeters: 120, gridSizeMeters: 5,
      rootEmail, rootPassword: password, rootDisplayName: "Root Supervisor", idempotencyKey: `create-site-${suffix}`,
    });
    expect(response.status).toBe(201);
    siteId = response.body.siteId;
    rootUid = response.body.rootSupervisorUid;
    expect((await firestore.collection("identityOperations").where("siteId", "==", siteId).get()).docs[0].data().status).toBe("completed");
    expect((await firestore.collection("userAccountEmails").where("uid", "==", rootUid).get()).docs[0].data().state).toBe("active");
    rootToken = await signIn(rootEmail, password);
    const me = await request(app).get("/api/me").set("Authorization", `Bearer ${rootToken}`);
    expect(me.status).toBe(200);
    expect(me.body.supervisor).toMatchObject({ uid: rootUid, displayName: "Root Supervisor" });
  });

  it("allows only Root to create and manage a Regular Supervisor", async () => {
    const created = await request(app).post("/api/supervisors").set("Authorization", `Bearer ${rootToken}`).send({
      email: regularEmail, password, fullName: "Regular Supervisor", phone: null, idempotencyKey: `create-regular-${suffix}`,
    });
    expect(created.status).toBe(201);
    regularUid = created.body.supervisor.uid;
    regularToken = await signIn(regularEmail, password);
    expect((await request(app).get("/api/me").set("Authorization", `Bearer ${regularToken}`)).status).toBe(200);
    const forbidden = await request(app).post("/api/supervisors").set("Authorization", `Bearer ${regularToken}`).send({ email: `other-${suffix}@example.test`, password, fullName: "Other", idempotencyKey: `other-regular-${suffix}` });
    expect(forbidden.status).toBe(403);
    const profile = await firestore.collection("supervisors").doc(regularUid).get();
    const updated = await request(app).patch(`/api/supervisors/${regularUid}`).set("Authorization", `Bearer ${rootToken}`).send({ fullName: "Updated Regular", expectedRevision: profile.data()?.revision });
    expect(updated.status).toBe(200);
  });

  it("blocks Site users immediately after Superadmin deactivation", async () => {
    const response = await request(app).patch(`/api/superadmin/sites/${siteId}/status`).set("Authorization", `Bearer ${superadminToken}`).send({ status: "inactive", reason: "integration test" });
    expect(response.status).toBe(200);
    expect((await request(app).get("/api/me").set("Authorization", `Bearer ${rootToken}`)).status).toBe(403);
    const operation = await firestore.collection("siteOperations").where("siteId", "==", siteId).where("type", "==", "deactivate").get();
    expect(operation.docs[0].data().status).toBe("pending");
    const reactivated = await request(app).patch(`/api/superadmin/sites/${siteId}/status`).set("Authorization", `Bearer ${superadminToken}`).send({ status: "active", reason: "integration test complete" });
    expect(reactivated.status).toBe(200);
    expect((await request(app).get("/api/me").set("Authorization", `Bearer ${rootToken}`)).status).toBe(200);
  });

  it("resets the current Root account without storing its password", async () => {
    const newPassword = "New-emulator-password-456!";
    const recovered = await request(app).post(`/api/superadmin/sites/${siteId}/root-recovery`).set("Authorization", `Bearer ${superadminToken}`).send({ mode: "reset_existing", password: newPassword, displayName: "Recovered Root", reason: "test recovery", idempotencyKey: `recover-${suffix}` });
    expect(recovered.status).toBe(200);
    expect(recovered.body.result.rootSupervisorUid).toBe(rootUid);
    expect(await signIn(rootEmail, newPassword)).toEqual(expect.any(String));
    const operationDocuments = await firestore.collection("identityOperations").get();
    expect(JSON.stringify(operationDocuments.docs.map((document) => document.data()))).not.toContain(newPassword);
  });

  it("can replace a lost Root account and disables the previous identity", async () => {
    const replacementPassword = "Replacement-password-789!";
    const response = await request(app).post(`/api/superadmin/sites/${siteId}/root-recovery`).set("Authorization", `Bearer ${superadminToken}`).send({ mode: "replace", email: replacementRootEmail, password: replacementPassword, displayName: "Replacement Root", reason: "lost account", idempotencyKey: `replace-root-${suffix}` });
    expect(response.status).toBe(200);
    const replacementUid = response.body.result.rootSupervisorUid;
    expect(replacementUid).not.toBe(rootUid);
    expect(await signIn(replacementRootEmail, replacementPassword)).toEqual(expect.any(String));
    expect((await firestore.collection("sites").doc(siteId).get()).data()?.rootSupervisorUid).toBe(replacementUid);
    expect((await firestore.collection("userAccounts").doc(rootUid).get()).data()).toMatchObject({ status: "inactive", authority: "regular" });
    expect((await firebaseAuth.getUser(rootUid)).disabled).toBe(true);
  });
});
