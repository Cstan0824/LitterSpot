import "dotenv/config";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { firebaseAuth, firestore } from "../../config/firebase.js";
import { env } from "../../config/env.js";
import { assertV2MigrationTarget } from "../../services/v2MigrationSafety.js";
import { createV2Cleaner } from "../../services/v2CleanerService.js";
import {
  publishV2CameraDraft,
  saveV2DraftRegistration,
  startV2CameraDraft,
  uploadV2DraftReference,
  uploadV2DraftSourceVideo,
  validateV2CameraDraft,
} from "../../services/v2CameraDraftService.js";
import { createV2SimulatedAlert } from "../../services/v2TestSupportService.js";
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
const fixtureCleanerEmail = "cleaner2@sunway-test.com";
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

async function ensureCleaner(rootUid: string, rootName: string) {
  const existing = await firestore.collection("userAccounts").where("emailNormalized", "==", fixtureCleanerEmail).limit(1).get();
  if (existing.size) return String(existing.docs[0].data()?.profileId);
  if (!fixtureCleanerPassword) throw new Error("Set INTEGRATION_FIXTURE_PASSWORD to create the missing integration Cleaner.");
  const cleaner = await createV2Cleaner({
    siteId,
    staffCode: "CLN-002",
    fullName: "Integration Test Cleaner",
    phone: "+60123456790",
    email: fixtureCleanerEmail,
    password: fixtureCleanerPassword,
    notes: "Development fixture used for Phase 12 frontend integration.",
    weeklySchedule: {
      mon: { startMinute: 0, endMinute: 0 }, tue: { startMinute: 0, endMinute: 0 }, wed: { startMinute: 0, endMinute: 0 },
      thu: { startMinute: 0, endMinute: 0 }, fri: { startMinute: 0, endMinute: 0 }, sat: { startMinute: 0, endMinute: 0 }, sun: { startMinute: 0, endMinute: 0 },
    },
    stationPoint: { xMeters: 70, yMeters: 10 },
    idempotencyKey: "integration-baseline-cleaner-002-v1",
  }, { uid: rootUid, role: "supervisor", authority: "root", displayName: rootName }, "integration-baseline-cleaner-002");
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

async function ensureSimulatedAlert(rootUid: string, rootName: string, cameraId: string) {
  const result = await createV2SimulatedAlert({
    siteId,
    cameraId,
    issueType: "floor_litter",
    condition: "litter",
    severity: "warning",
    confidence: 0.99,
    clientRequestId: "integration-baseline-floor-litter-v1",
  }, { uid: rootUid, role: "supervisor", authority: "root", displayName: rootName }, "integration-baseline-floor-litter-v1");
  return result.alert.id;
}

const root = await firebaseAuth.getUserByEmail(rootEmail);
const rootAccount = await firestore.collection("userAccounts").doc(root.uid).get();
if (!rootAccount.exists || rootAccount.data()?.role !== "supervisor" || rootAccount.data()?.authority !== "root" || rootAccount.data()?.siteId !== siteId) {
  throw new Error("The required Sunway Root Supervisor is missing or does not have Root authority.");
}
const rootName = String(rootAccount.data()?.displayName ?? "Root Supervisor");

await currentMap();
const availableCleanerId = await ensureCleaner(root.uid, rootName);
const laptopCameraId = await ensureCamera({ rootUid: root.uid, name: "Main Entrance Camera", sourceType: "laptop_camera", point: { xMeters: 20, yMeters: 20 }, bin: false });
const loopedCameraId = await ensureCamera({ rootUid: root.uid, name: "Food Court Demo Camera", sourceType: "looped_video", point: { xMeters: 70, yMeters: 20 }, bin: true });
const alertId = await ensureSimulatedAlert(root.uid, rootName, loopedCameraId);

const tsxPath = resolve(scriptDirectory, "../../../../node_modules/.bin/tsx");
await run(tsxPath, [resolve(scriptDirectory, "seedPhase11Development.ts")]);
const dashboard = await buildDashboard(siteId);
const analytics = await refreshBinPlacement(siteId, 30, { uid: root.uid, role: "supervisor", authority: "root", displayName: rootName });
await firestore.collection("systemMetadata").doc("integrationBaseline").set({
  schemaVersion: 2,
  fixtureVersion: "phase12-v1",
  siteId,
  rootSupervisorUid: root.uid,
  cleanerFixtureIds: [availableCleanerId],
  cameraFixtureIds: [laptopCameraId, loopedCameraId],
  activeAlertId: alertId,
  preparedAt: new Date(),
  preparedBy: "v2:prepare-integration-baseline",
}, { merge: true });

console.log(JSON.stringify({
  target: `${env.firebaseProjectId}/${env.firebaseDatabaseId}`,
  siteId,
  fixtures: { availableCleanerId, laptopCameraId, loopedCameraId, alertId },
  dashboardCounts: dashboard.counts,
  analyticsStatus: analytics.status,
}, null, 2));
