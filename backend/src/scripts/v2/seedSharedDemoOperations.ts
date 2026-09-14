import "dotenv/config";
import { FieldValue, Timestamp, type DocumentReference, type WriteBatch } from "firebase-admin/firestore";
import { firestore } from "../../config/firebase.js";
import { env } from "../../config/env.js";
import { rebuildDailySummaries } from "../../services/phase11Daily.js";
import { persistMinuteContributions } from "../../services/phase11MinuteStore.js";
import { buildDashboard, compareIntervention, refreshBinPlacement } from "../../services/phase11Service.js";
import { shiftDate, siteLocalDate, siteMidnight } from "../../services/phase11Calendar.js";
import { allDocuments } from "../../services/phase11Data.js";
import { assertV2MigrationTarget } from "../../services/v2MigrationSafety.js";

const siteId = "sunway-theme-park";
const expectedHost = "127.0.0.1:8180";
const historyDays = 30;
const structuralCollections = [
  "sites",
  "siteMapRevisions",
  "zones",
  "cameras",
  "cameraSourceRevisions",
  "cameraRegistrationRevisions",
  "cameraRegistrations",
  "mediaAssets",
] as const;
const flatOperationalCollections = [
  "activeAlertKeys",
  "activeWorkOrderKeys",
  "analyticsDailySummaries",
  "analyticsMinuteBuckets",
  "analyticsSampleApplications",
  "binPlacementInterventions",
  "binPlacementSnapshots",
  "dashboardSummaries",
  "notifications",
  "orchestratorOutbox",
  "orchestratorRuns",
  "phase11MaintenanceStates",
  "reviewRequests",
  "reviews",
  "workOrderDecisions",
] as const;

assertV2MigrationTarget({
  appEnvironment: env.appEnvironment,
  firebaseProjectId: env.firebaseProjectId,
  expectedFirebaseProjectId: env.expectedFirebaseProjectId,
  firestoreDatabaseId: env.firebaseDatabaseId,
  emulator: Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST),
});
if (env.appEnvironment !== "local-emulator" || env.firebaseProjectId !== "demo-litterspot" || process.env.FIRESTORE_EMULATOR_HOST !== expectedHost) {
  throw new Error(`Refusing presentation-data seed outside demo-litterspot on ${expectedHost}.`);
}

const site = await firestore.collection("sites").doc(siteId).get();
const mapRevisionId = String(site.data()?.activeMapRevisionId ?? "");
if (!site.exists || site.data()?.schemaVersion !== 2 || site.data()?.status !== "active" || !mapRevisionId) throw new Error("The active Sunway Theme Park Site Map is required.");
const revision = await firestore.collection("siteMapRevisions").doc(mapRevisionId).get();
if (!revision.exists || revision.data()?.siteId !== siteId) throw new Error("The active Site Map revision is missing.");

async function siteIds(collectionName: string) {
  const documents = collectionName === "sites"
    ? [await firestore.collection(collectionName).doc(siteId).get()]
    : await allDocuments(firestore.collection(collectionName).where("siteId", "==", siteId));
  return documents.filter((document) => document.exists).map((document) => document.id).sort();
}

async function structuralIdentity() {
  const collections = Object.fromEntries(await Promise.all(structuralCollections.map(async (collectionName) => [collectionName, await siteIds(collectionName)])));
  const nested = Object.fromEntries(await Promise.all(["zoneGeometry", "cameraPlacements", "cleanerStations"].map(async (collectionName) => [
    collectionName,
    (await revision.ref.collection(collectionName).get()).docs.map((document) => document.id).sort(),
  ])));
  return { activeMapRevisionId: mapRevisionId, collections, nested };
}

async function deleteFlatSiteDocuments(collectionName: string) {
  const documents = await allDocuments(firestore.collection(collectionName).where("siteId", "==", siteId));
  for (let offset = 0; offset < documents.length; offset += 400) {
    const batch = firestore.batch();
    for (const document of documents.slice(offset, offset + 400)) batch.delete(document.ref);
    await batch.commit();
  }
  return documents.length;
}

async function deleteRecursiveSiteDocuments(collectionName: "alerts" | "workOrders") {
  const documents = await allDocuments(firestore.collection(collectionName).where("siteId", "==", siteId));
  for (let offset = 0; offset < documents.length; offset += 12) {
    await Promise.all(documents.slice(offset, offset + 12).map((document) => firestore.recursiveDelete(document.ref)));
  }
  return documents.length;
}

const structuralBefore = await structuralIdentity();
const [geometry, placements, cleanerDocs, supervisorDocs] = await Promise.all([
  revision.ref.collection("zoneGeometry").get(),
  revision.ref.collection("cameraPlacements").get(),
  firestore.collection("cleaners").where("siteId", "==", siteId).where("schemaVersion", "==", 2).get(),
  firestore.collection("supervisors").where("siteId", "==", siteId).where("schemaVersion", "==", 2).get(),
]);
const zones = geometry.docs.map((document) => ({
  id: document.id,
  name: String(document.data()?.zoneNameSnapshot ?? document.id),
  polygon: document.data()?.polygon as Array<{ xMeters: number; yMeters: number }>,
})).filter((zone) => Array.isArray(zone.polygon) && zone.polygon.length >= 3).sort((left, right) => left.name.localeCompare(right.name));
if (zones.length < 2) throw new Error("At least two active Zones are required for useful Bin Analysis data.");

const camerasByZone = new Map<string, Array<{ id: string; name: string; point: { xMeters: number; yMeters: number } }>>();
for (const document of placements.docs) {
  const data = document.data();
  const zoneId = String(data.zoneId ?? "");
  const cameras = camerasByZone.get(zoneId) ?? [];
  cameras.push({ id: String(data.cameraId ?? document.id), name: String(data.cameraNameSnapshot ?? data.cameraId ?? document.id), point: data.point });
  camerasByZone.set(zoneId, cameras);
}
const cleaners = cleanerDocs.docs.filter((document) => document.data()?.status === "active").map((document) => ({ id: document.id, name: String(document.data()?.fullName ?? document.id) }));
if (!cleaners.length) throw new Error("At least one active Cleaner is required for Work history.");
const rootSupervisor = supervisorDocs.docs.find((document) => document.data()?.authority === "root") ?? supervisorDocs.docs[0];
if (!rootSupervisor) throw new Error("At least one active Supervisor is required for Intervention history.");
const supervisorActor = {
  type: "human",
  uid: rootSupervisor.id,
  role: "supervisor",
  authority: String(rootSupervisor.data()?.authority ?? "regular"),
  displayNameSnapshot: String(rootSupervisor.data()?.fullName ?? "Site Supervisor"),
};

const deleted: Record<string, number> = {};
for (const collectionName of flatOperationalCollections) deleted[collectionName] = await deleteFlatSiteDocuments(collectionName);
deleted.alerts = await deleteRecursiveSiteDocuments("alerts");
deleted.workOrders = await deleteRecursiveSiteDocuments("workOrders");
for (const cleaner of cleanerDocs.docs) {
  await cleaner.ref.update({ activeWorkOrderId: null, activeWorkAssignedAt: null, updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) });
}

const timeZone = String(site.data()?.timeZone ?? "Asia/Kuala_Lumpur");
const now = new Date();
const anchorDate = shiftDate(siteLocalDate(now, timeZone), -1);
const dates = Array.from({ length: historyDays }, (_, index) => shiftDate(anchorDate, index - historyDays + 1));
const interventionIndex = historyDays - 11;
const interventionDate = dates[interventionIndex];
const workPattern = [0, 1, 0, -1, 1, -1];
const binPattern = [0, 0, 1, -1, 0];
const peoplePattern = [0, 5, -3, 7, 2, 10];
const zoneProfiles: Record<string, { people: number; work: number; bin: number; overflowEvery: number }> = {
  "Main Facilities & Plaza": { people: 122, work: 4, bin: 3, overflowEvery: 2 },
  "Central Lagoon & Beach": { people: 110, work: 4, bin: 3, overflowEvery: 3 },
  "F&B": { people: 103, work: 4, bin: 3, overflowEvery: 2 },
  "Wave Pool & Lazy River": { people: 96, work: 4, bin: 3, overflowEvery: 2 },
  "Water Slides North": { people: 87, work: 3, bin: 2, overflowEvery: 3 },
  "Kids Splash Area": { people: 78, work: 3, bin: 1, overflowEvery: 4 },
  "Water Slides East": { people: 71, work: 2, bin: 2, overflowEvery: 4 },
  "Thrill Rides": { people: 64, work: 2, bin: 1, overflowEvery: 5 },
  "Hall": { people: 57, work: 1, bin: 1, overflowEvery: 6 },
};

let batch: WriteBatch = firestore.batch();
let writes = 0;
let alertCount = 0;
let workCount = 0;
const commit = async () => { if (!writes) return; await batch.commit(); batch = firestore.batch(); writes = 0; };
const set = (reference: DocumentReference, data: FirebaseFirestore.DocumentData) => { batch.set(reference, data); writes += 1; };

for (const [dayIndex, localDate] of dates.entries()) {
  const dayStart = siteMidnight(localDate, timeZone);
  for (const [zoneIndex, zone] of zones.entries()) {
    const profile = zoneProfiles[zone.name] ?? { people: Math.max(42, 92 - zoneIndex * 7), work: Math.max(1, 4 - Math.floor(zoneIndex / 2)), bin: Math.max(1, 3 - Math.floor(zoneIndex / 3)), overflowEvery: 4 };
    const afterWavePoolIntervention = zone.name === "Wave Pool & Lazy River" && dayIndex >= interventionIndex;
    const dailyWork = afterWavePoolIntervention
      ? [2, 1, 2, 1, 1, 2, 1][dayIndex % 7]
      : Math.max(1, profile.work + workPattern[(dayIndex + zoneIndex) % workPattern.length]);
    const dailyBin = afterWavePoolIntervention
      ? [1, 0, 1, 0, 0, 1, 0][dayIndex % 7]
      : Math.min(dailyWork, Math.max(0, profile.bin + binPattern[(dayIndex + zoneIndex) % binPattern.length]));
    const camera = camerasByZone.get(zone.id)?.[0] ?? null;
    const point = camera?.point ?? zone.polygon[0];
    for (let occurrence = 0; occurrence < dailyWork; occurrence += 1) {
      const createdAt = new Date(+dayStart + (9 * 60 + zoneIndex * 11 + occurrence * 43) * 60_000);
      const startedAt = new Date(+createdAt + (4 + occurrence * 2) * 60_000);
      const submittedAt = new Date(+startedAt + (16 + zoneIndex * 2) * 60_000);
      const resolvedAt = new Date(+submittedAt + 7 * 60_000);
      const issueType = occurrence < dailyBin ? "bin_service" : occurrence % 2 ? "floor_spill" : "floor_litter";
      const overflow = issueType === "bin_service" && occurrence === 0 && (dayIndex + zoneIndex) % profile.overflowEvery === 0;
      const observedCondition = issueType === "bin_service" ? overflow ? "overflow" : "full" : issueType === "floor_spill" ? "spill" : "litter";
      const severity = overflow || issueType === "floor_spill" ? "critical" : "warning";
      const key = `${localDate}-${zoneIndex}-${occurrence}`;
      const alertId = `operations-history-alert-${key}`;
      const workId = `operations-history-work-${key}`;
      const cleaner = cleaners[(zoneIndex + dayIndex + occurrence) % cleaners.length];
      const alertRef = firestore.collection("alerts").doc(alertId);
      const workRef = firestore.collection("workOrders").doc(workId);
      set(alertRef, {
        schemaVersion: 2, alertId, siteId, mapRevisionId, cameraId: camera?.id ?? null, cameraNameSnapshot: camera?.name ?? "Site operations",
        zoneId: zone.id, zoneNameSnapshot: zone.name, issueType, observedCondition, status: "resolved", severity,
        highestSeverity: severity, priorityScore: severity === "critical" ? 90 : 55, priorityPolicyVersion: "priority-v2",
        activeWorkOrderId: null, evidenceMediaId: null, firstDetectedAt: Timestamp.fromDate(createdAt), lastDetectedAt: Timestamp.fromDate(createdAt),
        occurrenceCount: 1, affectedBinIds: issueType === "bin_service" ? [`${zone.id}-bin-01`] : [],
        createdAt: Timestamp.fromDate(createdAt), updatedAt: Timestamp.fromDate(resolvedAt), resolvedAt: Timestamp.fromDate(resolvedAt),
        resolvedBy: supervisorActor, dismissedAt: null, dismissedBy: null, dismissReason: null, managementMode: "orchestrated", isSimulation: false, revision: 2,
      });
      set(alertRef.collection("events").doc("created"), {
        schemaVersion: 2, siteId, alertId, type: "created", fromStatus: null, toStatus: "waiting_for_cleaner",
        fromSeverity: null, toSeverity: severity, fromCondition: null, toCondition: observedCondition, workOrderId: null,
        actor: { type: "system", serviceId: "alert-policy", displayNameSnapshot: "Alert policy" }, reasonCode: observedCondition,
        note: null, requestId: `operations-history-created-${key}`, occurredAt: Timestamp.fromDate(createdAt), analyticsAppliedVersion: null, analyticsAppliedAt: null,
      });
      set(alertRef.collection("events").doc("resolved"), {
        schemaVersion: 2, siteId, alertId, type: "resolved", fromStatus: "awaiting_review", toStatus: "resolved",
        fromSeverity: severity, toSeverity: severity, workOrderId: workId, actor: supervisorActor,
        reasonCode: "verification_passed", note: null, requestId: `operations-history-resolved-${key}`, occurredAt: Timestamp.fromDate(resolvedAt),
        analyticsAppliedVersion: null, analyticsAppliedAt: null,
      });
      const title = `${issueType === "bin_service" ? "Service registered bin" : issueType === "floor_spill" ? "Clean floor spill" : "Remove floor litter"} at ${zone.name}`;
      set(workRef, {
        schemaVersion: 2, workOrderId: workId, siteId, origin: "alert", alertId, managementMode: "orchestrated", status: "resolved", severity,
        issueType, title, instructions: title, assignedCleanerId: cleaner.id, cleanerNameSnapshot: cleaner.name, mapRevisionId,
        zoneId: zone.id, cameraId: camera?.id ?? null,
        target: { type: camera ? "camera" : "coordinate", mapRevisionId, zoneId: zone.id, zoneNameSnapshot: zone.name, point, ...(camera ? { cameraId: camera.id, cameraNameSnapshot: camera.name } : {}) },
        assignedAt: Timestamp.fromDate(createdAt), assignedBy: { type: "orchestrator", serviceId: "site-orchestrator", displayNameSnapshot: "Site Orchestrator" },
        createdAt: Timestamp.fromDate(createdAt), startedAt: Timestamp.fromDate(startedAt), submittedAt: Timestamp.fromDate(submittedAt),
        resolvedAt: Timestamp.fromDate(resolvedAt), resolvedBy: supervisorActor, updatedAt: Timestamp.fromDate(resolvedAt),
        creationEvidenceMediaId: null, completionEvidenceMediaId: null, latestVerificationId: `operations-history-verification-${key}`,
        latestVerificationOutcome: "passed", reworkCount: 0, isSimulation: false, revision: 4,
      });
      set(workRef.collection("events").doc("assigned"), {
        schemaVersion: 2, siteId, workOrderId: workId, type: "assigned", fromStatus: "waiting_for_cleaner", toStatus: "assigned",
        cleanerId: cleaner.id, previousCleanerId: null, actor: { type: "orchestrator", serviceId: "site-orchestrator", displayNameSnapshot: "Site Orchestrator" },
        reasonCode: "cleaner_assigned", note: null, evidenceMediaIds: [], requestId: `operations-history-assigned-${key}`,
        occurredAt: Timestamp.fromDate(createdAt), analyticsAppliedVersion: null, analyticsAppliedAt: null,
      });
      set(workRef.collection("events").doc("resolved"), {
        schemaVersion: 2, siteId, workOrderId: workId, type: "resolved", fromStatus: "awaiting_review", toStatus: "resolved",
        cleanerId: cleaner.id, previousCleanerId: null, actor: supervisorActor, reasonCode: "verification_passed", note: null,
        evidenceMediaIds: [], requestId: `operations-history-resolved-${key}`, occurredAt: Timestamp.fromDate(resolvedAt),
        analyticsAppliedVersion: null, analyticsAppliedAt: null,
      });
      alertCount += 1;
      workCount += 1;
      if (writes >= 390) await commit();
    }
  }
  await persistMinuteContributions(siteId, new Date(+dayStart + 12 * 3_600_000), timeZone, zones.map((zone, zoneIndex) => {
    const profile = zoneProfiles[zone.name] ?? { people: Math.max(42, 92 - zoneIndex * 7), work: 2, bin: 1, overflowEvery: 4 };
    const afterWavePoolIntervention = zone.name === "Wave Pool & Lazy River" && dayIndex >= interventionIndex;
    const people = Math.max(1, profile.people + peoplePattern[(dayIndex + zoneIndex) % peoplePattern.length] - (afterWavePoolIntervention ? 2 : 0));
    return {
      id: `operations-history-minute:${localDate}:${zone.id}`, zoneId: zone.id, zoneNameSnapshot: zone.name, mapRevisionId,
      metrics: {
        eligibleCameraCount: Math.max(1, camerasByZone.get(zone.id)?.length ?? 0), sampleAttemptCount: 24, successfulSampleCount: 24,
        failedSampleCount: 0, peopleObservationCount: 24, peopleSum: people * 24, peopleMax: people + 11,
        qualifyingLitterCount: profile.work > 2 ? 2 : 1, qualifyingSpillCount: zoneIndex % 3 === 0 ? 1 : 0,
        qualifyingBinFullCount: afterWavePoolIntervention ? 1 : profile.bin, qualifyingBinOverflowCount: afterWavePoolIntervention ? 0 : dayIndex % profile.overflowEvery === 0 ? 1 : 0,
        simulationSampleCount: 0, inferenceLatencyMsSum: 4_320, inferenceLatencySampleCount: 24, offlineCameraSeconds: 0,
      },
    };
  }));
}
await commit();

await rebuildDailySummaries(siteId, dates, now);
const interventionZone = zones.find((zone) => zone.name === "Wave Pool & Lazy River") ?? zones[Math.min(2, zones.length - 1)];
const interventionId = `operations-intervention-${interventionDate}-${interventionZone.id}`;
await firestore.collection("binPlacementInterventions").doc(interventionId).set({
  schemaVersion: 2, interventionId, siteId, zoneId: interventionZone.id, zoneNameSnapshot: interventionZone.name, mapRevisionId,
  timeZoneSnapshot: timeZone, implementedAt: Timestamp.fromDate(siteMidnight(interventionDate, timeZone)), implementedByUid: rootSupervisor.id,
  sourceSnapshotCalculatedAt: Timestamp.fromMillis(+siteMidnight(interventionDate, timeZone) - 60_000),
  rankingSnapshot: { zoneId: interventionZone.id, zoneNameSnapshot: interventionZone.name, rank: 1, totalScore: 84.7, coverage: { requestedDays: 30, availableDays: 30, partial: false } },
  requestedLookbackDaysSnapshot: 30, availableCoverageSnapshot: { requestedDays: 30, availableDays: 30, partial: false },
  exclusionEndsAt: Timestamp.fromDate(siteMidnight(shiftDate(interventionDate, 2), timeZone)),
  note: "A second high-capacity bin was installed beside the Wave Pool exit.", createdAt: Timestamp.fromDate(siteMidnight(interventionDate, timeZone)),
});

const binPlacement = await refreshBinPlacement(siteId, historyDays, { uid: rootSupervisor.id, role: "supervisor", authority: supervisorActor.authority, displayName: supervisorActor.displayNameSnapshot }, now);
const dashboard = await buildDashboard(siteId, now);
const comparison = await compareIntervention(siteId, interventionId, 7, now);
await firestore.collection("systemMetadata").doc("shared-demo-operations").set({
  schemaVersion: 2, siteId, kind: "presentation_operations_seed", anchorDate, dates, mapRevisionId,
  generatedAlertCount: alertCount, generatedWorkCount: workCount, interventionId, updatedAt: FieldValue.serverTimestamp(),
});

const structuralAfter = await structuralIdentity();
if (JSON.stringify(structuralAfter) !== JSON.stringify(structuralBefore)) {
  throw new Error("Protected Site Map, Zone, Camera, registration, or media identities changed during the analytics seed.");
}

console.log(JSON.stringify({
  status: "complete", siteId, mapRevisionId, anchorDate, historyDays, dates: { from: dates[0], to: dates.at(-1) },
  zones: zones.map((zone) => zone.name), deleted, generatedAlertCount: alertCount, generatedWorkCount: workCount,
  dailySummaryCount: dates.length, intervention: { zone: interventionZone.name, implementedOn: interventionDate, beforeDays: comparison.before.availableDays, afterDays: comparison.after.availableDays },
  binPlacementStatus: binPlacement.status,
  rankedZones: binPlacement.zoneRankings.map((zone: { rank: number | null; zoneNameSnapshot: string; totalScore: number | null }) => ({ rank: zone.rank, zone: zone.zoneNameSnapshot, score: zone.totalScore })),
  dashboardCounts: dashboard.counts,
  protectedDataVerified: true,
}, null, 2));
