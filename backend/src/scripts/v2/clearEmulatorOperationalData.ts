import "dotenv/config";
import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "../../config/firebase.js";
import { env } from "../../config/env.js";
import { deleteStoredMedia } from "../../services/localMediaStorage.js";

const siteId = process.env.CLEANUP_SITE_ID?.trim() || "sunway-theme-park";
const apply = process.argv.includes("--apply");
const confirmation = process.argv.find((argument) => argument.startsWith("--confirm-site="))?.slice("--confirm-site=".length);
const expectedHost = "127.0.0.1:8180";

if (env.appEnvironment !== "local-emulator" || env.firebaseProjectId !== "demo-litterspot" || process.env.FIRESTORE_EMULATOR_HOST !== expectedHost) {
  throw new Error(`Refusing cleanup outside demo-litterspot on ${expectedHost}.`);
}
if (apply && confirmation !== siteId) throw new Error(`Apply requires --confirm-site=${siteId}.`);

const disposableCollections = [
  "activeAlertKeys",
  "activeWorkOrderKeys",
  "alerts",
  "analysisRuns",
  "analyticsDailySummaries",
  "analyticsMinuteBuckets",
  "analyticsSampleApplications",
  "auditEvents",
  "binPlacementInterventions",
  "binPlacementSnapshots",
  "cameraDraftLocks",
  "cameraDrafts",
  "cameraRegistrationRevisions",
  "cameraRegistrations",
  "cameraRuntimeStates",
  "cameraSourceRevisions",
  "cameras",
  "dashboardSummaries",
  "detections",
  "flags",
  "monitoringEpisodes",
  "monitoringSessions",
  "notifications",
  "operationKeys",
  "orchestratorOutbox",
  "orchestratorRuns",
  "phase11MaintenanceStates",
  "processingJobs",
  "reviewRequests",
  "reviews",
  "systemEvents",
  "workOrderDecisions",
  "workOrders",
  "zones",
] as const;

const retainedMediaPurposes = new Set(["site_background", "cleaner_profile"]);

async function siteDocuments(collectionName: string) {
  return (await firestore.collection(collectionName).where("siteId", "==", siteId).get()).docs;
}

const site = await firestore.collection("sites").doc(siteId).get();
if (!site.exists || site.data()?.status !== "active") throw new Error(`Active Site ${siteId} was not found.`);
const activeRevisionId = String(site.data()?.activeMapRevisionId ?? "");
const activeRevision = await firestore.collection("siteMapRevisions").doc(activeRevisionId).get();
if (!activeRevision.exists || activeRevision.data()?.siteId !== siteId) throw new Error("The active Site Map revision is missing.");

const counts: Record<string, number> = {};
for (const collectionName of disposableCollections) counts[collectionName] = (await siteDocuments(collectionName)).length;
const media = await siteDocuments("mediaAssets");
const disposableMedia = media.filter((document) => !retainedMediaPurposes.has(String(document.data()?.purpose ?? "")));
counts.mediaAssets = disposableMedia.length;
counts.siteMapRevisions = (await siteDocuments("siteMapRevisions")).length;
counts.siteMapDrafts = (await siteDocuments("siteMapDrafts")).length;

console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", projectId: env.firebaseProjectId, firestoreHost: process.env.FIRESTORE_EMULATOR_HOST, siteId, preserved: ["Site", "Root and Supervisor accounts", "Cleaner accounts", "Cleaner Station Points as unzoned", "Site background"], counts }, null, 2));
if (!apply) process.exit(0);

const cleanRevisionRef = firestore.collection("siteMapRevisions").doc();
const sourceStations = await activeRevision.ref.collection("cleanerStations").get();
const nextRevisionNumber = Number(site.data()?.mapRevisionNumber ?? activeRevision.data()?.revisionNumber ?? 0) + 1;
const cleanHash = createHash("sha256").update(`${siteId}:clean:${activeRevisionId}:${nextRevisionNumber}`).digest("hex");

await cleanRevisionRef.create({
  ...activeRevision.data(),
  schemaVersion: 2,
  revisionId: cleanRevisionRef.id,
  siteId,
  revisionNumber: nextRevisionNumber,
  parentRevisionId: activeRevisionId,
  zoneCount: 0,
  cameraPlacementCount: 0,
  cleanerStationCount: sourceStations.size,
  contentHash: cleanHash,
  publishedAt: FieldValue.serverTimestamp(),
  publishedByUid: "local-emulator-cleanup",
  publicationRequestId: "local-emulator-cleanup",
});
for (const station of sourceStations.docs) {
  await cleanRevisionRef.collection("cleanerStations").doc(station.id).create({ ...station.data(), zoneId: null, publishedAt: FieldValue.serverTimestamp(), publishedByUid: "local-emulator-cleanup" });
}

await firestore.collection("sites").doc(siteId).update({
  activeMapRevisionId: cleanRevisionRef.id,
  mapRevisionNumber: nextRevisionNumber,
  mapDraftExists: false,
  firstCameraCreated: false,
  laptopCameraId: null,
  enabledLaptopCameraId: null,
  updatedAt: FieldValue.serverTimestamp(),
  updatedByUid: "local-emulator-cleanup",
  revision: FieldValue.increment(1),
});

for (const cleaner of await siteDocuments("cleaners")) {
  await cleaner.ref.update({ activeWorkOrderId: null, activeWorkAssignedAt: null, stationZoneId: null, updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) });
}

for (const draft of await siteDocuments("siteMapDrafts")) await firestore.recursiveDelete(draft.ref);
for (const collectionName of disposableCollections) {
  for (const document of await siteDocuments(collectionName)) await firestore.recursiveDelete(document.ref);
}
for (const document of disposableMedia) {
  const storageKey = document.data()?.storageKey;
  if (typeof storageKey === "string") await deleteStoredMedia(storageKey).catch(() => undefined);
  await firestore.recursiveDelete(document.ref);
}
for (const revision of await siteDocuments("siteMapRevisions")) {
  if (revision.id !== cleanRevisionRef.id) await firestore.recursiveDelete(revision.ref);
}

console.log(JSON.stringify({ status: "complete", siteId, activeMapRevisionId: cleanRevisionRef.id, retainedCleanerStations: sourceStations.size }, null, 2));
