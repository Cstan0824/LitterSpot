import "dotenv/config";
import { Timestamp, type WriteBatch } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { env } from "../config/env.js";
import { shiftDate, siteLocalDate, siteMidnight } from "../services/phase11Calendar.js";
import { rebuildDailySummaries } from "../services/phase11Daily.js";
import { persistMinuteContributions } from "../services/phase11MinuteStore.js";
import { compareIntervention } from "../services/phase11Service.js";
import { assertMigrationTarget } from "../services/databaseSafety.js";

const siteId = "sunway-theme-park";
const expectedHost = "127.0.0.1:8180";
const beforeWork = [4, 5, 3, 6, 5, 4, 5];
const beforeOverflow = [3, 2, 4, 3, 3, 2, 3];
const afterWork = [2, 2, 1, 2, 1, 1, 1];
const afterOverflow = [1, 1, 0, 1, 0, 0, 1];
const fixtureVersion = 2;

assertMigrationTarget({ appEnvironment: env.appEnvironment, firebaseProjectId: env.firebaseProjectId, expectedFirebaseProjectId: env.expectedFirebaseProjectId, firestoreDatabaseId: env.firebaseDatabaseId, emulator: Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST) });
if (env.appEnvironment !== "local-emulator" || env.firebaseProjectId !== "demo-litterspot" || process.env.FIRESTORE_EMULATOR_HOST !== expectedHost) throw new Error(`Refusing Bin Placement fixture outside demo-litterspot on ${expectedHost}.`);

const site = await firestore.collection("sites").doc(siteId).get();
if (!site.exists || site.data()?.schemaVersion !== 2) throw new Error("The Sunway Theme Park demo Site is required.");
const mapRevisionId = String(site.data()?.activeMapRevisionId ?? "");
const timeZone = String(site.data()?.timeZone ?? "Asia/Kuala_Lumpur");
const revision = await firestore.collection("siteMapRevisions").doc(mapRevisionId).get();
if (!revision.exists) throw new Error("The active Site Map revision is required.");
const zones = await revision.ref.collection("zoneGeometry").get();
const zone = zones.docs.find((document) => String(document.data()?.zoneNameSnapshot).toLowerCase() === "wave pool & lazy river") ?? zones.docs.sort((left, right) => String(left.data()?.zoneNameSnapshot).localeCompare(String(right.data()?.zoneNameSnapshot)))[0];
if (!zone) throw new Error("At least one Zone is required.");
const zoneId = zone.id;
const zoneName = String(zone.data()?.zoneNameSnapshot ?? zoneId);
const metadataRef = firestore.collection("systemMetadata").doc("bin-placement-comparison-fixture");
const metadata = await metadataRef.get();
if (metadata.exists && metadata.data()?.fixtureVersion !== fixtureVersion) {
  const [oldWork, oldAlerts] = await Promise.all([firestore.collection("workOrders").where("fixtureKind", "==", "bin_placement_comparison").get(), firestore.collection("alerts").where("fixtureKind", "==", "bin_placement_comparison").get()]);
  let cleanup = firestore.batch(); let cleanupWrites = 0;
  for (const document of [...oldWork.docs, ...oldAlerts.docs]) { cleanup.delete(document.ref); cleanupWrites += 1; if (cleanupWrites === 400) { await cleanup.commit(); cleanup = firestore.batch(); cleanupWrites = 0; } }
  if (cleanupWrites) await cleanup.commit();
}
const fallbackEnd = shiftDate(siteLocalDate(new Date(), timeZone), -30);
const afterEndDate = metadata.data()?.fixtureVersion === fixtureVersion && typeof metadata.data()?.afterEndDate === "string" ? String(metadata.data()?.afterEndDate) : fallbackEnd;
const interventionDate = shiftDate(afterEndDate, -6);
const implementedAt = siteMidnight(interventionDate, timeZone);
const beforeDates = Array.from({ length: 7 }, (_, index) => shiftDate(interventionDate, index - 7));
const afterDates = Array.from({ length: 7 }, (_, index) => shiftDate(interventionDate, index));
const allDates = [...beforeDates, ...afterDates];
const interventionId = `demo-bin-placement-comparison-${zoneId}`;
let batch: WriteBatch = firestore.batch();
let writes = 0;
const commit = async () => { if (!writes) return; await batch.commit(); batch = firestore.batch(); writes = 0; };
const set = (reference: FirebaseFirestore.DocumentReference, data: FirebaseFirestore.DocumentData) => { batch.set(reference, data, { merge: true }); writes += 1; };

for (const [periodIndex, dates] of [[0, beforeDates], [1, afterDates]] as const) {
  const workSeries = periodIndex === 0 ? beforeWork : afterWork;
  const overflowSeries = periodIndex === 0 ? beforeOverflow : afterOverflow;
  for (const [dayIndex, localDate] of dates.entries()) {
    const dayStart = siteMidnight(localDate, timeZone);
    await persistMinuteContributions(siteId, new Date(+dayStart + 12 * 3_600_000), timeZone, [{ id: `bin-comparison-monitoring:${localDate}:${zoneId}`, zoneId, zoneNameSnapshot: zoneName, mapRevisionId, metrics: { sampleAttemptCount: 12, successfulSampleCount: 12, failedSampleCount: 0, peopleObservationCount: 12, peopleSum: 300, peopleMax: 35, qualifyingLitterCount: 0, qualifyingSpillCount: 0, qualifyingBinFullCount: 0, qualifyingBinOverflowCount: overflowSeries[dayIndex], simulationSampleCount: 12, inferenceLatencyMsSum: 1200, inferenceLatencySampleCount: 12 } }]);
    for (let index = 0; index < workSeries[dayIndex]; index += 1) {
      const resolvedAt = new Date(+dayStart + (10 * 60 + index * 35) * 60_000);
      const workId = `bin-comparison-work-${localDate}-${zoneId}-${index}`;
      set(firestore.collection("workOrders").doc(workId), { schemaVersion: 2, workOrderId: workId, siteId, origin: "manual", alertId: null, managementMode: "manual", status: "resolved", severity: "warning", issueType: "general_cleanup", title: `Historical cleanup at ${zoneName}`, instructions: "Historical emulator demonstration record.", assignedCleanerId: "fixture-cleaner", cleanerNameSnapshot: "Fixture Cleaner", zoneId, cameraId: null, target: { type: "coordinate", zoneId, zoneNameSnapshot: zoneName, point: zone.data()?.polygon?.[0] ?? null }, assignedAt: Timestamp.fromMillis(+resolvedAt - 30 * 60_000), startedAt: Timestamp.fromMillis(+resolvedAt - 20 * 60_000), submittedAt: Timestamp.fromMillis(+resolvedAt - 5 * 60_000), resolvedAt: Timestamp.fromDate(resolvedAt), createdAt: Timestamp.fromMillis(+resolvedAt - 30 * 60_000), updatedAt: Timestamp.fromDate(resolvedAt), completionEvidenceMediaId: null, latestVerificationId: null, latestVerificationOutcome: "passed", reworkCount: 0, isSimulation: true, fixtureKind: "bin_placement_comparison", revision: 1 });
    }
    for (let index = 0; index < overflowSeries[dayIndex]; index += 1) {
      const resolvedAt = new Date(+dayStart + (11 * 60 + index * 40) * 60_000);
      const alertId = `bin-comparison-overflow-${localDate}-${zoneId}-${index}`;
      set(firestore.collection("alerts").doc(alertId), { schemaVersion: 2, alertId, siteId, cameraId: null, cameraNameSnapshot: "Historical observation", zoneId, zoneNameSnapshot: zoneName, issueType: "bin_service", observedCondition: "overflow", status: "resolved", severity: "warning", highestSeverity: "warning", priorityScore: 50, activeWorkOrderId: null, evidenceMediaId: null, firstDetectedAt: Timestamp.fromMillis(+resolvedAt - 10 * 60_000), createdAt: Timestamp.fromMillis(+resolvedAt - 10 * 60_000), updatedAt: Timestamp.fromDate(resolvedAt), resolvedAt: Timestamp.fromDate(resolvedAt), dismissedAt: null, isSimulation: true, fixtureKind: "bin_placement_comparison", revision: 1 });
    }
    if (writes >= 400) await commit();
  }
}

set(firestore.collection("binPlacementInterventions").doc(interventionId), { schemaVersion: 2, interventionId, siteId, zoneId, zoneNameSnapshot: zoneName, mapRevisionId, timeZoneSnapshot: timeZone, implementedAt: Timestamp.fromDate(implementedAt), implementedByUid: "bin-placement-fixture", sourceSnapshotCalculatedAt: Timestamp.fromMillis(+implementedAt - 60_000), rankingSnapshot: { zoneId, zoneNameSnapshot: zoneName, rank: 1, totalScore: 75, coverage: { requestedDays: 7, availableDays: 7, partial: false } }, requestedLookbackDaysSnapshot: 7, availableCoverageSnapshot: { requestedDays: 7, availableDays: 7, partial: false }, exclusionEndsAt: Timestamp.fromMillis(+implementedAt + 2 * 86_400_000), note: "Emulator demonstration: compare seven days before and after bin placement.", createdAt: Timestamp.fromDate(implementedAt), fixtureKind: "bin_placement_comparison" });
set(metadataRef, { schemaVersion: 2, fixtureVersion, siteId, kind: "bin_placement_comparison_fixture", zoneId, zoneName, mapRevisionId, interventionId, interventionDate, beforeDates, afterDates, afterEndDate, updatedAt: Timestamp.now() });
await commit();
await rebuildDailySummaries(siteId, allDates, new Date(+siteMidnight(shiftDate(afterEndDate, 1), timeZone) + 1));

const comparison = await compareIntervention(siteId, interventionId, 7, new Date(+siteMidnight(shiftDate(afterEndDate, 1), timeZone) + 1));
const clean = (side: typeof comparison.before) => side.series.map((row: { cleaningFrequency: number }) => row.cleaningFrequency);
const overflow = (side: typeof comparison.before) => side.series.map((row: { binOverflowFrequency: number }) => row.binOverflowFrequency);
const actual = { beforeWork: clean(comparison.before), afterWork: clean(comparison.after), beforeOverflow: overflow(comparison.before), afterOverflow: overflow(comparison.after) };
if (JSON.stringify(actual) !== JSON.stringify({ beforeWork, afterWork, beforeOverflow, afterOverflow })) throw new Error(`Bin Placement comparison verification failed: ${JSON.stringify(actual)}`);
console.log(JSON.stringify({ status: "complete", siteId, zoneId, zoneName, interventionId, beforeDates, afterDates, ...actual }, null, 2));
