import { createHash, randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { firebaseAuth, firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { getCleaner, updateCleaner, type CleanerUpdate } from "./cleanerService.js";

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

function emailReservationId(email: string) {
  return createHash("sha256").update(normalizedEmail(email)).digest("hex");
}

function cleanerAuthUid(cleanerId: string) {
  const direct = `cleaner-${cleanerId}`;
  return direct.length <= 128 ? direct : `cleaner-${createHash("sha256").update(cleanerId).digest("hex")}`;
}

function authErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : "";
}

export async function provisionCleanerAccount(cleanerId: string, rawEmail: string, actorUid: string) {
  const email = normalizedEmail(rawEmail);
  const uid = cleanerAuthUid(cleanerId);
  const cleanerReference = firestore.collection("cleaners").doc(cleanerId);
  const accountReference = firestore.collection("userAccounts").doc(uid);
  const reservationReference = firestore.collection("userAccountEmails").doc(emailReservationId(email));

  try {
    const existingEmailUser = await firebaseAuth.getUserByEmail(email);
    if (existingEmailUser.uid !== uid) throw new HttpError(409, "Email address already belongs to another Firebase account.");
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (authErrorCode(error) !== "auth/user-not-found") throw error;
  }

  const preparation = await firestore.runTransaction(async (transaction) => {
    const [cleaner, reservation] = await Promise.all([
      transaction.get(cleanerReference),
      transaction.get(reservationReference),
    ]);
    if (!cleaner.exists) throw new HttpError(404, "Cleaner not found.");
    const data = cleaner.data()!;
    if (data.status !== "active") throw new HttpError(409, "An inactive Cleaner cannot receive an account.");
    if (data.authUid && data.authUid !== uid) throw new HttpError(409, "Cleaner is linked to a different authentication identity.");
    if (data.email && normalizedEmail(String(data.email)) !== email) throw new HttpError(409, "Cleaner is linked to a different email address.");
    if (reservation.exists && reservation.data()?.cleanerId !== cleanerId) {
      throw new HttpError(409, "Email address is already reserved for another account.");
    }
    if (!reservation.exists) {
      transaction.create(reservationReference, {
        email,
        uid,
        cleanerId,
        status: "reserved",
        createdAt: FieldValue.serverTimestamp(),
        createdByUid: actorUid,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    const existingAccountStatus = String(data.accountStatus ?? "not_provisioned");
    transaction.update(cleanerReference, {
      authUid: uid,
      email,
      accountStatus: ["invited", "active"].includes(existingAccountStatus) ? existingAccountStatus : "provisioning",
      accountProvisioningErrorCode: null,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: actorUid,
    });
    return { existingAccountStatus };
  });

  try {
    let user;
    let createdAuthUser = false;
    try {
      user = await firebaseAuth.getUser(uid);
      if (normalizedEmail(user.email ?? "") !== email) {
        throw new HttpError(409, "The deterministic Cleaner identity already uses another email address.");
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (authErrorCode(error) !== "auth/user-not-found") throw error;
      const cleaner = await getCleaner(cleanerId);
      user = await firebaseAuth.createUser({
        uid,
        email,
        displayName: cleaner.fullName,
        password: randomBytes(32).toString("base64url"),
        emailVerified: false,
        disabled: false,
      });
      createdAuthUser = true;
    }
    if (user.disabled) user = await firebaseAuth.updateUser(uid, { disabled: false });

    await firestore.runTransaction(async (transaction) => {
      const cleaner = await transaction.get(cleanerReference);
      if (!cleaner.exists || cleaner.data()?.authUid !== uid || normalizedEmail(String(cleaner.data()?.email ?? "")) !== email) {
        throw new HttpError(409, "Cleaner account link changed while provisioning was completed.");
      }
      transaction.set(accountReference, {
        role: "cleaner",
        profileId: cleanerId,
        status: "active",
        email,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: actorUid,
      }, { merge: true });
      transaction.update(reservationReference, { status: "active", updatedAt: FieldValue.serverTimestamp() });
      transaction.update(cleanerReference, {
        accountStatus: preparation.existingAccountStatus === "active" ? "active" : "invited",
        accountProvisionedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: actorUid,
      });
    });
    const setupLink = await firebaseAuth.generatePasswordResetLink(email);
    return { cleaner: await getCleaner(cleanerId), setupLink, idempotent: !createdAuthUser };
  } catch (error) {
    await cleanerReference.update({
      ...(preparation.existingAccountStatus === "active" ? {} : { accountStatus: "provisioning" }),
      accountProvisioningErrorCode: authErrorCode(error) || "account_provisioning_failed",
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: actorUid,
    }).catch(() => undefined);
    throw error;
  }
}

export async function reconcileCleanerAccount(cleanerId: string, actorUid: string) {
  const cleaner = await getCleaner(cleanerId);
  if (!cleaner.email) throw new HttpError(409, "Cleaner has no reserved account email to reconcile.");
  return provisionCleanerAccount(cleanerId, cleaner.email, actorUid);
}

export async function changeCleanerStatus(
  cleanerId: string,
  status: "active" | "inactive",
  actorUid: string,
  remainingUpdate: CleanerUpdate = {},
) {
  const current = await getCleaner(cleanerId);
  if (remainingUpdate && Object.keys(remainingUpdate).length > 0) await updateCleaner(cleanerId, remainingUpdate, actorUid);
  if (!current.authUid) return updateCleaner(cleanerId, { status }, actorUid);
  const accountReference = firestore.collection("userAccounts").doc(current.authUid);
  const cleanerReference = firestore.collection("cleaners").doc(cleanerId);

  if (status === "inactive") {
    const activeWork = await firestore.collection("workOrders")
      .where("assignedCleanerId", "==", cleanerId)
      .where("status", "in", ["unassigned", "assigned", "accepted", "in_progress", "ready_for_review", "rework_required", "rejected"])
      .limit(1)
      .get();
    if (!activeWork.empty) throw new HttpError(409, "Reassign, complete, or cancel the Cleaner’s active work order before deactivation.");
    await updateCleaner(cleanerId, { status: "inactive" }, actorUid);
    await cleanerReference.update({ accountStatus: "disable_pending" });
    try {
      await firebaseAuth.updateUser(current.authUid, { disabled: true });
    } catch (error) {
      throw new HttpError(503, "Cleaner access is blocked in Firestore, but Firebase Auth disablement must be reconciled.");
    }
    await firestore.runTransaction(async (transaction) => {
      transaction.set(accountReference, { status: "inactive", updatedAt: FieldValue.serverTimestamp(), updatedByUid: actorUid }, { merge: true });
      transaction.update(cleanerReference, { accountStatus: "disabled", updatedAt: FieldValue.serverTimestamp(), updatedByUid: actorUid });
    });
  } else {
    await firebaseAuth.updateUser(current.authUid, { disabled: false });
    await firestore.runTransaction(async (transaction) => {
      transaction.set(accountReference, { status: "active", updatedAt: FieldValue.serverTimestamp(), updatedByUid: actorUid }, { merge: true });
      transaction.update(cleanerReference, {
        status: "active",
        accountStatus: "invited",
        deactivatedAt: null,
        deactivatedByUid: null,
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: actorUid,
      });
    });
  }
  return getCleaner(cleanerId);
}
