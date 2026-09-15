import { FieldValue, Timestamp, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { canonicalHash } from "./persistence.js";
import { serializeFirestore } from "./presentation.js";
import { allDocuments, millis, operationalFacts, requireAnalyticsSite } from "./phase11Data.js";
import { shiftDate, siteLocalDate, siteMidnight, validLocalDate } from "./phase11Calendar.js";

const additiveSampleFields = ["eligibleCameraCount","sampleAttemptCount", "successfulSampleCount", "failedSampleCount", "peopleObservationCount", "peopleSum", "simulationSampleCount","inferenceLatencyMsSum","inferenceLatencySampleCount","offlineCameraSeconds"];
const sampleFields = [...additiveSampleFields,"peopleMax"];
const operationFields = ["litterAlertCount", "spillAlertCount", "binServiceAlertCount", "overflowEscalationCount", "resolvedWorkCount", "dismissedWorkCount", "workDurationSecondsSum", "workDurationCount", "simulationAlertCount"];
export const dailyId = (siteId: string, date: string) => canonicalHash("phase11-daily-v3", siteId, date);
type Metrics = Record<string, any>;
const empty = (): Metrics => Object.fromEntries([...sampleFields, ...operationFields, "peopleMax", "activeWorkPeak", "observedMinuteCount"].map(key => [key, 0]));
const tails = new Map<string, Promise<unknown>>();
export async function withDailyLock<T>(siteId: string, date: string, operation: () => Promise<T>): Promise<T> {
  const key = `${siteId}:${date}`, before = tails.get(key) ?? Promise.resolve();
  const result = before.then(operation, operation); tails.set(key, result);
  try { return await result; } finally { if (tails.get(key) === result) tails.delete(key); }
}
function peak(works: QueryDocumentSnapshot[], start: number, end: number, zoneId?: string) {
  const events: Array<[number, number]> = [];
  for (const doc of works) {
    const w = doc.data(); if (zoneId && w.zoneId !== zoneId) continue;
    const from = millis(w.createdAt ?? w.assignedAt), terminal = millis(w.resolvedAt ?? w.dismissedAt);
    const until = Number.isFinite(terminal) ? terminal : end;
    if (!Number.isFinite(from) || from >= end || until <= start) continue;
    events.push([Math.max(from, start), 1], [Math.min(until, end), -1]);
  }
  let current = 0, maximum = 0;
  for (const [, delta] of events.sort((a,b) => a[0] - b[0] || a[1] - b[1])) { current += delta; maximum = Math.max(maximum, current); }
  return maximum;
}

type DailyRebuildContext = {
  site: FirebaseFirestore.DocumentData;
  operations: Awaited<ReturnType<typeof operationalFacts>>;
};

export async function rebuildDailySummary(siteId: string, date: string, now = new Date(), context?: DailyRebuildContext) {
  return withDailyLock(siteId, date, async () => {
    const site = context?.site ?? await requireAnalyticsSite(siteId), zone = String(site.timeZone ?? "Asia/Kuala_Lumpur");
    if (!validLocalDate(date) || date > siteLocalDate(now, zone)) throw new HttpError(400, "Choose a valid current or past Site-local date.");
    const start = siteMidnight(date, zone), end = siteMidnight(shiftDate(date, 1), zone);
    const ref = firestore.collection("analyticsDailySummaries").doc(dailyId(siteId, date));
    const previous = await ref.get();
    const minutes = await allDocuments(firestore.collection("analyticsMinuteBuckets").where("siteId", "==", siteId)
      .where("bucketStart", ">=", Timestamp.fromDate(start)).where("bucketStart", "<", Timestamp.fromDate(end)).orderBy("bucketStart"));
    const minuteMetrics: Record<string, Metrics> = {};
    const retired = previous.data()?.minuteDataRetired === true;
    if (retired) Object.assign(minuteMetrics, previous.data()?.zoneMinuteMetrics ?? {});
    else for (const doc of minutes) {
      const data = doc.data(); if (data.schemaVersion !== 2) continue;
      for (const [id, raw] of Object.entries(data.zoneMetrics ?? {})) {
        const x = raw as Metrics, m = minuteMetrics[id] ??= empty();
        for (const field of additiveSampleFields) m[field] += Number(x[field] ?? (field === "peopleObservationCount" ? x.successfulSampleCount : 0) ?? 0);
        m.peopleMax = Math.max(m.peopleMax, Number(x.peopleMax ?? 0)); m.observedMinuteCount++;
        m.zoneNameSnapshot = x.zoneNameSnapshot ?? id;
      }
    }
    const { facts, works } = context?.operations ?? await operationalFacts(siteId);
    const zoneMetrics: Record<string, Metrics> = {};
    for (const [id, m] of Object.entries(minuteMetrics)) zoneMetrics[id] = { ...empty(), ...m };
    const dayFacts = facts.filter(f => f.at >= +start && f.at < +end && f.at <= +now);
    for (const fact of dayFacts) {
      const m = zoneMetrics[fact.zoneId] ??= { ...empty(), zoneNameSnapshot: fact.name };
      const field = { litter: "litterAlertCount", spill: "spillAlertCount", bin: "binServiceAlertCount", overflow: "overflowEscalationCount", resolved: "resolvedWorkCount", dismissed: "dismissedWorkCount" }[fact.kind];
      m[field]++;
      if (fact.simulation && ["litter", "spill", "bin"].includes(fact.kind)) m.simulationAlertCount++;
      if (fact.durationSeconds !== undefined) { m.workDurationSecondsSum += fact.durationSeconds; m.workDurationCount++; }
    }
    const totals = empty();
    for (const [id, m] of Object.entries(zoneMetrics)) {
      m.activeWorkPeak = peak(works, +start, Math.min(+end, +now), id);
      for (const field of [...additiveSampleFields, ...operationFields]) totals[field] += m[field];
      totals.peopleMax = Math.max(totals.peopleMax, m.peopleMax);
    }
    totals.activeWorkPeak = peak(works, +start, Math.min(+end, +now));
    const minuteBucketCount = retired ? previous.data()?.coverage?.minuteBucketCount ?? 0 : minutes.filter(d => d.data().schemaVersion === 2).length;
    const expectedMinutes = Math.max(0, Math.ceil((Math.min(+end, +now) - +start) / 60000));
    const data = { schemaVersion: 2, summaryId: ref.id, siteId, localDate: date, timeZoneSnapshot: zone,
      periodStart: Timestamp.fromDate(start), periodEnd: Timestamp.fromDate(end), zoneMinuteMetrics: minuteMetrics, zoneMetrics, siteTotals: totals,
      minuteDataRetired: retired, coverage: { minuteBucketCount, expectedMinutes, operationalEventCount: dayFacts.length,
        hasSourceData: totals.successfulSampleCount > 0 || dayFacts.length > 0, partial: minuteBucketCount < expectedMinutes || totals.offlineCameraSeconds > 0,
        warning: minuteBucketCount === 0 ? "no_minute_buckets" : minuteBucketCount < expectedMinutes ? "partial_monitoring_coverage" : null },
      aggregationVersion: "daily-v3", status: +end <= +now ? "final" : "provisional", generatedAt: Timestamp.fromDate(now), lastReconciledAt: Timestamp.fromDate(now) };
    await ref.set({ ...data, sourceSignature: canonicalHash("daily-source", minutes.map(d => [d.id, d.updateTime.toMillis()]), dayFacts) });
    return serializeFirestore({ id: ref.id, ...data });
  });
}

export async function rebuildDailySummaries(siteId: string, dates: string[], now = new Date()) {
  const site = await requireAnalyticsSite(siteId);
  const operations = await operationalFacts(siteId);
  const context = { site, operations };
  const summaries = [];
  for (const date of dates) summaries.push(await rebuildDailySummary(siteId, date, now, context));
  return summaries;
}

export async function getDailySummaries(siteId: string, from?: string, to?: string) {
  if ((from && !validLocalDate(from)) || (to && !validLocalDate(to)) || (from && to && from > to)) throw new HttpError(400, "Invalid daily date range.");
  let query = firestore.collection("analyticsDailySummaries").where("siteId", "==", siteId);
  if (from) query = query.where("localDate", ">=", from);
  if (to) query = query.where("localDate", "<=", to);
  const docs = await allDocuments(query.orderBy("localDate"));
  const dates = new Map<string, any>();
  for (const doc of docs) {
    const data = doc.data(); if (data.schemaVersion !== 2) continue;
    const prior = dates.get(data.localDate);
    if (!prior || data.aggregationVersion === "daily-v3" || millis(data.generatedAt) > millis(prior.generatedAt)) dates.set(data.localDate, serializeFirestore({ id: doc.id, ...data }));
  }
  return [...dates.values()].sort((a,b) => b.localDate.localeCompare(a.localDate));
}

export async function cleanupMinuteBuckets(siteId: string, now = new Date()) {
  const site = await requireAnalyticsSite(siteId), zone = String(site.timeZone ?? "Asia/Kuala_Lumpur");
  const expired = await firestore.collection("analyticsMinuteBuckets").where("siteId", "==", siteId)
    .where("expiresAt", "<=", Timestamp.fromDate(now)).orderBy("expiresAt").limit(300).get();
  const groups = new Map<string, QueryDocumentSnapshot[]>();
  for (const doc of expired.docs) {
    if (doc.data().schemaVersion !== 2) continue;
    const date = siteLocalDate(new Date(millis(doc.data().bucketStart)), zone), values = groups.get(date) ?? [];
    values.push(doc); groups.set(date, values);
  }
  let deleted = 0;
  for (const [date, docs] of groups) {
    await rebuildDailySummary(siteId, date, now);
    await withDailyLock(siteId, date, async () => {
      await firestore.runTransaction(async tx => {
        const ref = firestore.collection("analyticsDailySummaries").doc(dailyId(siteId, date));
        const summary = await tx.get(ref);
        if (summary.data()?.status !== "final") throw new HttpError(409, "Daily summary must be final before retention cleanup.");
        tx.update(ref, { minuteDataRetired: true });
        for (const doc of docs) tx.delete(doc.ref);
      });
    });
    deleted += docs.length;
  }
  return deleted;
}

/**
 * Finalize only the previous Site-local day. Older repair is explicit through
 * the rebuild API, so an idle worker never scans all retained minute history.
 */
export async function catchUpDailySummaries(siteId: string, now = new Date()) {
  const site = await requireAnalyticsSite(siteId);
  const zone = String(site.timeZone ?? "Asia/Kuala_Lumpur");
  const today = siteLocalDate(now, zone);
  if (+now - +siteMidnight(today, zone) < 5 * 60_000) return { rebuilt: 0, remaining: 0 };
  const date = shiftDate(today, -1);
  const prior = await firestore.collection("analyticsDailySummaries").doc(dailyId(siteId, date)).get();
  if (prior.data()?.aggregationVersion === "daily-v3" && prior.data()?.status === "final") return { rebuilt: 0, remaining: 0 };
  await rebuildDailySummary(siteId, date, now, { site, operations: await operationalFacts(siteId) });
  return { rebuilt: 1, remaining: 0 };
}
