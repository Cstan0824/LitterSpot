import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { presentV2Cleaner } from "./v2CleanerService.js";
import { getV2OrchestratorConfig } from "./v2OrchestratorService.js";
import { priorityScore } from "./v2AlertPolicy.js";
import { rankBinPlacementFactors } from "./v2BinPlacement.js";
import { v2Json } from "./v2Presentation.js";
import { canonicalHash } from "./v2Persistence.js";
import { allDocuments, millis, operationalFacts, requireAnalyticsSite, siteDocuments } from "./phase11Data.js";
import { getDailySummaries } from "./phase11Daily.js";
import { fullDayExclusion, shiftDate, siteLocalDate, siteMidnight, shiftSiteInstant, validateDays } from "./phase11Calendar.js";
import { v2AuditEventData } from "./v2AuditService.js";
export { rebuildDailySummary, rebuildDailySummaries, getDailySummaries, cleanupMinuteBuckets } from "./phase11Daily.js";

const activeWork = ["assigned", "in_progress", "awaiting_review"];
const alertStates = ["waiting_for_cleaner", ...activeWork, "resolved", "dismissed"];
const byName = (a: string, b: string) => a.localeCompare(b);
const safe = (data: any) => v2Json(data);
const severityRank = (s: string) => s === "critical" ? 2 : 1;

export async function buildDashboard(siteId: string, now = new Date()) {
  await requireAnalyticsSite(siteId);
  const end = new Date(Math.floor(+now / 60000) * 60000), start = new Date(+end - 15 * 60000);
  const [zoneDocs, cameraDocs, cleanerDocs, alertDocs, workDocs, config, runtimeDocs, minutes] = await Promise.all([
    siteDocuments("zones", siteId), siteDocuments("cameras", siteId), siteDocuments("cleaners", siteId),
    siteDocuments("alerts", siteId), siteDocuments("workOrders", siteId), getV2OrchestratorConfig(siteId), siteDocuments("cameraRuntimeStates", siteId),
    allDocuments(firestore.collection("analyticsMinuteBuckets").where("siteId", "==", siteId)
      .where("bucketStart", ">=", Timestamp.fromDate(start)).where("bucketStart", "<", Timestamp.fromDate(end)).orderBy("bucketStart")),
  ]);
  const zones = zoneDocs.filter(d => d.data().status === "active"), cameras = cameraDocs.filter(d => d.data().status === "active");
  const cleaners = await Promise.all(cleanerDocs.filter(d => d.data().status === "active").map(d => presentV2Cleaner(d.id, siteId, now)));
  const available = cleaners.filter(c => c.availability.available);
  const alerts = alertDocs.map(d => ({ ...d.data(), id: d.id } as any));
  const works = workDocs.map(d => ({ ...d.data(), id: d.id } as any));
  const active = works.filter(w => activeWork.includes(w.status));
  const score = (a: any) => priorityScore({ severity: a.severity === "critical" ? "critical" : "warning", createdAtMs: Number.isFinite(millis(a.createdAt)) ? millis(a.createdAt) : +now, nowMs: +now });
  const unresolved = alerts.filter(a => ["waiting_for_cleaner", ...activeWork].includes(a.status)).sort((a,b) => score(b) - score(a) || millis(a.createdAt) - millis(b.createdAt) || byName(a.id,b.id));
  const fallback = alerts.filter(a => a.status === "resolved").sort((a,b) => severityRank(b.highestSeverity ?? b.severity) - severityRank(a.highestSeverity ?? a.severity) || millis(b.resolvedAt) - millis(a.resolvedAt) || byName(a.id,b.id));
  const topAlerts = (unresolved.length ? unresolved : fallback).slice(0,3).map(a => safe({
    alertId: a.id, cameraId: a.cameraId ?? null, zoneId: a.zoneId ?? null, zoneNameSnapshot: a.zoneNameSnapshot ?? a.zoneId ?? "",
    issueType: a.issueType ?? "unknown", condition: a.observedCondition ?? null, status: a.status, severity: a.severity ?? "warning",
    priority: score(a), evidenceMediaId: a.evidence?.mediaId ?? null, createdAt: a.createdAt ?? null, terminalAt: a.resolvedAt ?? a.dismissedAt ?? null,
  }));
  const raw = zones.map(z => {
    const metrics = minutes.filter(d => d.data().schemaVersion === 2).map(d => d.data().zoneMetrics?.[z.id]).filter(Boolean);
    const peopleSum = metrics.reduce((sum,x) => sum + Number(x.peopleSum ?? 0), 0);
    const samples = metrics.reduce((sum,x) => sum + Number(x.peopleObservationCount ?? x.successfulSampleCount ?? 0), 0);
    return { zoneId: z.id, zoneName: String(z.data().name ?? z.id), rawPeoplePressure: samples ? peopleSum / samples : 0,
      sampleCount: samples, activeWorkPoints: active.filter(w => w.zoneId === z.id).reduce((sum,w) => sum + severityRank(w.severity), 0),
      qualifyingIssueCount: metrics.reduce((sum,x) => sum + ["qualifyingLitterCount","qualifyingSpillCount","qualifyingBinFullCount","qualifyingBinOverflowCount"].reduce((n,k) => n + Number(x[k] ?? 0),0),0) };
  });
  const maxPeople = Math.max(0,...raw.map(z=>z.rawPeoplePressure)), maxWork = Math.max(0,...raw.map(z=>z.activeWorkPoints));
  const busyZones = raw.map(z => {
    const p = maxPeople ? z.rawPeoplePressure / maxPeople : 0, w = maxWork ? z.activeWorkPoints / maxWork : 0;
    return { ...z, normalizedPeoplePressure: p, normalizedActiveWorkPoints: w, score: 50 * p + 50 * w };
  }).sort((a,b) => b.score - a.score || b.qualifyingIssueCount - a.qualifyingIssueCount || b.rawPeoplePressure - a.rawPeoplePressure || byName(a.zoneName,b.zoneName) || byName(a.zoneId,b.zoneId))
    .slice(0,3).map((z,i)=>({...z,rank:i+1}));
  const runtime = new Map(runtimeDocs.map(d=>[d.id,d.data()]));
  const data = {
    schemaVersion:2, siteId,
    counts: { zoneCount: zones.length, cameraCount: cameras.length, cleanerCount: cleaners.length, availableCleanerCount: available.length,
      alertCount: alerts.length, activeAlertCount: unresolved.length, workCount: works.length, activeWorkCount: active.length,
      onlineCameraCount: cameras.filter(c => c.data().monitoringEnabled && runtime.get(c.id)?.connectionStatus === "online" && +now - millis(runtime.get(c.id)?.lastSampleAcceptedAt) <= 10000).length,
      alertByStatus: Object.fromEntries(alertStates.map(s=>[s,alerts.filter(a=>a.status===s).length])),
      alertBySeverity: Object.fromEntries(["warning","critical"].map(s=>[s,alerts.filter(a=>a.severity===s).length])),
      workByStatus: Object.fromEntries([...activeWork,"resolved","dismissed"].map(s=>[s,works.filter(w=>w.status===s).length])) },
    orchestrator: config, topAlerts, topAlertsSource: unresolved.length ? "active" : "resolved_history", busyZones,
    availableCleaners: safe(available.slice(0,20)), assignedWork: safe(active.sort((a,b)=>millis(a.assignedAt)-millis(b.assignedAt)||byName(a.id,b.id)).slice(0,20)),
    windowStart: Timestamp.fromDate(start), windowEnd: Timestamp.fromDate(end), calculationVersion:"dashboard-v3",
    generatedAt: Timestamp.fromDate(now), staleAfter: Timestamp.fromMillis(+now+60000),
  };
  await firestore.collection("dashboardSummaries").doc(siteId).set(data);
  return safe(data);
}
export async function getDashboardV2(siteId: string, now = new Date()) {
  await requireAnalyticsSite(siteId);
  const snap = await firestore.collection("dashboardSummaries").doc(siteId).get();
  return snap.data()?.calculationVersion === "dashboard-v3" && millis(snap.data()?.staleAfter) > +now ? safe(snap.data()) : buildDashboard(siteId,now);
}

export async function listInterventions(siteId: string) {
  const docs = await siteDocuments("binPlacementInterventions",siteId);
  return docs.map(d=>safe({id:d.id,...d.data()})).sort((a,b)=>millis(b.implementedAt)-millis(a.implementedAt)||byName(a.id,b.id));
}
async function rankingInput(siteId: string, days: number, now: Date) {
  validateDays(days);
  const site = await requireAnalyticsSite(siteId), tz = String(site.timeZone ?? "Asia/Kuala_Lumpur"), today = siteLocalDate(now,tz);
  const from = shiftDate(today,-days), to = shiftDate(today,-1);
  const [all, zones, interventions] = await Promise.all([getDailySummaries(siteId,from,to),siteDocuments("zones",siteId),listInterventions(siteId)]);
  const summaries = all.filter(s => s.status === "final" && s.coverage?.hasSourceData);
  const excluded = new Set(interventions.filter(i=>millis(i.exclusionEndsAt)>+now).map(i=>i.zoneId));
  const activeZones = zones.filter(z=>z.data().status==="active" && !excluded.has(z.id));
  const fingerprint = canonicalHash("ranking-input",summaries.map(s=>[s.id,s.generatedAt]),activeZones.map(z=>z.id),interventions.map(i=>[i.id,i.exclusionEndsAt]),site.activeMapRevisionId ?? null,days,from,to);
  return { site,tz,from,to,summaries,activeZones,fingerprint };
}
export async function refreshBinPlacement(siteId: string, days: number, actor: any, now = new Date(), _legacyCatchUp?: boolean) {
  const input = await rankingInput(siteId,days,now);
  const raw = input.activeZones.map(doc => {
    let peopleSum=0,samples=0,cleaning=0,bin=0,availableDays=0;
    for(const s of input.summaries) {
      const z=s.zoneMetrics?.[doc.id]; if(!z) continue;
      if(Number(z.successfulSampleCount??0)>0 || Number(z.resolvedWorkCount??0)+Number(z.litterAlertCount??0)+Number(z.binServiceAlertCount??0)>0) availableDays++;
      peopleSum+=Number(z.peopleSum??0); samples+=Number(z.peopleObservationCount??z.successfulSampleCount??0);
      cleaning+=Number(z.resolvedWorkCount??0); bin+=Number(z.binServiceAlertCount??0);
    }
    return {zoneId:doc.id,zoneNameSnapshot:String(doc.data().name??doc.id),people:samples?peopleSum/samples:0,cleaning,bin,availableDays};
  });
  const sufficient=raw.filter(x=>x.availableDays>=2);
  const maxima={peopleActivity:Math.max(0,...sufficient.map(x=>x.people)),cleaningFrequency:Math.max(0,...sufficient.map(x=>x.cleaning)),binServiceFrequency:Math.max(0,...sufficient.map(x=>x.bin))};
  let rank=0;
  const rankings=raw.map(x=>{
    const factors=rankBinPlacementFactors({peopleActivity:x.people,cleaningFrequency:x.cleaning,binServiceFrequency:x.bin},maxima);
    return {...x,rank:null as number|null,totalScore:x.availableDays>=2?factors.totalScore:null,
      peopleActivity:factors.factors.peopleActivity,cleaningFrequency:factors.factors.cleaningFrequency,binServiceFrequency:factors.factors.binServiceFrequency,
      coverage:{requestedDays:days,availableDays:x.availableDays,partial:x.availableDays<days},status:x.availableDays<2?"insufficient_data":x.availableDays<days?"partial_data":"ready",
      reasonSummary:x.availableDays<2?"At least two observed completed local days are required.":`${x.availableDays} observed days in the requested window.`};
  }).sort((a,b)=>(b.totalScore??-1)-(a.totalScore??-1)||byName(a.zoneNameSnapshot,b.zoneNameSnapshot)||byName(a.zoneId,b.zoneId))
    .map(x=>({...x,rank:x.totalScore===null?null:++rank}));
  const data={schemaVersion:2,siteId,mapRevisionId:input.site.activeMapRevisionId??null,timeZoneSnapshot:input.tz,requestedLookbackDays:days,
    requestedStart:input.from,requestedEnd:input.to,availableDays:input.summaries.length,
    availableStart:input.summaries.at(-1)?.periodStart??null,availableEnd:input.summaries[0]?.periodEnd??null,
    calculatedAt:Timestamp.fromDate(now),calculatedBy:actor,policyVersion:"bin-placement-v3",sourceFingerprint:input.fingerprint,
    status:sufficient.length===0?"insufficient_data":input.summaries.length<days?"partial_data":"ready",
    zoneRankings:rankings,sourceSummaryIds:input.summaries.map(s=>s.id),nextScheduledRefreshAt:Timestamp.fromDate(siteMidnight(shiftDate(siteLocalDate(now,input.tz),1),input.tz))};
  await firestore.collection("binPlacementSnapshots").doc(siteId).set(data);
  return safe(data);
}
export async function getBinPlacementSnapshot(siteId: string, days?: number, now = new Date(), _legacyCatchUp?: boolean) {
  const snap=await firestore.collection("binPlacementSnapshots").doc(siteId).get();
  const requested=days??Number(snap.data()?.requestedLookbackDays??30);
  if(snap.data()?.policyVersion!=="bin-placement-v3" || Number(snap.data()?.requestedLookbackDays)!==requested || millis(snap.data()?.nextScheduledRefreshAt)<=+now)
    return refreshBinPlacement(siteId,requested,{uid:"analytics-worker",role:"system"},now);
  return safe(snap.data());
}
export async function implementBinPlacement(siteId:string,zoneId:string,actor:any,note?:string,now=new Date(),expectedSnapshotCalculatedAt?:string) {
  const ref=firestore.collection("binPlacementSnapshots").doc(siteId);
  const id=await firestore.runTransaction(async tx=>{
    const [snap,site,zone]=await Promise.all([tx.get(ref),tx.get(firestore.collection("sites").doc(siteId)),tx.get(firestore.collection("zones").doc(zoneId))]);
    if(site.data()?.status!=="active" || zone.data()?.siteId!==siteId || zone.data()?.status!=="active") throw new HttpError(404,"Active Zone not found.");
    const s=snap.data();
    if (expectedSnapshotCalculatedAt && millis(s?.calculatedAt) !== Date.parse(expectedSnapshotCalculatedAt)) throw new HttpError(409,"The recommendation changed. Refresh and review it before implementing.");
    if(!s || s.policyVersion!=="bin-placement-v3" || millis(s.nextScheduledRefreshAt)<=+now || s.mapRevisionId!==(site.data()?.activeMapRevisionId??null)) throw new HttpError(409,"Refresh recommendations before implementing.");
    const interventionId=canonicalHash("bin-intervention",siteId,zoneId,millis(s.calculatedAt));
    const intervention=firestore.collection("binPlacementInterventions").doc(interventionId);
    const existing=await tx.get(intervention);
    if(existing.exists) return interventionId;
    const previous=await tx.get(firestore.collection("binPlacementInterventions").where("siteId","==",siteId).where("zoneId","==",zoneId));
    if(previous.docs.some(d=>millis(d.data().exclusionEndsAt)>+now)) throw new HttpError(409,"This Zone is still in its post-implementation exclusion period.");
    const ranking=s.zoneRankings.find((z:any)=>z.zoneId===zoneId);
    if(!ranking || ranking.totalScore===null || ranking.coverage.availableDays<2) throw new HttpError(409,"There is not enough observed data to implement this recommendation.");
    const tz=String(site.data()?.timeZone??"Asia/Kuala_Lumpur");
    const data={schemaVersion:2,interventionId,siteId,zoneId,zoneNameSnapshot:ranking.zoneNameSnapshot,mapRevisionId:s.mapRevisionId,
      timeZoneSnapshot:tz,implementedAt:Timestamp.fromDate(now),implementedByUid:actor.uid,sourceSnapshotCalculatedAt:s.calculatedAt,
      rankingSnapshot:ranking,requestedLookbackDaysSnapshot:s.requestedLookbackDays,availableCoverageSnapshot:ranking.coverage,
      exclusionEndsAt:Timestamp.fromDate(fullDayExclusion(now,tz)),note:note??null,createdAt:Timestamp.fromDate(now)};
    tx.create(intervention,data);
    tx.update(ref,{zoneRankings:s.zoneRankings.filter((z:any)=>z.zoneId!==zoneId),sourceFingerprint:null});
    const audit=firestore.collection("auditEvents").doc();
    tx.create(audit,v2AuditEventData({auditEventId:audit.id,actor,siteId,action:"bin_placement_implemented",resourceType:"BinPlacementIntervention",resourceId:interventionId,outcome:"succeeded",after:{zoneId},requestId:interventionId}));
    return interventionId;
  });
  return safe({id,...(await firestore.collection("binPlacementInterventions").doc(id).get()).data()});
}

export async function compareIntervention(siteId:string,id:string,days:number,now=new Date()) {
  validateDays(days);
  const [doc,site]=await Promise.all([firestore.collection("binPlacementInterventions").doc(id).get(),requireAnalyticsSite(siteId)]);
  if(!doc.exists || doc.data()?.siteId!==siteId) throw new HttpError(404,"Intervention not found.");
  const intervention=doc.data()!,at=millis(intervention.implementedAt),tz=String(intervention.timeZoneSnapshot??site.timeZone??"Asia/Kuala_Lumpur");
  const date=siteLocalDate(new Date(at),tz), midnight=+siteMidnight(date,tz);
  // Calendar-day windows; the intervention day's operational events are split at its exact timestamp.
  const beforeStart=+shiftSiteInstant(new Date(at),-days,tz),afterEnd=+shiftSiteInstant(new Date(at),days,tz);
  const summaries=await getDailySummaries(siteId,shiftDate(date,-days),shiftDate(date,days));
  const {facts}=await operationalFacts(siteId), zoneId=String(intervention.zoneId);
  const side=(from:number,to:number)=>{
    const rows:any[]=[],missingDates:string[]=[];
    let d=siteLocalDate(new Date(from),tz);
    while(+siteMidnight(d,tz)<to) {
      const a=Math.max(from,+siteMidnight(d,tz)),b=Math.min(to,+siteMidnight(shiftDate(d,1),tz),+now);
      if(b>a) {
        const summary=summaries.find(s=>s.localDate===d),metric=summary?.zoneMetrics?.[zoneId];
        const events=facts.filter(f=>f.zoneId===zoneId && f.at>=a && f.at<b);
        const observed=Boolean(metric && (metric.successfulSampleCount>0 || metric.resolvedWorkCount>0 || metric.binServiceAlertCount>0 || metric.litterAlertCount>0)) || events.length>0;
        if(observed) rows.push({localDate:d,periodStart:new Date(a).toISOString(),periodEnd:new Date(b).toISOString(),
          cleaningFrequency:events.filter(f=>f.kind==="resolved").length,binOverflowFrequency:events.filter(f=>f.kind==="overflow").length,
          coverageDays:(b-a)/(+siteMidnight(shiftDate(d,1),tz)-+siteMidnight(d,tz)),
          monitoringPartial:summary?.coverage?.partial??true,
          partialDay:a>+siteMidnight(d,tz)||b<+siteMidnight(shiftDate(d,1),tz)});
        else missingDates.push(d);
      }
      d=shiftDate(d,1);
    }
    const availableDays=Math.min(days,Math.round(rows.reduce((sum,r)=>sum+r.coverageDays,0)*1000000)/1000000);
    return {requestedStart:new Date(from).toISOString(),requestedEnd:new Date(to).toISOString(),availableDays,
      partialDays:rows.filter(r=>r.partialDay).length,partial:missingDates.length>0||to>+now||availableDays<days,
      missingDates,summaries:rows,series:rows};
  };
  return {interventionId:id,zoneId,requestedDays:days,timeZone:tz,implementedAt:new Date(at).toISOString(),
    before:side(beforeStart,at),after:side(at,afterEnd),boundaryPolicy:"site_calendar_days_split_at_implementation"};
}
