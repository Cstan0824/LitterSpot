import { createHash, randomUUID } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { PipelineAnalysisResponse } from "../schemas/detection.js";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { V2_SCHEMA_VERSION } from "../shared/v2Contracts.js";
import { detectSupportedImage, validateDeclaredImageType } from "./imageUploadValidation.js";
import { loadRegistrationReference } from "./cameraRegistrationReference.js";
import { inferFrame } from "./frameInferenceClient.js";
import { shouldAcceptSample, type MonitoringLease } from "./v2MonitoringLease.js";
import { persistMinuteContributions } from "./phase11MinuteStore.js";

export type LiveIssue = { issueType: "floor_litter" | "floor_spill" | "bin_service"; condition: "litter" | "spill" | "full" | "overflow"; confidence: number; entityId: string; geometry: unknown };
export type V2LiveObservation = {
  sampleId: string;
  capturedAtMs: number;
  peopleCount: number;
  people: Array<{ confidence: number; bbox: { x1: number; y1: number; x2: number; y2: number } }>;
  bins: Array<{
    binId: string;
    state: "normal" | "full" | "overflow" | "review" | "unknown";
    confidence: number;
    bbox: { x1: number; y1: number; x2: number; y2: number };
  }>;
  issues: LiveIssue[];
  binStates: Array<{ binId: string; state: "normal" | "full" | "overflow" | "review" | "unknown" }>;
  modelVersions: Record<string, string>;
  isSimulation: boolean;
};
export type V2EvidenceCandidate = { confidence: number; frame: Buffer; mimeType: string; observation: V2LiveObservation };
type MinuteAccumulator = { contributionId: string; pending: number; siteId: string; minuteStart: string; timeZone: string; mapRevisionId: string; cameraId: string; zoneId: string; zoneName: string; sampleAttemptCount: number; successfulSampleCount: number; failedSampleCount: number; peopleSum: number; peopleMax: number; litter: number; spill: number; full: number; overflow: number; simulation: number; latencySum: number; latencyCount: number };

const temporal = new Map<string, V2LiveObservation[]>();
const evidence = new Map<string, V2EvidenceCandidate>();
const minute = new Map<string, MinuteAccumulator>();
let inference: typeof inferFrame = inferFrame;
const inferenceTails = new Map<string, Promise<void>>();

async function serializeInference<T>(cameraId: string, work: () => Promise<T>) {
  const previous = inferenceTails.get(cameraId) ?? Promise.resolve(); let release!: () => void; const current = new Promise<void>((resolve) => { release = resolve; }); const tail = previous.then(() => current); inferenceTails.set(cameraId, tail); await previous;
  try { return await work(); } finally { release(); if (inferenceTails.get(cameraId) === tail) inferenceTails.delete(cameraId); }
}

export function setV2LiveInferenceForTests(replacement: typeof inferFrame | null) { inference = replacement ?? inferFrame; }
export function resetV2LiveMemory(cameraId?: string, preserveMinute = false) {
  for (const store of preserveMinute ? [temporal, evidence] : [temporal, evidence, minute]) for (const key of store.keys()) if (!cameraId || key.includes(`:${cameraId}:`) || key.endsWith(`:${cameraId}`)) store.delete(key);
}
export function inspectV2LiveMemory(cameraId: string) {
  return { temporalKeys: [...temporal.keys()].filter((key) => key.includes(`:${cameraId}:`)), evidenceKeys: [...evidence.keys()].filter((key) => key.includes(`:${cameraId}:`)), minuteKeys: [...minute.keys()].filter((key) => key.endsWith(`:${cameraId}`)) };
}
export function getV2LiveIssueState(siteId: string, cameraId: string, issueType: "floor_litter" | "floor_spill" | "bin_service") { const key = `${siteId}:${cameraId}:${issueType}`; return { observations: [...(temporal.get(key) ?? [])], candidate: evidence.get(key) ?? null }; }

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function lease(data: FirebaseFirestore.DocumentData): MonitoringLease { return { sessionId: String(data.sessionId), ownerUid: String(data.ownerUid), tokenHash: String(data.leaseTokenHash), leaseExpiresAtMs: Number(data.leaseExpiresAt?.toMillis?.() ?? 0), status: data.status, revision: Number(data.revision ?? 0) }; }
function issues(result: PipelineAnalysisResponse): LiveIssue[] {
  const floor = result.floorHazards.map((hazard, index) => ({ issueType: hazard.className, condition: hazard.className === "floor_litter" ? "litter" as const : "spill" as const, confidence: hazard.confidence, entityId: `floor-${index + 1}`, geometry: { bbox: hazard.bbox, polygon: hazard.polygon } }));
  const bins = result.bins.filter((bin) => bin.state === "full" || bin.state === "overflow").map((bin) => ({ issueType: "bin_service" as const, condition: bin.state as "full" | "overflow", confidence: bin.stateConfidence, entityId: bin.binId ?? `bin-${bin.binIndex}`, geometry: { bbox: bin.bbox, binId: bin.binId ?? null } }));
  return [...floor, ...bins];
}

export async function startMonitoringEpisode(input: { siteId: string; cameraId: string; sessionId: string; token: string }) {
  const [session, camera, site] = await Promise.all([firestore.collection("monitoringSessions").doc(input.siteId).get(), firestore.collection("cameras").doc(input.cameraId).get(), firestore.collection("sites").doc(input.siteId).get()]);
  if (!session.exists || !camera.exists || camera.data()?.siteId !== input.siteId) throw new HttpError(404, "Monitoring Session or Camera not found.");
  if (camera.data()?.status !== "active" || camera.data()?.monitoringEnabled !== true) throw new HttpError(409, "Camera monitoring is not enabled.");
  const currentLease = lease(session.data()!);
  if (!shouldAcceptSample({ session: currentLease, sessionId: input.sessionId, tokenHash: hash(input.token), expectedSequence: 0, sequence: 0, nowMs: Date.now() })) throw new HttpError(409, "Monitoring Session is not the active owner.");
  const episodeRef = firestore.collection("monitoringEpisodes").doc();
  const mapRevisionId = String(site.data()?.activeMapRevisionId ?? ""); const placement = await firestore.collection("siteMapRevisions").doc(mapRevisionId).collection("cameraPlacements").doc(input.cameraId).get();
  if (!placement.exists || placement.data()?.siteId !== input.siteId) throw new HttpError(409, "Camera Placement is missing from the Active Map Revision.");
  await episodeRef.create({ schemaVersion: V2_SCHEMA_VERSION, episodeId: episodeRef.id, siteId: input.siteId, cameraId: input.cameraId, monitoringSessionId: input.sessionId, sourceRevisionId: camera.data()?.activeSourceRevisionId, registrationRevisionId: camera.data()?.activeRegistrationRevisionId, mapRevisionId, zoneId: placement.data()?.zoneId, timeZoneSnapshot: String(site.data()?.timeZone ?? "Asia/Kuala_Lumpur"), isSimulation: Boolean(camera.data()?.isSimulation), startedAt: FieldValue.serverTimestamp(), endedAt: null, endReason: null, lastSequence: 0 });
  await firestore.collection("cameraRuntimeStates").doc(input.cameraId).set({ schemaVersion: V2_SCHEMA_VERSION, siteId: input.siteId, cameraId: input.cameraId, connectionStatus: "online", cleanlinessState: "unknown", monitoringSessionId: input.sessionId, monitoringEpisodeId: episodeRef.id, lastFrameCapturedAt: null, lastSampleAcceptedAt: null, lastInferenceSucceededAt: null, lastPeopleCount: null, lastIssueSummary: {}, sourceErrorCode: null, sourceErrorMessage: null, updatedAt: FieldValue.serverTimestamp(), expiresAt: null });
  resetV2LiveMemory(input.cameraId, true);
  return { episodeId: episodeRef.id, nextSequence: 1, isSimulation: Boolean(camera.data()?.isSimulation) };
}

export async function processLiveSample(input: { siteId: string; cameraId: string; sessionId: string; episodeId: string; token: string; sequence: number; capturedAt: Date; frame: Express.Multer.File }) {
  if (+input.capturedAt < Date.now() - 120000 || +input.capturedAt > Date.now() + 10000) throw new HttpError(400, "Live sample is outside the two-minute lateness window.");
  const detected = detectSupportedImage(input.frame.buffer); validateDeclaredImageType(input.frame.mimetype, detected.mimeType);
  const cameraRef = firestore.collection("cameras").doc(input.cameraId); const sessionRef = firestore.collection("monitoringSessions").doc(input.siteId); const episodeRef = firestore.collection("monitoringEpisodes").doc(input.episodeId);
  const [camera, session, episode] = await Promise.all([cameraRef.get(), sessionRef.get(), episodeRef.get()]);
  if (!camera.exists || camera.data()?.siteId !== input.siteId || camera.data()?.status !== "active" || camera.data()?.monitoringEnabled !== true) throw new HttpError(409, "Camera is not available for monitoring.");
  if (!session.exists || !episode.exists || episode.data()?.siteId !== input.siteId || episode.data()?.cameraId !== input.cameraId || episode.data()?.endedAt) throw new HttpError(409, "Monitoring Episode is not active.");
  const currentLease = lease(session.data()!); const expected = Number(episode.data()?.lastSequence ?? 0) + 1;
  if (!shouldAcceptSample({ session: currentLease, sessionId: input.sessionId, tokenHash: hash(input.token), expectedSequence: expected, sequence: input.sequence, nowMs: Date.now() })) throw new HttpError(409, "Live sample sequence or Monitoring Session is invalid.");
  if (camera.data()?.activeSourceRevisionId !== episode.data()?.sourceRevisionId || camera.data()?.activeRegistrationRevisionId !== episode.data()?.registrationRevisionId) throw new HttpError(409, "Camera source or Registration changed. Start a new Monitoring Episode.");
  const registration = await firestore.collection("cameraRegistrationRevisions").doc(String(episode.data()?.registrationRevisionId)).get();
  if (!registration.exists || registration.data()?.siteId !== input.siteId || registration.data()?.cameraId !== input.cameraId) throw new HttpError(409, "Active Camera Registration is missing.");
  await firestore.runTransaction(async (transaction) => { const latest = await transaction.get(episodeRef); if (!latest.exists || latest.data()?.lastSequence !== expected - 1) throw new HttpError(409, "Live sample sequence changed."); transaction.update(episodeRef, { lastSequence: input.sequence }); });
  const reference = await loadRegistrationReference(registration.data());
  const minuteStart = `${input.capturedAt.toISOString().slice(0, 16)}:00.000Z`; const minuteKey = `${input.siteId}:${minuteStart}:${input.episodeId}:${input.cameraId}`;
  const accumulator = minute.get(minuteKey) ?? { contributionId: randomUUID(), pending: 0, siteId: input.siteId, minuteStart, timeZone: String(episode.data()?.timeZoneSnapshot ?? "Asia/Kuala_Lumpur"), mapRevisionId: String(episode.data()?.mapRevisionId ?? ""), cameraId: input.cameraId, zoneId: String(episode.data()?.zoneId), zoneName:String(episode.data()?.zoneNameSnapshot??episode.data()?.zoneId), sampleAttemptCount: 0, successfulSampleCount: 0, failedSampleCount: 0, peopleSum: 0, peopleMax: 0, litter: 0, spill: 0, full: 0, overflow: 0, simulation: 0, latencySum:0, latencyCount:0 }; accumulator.pending += 1; accumulator.sampleAttemptCount += 1; minute.set(minuteKey, accumulator);
  try {
    const result = await serializeInference(input.cameraId, () => inference({ contents: input.frame.buffer, fileName: input.frame.originalname || `sample-${input.sequence}.${detected.extension}`, mimeType: detected.mimeType, floorConfidence: 0.25, binLocalizerConfidence: 0.8, focusRegion: registration.data()?.walkableFloorPolygon ?? [], registration: { ...registration.data(), status: "ready", alignmentStatus: "valid" }, reference, binReviewEnabled: true }));
    const observation: V2LiveObservation = {
      sampleId: `${input.episodeId}:${input.sequence}`,
      capturedAtMs: input.capturedAt.getTime(),
      peopleCount: result.peopleCount,
      people: result.people.map((person) => ({ confidence: person.confidence, bbox: person.bbox })),
      bins: result.bins.map((bin) => ({
        binId: bin.binId ?? `bin-${bin.binIndex}`,
        state: bin.state,
        confidence: bin.stateConfidence,
        bbox: bin.bbox,
      })),
      issues: issues(result),
      binStates: result.bins.map((bin) => ({ binId: bin.binId ?? `bin-${bin.binIndex}`, state: bin.state })),
      modelVersions: result.modelVersions,
      isSimulation: Boolean(camera.data()?.isSimulation),
    };
    for (const issueType of ["floor_litter", "floor_spill", "bin_service"] as const) { const key = `${input.siteId}:${input.cameraId}:${issueType}`; const values = temporal.get(key) ?? []; values.push(observation); temporal.set(key, values.slice(-5)); const matching = observation.issues.filter((issue) => issue.issueType === issueType); const best = matching.sort((a, b) => b.confidence - a.confidence)[0]; if (best) { const current = evidence.get(key); if (!current || best.confidence >= current.confidence) evidence.set(key, { confidence: best.confidence, frame: Buffer.from(input.frame.buffer), mimeType: detected.mimeType, observation }); } }
    accumulator.successfulSampleCount += 1; accumulator.latencySum+=result.processingTimeMs; accumulator.latencyCount++; accumulator.peopleSum += result.peopleCount; accumulator.peopleMax = Math.max(accumulator.peopleMax, result.peopleCount); accumulator.litter += observation.issues.filter((issue) => issue.condition === "litter" && issue.confidence >= 0.5).length; accumulator.spill += observation.issues.filter((issue) => issue.condition === "spill" && issue.confidence >= 0.5).length; accumulator.full += observation.issues.filter((issue) => issue.condition === "full" && issue.confidence >= 0.5).length; accumulator.overflow += observation.issues.filter((issue) => issue.condition === "overflow" && issue.confidence >= 0.5).length; accumulator.simulation += observation.isSimulation ? 1 : 0;
    await firestore.collection("cameraRuntimeStates").doc(input.cameraId).set({ connectionStatus: "online", monitoringSessionId: input.sessionId, monitoringEpisodeId: input.episodeId, lastFrameCapturedAt: Timestamp.fromDate(input.capturedAt), lastSampleAcceptedAt: FieldValue.serverTimestamp(), lastInferenceSucceededAt: FieldValue.serverTimestamp(), lastPeopleCount: result.peopleCount, lastIssueSummary: { litter: accumulator.litter, spill: accumulator.spill, full: accumulator.full, overflow: accumulator.overflow }, sourceErrorCode: null, sourceErrorMessage: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { accepted: true, sequence: input.sequence, observation: { ...observation, issues: observation.issues, image: result.image, processingTimeMs: result.processingTimeMs } };
  } catch (error) {
    accumulator.failedSampleCount += 1;
    await firestore.collection("cameraRuntimeStates").doc(input.cameraId).set({ lastFrameCapturedAt: Timestamp.fromDate(input.capturedAt), lastSampleAcceptedAt: FieldValue.serverTimestamp(), sourceErrorCode: "inference_failed", sourceErrorMessage: "The sampled frame could not be analyzed.", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    throw error;
  } finally {
    accumulator.pending -= 1;
  }
}

export async function markOfflineCameras(siteId: string, now = new Date(), timeoutSeconds = 10) {
  const cutoff = Timestamp.fromMillis(now.getTime() - timeoutSeconds * 1000); const snapshot = await firestore.collection("cameraRuntimeStates").where("siteId", "==", siteId).where("connectionStatus", "==", "online").get(); let changed = 0;
  for (const state of snapshot.docs) { const last = state.data().lastSampleAcceptedAt as Timestamp | undefined; if (!last || last.toMillis() <= cutoff.toMillis()) { await state.ref.update({ connectionStatus: "offline", sourceErrorCode: "sample_timeout", sourceErrorMessage: "Camera sampling stopped.", updatedAt: FieldValue.serverTimestamp() }); const episodeId = state.data().monitoringEpisodeId; if (episodeId) await firestore.collection("monitoringEpisodes").doc(String(episodeId)).set({ endedAt: FieldValue.serverTimestamp(), endReason: "session_lost" }, { merge: true }); changed += 1; } }
  return changed;
}

let flushTail: Promise<unknown> = Promise.resolve();
export async function flushV2MinuteBuckets(siteId: string, before = new Date()) {
  const work = async () => {
    const selected = [...minute.entries()].filter(([, v]) => v.siteId === siteId && v.pending === 0 && Date.parse(v.minuteStart) + 60000 <= +before);
    const groups = new Map<string, Array<{ key: string; value: MinuteAccumulator; count: number }>>();
    for (const [key, value] of selected) {
      const items = groups.get(value.minuteStart) ?? [];
      items.push({ key, value, count: value.sampleAttemptCount }); groups.set(value.minuteStart, items);
    }
    for (const [start, items] of groups) {
      await persistMinuteContributions(siteId, new Date(start), items[0].value.timeZone, items.map(({ value: v }) => ({
        id: v.contributionId, zoneId: v.zoneId, zoneNameSnapshot:v.zoneName, mapRevisionId: v.mapRevisionId,
        metrics: { sampleAttemptCount: v.sampleAttemptCount, successfulSampleCount: v.successfulSampleCount, failedSampleCount: v.failedSampleCount,
          peopleObservationCount: v.successfulSampleCount, peopleSum: v.peopleSum, peopleMax: v.peopleMax, qualifyingLitterCount: v.litter,
          qualifyingSpillCount: v.spill, qualifyingBinFullCount: v.full, qualifyingBinOverflowCount: v.overflow, simulationSampleCount: v.simulation, inferenceLatencyMsSum:v.latencySum,inferenceLatencySampleCount:v.latencyCount },
      })));
      for (const item of items) if (minute.get(item.key) === item.value && item.value.pending === 0 && item.value.sampleAttemptCount === item.count) minute.delete(item.key);
    }
    return groups.size;
  };
  const result = flushTail.then(work, work); flushTail = result.catch(() => undefined); return result;
}
export function liveAnalyticsSites() { return [...new Set([...minute.values()].map(v => v.siteId))]; }
