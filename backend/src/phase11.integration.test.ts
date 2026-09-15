import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import request from "supertest";
import { app } from "./app.js";
import { firebaseAuth, firestore } from "./config/firebase.js";
import { rebuildDailySummary, refreshBinPlacement, buildDashboard, getDashboard, implementBinPlacement, compareIntervention, cleanupMinuteBuckets, getBinPlacementSnapshot } from "./services/phase11Service.js";
import { persistMinuteContributions } from "./services/phase11MinuteStore.js";
import { runPhase11Maintenance } from "./services/phase11Worker.js";
import { dailyId } from "./services/phase11Daily.js";
import { siteMidnight } from "./services/phase11Calendar.js";

const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const now = new Date("2026-09-08T10:00:00Z");
const actor = {uid:"phase11-test",role:"supervisor" as const,authority:"root" as const,displayName:"Test"};
async function setup() {
  const siteId="phase11-"+randomUUID(), a=siteId+"-a", b=siteId+"-b";
  const put=(collection:string,id:string,data:object)=>firestore.collection(collection).doc(id).set({schemaVersion:2,siteId,...data});
  await put("sites",siteId,{name:"Phase11",status:"active",timeZone:"Asia/Kuala_Lumpur",activeMapRevisionId:"map"});
  await put("orchestratorConfigs",siteId,{status:"running",assignmentEnabled:true});
  await put("zones",a,{name:"A",lifecycleStatus:"active"}); await put("zones",b,{name:"B",status:"active"});
  const minute=async(date:string,id:string,people:number,zoneId=a)=>persistMinuteContributions(siteId,new Date(date),"Asia/Kuala_Lumpur",
    [{id,zoneId,mapRevisionId:"map",metrics:{sampleAttemptCount:1,successfulSampleCount:1,failedSampleCount:0,peopleObservationCount:1,peopleSum:people,peopleMax:people}}]);
  return {siteId,a,b,put,minute};
}
run("Phase 11 service regressions",()=>{
  it("merges minute contributions idempotently and builds correct Site totals and peaks",async()=>{
    const s=await setup();
    const t="2026-08-30T00:00:00Z";
    await s.minute(t,"one",5); await s.minute(t,"one",5); await s.minute(t,"two",3);
    const buckets=await firestore.collection("analyticsMinuteBuckets").where("siteId","==",s.siteId).get();
    expect(buckets.size).toBe(1); expect(buckets.docs[0].data().siteTotals.peopleSum).toBe(8);
    await s.minute("2026-08-30T00:01:00Z","three",2);
    const first=await rebuildDailySummary(s.siteId,"2026-08-30",now);
    expect(first.siteTotals.peopleSum).toBe(10); expect(first.siteTotals.peopleMax).toBe(5);
    expect(first.siteTotals.peopleObservationCount).toBe(3); expect(first.coverage.partial).toBe(true);
    const repeat=await rebuildDailySummary(s.siteId,"2026-08-30",now);
    expect(repeat.siteTotals).toEqual(first.siteTotals);
  });
  it("uses 15-minute Zone aggregates, bounded equal weights and Alert states",async()=>{
    const s=await setup();
    await s.minute("2026-09-08T09:59:00Z","a",10,s.a);
    await s.minute("2026-09-08T09:59:00Z","b",5,s.b);
    await s.minute("2026-09-08T09:00:00Z","old",10000,s.b);
    await s.put("alerts",s.siteId+"-alert",{status:"assigned",zoneId:s.a,severity:"warning",createdAt:Timestamp.fromDate(now)});
    await s.put("workOrders",s.siteId+"-work",{zoneId:s.b,status:"assigned",severity:"critical",createdAt:Timestamp.fromDate(now)});
    const dashboard=await buildDashboard(s.siteId,now);
    expect(dashboard.counts.alertByStatus.assigned).toBe(1);
    expect(dashboard.counts.alertByStatus.waiting_for_cleaner).toBe(0);
    expect(dashboard.busyZones.map((z:any)=>[z.zoneId,z.score])).toEqual([[s.b,75],[s.a,50]]);
    expect((await getDashboard(s.siteId,now)).generatedAt).toBe(dashboard.generatedAt);
  });
  it("uses highest historical severity for resolved Alert fallback and excludes dismissals",async()=>{
    const s=await setup();
    await s.put("alerts","high-"+s.siteId,{status:"resolved",severity:"warning",highestSeverity:"critical",priorityScore:1,createdAt:Timestamp.fromDate(now),resolvedAt:Timestamp.fromDate(now)});
    await s.put("alerts","low-"+s.siteId,{status:"resolved",severity:"warning",highestSeverity:"warning",priorityScore:100,createdAt:Timestamp.fromDate(now),resolvedAt:Timestamp.fromDate(now)});
    await s.put("alerts","dismissed-"+s.siteId,{status:"dismissed",severity:"critical",priorityScore:1000});
    expect((await buildDashboard(s.siteId,now)).topAlerts.map((a:any)=>a.alertId)).toEqual(["high-"+s.siteId,"low-"+s.siteId]);
  });
  it("keeps retired minute totals when cleaning 90-day data then rebuilding",async()=>{
    const s=await setup();
    await s.minute("2026-05-01T00:00:00Z","old",8);
    expect(await cleanupMinuteBuckets(s.siteId,now)).toBe(1);
    const summary=await rebuildDailySummary(s.siteId,"2026-05-01",now);
    expect(summary.siteTotals.peopleSum).toBe(8);
    expect(summary.minuteDataRetired).toBe(true);
    expect((await firestore.collection("analyticsMinuteBuckets").where("siteId","==",s.siteId).get()).empty).toBe(true);
  });
  it("ranks like factors across Zones and reports seven available days out of thirty",async()=>{
    const s=await setup();
    for(let day=1;day<=7;day++){
      const date=`2026-09-0${day}`;
      await s.minute(date+"T00:00:00Z","a",100,s.a); await s.minute(date+"T00:00:00Z","b",1,s.b);
      for(const zoneId of [s.a,s.b]){
        await s.put("workOrders",zoneId+day,{zoneId,status:"resolved",resolvedAt:Timestamp.fromDate(new Date(date+"T01:00:00Z"))});
        await s.put("alerts",zoneId+day,{zoneId,status:"resolved",issueType:"bin_service",createdAt:Timestamp.fromDate(new Date(date+"T00:00:00Z"))});
      }
      await rebuildDailySummary(s.siteId,date,now);
    }
    const ranking=await refreshBinPlacement(s.siteId,30,actor,now,false);
    expect(ranking.status).toBe("partial_data");
    expect(ranking.availableDays).toBe(7);
    expect(ranking.zoneRankings[0].zoneId).toBe(s.a);
    expect(ranking.zoneRankings[0].totalScore).toBeCloseTo(100);
    expect(ranking.zoneRankings[1].totalScore).toBeCloseTo(67);
    const intervention=await implementBinPlacement(s.siteId,s.a,actor,undefined,now,ranking.calculatedAt);
    const repeat=await implementBinPlacement(s.siteId,s.a,actor,undefined,now,ranking.calculatedAt);
    expect(repeat.interventionId).toBe(intervention.interventionId);
    expect(intervention.exclusionEndsAt).toBe("2026-09-10T16:00:00.000Z");
    const refreshed=await refreshBinPlacement(s.siteId,30,actor,new Date(+now+1000),false);
    expect(refreshed.zoneRankings.some((z:any)=>z.zoneId===s.a)).toBe(false);
    await expect(implementBinPlacement(s.siteId,s.a,actor,undefined,new Date(+now+1000))).rejects.toMatchObject({status:409});
  });
  it("does not replace missing calendar days with old summaries or mark one day sufficient",async()=>{
    const s=await setup();
    await s.minute("2026-08-01T00:00:00Z","old",99);
    await rebuildDailySummary(s.siteId,"2026-08-01",now);
    await s.minute("2026-09-07T00:00:00Z","recent",5);
    await rebuildDailySummary(s.siteId,"2026-09-07",now);
    const snapshot=await refreshBinPlacement(s.siteId,2,actor,now,false);
    const maintenanceState=await firestore.collection("phase11MaintenanceStates").doc(s.siteId).get();
    expect(snapshot.availableDays).toBe(1);
    expect(maintenanceState.data()?.recommendationLookbackDays).toBe(2);
    expect(snapshot.status).toBe("insufficient_data");
    expect(snapshot.zoneRankings.find((z:any)=>z.zoneId===s.a).totalScore).toBeNull();
    await expect(implementBinPlacement(s.siteId,s.a,actor,undefined,now)).rejects.toMatchObject({status:409});
  });
  it("splits comparison events at implementation and uses only the selected Zone and window",async()=>{
    const s=await setup();
    const at=new Date("2026-09-01T02:00:00Z"),id=s.siteId+"-intervention";
    await s.put("binPlacementInterventions",id,{zoneId:s.a,implementedAt:Timestamp.fromDate(at),timeZoneSnapshot:"Asia/Kuala_Lumpur"});
    for(const [label,zoneId,date] of [["before",s.a,"2026-09-01T01:00:00Z"],["after",s.a,"2026-09-01T03:00:00Z"],["other",s.b,"2026-09-01T04:00:00Z"],["outside",s.a,"2026-09-07T01:00:00Z"]]){
      await s.put("workOrders",s.siteId+label,{zoneId,status:"resolved",resolvedAt:Timestamp.fromDate(new Date(date))});
    }
    const comparison=await compareIntervention(s.siteId,id,2,now);
    expect(comparison.before.series.reduce((n:number,row:any)=>n+row.cleaningFrequency,0)).toBe(1);
    expect(comparison.after.series.reduce((n:number,row:any)=>n+row.cleaningFrequency,0)).toBe(1);
    expect(comparison.after.requestedEnd).toBe("2026-09-03T02:00:00.000Z");
    expect(comparison.after.missingDates.length).toBeGreaterThan(0);
    await expect(compareIntervention("other-site",id,2,now)).rejects.toMatchObject({status:404});
  });
  it("uses immutable overflow event time even after unrelated Alert updates",async()=>{
    const s=await setup(),id=s.siteId+"-bin";
    await s.put("alerts",id,{zoneId:s.a,issueType:"bin_service",observedCondition:"overflow",createdAt:Timestamp.fromDate(new Date("2026-09-01T00:00:00Z")),updatedAt:Timestamp.fromDate(now)});
    await firestore.collection("alerts").doc(id).collection("events").doc("overflow").set({type:"severity_changed",reasonCode:"overflow",occurredAt:Timestamp.fromDate(new Date("2026-09-02T00:00:00Z"))});
    expect((await rebuildDailySummary(s.siteId,"2026-09-02",now)).siteTotals.overflowEscalationCount).toBe(1);
    expect((await rebuildDailySummary(s.siteId,"2026-09-08",now)).siteTotals.overflowEscalationCount).toBe(0);
  });
  it("finalizes the previous day and uses explicit rebuild for older repair",async()=>{
    const s=await setup();
    await s.minute("2026-09-06T00:00:00Z","one",5); await s.minute("2026-09-07T00:00:00Z","two",6);
    await rebuildDailySummary(s.siteId,"2026-09-06",now);
    await runPhase11Maintenance(now,s.siteId);
    const snapshot=await getBinPlacementSnapshot(s.siteId,2,now);
    expect(snapshot.requestedLookbackDays).toBe(2);
    expect(snapshot.status).toBe("ready");
    expect(snapshot.zoneRankings.find((z:any)=>z.zoneId===s.a).totalScore).not.toBeNull();
    expect((await firestore.collection("analyticsDailySummaries").doc(dailyId(s.siteId,"2026-09-06")).get()).exists).toBe(true);
  });
  it("does not rescan retained analytics history on an unchanged maintenance tick",async()=>{
    const s=await setup();
    const batch=firestore.batch();
    for(let minute=0;minute<60;minute++){
      const bucketStart=new Date(Date.parse("2026-09-07T00:00:00Z")+minute*60000);
      batch.set(firestore.collection("analyticsMinuteBuckets").doc(`${s.siteId}-${minute}`),{
        schemaVersion:2,siteId:s.siteId,bucketStart:Timestamp.fromDate(bucketStart),bucketEnd:Timestamp.fromMillis(+bucketStart+60000),
        expiresAt:Timestamp.fromMillis(+bucketStart+91*86400000),zoneMetrics:{[s.a]:{successfulSampleCount:1,peopleObservationCount:1,peopleSum:2,peopleMax:2}},
      });
    }
    await batch.commit();
    await runPhase11Maintenance(now,s.siteId);
    const queryPrototype=Object.getPrototypeOf(firestore.collection("read-budget-probe").where("siteId","==",s.siteId));
    const original=queryPrototype.get;
    let queryDocuments=0;
    const get=vi.spyOn(queryPrototype,"get").mockImplementation(async function(this:unknown,...args:unknown[]){
      const snapshot=await original.apply(this,args);
      queryDocuments+=snapshot.size;
      return snapshot;
    });
    try{
      await runPhase11Maintenance(new Date(+now+60000),s.siteId);
      expect(queryDocuments).toBeLessThanOrEqual(5);
    }finally{get.mockRestore();}
  },15_000);
  it("records eligible and offline Camera coverage for each completed minute",async()=>{
    const s=await setup(),camera=s.siteId+"-camera",map="map",minute=new Date("2026-09-08T09:59:00Z");
    await s.put("cameras",camera,{status:"active",monitoringEnabled:true});
    await firestore.collection("siteMapRevisions").doc(map).collection("cameraPlacements").doc(camera).set({schemaVersion:2,siteId:s.siteId,zoneId:s.a,zoneNameSnapshot:"A"});
    await s.put("cameraRuntimeStates",camera,{connectionStatus:"online",lastSampleAcceptedAt:Timestamp.fromDate(new Date("2026-09-08T09:59:30Z"))});
    await runPhase11Maintenance(now,s.siteId);
    let buckets=await firestore.collection("analyticsMinuteBuckets").where("siteId","==",s.siteId).get();
    expect(buckets.docs.find(d=>d.data().bucketStart.toMillis()===+minute)?.data().siteTotals).toMatchObject({eligibleCameraCount:1,offlineCameraSeconds:0});
    await firestore.collection("cameraRuntimeStates").doc(camera).update({lastSampleAcceptedAt:Timestamp.fromMillis(0)});
    await runPhase11Maintenance(new Date(+now+60000),s.siteId);
    buckets=await firestore.collection("analyticsMinuteBuckets").where("siteId","==",s.siteId).get();
    expect(buckets.docs.find(d=>d.data().bucketStart.toMillis()===+now)?.data().siteTotals).toMatchObject({eligibleCameraCount:1,offlineCameraSeconds:60});
  });
  it("rejects invalid dates and Cleaner access, and scopes HTTP reads to the authenticated Site",async()=>{
    const s=await setup(),uid="phase11-user-"+randomUUID(),email=uid+"@example.test",password="Test-phase11-password";
    await firebaseAuth.createUser({uid,email,password});
    await s.put("userAccounts",uid,{uid,role:"supervisor",profileId:uid,authority:"root",status:"active"});
    await s.put("supervisors",uid,{uid,authority:"root",fullName:"Root",status:"active"});
    try{
      const signin=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=x`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,returnSecureToken:true})});
      const token=(await signin.json() as any).idToken;
      expect((await request(app).post("/api/analytics/daily/rebuild").set("Authorization",`Bearer ${token}`).send({localDate:"2026-02-30"})).status).toBe(400);
      const dashboard=await request(app).get("/api/dashboard?siteId=other-site").set("Authorization",`Bearer ${token}`);
      expect(dashboard.status).toBe(200); expect(dashboard.body.dashboard.siteId).toBe(s.siteId);
      await s.put("cleaners",uid,{authUid:uid,status:"active"});
      await firestore.collection("userAccounts").doc(uid).update({role:"cleaner",authority:null});
      expect((await request(app).get("/api/dashboard").set("Authorization",`Bearer ${token}`)).status).toBe(403);
    }finally{await firebaseAuth.deleteUser(uid);}
  });
});
