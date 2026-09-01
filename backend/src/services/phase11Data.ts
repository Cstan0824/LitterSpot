import { FieldPath, Timestamp, type Query, type DocumentData, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";

export const millis = (value: any): number => value instanceof Timestamp ? value.toMillis() : value instanceof Date ? +value : typeof value === "string" ? Date.parse(value) : NaN;
export async function allDocuments(query: Query<DocumentData>) {
  const docs: QueryDocumentSnapshot[] = [];
  let cursor: QueryDocumentSnapshot | undefined;
  while (true) {
    let pageQuery = query.orderBy(FieldPath.documentId()).limit(500);
    if (cursor) pageQuery = pageQuery.startAfter(cursor);
    const page = await pageQuery.get(); docs.push(...page.docs);
    if (page.size < 500) return docs;
    cursor = page.docs.at(-1);
  }
}
export async function siteDocuments(collection: string, siteId: string) {
  return (await allDocuments(firestore.collection(collection).where("siteId", "==", siteId))).filter(doc => doc.data().schemaVersion === 2);
}
export async function requireAnalyticsSite(siteId: string) {
  const doc = await firestore.collection("sites").doc(siteId).get();
  if (!doc.exists || doc.data()?.schemaVersion !== 2 || doc.data()?.status !== "active") throw new HttpError(404, "Active Site not found.");
  return doc.data()!;
}
export type OperationalFact = { at: number; zoneId: string; name: string; kind: "litter" | "spill" | "bin" | "overflow" | "resolved" | "dismissed"; simulation: boolean; durationSeconds?: number };

/** Rebuild from immutable event times. Parent creation/terminal timestamps support older records without events. */
export async function operationalFacts(siteId: string) {
  const [alerts, works] = await Promise.all([siteDocuments("alerts", siteId), siteDocuments("workOrders", siteId)]);
  const facts: OperationalFact[] = [];
  for (const doc of alerts) {
    const a = doc.data(); if (!a.zoneId) continue;
    const base = { zoneId: String(a.zoneId), name: String(a.zoneNameSnapshot ?? a.zoneId), simulation: Boolean(a.isSimulation) };
    facts.push({ ...base, at: millis(a.createdAt), kind: a.issueType === "floor_litter" ? "litter" : a.issueType === "floor_spill" ? "spill" : "bin" });
    const events = await allDocuments(doc.ref.collection("events"));
    const overflow = events.map(e => e.data()).filter(e => e.toCondition !== undefined
      ? e.toCondition === "overflow" && e.fromCondition !== "overflow"
      : e.reasonCode === "overflow" && ["created", "severity_changed", "overflow_escalated"].includes(e.type));
    if (overflow.length) for (const e of overflow) facts.push({ ...base, at: millis(e.occurredAt), kind: "overflow" });
    else if (a.observedCondition === "overflow" && !events.length) facts.push({ ...base, at: millis(a.firstDetectedAt ?? a.createdAt), kind: "overflow" });
  }
  for (const doc of works) {
    const w = doc.data(); if (!w.zoneId) continue;
    const base = { zoneId: String(w.zoneId), name: String(w.target?.zoneNameSnapshot ?? w.zoneId), simulation: Boolean(w.isSimulation) };
    const events = await allDocuments(doc.ref.collection("events"));
    for (const kind of ["resolved", "dismissed"] as const) {
      const event = events.map(e => e.data()).filter(e => e.toStatus === kind).sort((a,b) => millis(a.occurredAt) - millis(b.occurredAt))[0];
      const at = event ? millis(event.occurredAt) : millis(w[`${kind}At`]);
      if (!Number.isFinite(at)) continue;
      const started = millis(w.startedAt);
      facts.push({ ...base, at, kind, ...(kind === "resolved" && Number.isFinite(started) && started <= at ? { durationSeconds: (at - started) / 1000 } : {}) });
    }
  }
  return { facts: facts.filter(f => Number.isFinite(f.at)), alerts, works };
}
