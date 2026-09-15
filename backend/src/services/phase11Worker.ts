import { cleanupMinuteBuckets, catchUpDailySummaries } from "./phase11Daily.js";
import { refreshBinPlacement } from "./phase11Service.js";
import { allDocuments } from "./phase11Data.js";
import { firestore } from "../config/firebase.js";
import { flushMinuteBuckets, liveAnalyticsSites } from "./liveMonitoringService.js";
import { persistCameraCoverageMinute } from "./phase11MinuteStore.js";
import { siteLocalDate, siteMidnight } from "./phase11Calendar.js";
import { safeFirestoreError } from "../shared/firestoreErrors.js";

let minuteTimer: NodeJS.Timeout | null = null;
let dailyTimer: NodeJS.Timeout | null = null;
let current: Promise<void> | null = null;

export async function runPhase11MinuteMaintenance(now = new Date(), onlySiteId?: string) {
  const siteIds = onlySiteId ? [onlySiteId] : liveAnalyticsSites();
  for (const siteId of siteIds) {
    await flushMinuteBuckets(siteId, now);
    await persistCameraCoverageMinute(siteId,new Date(Math.floor(+now/60000)*60000-60000));
  }
}

export async function runPhase11DailyMaintenance(now = new Date(), onlySiteId?: string) {
  const sites = onlySiteId ? [await firestore.collection("sites").doc(onlySiteId).get()] : await allDocuments(firestore.collection("sites").where("status", "==", "active"));
  for (const site of sites) {
    if (site.data()?.schemaVersion !== 2 || site.data()?.status !== "active") continue;
    const timeZone=String(site.data()?.timeZone??"Asia/Kuala_Lumpur"),today=siteLocalDate(now,timeZone);
    if(+now-+siteMidnight(today,timeZone)<5*60_000)continue;
    const stateRef=firestore.collection("phase11MaintenanceStates").doc(site.id),state=await stateRef.get();
    if(state.data()?.lastCompletedLocalDate===today)continue;
    await catchUpDailySummaries(site.id, now);
    await cleanupMinuteBuckets(site.id, now);
    await refreshBinPlacement(site.id,Number(state.data()?.recommendationLookbackDays??30),{uid:"analytics-worker",role:"system"},now);
    await stateRef.set({schemaVersion:2,siteId:site.id,lastCompletedLocalDate:today,lastCompletedAt:now,recommendationLookbackDays:Number(state.data()?.recommendationLookbackDays??30)});
  }
}
export async function runPhase11Maintenance(now = new Date(), onlySiteId?: string) {
  await runPhase11MinuteMaintenance(now,onlySiteId);
  await runPhase11DailyMaintenance(now,onlySiteId);
}
export function startPhase11Worker() {
  if (minuteTimer || dailyTimer) return;
  const run = (operation:()=>Promise<void>) => {
    if (current) return;
    current = operation().catch((error) => console.error(JSON.stringify({event:"phase11_maintenance_failed",...safeFirestoreError(error)}))).finally(() => { current = null; });
  };
  run(()=>runPhase11MinuteMaintenance());
  minuteTimer=setInterval(()=>run(()=>runPhase11MinuteMaintenance()),60_000);minuteTimer.unref();
  dailyTimer=setInterval(()=>run(()=>runPhase11DailyMaintenance()),15*60_000);dailyTimer.unref();
  setTimeout(()=>run(()=>runPhase11DailyMaintenance()),1_000).unref();
}
export async function stopPhase11Worker() { if(minuteTimer)clearInterval(minuteTimer);if(dailyTimer)clearInterval(dailyTimer);minuteTimer=null;dailyTimer=null;await current; }
