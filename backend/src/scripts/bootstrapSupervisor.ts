import { FieldValue } from "firebase-admin/firestore";
import type { UserRecord } from "firebase-admin/auth";
import { firebaseAuth, firestore } from "../config/firebase.js";

const email = process.env.SUPERVISOR_EMAIL?.trim().toLowerCase();
const password = process.env.SUPERVISOR_PASSWORD;
const displayName = process.env.SUPERVISOR_DISPLAY_NAME?.trim();

if (!email || !password || !displayName) {
  throw new Error(
    "Set SUPERVISOR_EMAIL, SUPERVISOR_PASSWORD, and SUPERVISOR_DISPLAY_NAME before running the bootstrap command.",
  );
}

if (password.length < 8) {
  throw new Error("SUPERVISOR_PASSWORD must contain at least 8 characters.");
}

let createdAuthUser = false;
let user: UserRecord | undefined;

try {
  try {
    user = await firebaseAuth.getUserByEmail(email);
    user = await firebaseAuth.updateUser(user.uid, { displayName, disabled: false });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
    if (code !== "auth/user-not-found") throw error;

    user = await firebaseAuth.createUser({
      email,
      password,
      displayName,
      disabled: false,
      emailVerified: false,
    });
    createdAuthUser = true;
  }

  const profileRef = firestore.collection("supervisors").doc(user.uid);
  const existing = await profileRef.get();
  const existingData = existing.data();

  if (existing.exists && existingData?.role !== "supervisor") {
    throw new Error("The existing Firestore profile has an incompatible role.");
  }

  await profileRef.set({
    uid: user.uid,
    email,
    emailNormalized: email,
    displayName,
    role: "supervisor",
    status: "active",
    authDisabled: user.disabled,
    reconciliationStatus: "consistent",
    createdAt: existing.exists ? existingData?.createdAt ?? FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
    createdByUid: existing.exists ? existingData?.createdByUid ?? "bootstrap" : "bootstrap",
    updatedAt: FieldValue.serverTimestamp(),
    updatedByUid: "bootstrap",
    deactivatedAt: null,
    deactivatedByUid: null,
  }, { merge: true });

  console.log(`Supervisor bootstrap complete for ${email} (${user.uid}).`);
} catch (error) {
  if (createdAuthUser && user) {
    await firebaseAuth.updateUser(user.uid, { disabled: true }).catch(() => undefined);
  }
  throw error;
}
