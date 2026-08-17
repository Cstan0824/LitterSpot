import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { firebaseAuth, firestore } from "./config/firebase.js";
import { app } from "./app.js";

const emulatorDescribe = process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST
  ? describe
  : describe.skip;
const uid = `http-supervisor-${process.pid}`;
const email = `${uid}@example.test`;
const password = "Emulator-only-password-123!";
let token = "";

emulatorDescribe("authenticated HTTP boundary", () => {
  beforeAll(async () => {
    await firebaseAuth.createUser({ uid, email, password, displayName: "HTTP Test Supervisor" });
    await firestore.collection("supervisors").doc(uid).set({
      role: "supervisor",
      status: "active",
      email,
      displayName: "HTTP Test Supervisor",
    });
    const host = process.env.FIREBASE_AUTH_EMULATOR_HOST!;
    const response = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    const result = await response.json() as { idToken?: string; error?: unknown };
    if (!response.ok || !result.idToken) throw new Error(`Auth emulator sign-in failed: ${JSON.stringify(result.error)}`);
    token = result.idToken;
  });

  afterAll(async () => {
    await firestore.collection("supervisors").doc(uid).delete().catch(() => undefined);
    await firestore.collection("userAccounts").doc(uid).delete().catch(() => undefined);
    await firebaseAuth.deleteUser(uid).catch(() => undefined);
  });

  it("accepts an active provisioned Supervisor token", async () => {
    const response = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.supervisor).toMatchObject({ uid, email, displayName: "HTTP Test Supervisor" });
    expect(response.headers["x-request-id"]).toEqual(expect.any(String));
  });

  it("rejects an inactive profile without invalidating the Firebase identity", async () => {
    await firestore.collection("supervisors").doc(uid).update({ status: "inactive" });
    const response = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Supervisor access is inactive.");
    await firestore.collection("supervisors").doc(uid).update({ status: "active" });
  });

  it("rejects malformed bearer credentials", async () => {
    const response = await request(app).get("/api/me").set("Authorization", "Bearer not-a-token");
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Invalid or expired authentication token.");
  });
});
