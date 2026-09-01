import "dotenv/config";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { firestore } from "../../config/firebase.js";
import { env } from "../../config/env.js";
import { rebuildDailySummaries } from "../../services/phase11Daily.js";
import { persistMinuteContributions } from "../../services/phase11MinuteStore.js";
import { buildDashboard, refreshBinPlacement } from "../../services/phase11Service.js";
import { shiftDate, siteLocalDate, siteMidnight } from "../../services/phase11Calendar.js";
import { assertV2MigrationTarget } from "../../services/v2MigrationSafety.js";

assertV2MigrationTarget({
  appEnvironment: env.appEnvironment,
  firebaseProjectId: env.firebaseProjectId,
  expectedFirebaseProjectId: env.expectedFirebaseProjectId,
  firestoreDatabaseId: env.firebaseDatabaseId,
  emulator: Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST),
});
if (env.firebaseProjectId !== "litterspot-v2-database" || env.firebaseDatabaseId !== "(default)") {
  throw new Error("Phase 11 cloud seed is locked to litterspot-v2-database/(default).");
}

const siteId = "sunway-theme-park";
const site = await firestore.collection("sites").doc(siteId).get();
const mapRevisionId = String(site.data()?.activeMapRevisionId ?? "");
if (!site.exists || site.data()?.schemaVersion !== 2 || site.data()?.status !== "active" || !mapRevisionId) {
  throw new Error("Run the V2 development bootstrap before seeding Phase 11.");
}
const geometry = await firestore.collection("siteMapRevisions").doc(mapRevisionId).collection("zoneGeometry").get();
const zones = geometry.docs.map((document) => ({
  id: document.id,
  name: String(document.data()?.zoneNameSnapshot ?? document.id),
  polygon: document.data()?.polygon as Array<{ xMeters: number; yMeters: number }>,
})).filter((zone) => Array.isArray(zone.polygon) && zone.polygon.length >= 3);
if (!zones.some((zone) => zone.id === "main-entrance") || !zones.some((zone) => zone.id === "food-court")) {
  throw new Error("The active V2 map must contain Main Entrance and Food Court geometry. Run v2:prepare-integration-baseline first.");
}

const timeZone = String(site.data()?.timeZone ?? "Asia/Kuala_Lumpur");
const now = new Date();
const today = siteLocalDate(now, timeZone);
const dates = [shiftDate(today, -3), shiftDate(today, -2), shiftDate(today, -1)];
const batch = firestore.batch();
for (const zone of zones) {
  const data = { schemaVersion: 2, siteId, zoneId: zone.id, name: zone.name, nameNormalized: zone.name.toLowerCase(), status: "active", activeMapRevisionId: mapRevisionId, retiredAt: null, updatedAt: FieldValue.serverTimestamp() };
  batch.set(firestore.collection("zones").doc(zone.id), { ...data, createdAt: FieldValue.serverTimestamp() }, { merge: true });
}

for (const [dayIndex, date] of dates.entries()) {
  const noon = new Date(+siteMidnight(date, timeZone) + 12 * 3_600_000);
  for (const zone of zones) {
    const multiplier = zone.id === "food-court" ? 2 : 1;
    for (let occurrence = 0; occurrence < multiplier; occurrence += 1) {
      const at = new Date(+noon + (occurrence + 1) * 600_000);
      const alertId = `phase11-seed-alert-${date}-${zone.id}-${occurrence}`;
      const workId = `phase11-seed-work-${date}-${zone.id}-${occurrence}`;
      batch.set(firestore.collection("alerts").doc(alertId), {
        schemaVersion: 2, alertId, siteId, zoneId: zone.id, zoneNameSnapshot: zone.name, cameraId: null,
        issueType: "bin_service", observedCondition: occurrence === 0 && zone.id === "food-court" ? "overflow" : "full",
        status: "resolved", severity: zone.id === "food-court" ? "critical" : "warning", highestSeverity: zone.id === "food-court" ? "critical" : "warning",
        isSimulation: true, createdAt: Timestamp.fromDate(at), firstDetectedAt: Timestamp.fromDate(at), resolvedAt: Timestamp.fromMillis(+at + 3_600_000),
      }, { merge: true });
      batch.set(firestore.collection("workOrders").doc(workId), {
        schemaVersion: 2, workOrderId: workId, siteId, zoneId: zone.id, target: { type: "coordinate", zoneNameSnapshot: zone.name, point: zone.polygon[0] },
        status: "resolved", severity: zone.id === "food-court" ? "critical" : "warning", issueType: "bin_service", isSimulation: true,
        createdAt: Timestamp.fromDate(at), assignedAt: Timestamp.fromDate(at), startedAt: Timestamp.fromMillis(+at + 600_000), resolvedAt: Timestamp.fromMillis(+at + 3_600_000),
      }, { merge: true });
    }
  }
  batch.set(firestore.collection("systemMetadata").doc(`phase11-seed-${date}`), { schemaVersion: 2, siteId, kind: "phase11_development_seed", localDate: date, dayIndex, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}
await batch.commit();

for (const [dayIndex, date] of dates.entries()) {
  const start = new Date(+siteMidnight(date, timeZone) + 12 * 3_600_000);
  await persistMinuteContributions(siteId, start, timeZone, zones.map((zone) => {
    const foodCourt = zone.id === "food-court";
    const people = foodCourt ? 45 + dayIndex * 5 : 18 + dayIndex * 2;
    return { id: `phase11-seed:${date}:${zone.id}`, zoneId: zone.id, zoneNameSnapshot: zone.name, mapRevisionId,
      metrics: { sampleAttemptCount: 10, successfulSampleCount: 10, failedSampleCount: 0, peopleObservationCount: 10, peopleSum: people * 10,
        peopleMax: people + 4, qualifyingLitterCount: foodCourt ? 3 : 1, qualifyingSpillCount: 0, qualifyingBinFullCount: foodCourt ? 2 : 1,
        qualifyingBinOverflowCount: foodCourt ? 1 : 0, simulationSampleCount: 10, inferenceLatencyMsSum: 2_000, inferenceLatencySampleCount: 10 } };
  }));
}

const currentMinute = new Date(Math.floor(+now / 60_000) * 60_000 - 5 * 60_000);
await persistMinuteContributions(siteId, currentMinute, timeZone, zones.map((zone) => ({
  id: `phase11-dashboard-seed:${today}:${zone.id}`, zoneId: zone.id, zoneNameSnapshot: zone.name, mapRevisionId,
  metrics: { sampleAttemptCount: 5, successfulSampleCount: 5, failedSampleCount: 0, peopleObservationCount: 5,
    peopleSum: zone.id === "food-court" ? 250 : 75, peopleMax: zone.id === "food-court" ? 55 : 18,
    qualifyingLitterCount: zone.id === "food-court" ? 2 : 0, qualifyingSpillCount: 0, qualifyingBinFullCount: 0,
    qualifyingBinOverflowCount: 0, simulationSampleCount: 5, inferenceLatencyMsSum: 1_000, inferenceLatencySampleCount: 5 },
})));

await rebuildDailySummaries(siteId, dates, now);
const snapshot = await refreshBinPlacement(siteId, 30, { uid: "phase11-development-seed", role: "system" }, now);
const dashboard = await buildDashboard(siteId, now);
console.log(JSON.stringify({
  siteId,
  localDates: dates,
  zones: zones.map((zone) => ({ zoneId: zone.id, name: zone.name })),
  recommendationStatus: snapshot.status,
  eligibleRecommendationCount: snapshot.zoneRankings.filter((row: any) => row.totalScore !== null).length,
  firstRankedZone: snapshot.zoneRankings.find((row: any) => row.rank === 1)?.zoneId ?? null,
  dashboardCounts: dashboard.counts,
}, null, 2));
