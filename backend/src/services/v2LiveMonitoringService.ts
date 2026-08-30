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

export type LiveIssue = { issueType: "floor_litter" | "floor_spill" | "bin_service"; condition: "litter" | "spill" | "full" | "overflow"; confidence: number; entityId: string; geometry: unknown };
export type V2LiveObservation = { sampleId: string; capturedAtMs: number; peopleCount: number; issues: LiveIssue[]; binStates: Array<{ binId: string; state: "normal" | "full" | "overflow" | "review" | "unknown" }>; modelVersions: Record<string, string>; isSimulation: boolean };
export type V2EvidenceCandidate = { confidence: number; frame: Buffer; mimeType: string; observation: V2LiveObservation };
type MinuteAccumulator = { siteId: string; minuteStart: string; timeZone: string; mapRevisionId: string; cameraId: string; zoneId: string; sampleAttemptCount: number; successfulSampleCount: number; failedSampleCount: number; peopleSum: number; peopleMax: number; litter: number; spill: number; full: number; overflow: number; simulation: number };

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
export function resetV2LiveMemory(cameraId?: string) {
  for (const store of [temporal, evidence, minute]) for (const key of store.keys()) if (!cameraId || key.includes(`:${cameraId}:`) || key.endsWith(`:${cameraId}`)) store.delete(key);
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
  resetV2LiveMemory(input.cameraId);
  return { episodeId: episodeRef.id, nextSequence: 1, isSimulation: Boolean(camera.data()?.isSimulation) };
}

export async function processLiveSample(input: { siteId: string; cameraId: string; sessionId: string; episodeId: string; token: string; sequence: number; capturedAt: Date; frame: Express.Multer.File }) {
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
  const minuteStart = `${input.capturedAt.toISOString().slice(0, 16)}:00.000Z`; const minuteKey = `${input.siteId}:${minuteStart}:${input.cameraId}`;
  const accumulator = minute.get(minuteKey) ?? { siteId: input.siteId, minuteStart, timeZone: String(episode.data()?.timeZoneSnapshot ?? "Asia/Kuala_Lumpur"), mapRevisionId: String(episode.data()?.mapRevisionId ?? ""), cameraId: input.cameraId, zoneId: String(episode.data()?.zoneId), sampleAttemptCount: 0, successfulSampleCount: 0, failedSampleCount: 0, peopleSum: 0, peopleMax: 0, litter: 0, spill: 0, full: 0, overflow: 0, simulation: 0 }; accumulator.sampleAttemptCount += 1; minute.set(minuteKey, accumulator);
  try {
    const result = await serializeInference(input.cameraId, () => inference({ contents: input.frame.buffer, fileName: input.frame.originalname || `sample-${input.sequence}.${detected.extension}`, mimeType: detected.mimeType, floorConfidence: 0.25, binLocalizerConfidence: 0.8, focusRegion: registration.data()?.walkableFloorPolygon ?? [], registration: { ...registration.data(), status: "ready", alignmentStatus: "valid" }, reference, binReviewEnabled: true }));
    const observation: V2LiveObservation = { sampleId: `${input.episodeId}:${input.sequence}`, capturedAtMs: input.capturedAt.getTime(), peopleCount: result.peopleCount, issues: issues(result), binStates: result.bins.map((bin) => ({ binId: bin.binId ?? `bin-${bin.binIndex}`, state: bin.state })), modelVersions: result.modelVersions, isSimulation: Boolean(camera.data()?.isSimulation) };
    for (const issueType of ["floor_litter", "floor_spill", "bin_service"] as const) { const key = `${input.siteId}:${input.cameraId}:${issueType}`; const values = temporal.get(key) ?? []; values.push(observation); temporal.set(key, values.slice(-5)); const matching = observation.issues.filter((issue) => issue.issueType === issueType); const best = matching.sort((a, b) => b.confidence - a.confidence)[0]; if (best) { const current = evidence.get(key); if (!current || best.confidence >= current.confidence) evidence.set(key, { confidence: best.confidence, frame: Buffer.from(input.frame.buffer), mimeType: detected.mimeType, observation }); } }
    accumulator.successfulSampleCount += 1; accumulator.peopleSum += result.peopleCount; accumulator.peopleMax = Math.max(accumulator.peopleMax, result.peopleCount); accumulator.litter += observation.issues.filter((issue) => issue.condition === "litter").length; accumulator.spill += observation.issues.filter((issue) => issue.condition === "spill").length; accumulator.full += observation.issues.filter((issue) => issue.condition === "full").length; accumulator.overflow += observation.issues.filter((issue) => issue.condition === "overflow").length; accumulator.simulation += observation.isSimulation ? 1 : 0;
    await firestore.collection("cameraRuntimeStates").doc(input.cameraId).set({ connectionStatus: "online", monitoringSessionId: input.sessionId, monitoringEpisodeId: input.episodeId, lastFrameCapturedAt: Timestamp.fromDate(input.capturedAt), lastSampleAcceptedAt: FieldValue.serverTimestamp(), lastInferenceSucceededAt: FieldValue.serverTimestamp(), lastPeopleCount: result.peopleCount, lastIssueSummary: { litter: accumulator.litter, spill: accumulator.spill, full: accumulator.full, overflow: accumulator.overflow }, sourceErrorCode: null, sourceErrorMessage: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { accepted: true, sequence: input.sequence, observation: { ...observation, issues: observation.issues, image: result.image, processingTimeMs: result.processingTimeMs } };
  } catch (error) {
    accumulator.failedSampleCount += 1;
    await firestore.collection("cameraRuntimeStates").doc(input.cameraId).set({ lastFrameCapturedAt: Timestamp.fromDate(input.capturedAt), lastSampleAcceptedAt: FieldValue.serverTimestamp(), sourceErrorCode: "inference_failed", sourceErrorMessage: "The sampled frame could not be analyzed.", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    throw error;
  }
}

export async function markOfflineCameras(siteId: string, now = new Date(), timeoutSeconds = 10) {
  const cutoff = Timestamp.fromMillis(now.getTime() - timeoutSeconds * 1000); const snapshot = await firestore.collection("cameraRuntimeStates").where("siteId", "==", siteId).where("connectionStatus", "==", "online").get(); let changed = 0;
  for (const state of snapshot.docs) { const last = state.data().lastSampleAcceptedAt as Timestamp | undefined; if (!last || last.toMillis() <= cutoff.toMillis()) { await state.ref.update({ connectionStatus: "offline", sourceErrorCode: "sample_timeout", sourceErrorMessage: "Camera sampling stopped.", updatedAt: FieldValue.serverTimestamp() }); const episodeId = state.data().monitoringEpisodeId; if (episodeId) await firestore.collection("monitoringEpisodes").doc(String(episodeId)).set({ endedAt: FieldValue.serverTimestamp(), endReason: "session_lost" }, { merge: true }); changed += 1; } }
  return changed;
}

export async function flushV2MinuteBuckets(siteId: string, before = new Date()) {
  const selected = [...minute.entries()].filter(([, value]) => value.siteId === siteId && new Date(value.minuteStart).getTime() < before.getTime());
  const groups = new Map<string, MinuteAccumulator[]>(); for (const [, value] of selected) { const key = `${value.siteId}:${value.minuteStart}`; const values = groups.get(key) ?? []; values.push(value); groups.set(key, values); }
  for (const [key, values] of groups) {
    const first = values[0]; const zones: Record<string, Record<string, number>> = {};
    for (const value of values) { const zone = zones[value.zoneId] ?? { sampleAttemptCount: 0, successfulSampleCount: 0, failedSampleCount: 0, peopleSum: 0, peopleMax: 0, qualifyingLitterCount: 0, qualifyingSpillCount: 0, qualifyingBinFullCount: 0, qualifyingBinOverflowCount: 0, simulationSampleCount: 0 }; zone.sampleAttemptCount += value.sampleAttemptCount; zone.successfulSampleCount += value.successfulSampleCount; zone.failedSampleCount += value.failedSampleCount; zone.peopleSum += value.peopleSum; zone.peopleMax = Math.max(zone.peopleMax, value.peopleMax); zone.qualifyingLitterCount += value.litter; zone.qualifyingSpillCount += value.spill; zone.qualifyingBinFullCount += value.full; zone.qualifyingBinOverflowCount += value.overflow; zone.simulationSampleCount += value.simulation; zones[value.zoneId] = zone; }
    const bucketId = createHash("sha256").update(key).digest("hex"); const start = new Date(first.minuteStart);
    await firestore.collection("analyticsMinuteBuckets").doc(bucketId).set({ schemaVersion: V2_SCHEMA_VERSION, bucketId, siteId: first.siteId, bucketStart: Timestamp.fromDate(start), bucketEnd: Timestamp.fromMillis(start.getTime() + 60000), siteLocalDate: new Intl.DateTimeFormat("en-CA", { timeZone: first.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(start), timeZoneSnapshot: first.timeZone, mapRevisionIds: [...new Set(values.map((value) => value.mapRevisionId))], zoneMetrics: zones, siteTotals: {}, aggregationVersion: "minute-v2", finalizedAt: FieldValue.serverTimestamp(), lastReconciledAt: null, expiresAt: Timestamp.fromMillis(start.getTime() + 90 * 86400000) }, { merge: true });
  }
  for (const [key] of selected) minute.delete(key);
  return groups.size;
}
