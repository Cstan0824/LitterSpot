import "dotenv/config";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { firebaseAuth, firestore } from "../../config/firebase.js";
import { env } from "../../config/env.js";
import { assertV2MigrationTarget } from "../../services/v2MigrationSafety.js";
import { createV2Cleaner } from "../../services/v2CleanerService.js";
import { canonicalHash } from "../../services/v2Persistence.js";
import {
  publishV2CameraDraft,
  saveV2DraftRegistration,
  startV2CameraDraft,
  uploadV2DraftReference,
  uploadV2DraftSourceVideo,
  validateV2CameraDraft,
} from "../../services/v2CameraDraftService.js";
import { createV2SimulatedAlert } from "../../services/v2TestSupportService.js";
import {
  applyV2Verification,
  createV2AlertWorkOrder,
  createV2ManualWorkOrder,
  dismissV2WorkOrder,
  getV2WorkOrder,
  transitionV2WorkOrder,
  uploadV2CompletionEvidence,
  type V2WorkActor,
} from "../../services/v2WorkOrderService.js";
import { runV2AssignmentCycle } from "../../services/v2OrchestratorService.js";
import { buildDashboard, refreshBinPlacement } from "../../services/phase11Service.js";

const target = {
  appEnvironment: env.appEnvironment,
  firebaseProjectId: env.firebaseProjectId,
  expectedFirebaseProjectId: env.expectedFirebaseProjectId,
  firestoreDatabaseId: env.firebaseDatabaseId,
  emulator: Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST),
};
assertV2MigrationTarget(target);
if (env.firebaseProjectId !== "litterspot-v2-database" || env.firebaseDatabaseId !== "(default)") {
  throw new Error("The integration baseline is locked to litterspot-v2-database/(default).");
}

const siteId = "sunway-theme-park";
const rootEmail = "root@sunway-test.com";
const fixtureCleanerPassword = process.env.INTEGRATION_FIXTURE_PASSWORD;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const fixtureImagePath = resolve(scriptDirectory, "../../../../frontend/public/mock/spill.jpg");
const fixtureVideoPath = resolve(scriptDirectory, "../../../../data/Test videos/Test video 1.mp4");

type Upload = Express.Multer.File;

function upload(buffer: Buffer, originalname: string, mimetype: string): Upload {
  return { buffer, originalname, mimetype, size: buffer.length } as Upload;
}

function run(command: string, args: string[]) {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: resolve(scriptDirectory, "../../../.."), env: process.env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`Command failed with exit code ${code}.`)));
  });
}

async function currentMap() {
  const site = await firestore.collection("sites").doc(siteId).get();
  if (!site.exists || site.data()?.schemaVersion !== 2 || site.data()?.status !== "active") throw new Error("The Sunway development Site is missing or inactive.");
  const revisionId = String(site.data()?.activeMapRevisionId ?? "");
  const revision = await firestore.collection("siteMapRevisions").doc(revisionId).get();
  const zones = await revision.ref.collection("zoneGeometry").get();
  if (!revision.exists || !zones.docs.some((zone) => zone.id === "main-entrance") || !zones.docs.some((zone) => zone.id === "food-court")) {
    throw new Error("The active map must contain Main Entrance and Food Court V2 geometry before preparing fixtures.");
  }
  return { site, revision, zones };
}

type CleanerFixture = { email: string; staffCode: string; fullName: string; phone: string; stationPoint: { xMeters: number; yMeters: number } };
const cleanerFixtures: CleanerFixture[] = [
  { email: "cleaner2@sunway-test.com", staffCode: "CLN-002", fullName: "Integration Test Cleaner", phone: "+60123456790", stationPoint: { xMeters: 70, yMeters: 10 } },
  { email: "cleaner3@sunway-test.com", staffCode: "CLN-003", fullName: "Assigned Work Cleaner", phone: "+60123456791", stationPoint: { xMeters: 15, yMeters: 15 } },
  { email: "cleaner4@sunway-test.com", staffCode: "CLN-004", fullName: "Review Queue Cleaner", phone: "+60123456792", stationPoint: { xMeters: 75, yMeters: 15 } },
  { email: "cleaner5@sunway-test.com", staffCode: "CLN-005", fullName: "Rework Fixture Cleaner", phone: "+60123456793", stationPoint: { xMeters: 25, yMeters: 25 } },
  { email: "cleaner6@sunway-test.com", staffCode: "CLN-006", fullName: "Dismissed Work Cleaner", phone: "+60123456794", stationPoint: { xMeters: 30, yMeters: 30 } },
  { email: "cleaner7@sunway-test.com", staffCode: "CLN-007", fullName: "Evidence History Cleaner", phone: "+60123456795", stationPoint: { xMeters: 80, yMeters: 25 } },
];

async function ensureCleaner(rootUid: string, rootName: string, fixture: CleanerFixture) {
  const existing = await firestore.collection("userAccounts").where("emailNormalized", "==", fixture.email).limit(1).get();
  if (existing.size) return String(existing.docs[0].data()?.profileId);
  const [reservations, operations] = await Promise.all([
    firestore.collection("userAccountEmails").where("emailNormalized", "==", fixture.email).get(),
    firestore.collection("identityOperations").where("emailNormalized", "==", fixture.email).get(),
  ]);
  // A previous interrupted development-fixture attempt can leave an email reservation without an account.
  // These exact fixture identities are safe to reconcile here; real account recovery remains an application workflow.
  await Promise.all(operations.docs
    .filter((operation) => operation.data()?.status !== "completed")
    .map((operation) => operation.ref.set({ status: "failed", errorCode: "fixture_reconciliation", updatedAt: new Date() }, { merge: true })));
  await Promise.all(reservations.docs.map((reservation) => reservation.ref.delete()));
  await firebaseAuth.getUserByEmail(fixture.email).then((user) => firebaseAuth.deleteUser(user.uid)).catch((error: { code?: string }) => {
    if (error.code !== "auth/user-not-found") throw error;
  });
  if (!fixtureCleanerPassword) throw new Error("Set INTEGRATION_FIXTURE_PASSWORD to create the missing integration Cleaner.");
  const cleaner = await createV2Cleaner({
    siteId,
    staffCode: fixture.staffCode,
    fullName: fixture.fullName,
    phone: fixture.phone,
    email: fixture.email,
    password: fixtureCleanerPassword,
    notes: "Development fixture used for Phase 12 frontend integration.",
    weeklySchedule: {
      mon: { startMinute: 0, endMinute: 0 }, tue: { startMinute: 0, endMinute: 0 }, wed: { startMinute: 0, endMinute: 0 },
      thu: { startMinute: 0, endMinute: 0 }, fri: { startMinute: 0, endMinute: 0 }, sat: { startMinute: 0, endMinute: 0 }, sun: { startMinute: 0, endMinute: 0 },
    },
    stationPoint: fixture.stationPoint,
    idempotencyKey: `integration-baseline-${fixture.staffCode.toLowerCase()}-v2`,
  }, { uid: rootUid, role: "supervisor", authority: "root", displayName: rootName }, `integration-baseline-${fixture.staffCode.toLowerCase()}-v2`);
  return cleaner.id;
}

async function ensureCamera(input: {
  rootUid: string;
  name: string;
  sourceType: "laptop_camera" | "looped_video";
  point: { xMeters: number; yMeters: number };
  bin: boolean;
}) {
  const cameras = await firestore.collection("cameras").where("siteId", "==", siteId).limit(100).get();
  const existing = cameras.docs.find((camera) => camera.data()?.schemaVersion === 2 && camera.data()?.nameNormalized === input.name.toLowerCase());
  if (existing) return existing.id;

  const reference = upload(await readFile(fixtureImagePath), "spill.jpg", "image/jpeg");
  const draft = await startV2CameraDraft({
    siteId,
    kind: "create",
    name: input.name,
    description: input.sourceType === "laptop_camera" ? "Development laptop Camera fixture." : "Development looped-video Camera fixture.",
    sourceType: input.sourceType,
    placement: { point: input.point },
    actorUid: input.rootUid,
  });
  await uploadV2DraftReference({ siteId, draftId: draft.id, file: reference, actorUid: input.rootUid });
  if (input.sourceType === "looped_video") {
    await uploadV2DraftSourceVideo({
      siteId,
      draftId: draft.id,
      file: upload(await readFile(fixtureVideoPath), "test-video-1.mp4", "video/mp4"),
      actorUid: input.rootUid,
    });
  }
  await saveV2DraftRegistration({
    siteId,
    draftId: draft.id,
    sourceWidth: 1280,
    sourceHeight: 720,
    walkableFloorPolygon: [{ x: 0.05, y: 0.08 }, { x: 0.95, y: 0.08 }, { x: 0.95, y: 0.95 }, { x: 0.05, y: 0.95 }],
    bins: input.bin ? [{ binId: "bin-food-court-01", displayName: "Food Court Bin 01", binType: "open_top", binPolygon: [{ x: 0.68, y: 0.38 }, { x: 0.86, y: 0.38 }, { x: 0.86, y: 0.9 }, { x: 0.68, y: 0.9 }] }] : [],
    actorUid: input.rootUid,
  });
  const validation = await validateV2CameraDraft(siteId, draft.id);
  if (!validation.valid) throw new Error(`Camera fixture draft is invalid: ${validation.errors.join(", ")}`);
  const published = await publishV2CameraDraft(draft.id, input.rootUid);
  return String(published.cameraId);
}

async function ensureSimulatedAlert(input: {
  rootUid: string;
  rootName: string;
  cameraId: string;
  issueType: "floor_litter" | "floor_spill" | "bin_service";
  condition: "litter" | "spill" | "full" | "overflow";
  severity: "warning" | "critical";
  clientRequestId: string;
}) {
  const result = await createV2SimulatedAlert({
    siteId,
    cameraId: input.cameraId,
    issueType: input.issueType,
    condition: input.condition,
    severity: input.severity,
    confidence: 0.99,
    clientRequestId: input.clientRequestId,
  }, { uid: input.rootUid, role: "supervisor", authority: "root", displayName: input.rootName }, input.clientRequestId);
  return result.alert.id;
}

const supervisorActor = (rootUid: string, rootName: string) => ({ uid: rootUid, role: "supervisor" as const, authority: "root" as const, displayName: rootName, type: "supervisor" as const });

async function cleanerActor(cleanerId: string) {
  const cleaner = await firestore.collection("cleaners").doc(cleanerId).get();
  if (!cleaner.exists) throw new Error(`Fixture Cleaner ${cleanerId} is missing.`);
  return { uid: String(cleaner.data()?.authUid), role: "cleaner" as const, authority: null, displayName: String(cleaner.data()?.fullName), type: "cleaner" as const, cleanerId } as unknown as V2WorkActor;
}

async function ensureAlertWork(alertId: string, cleanerId: string, rootUid: string, rootName: string, idempotencyKey: string) {
  const alert = await firestore.collection("alerts").doc(alertId).get();
  const existingWorkId = String(alert.data()?.activeWorkOrderId ?? "");
  if (existingWorkId) return getV2WorkOrder(siteId, existingWorkId);
  return createV2AlertWorkOrder({ siteId, alertId, assignedCleanerId: cleanerId, idempotencyKey }, supervisorActor(rootUid, rootName), idempotencyKey);
}

async function ensureManualWork(input: {
  cleanerId: string;
  rootUid: string;
  rootName: string;
  idempotencyKey: string;
  title: string;
  target: { type: "camera"; cameraId: string } | { type: "coordinate"; point: { xMeters: number; yMeters: number } };
}) {
  const workId = canonicalHash("v2-work-order", siteId, "manual", input.idempotencyKey);
  const existing = await firestore.collection("workOrders").doc(workId).get();
  if (existing.exists) return getV2WorkOrder(siteId, workId);
  return createV2ManualWorkOrder({
    siteId,
    title: input.title,
    instructions: `${input.title}. This is a development fixture for frontend integration.`,
    severity: "warning",
    assignedCleanerId: input.cleanerId,
    target: input.target,
    idempotencyKey: input.idempotencyKey,
  }, supervisorActor(input.rootUid, input.rootName), input.idempotencyKey);
}

async function startWorkIfAssigned(workOrderId: string, cleanerId: string, key: string) {
  const work = await getV2WorkOrder(siteId, workOrderId);
  if (work.status !== "assigned") return work;
  return transitionV2WorkOrder(siteId, workOrderId, "in_progress", await cleanerActor(cleanerId), { idempotencyKey: key }, key);
}

async function submitCameraWorkIfInProgress(workOrderId: string, cleanerId: string, key: string) {
  const work = await getV2WorkOrder(siteId, workOrderId);
  if (work.status !== "in_progress") return work;
  return transitionV2WorkOrder(siteId, workOrderId, "awaiting_review", await cleanerActor(cleanerId), { idempotencyKey: key }, key);
}

async function resolveCoordinateEvidenceWork(workOrderId: string, cleanerId: string, rootUid: string, rootName: string) {
  let work = await startWorkIfAssigned(workOrderId, cleanerId, "integration-coordinate-start-v1");
  if (work.status === "in_progress") {
    const evidence = work.completionEvidenceMediaId
      ? { mediaId: String(work.completionEvidenceMediaId) }
      : await uploadV2CompletionEvidence({
        siteId,
        workOrderId,
        cleanerId,
        file: { buffer: await readFile(fixtureImagePath), mimetype: "image/jpeg", originalname: "integration-completion.jpg" },
      });
    work = await transitionV2WorkOrder(siteId, workOrderId, "awaiting_review", await cleanerActor(cleanerId), { idempotencyKey: "integration-coordinate-submit-v1", completionEvidenceMediaId: evidence.mediaId }, "integration-coordinate-submit-v1");
  }
  if (work.status === "awaiting_review") {
    await applyV2Verification({ siteId, workOrderId, outcome: "passed", reason: "Development fixture completion accepted.", expectedRevision: Number(work.revision), idempotencyKey: "integration-coordinate-verify-v1" }, supervisorActor(rootUid, rootName), "integration-coordinate-verify-v1");
  }
  return getV2WorkOrder(siteId, workOrderId);
}

const root = await firebaseAuth.getUserByEmail(rootEmail);
const rootAccount = await firestore.collection("userAccounts").doc(root.uid).get();
if (!rootAccount.exists || rootAccount.data()?.role !== "supervisor" || rootAccount.data()?.authority !== "root" || rootAccount.data()?.siteId !== siteId) {
  throw new Error("The required Sunway Root Supervisor is missing or does not have Root authority.");
}
const rootName = String(rootAccount.data()?.displayName ?? "Root Supervisor");

await currentMap();
const fixtureCleanerIds: Record<string, string> = {};
for (const fixture of cleanerFixtures) {
  fixtureCleanerIds[fixture.staffCode] = await ensureCleaner(root.uid, rootName, fixture);
}
const availableCleanerId = fixtureCleanerIds["CLN-002"];
const assignedCleanerId = fixtureCleanerIds["CLN-003"];
const reviewCleanerId = fixtureCleanerIds["CLN-004"];
const reworkCleanerId = fixtureCleanerIds["CLN-005"];
const dismissedCleanerId = fixtureCleanerIds["CLN-006"];
const evidenceCleanerId = fixtureCleanerIds["CLN-007"];
const laptopCameraId = await ensureCamera({ rootUid: root.uid, name: "Main Entrance Camera", sourceType: "laptop_camera", point: { xMeters: 20, yMeters: 20 }, bin: false });
const loopedCameraId = await ensureCamera({ rootUid: root.uid, name: "Food Court Demo Camera", sourceType: "looped_video", point: { xMeters: 70, yMeters: 20 }, bin: true });

const orchestratorAlertId = await ensureSimulatedAlert({ rootUid: root.uid, rootName, cameraId: laptopCameraId, issueType: "floor_spill", condition: "spill", severity: "critical", clientRequestId: "integration-orchestrator-assignment-v1" });
const reviewAlertId = await ensureSimulatedAlert({ rootUid: root.uid, rootName, cameraId: loopedCameraId, issueType: "bin_service", condition: "full", severity: "warning", clientRequestId: "integration-awaiting-review-v1" });
const reworkAlertId = await ensureSimulatedAlert({ rootUid: root.uid, rootName, cameraId: laptopCameraId, issueType: "bin_service", condition: "overflow", severity: "critical", clientRequestId: "integration-rework-v1" });
const dismissedAlertId = await ensureSimulatedAlert({ rootUid: root.uid, rootName, cameraId: laptopCameraId, issueType: "floor_litter", condition: "litter", severity: "warning", clientRequestId: "integration-dismissed-alert-v1" });

const orchestratorAlert = await firestore.collection("alerts").doc(orchestratorAlertId).get();
let orchestratedWorkId = String(orchestratorAlert.data()?.activeWorkOrderId ?? "");
if (!orchestratedWorkId) {
  const run = await runV2AssignmentCycle(siteId, {
    workerId: "integration-fixture-orchestrator",
    triggerType: "integration_fixture_assignment",
    sleep: async () => undefined,
    selector: {
      async select() {
        return { alertId: orchestratorAlertId, cleanerId: assignedCleanerId, rationaleSummary: "Fixture decision: this available Cleaner is near the Main Entrance spill.", provider: "integration-fixture", model: "deterministic-v1" };
      },
    },
  });
  orchestratedWorkId = String(run.run.workOrderId ?? "");
}
if (!orchestratedWorkId) throw new Error("The orchestrated assignment fixture did not create a Work Order.");

const reviewWork = await ensureAlertWork(reviewAlertId, reviewCleanerId, root.uid, rootName, "integration-awaiting-review-work-v1");
await submitCameraWorkIfInProgress((await startWorkIfAssigned(reviewWork.id, reviewCleanerId, "integration-awaiting-review-start-v1")).id, reviewCleanerId, "integration-awaiting-review-submit-v1");

const reworkWork = await ensureAlertWork(reworkAlertId, reworkCleanerId, root.uid, rootName, "integration-rework-work-v1");
let reworkCurrent = await startWorkIfAssigned(reworkWork.id, reworkCleanerId, "integration-rework-start-v1");
reworkCurrent = await submitCameraWorkIfInProgress(reworkCurrent.id, reworkCleanerId, "integration-rework-submit-v1");
if (reworkCurrent.status === "awaiting_review") {
  await applyV2Verification({ siteId, workOrderId: reworkCurrent.id, outcome: "failed", reason: "Development fixture: cleaning needs another pass.", expectedRevision: Number(reworkCurrent.revision), idempotencyKey: "integration-rework-verify-v1" }, supervisorActor(root.uid, rootName), "integration-rework-verify-v1");
}

const dismissedWork = await ensureAlertWork(dismissedAlertId, dismissedCleanerId, root.uid, rootName, "integration-dismissed-work-v1");
if (dismissedWork.status !== "dismissed") {
  await dismissV2WorkOrder({ siteId, workOrderId: dismissedWork.id, reason: "Development fixture: the reported issue was cleared during inspection.", expectedRevision: Number(dismissedWork.revision), idempotencyKey: "integration-dismissed-work-v1" }, supervisorActor(root.uid, rootName), "integration-dismissed-work-v1");
}

const waitingAlertId = await ensureSimulatedAlert({ rootUid: root.uid, rootName, cameraId: laptopCameraId, issueType: "floor_litter", condition: "litter", severity: "warning", clientRequestId: "integration-waiting-alert-v1" });
const evidenceWork = await ensureManualWork({
  cleanerId: evidenceCleanerId,
  rootUid: root.uid,
  rootName,
  idempotencyKey: "integration-coordinate-evidence-resolved-v1",
  title: "Clean loose litter beside Food Court seating",
  target: { type: "coordinate", point: { xMeters: 82, yMeters: 30 } },
});
await resolveCoordinateEvidenceWork(evidenceWork.id, evidenceCleanerId, root.uid, rootName);

const tsxPath = resolve(scriptDirectory, "../../../../node_modules/.bin/tsx");
await run(tsxPath, [resolve(scriptDirectory, "seedPhase11Development.ts")]);
const dashboard = await buildDashboard(siteId);
const analytics = await refreshBinPlacement(siteId, 30, { uid: root.uid, role: "supervisor", authority: "root", displayName: rootName });
await firestore.collection("systemMetadata").doc("integrationBaseline").set({
  schemaVersion: 2,
  fixtureVersion: "phase12-complete-v1",
  siteId,
  rootSupervisorUid: root.uid,
  cleanerFixtureIds: fixtureCleanerIds,
  cameraFixtureIds: [laptopCameraId, loopedCameraId],
  activeAlertId: waitingAlertId,
  workflowFixtureIds: { orchestratedWorkId, reviewWorkId: reviewWork.id, reworkWorkId: reworkWork.id, dismissedWorkId: dismissedWork.id, evidenceWorkId: evidenceWork.id },
  preparedAt: new Date(),
  preparedBy: "v2:prepare-integration-baseline",
}, { merge: true });

console.log(JSON.stringify({
  target: `${env.firebaseProjectId}/${env.firebaseDatabaseId}`,
  siteId,
  fixtures: { availableCleanerId, assignedCleanerId, reviewCleanerId, reworkCleanerId, dismissedCleanerId, evidenceCleanerId, laptopCameraId, loopedCameraId, waitingAlertId, orchestratedWorkId, reviewWorkId: reviewWork.id, reworkWorkId: reworkWork.id, dismissedWorkId: dismissedWork.id, evidenceWorkId: evidenceWork.id },
  dashboardCounts: dashboard.counts,
  analyticsStatus: analytics.status,
}, null, 2));
