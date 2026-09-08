import "dotenv/config";
import { FieldValue, Timestamp, type WriteBatch } from "firebase-admin/firestore";
import { firestore } from "../../config/firebase.js";
import { env } from "../../config/env.js";
import { rebuildDailySummaries } from "../../services/phase11Daily.js";
import { persistMinuteContributions } from "../../services/phase11MinuteStore.js";
import { buildDashboard, refreshBinPlacement } from "../../services/phase11Service.js";
import { shiftDate, siteLocalDate, siteMidnight } from "../../services/phase11Calendar.js";
import { assertV2MigrationTarget } from "../../services/v2MigrationSafety.js";

const siteId = "sunway-theme-park";
const expectedHost = "127.0.0.1:8180";
assertV2MigrationTarget({
  appEnvironment: env.appEnvironment,
  firebaseProjectId: env.firebaseProjectId,
  expectedFirebaseProjectId: env.expectedFirebaseProjectId,
  firestoreDatabaseId: env.firebaseDatabaseId,
  emulator: Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST),
});
if (env.appEnvironment !== "local-emulator" || env.firebaseProjectId !== "demo-litterspot" || process.env.FIRESTORE_EMULATOR_HOST !== expectedHost) {
  throw new Error(`Refusing shared demo seed outside demo-litterspot on ${expectedHost}.`);
}

const site = await firestore.collection("sites").doc(siteId).get();
const mapRevisionId = String(site.data()?.activeMapRevisionId ?? "");
if (!site.exists || site.data()?.schemaVersion !== 2 || site.data()?.status !== "active" || !mapRevisionId) throw new Error("The active Sunway Theme Park Site Map is required.");
const revision = await firestore.collection("siteMapRevisions").doc(mapRevisionId).get();
if (!revision.exists || revision.data()?.siteId !== siteId) throw new Error("The active Site Map revision is missing.");

const [geometry, placements, cleanerDocs, metadata] = await Promise.all([
  revision.ref.collection("zoneGeometry").get(),
  revision.ref.collection("cameraPlacements").get(),
  firestore.collection("cleaners").where("siteId", "==", siteId).where("schemaVersion", "==", 2).get(),
  firestore.collection("systemMetadata").doc("shared-demo-operations").get(),
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
if (!cleaners.length) throw new Error("At least one active Cleaner is required for shared Work history.");

const timeZone = String(site.data()?.timeZone ?? "Asia/Kuala_Lumpur");
const now = new Date();
const yesterday = shiftDate(siteLocalDate(now, timeZone), -1);
const anchorDate = typeof metadata.data()?.anchorDate === "string" ? String(metadata.data()?.anchorDate) : yesterday;
const dates = Array.from({ length: 10 }, (_, index) => shiftDate(anchorDate, index - 9));
const workPressure = [4, 3, 3, 2, 2, 1, 1];
const binPressure = [3, 2, 1, 2, 1, 1, 0];
const peoplePressure = [82, 68, 60, 51, 43, 35, 27];
let batch: WriteBatch = firestore.batch();
let writes = 0;
let alertCount = 0;
let workCount = 0;
const commit = async () => { if (!writes) return; await batch.commit(); batch = firestore.batch(); writes = 0; };
const set = (reference: FirebaseFirestore.DocumentReference, data: FirebaseFirestore.DocumentData) => { batch.set(reference, data, { merge: true }); writes += 1; };

for (const [dayIndex, localDate] of dates.entries()) {
  const dayStart = siteMidnight(localDate, timeZone);
  for (const [zoneIndex, zone] of zones.entries()) {
    const dailyWork = workPressure[zoneIndex % workPressure.length];
    const dailyBin = binPressure[zoneIndex % binPressure.length];
    const camera = camerasByZone.get(zone.id)?.[0] ?? null;
    const point = camera?.point ?? zone.polygon[0];
    for (let occurrence = 0; occurrence < dailyWork; occurrence += 1) {
      const createdAt = new Date(+dayStart + (9 * 60 + zoneIndex * 13 + occurrence * 37) * 60_000);
      const startedAt = new Date(+createdAt + (5 + occurrence * 2) * 60_000);
      const submittedAt = new Date(+startedAt + (18 + zoneIndex * 3) * 60_000);
      const resolvedAt = new Date(+submittedAt + 8 * 60_000);
      const issueType = occurrence < dailyBin ? "bin_service" : occurrence % 2 ? "floor_spill" : "floor_litter";
      const observedCondition = issueType === "bin_service" ? occurrence === 0 && zoneIndex < 2 ? "overflow" : "full" : issueType === "floor_spill" ? "spill" : "litter";
      const severity = observedCondition === "overflow" || zoneIndex === 0 && occurrence === dailyWork - 1 ? "critical" : "warning";
      const key = `${localDate}-${zoneIndex}-${occurrence}`;
      const alertId = `shared-demo-alert-${key}`;
      const workId = `shared-demo-work-${key}`;
      const cleaner = cleaners[(zoneIndex + dayIndex + occurrence) % cleaners.length];
      const alertRef = firestore.collection("alerts").doc(alertId);
      const workRef = firestore.collection("workOrders").doc(workId);
      set(alertRef, {
        schemaVersion: 2, alertId, siteId, cameraId: camera?.id ?? null, cameraNameSnapshot: camera?.name ?? "Coordinate observation",
        zoneId: zone.id, zoneNameSnapshot: zone.name, issueType, observedCondition, status: "resolved", severity,
        highestSeverity: severity, priorityScore: severity === "critical" ? 90 : 55, activeWorkOrderId: null, evidenceMediaId: null,
        firstDetectedAt: Timestamp.fromDate(createdAt), createdAt: Timestamp.fromDate(createdAt), updatedAt: Timestamp.fromDate(resolvedAt),
        resolvedAt: Timestamp.fromDate(resolvedAt), dismissedAt: null, isSimulation: true, revision: 1,
      });
      set(alertRef.collection("events").doc("resolved"), {
        schemaVersion: 2, siteId, alertId, type: "resolved", fromStatus: "awaiting_review", toStatus: "resolved",
        fromSeverity: severity, toSeverity: severity, workOrderId: workId, actor: { type: "system", serviceId: "shared-demo-seed", displayNameSnapshot: "Shared demo data" },
        reasonCode: "verification_passed", note: null, requestId: `shared-demo-${key}`, occurredAt: Timestamp.fromDate(resolvedAt), analyticsAppliedVersion: null, analyticsAppliedAt: null,
      });
      set(workRef, {
        schemaVersion: 2, workOrderId: workId, siteId, origin: "alert", alertId, managementMode: "orchestrated", status: "resolved", severity,
        issueType, title: `${issueType === "bin_service" ? "Service bin" : issueType === "floor_spill" ? "Clean floor spill" : "Remove floor litter"} at ${zone.name}`,
        instructions: "Complete the reported cleanup and submit the required evidence.", assignedCleanerId: cleaner.id, cleanerNameSnapshot: cleaner.name,
        zoneId: zone.id, cameraId: camera?.id ?? null, target: { type: camera ? "camera" : "coordinate", zoneId: zone.id, zoneNameSnapshot: zone.name, point, ...(camera ? { cameraId: camera.id, cameraNameSnapshot: camera.name } : {}) },
        assignedAt: Timestamp.fromDate(createdAt), createdAt: Timestamp.fromDate(createdAt), startedAt: Timestamp.fromDate(startedAt), submittedAt: Timestamp.fromDate(submittedAt),
        resolvedAt: Timestamp.fromDate(resolvedAt), updatedAt: Timestamp.fromDate(resolvedAt), completionEvidenceMediaId: null,
        latestVerificationId: `shared-demo-verification-${key}`, latestVerificationOutcome: "passed", reworkCount: 0, isSimulation: true, revision: 1,
      });
      set(workRef.collection("events").doc("resolved"), {
        schemaVersion: 2, siteId, workOrderId: workId, type: "resolved", fromStatus: "awaiting_review", toStatus: "resolved", cleanerId: cleaner.id,
        previousCleanerId: null, actor: { type: "system", serviceId: "shared-demo-seed", displayNameSnapshot: "Shared demo data" }, reasonCode: "verification_passed",
        note: null, requestId: `shared-demo-${key}`, occurredAt: Timestamp.fromDate(resolvedAt), evidenceMediaIds: [], analyticsAppliedVersion: null, analyticsAppliedAt: null,
      });
      alertCount += 1; workCount += 1;
      if (writes >= 400) await commit();
    }
  }
  await persistMinuteContributions(siteId, new Date(+dayStart + 12 * 3_600_000), timeZone, zones.map((zone, zoneIndex) => {
    const people = peoplePressure[zoneIndex % peoplePressure.length] + dayIndex * 2;
    return { id: `shared-demo-minute:${localDate}:${zone.id}`, zoneId: zone.id, zoneNameSnapshot: zone.name, mapRevisionId,
      metrics: { sampleAttemptCount: 12, successfulSampleCount: 12, failedSampleCount: 0, peopleObservationCount: 12, peopleSum: people * 12,
        peopleMax: people + 7, qualifyingLitterCount: Math.max(0, workPressure[zoneIndex % workPressure.length] - binPressure[zoneIndex % binPressure.length]),
        qualifyingSpillCount: zoneIndex % 3 === 0 ? 2 : 1, qualifyingBinFullCount: binPressure[zoneIndex % binPressure.length],
        qualifyingBinOverflowCount: zoneIndex < 2 ? 1 : 0, simulationSampleCount: 12, inferenceLatencyMsSum: 2_400, inferenceLatencySampleCount: 12 } };
  }));
}
set(firestore.collection("systemMetadata").doc("shared-demo-operations"), {
  schemaVersion: 2, siteId, kind: "shared_demo_operations", anchorDate, dates, mapRevisionId,
  generatedAlertCount: alertCount, generatedWorkCount: workCount, updatedAt: FieldValue.serverTimestamp(),
});
await commit();
await rebuildDailySummaries(siteId, dates, now);
const binPlacement = await refreshBinPlacement(siteId, 30, { uid: "shared-demo-seed", role: "system" }, now);
const dashboard = await buildDashboard(siteId, now);

console.log(JSON.stringify({
  status: "complete", siteId, mapRevisionId, anchorDate, dates, zones: zones.map((zone) => zone.name),
  generatedAlertCount: alertCount, generatedWorkCount: workCount, dailySummaryCount: dates.length,
  binPlacementStatus: binPlacement.status,
  rankedZones: binPlacement.zoneRankings.map((zone: { rank: number | null; zoneNameSnapshot: string; totalScore: number | null }) => ({ rank: zone.rank, zone: zone.zoneNameSnapshot, score: zone.totalScore })),
  dashboardCounts: dashboard.counts,
}, null, 2));
