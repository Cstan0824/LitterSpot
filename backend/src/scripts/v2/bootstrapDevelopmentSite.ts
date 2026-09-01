import "dotenv/config";
import { FieldValue } from "firebase-admin/firestore";
import { firebaseAuth, firestore } from "../../config/firebase.js";
import { env } from "../../config/env.js";
import { V2_DATABASE_MODEL, V2_SCHEMA_VERSION } from "../../shared/v2Contracts.js";
import { assertV2MigrationTarget } from "../../services/v2MigrationSafety.js";
import { emailReservationId, identityOperationId } from "../../services/v2IdentityService.js";

const siteName = "Sunway Theme Park";
const email = process.env.ROOT_SUPERVISOR_EMAIL?.trim().toLowerCase();
const password = process.env.ROOT_SUPERVISOR_PASSWORD;
const displayName = process.env.ROOT_SUPERVISOR_DISPLAY_NAME?.trim() || "Root Supervisor";
const superadminEmail = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
const superadminPassword = process.env.SUPERADMIN_PASSWORD;
const superadminDisplayName = process.env.SUPERADMIN_DISPLAY_NAME?.trim() || "LitterSpot Superadmin";
if (!email || !password || !superadminEmail || !superadminPassword) throw new Error("Set ROOT_SUPERVISOR_EMAIL, ROOT_SUPERVISOR_PASSWORD, SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD at runtime.");
assertV2MigrationTarget({
  appEnvironment: env.appEnvironment,
  firebaseProjectId: env.firebaseProjectId,
  expectedFirebaseProjectId: env.expectedFirebaseProjectId,
  firestoreDatabaseId: env.firebaseDatabaseId,
  emulator: Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST),
});

async function ensureAuth(emailAddress: string, passwordValue: string, name: string) {
  try {
    const existing = await firebaseAuth.getUserByEmail(emailAddress);
    return await firebaseAuth.updateUser(existing.uid, { displayName: name, disabled: false, password: passwordValue });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code !== "auth/user-not-found") throw error;
    return firebaseAuth.createUser({ email: emailAddress, password: passwordValue, displayName: name, disabled: false });
  }
}

const superadmin = await ensureAuth(superadminEmail, superadminPassword, superadminDisplayName);
const root = await ensureAuth(email, password, displayName);
const siteRef = firestore.collection("sites").doc("sunway-theme-park");
const mapRef = firestore.collection("siteMapRevisions").doc("sunway-theme-park-initial");
const rootOperationId = identityOperationId(superadmin.uid, "create_site_root", "bootstrap-sunway-theme-park");
await firestore.runTransaction(async (transaction) => {
  const [existing, existingMap] = await Promise.all([transaction.get(siteRef), transaction.get(mapRef)]);
  const now = FieldValue.serverTimestamp();
  if (!existing.exists) transaction.create(siteRef, {
    schemaVersion: V2_SCHEMA_VERSION,
    siteId: siteRef.id,
    name: siteName,
    nameNormalized: siteName.toLowerCase(),
    description: null,
    timeZone: "Asia/Kuala_Lumpur",
    status: "active",
    rootSupervisorUid: root.uid,
    activeMapRevisionId: mapRef.id,
    mapDraftExists: false,
    firstCameraCreated: false,
    laptopCameraId: null,
    defaultSampleIntervalSeconds: 2,
    fullBinAlertsEnabled: true,
    alertPolicyVersion: "cleanliness-v2",
    analyticsPolicyVersion: "analytics-v2",
    createdAt: now,
    createdByUid: superadmin.uid,
    updatedAt: now,
    updatedByUid: superadmin.uid,
    deactivatedAt: null,
    deactivatedByUid: null,
    deactivationOperationId: null,
    revision: 1,
  });
  if (!existingMap.exists) transaction.create(mapRef, {
    schemaVersion: V2_SCHEMA_VERSION,
    revisionId: mapRef.id,
    siteId: siteRef.id,
    revisionNumber: 1,
    parentRevisionId: null,
    widthMeters: 100,
    heightMeters: 100,
    gridSizeMeters: 5,
    backgroundMediaId: null,
    backgroundTransform: { xMeters: 0, yMeters: 0, widthMeters: 100, heightMeters: 100, opacity: 1 },
    zoneCount: 0,
    cameraPlacementCount: 0,
    cleanerStationCount: 0,
    contentHash: "empty-initial-map",
    publishedAt: now,
    publishedByUid: superadmin.uid,
    publicationRequestId: "bootstrap",
  });
  transaction.set(firestore.collection("userAccounts").doc(superadmin.uid), {
    schemaVersion: V2_SCHEMA_VERSION, uid: superadmin.uid, role: "superadmin", siteId: null, profileId: superadmin.uid,
    authority: null, emailNormalized: superadminEmail, displayName: superadminDisplayName, status: "active",
    createdAt: now, createdByUid: null, updatedAt: now, updatedByUid: superadmin.uid, revision: 1,
  }, { merge: true });
  transaction.set(firestore.collection("userAccountEmails").doc(emailReservationId(superadminEmail)), {
    schemaVersion: V2_SCHEMA_VERSION, emailNormalized: superadminEmail, uid: superadmin.uid, role: "superadmin", profileId: superadmin.uid,
    siteId: null, state: "active", operationId: "bootstrap-superadmin", createdAt: now, updatedAt: now,
  }, { merge: true });
  transaction.set(firestore.collection("userAccounts").doc(root.uid), {
    schemaVersion: V2_SCHEMA_VERSION, uid: root.uid, role: "supervisor", siteId: siteRef.id, profileId: root.uid,
    authority: "root", emailNormalized: email, displayName, status: "active", lastLoginAt: null,
    createdAt: now, createdByUid: superadmin.uid, updatedAt: now, updatedByUid: superadmin.uid, revision: 1,
  }, { merge: true });
  transaction.set(firestore.collection("userAccountEmails").doc(emailReservationId(email)), {
    schemaVersion: V2_SCHEMA_VERSION, emailNormalized: email, uid: root.uid, role: "supervisor", profileId: root.uid,
    siteId: siteRef.id, state: "active", operationId: rootOperationId, createdAt: now, updatedAt: now,
  }, { merge: true });
  transaction.set(firestore.collection("identityOperations").doc(rootOperationId), {
    schemaVersion: V2_SCHEMA_VERSION, operationId: rootOperationId, type: "create_site_root", siteId: siteRef.id, emailNormalized: email,
    authUid: root.uid, profileId: root.uid, status: "completed", lastCompletedStep: "firestore_committed", errorCode: null,
    requestedByUid: superadmin.uid, requestId: "bootstrap", requestBodyHash: "bootstrap", createdAt: now, updatedAt: now, completedAt: now,
  }, { merge: true });
  transaction.set(firestore.collection("supervisors").doc(root.uid), {
    schemaVersion: V2_SCHEMA_VERSION, uid: root.uid, siteId: siteRef.id, authority: "root", fullName: displayName,
    phone: null, status: "active", createdAt: now, createdByUid: superadmin.uid, updatedAt: now,
    updatedByUid: superadmin.uid, deactivatedAt: null, deactivatedByUid: null, revision: 1,
  }, { merge: true });
  transaction.set(firestore.collection("orchestratorConfigs").doc(siteRef.id), {
    schemaVersion: V2_SCHEMA_VERSION, siteId: siteRef.id, status: "running", pausedAt: null, pausedByUid: null,
    pauseReason: null, assignmentEnabled: true, reviewEnabled: true, provider: "ollama", model: "qwen3.5:4b",
    assignmentPolicyVersion: "assignment-v2", reviewPolicyVersion: "review-v2", technicalRetryLimit: 3,
    activeRunId: null,
    technicalRetryDelaysMs: [1000, 2000, 4000], requestTimeoutMs: 60_000, lastRunAt: null,
    lastSuccessfulRunAt: null, lastFailureAt: null, lastFailureCode: null, updatedAt: now, updatedByUid: superadmin.uid, revision: 1,
  }, { merge: true });
  transaction.set(firestore.collection("systemMetadata").doc("schema"), {
    schemaVersion: V2_SCHEMA_VERSION, databaseModel: V2_DATABASE_MODEL, migrationState: "ready",
    minimumBackendVersion: "v2-phase-0", firebaseProjectId: env.firebaseProjectId, firestoreDatabaseId: env.firebaseDatabaseId,
    environment: env.appEnvironment, initializedAt: now, initializedBy: "bootstrapDevelopmentSite", updatedAt: now,
  }, { merge: true });
});
console.log(JSON.stringify({ siteId: siteRef.id, superadminUid: superadmin.uid, rootSupervisorUid: root.uid }, null, 2));
