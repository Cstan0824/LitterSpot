import { createHash, randomUUID } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { PipelineAnalysisResponse } from "../schemas/detection.js";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";
import { V2_SCHEMA_VERSION } from "../shared/v2Contracts.js";
import { detectSupportedImage, validateDeclaredImageType } from "./imageUploadValidation.js";
import { loadRegistrationReference } from "./cameraRegistrationReference.js";
import { inferFrame } from "./frameInferenceClient.js";
import { shouldAcceptSample } from "./v2MonitoringLease.js";
import { persistMinuteContributions } from "./phase11MinuteStore.js";
import { publishCameraControl } from "./cameraLiveEvents.js";
import {
  activeRuntimeEpisode,
  activeRuntimeEpisodes,
  cameraRuntimeSnapshot,
  endRuntimeEpisode,
  runtimeEpisode,
  runtimeSession,
  setCameraRuntimeSnapshot,
  setRuntimeEpisode,
  updateCameraRuntimeSnapshot,
} from "./monitoringRuntimeRegistry.js";

export type LiveIssue = { issueType: "floor_litter" | "floor_spill" | "bin_service"; condition: "litter" | "spill" | "full" | "overflow"; confidence: number; entityId: string; geometry: unknown };
export type V2LiveObservation = {
  cameraId?: string;
  episodeId?: string;
  sequence?: number;
  image?: { width: number; height: number };
  sourceTimeSeconds?: number;
  playbackGeneration?: number;
  registrationRevisionId?: string;
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
export function getV2LiveIssueState(siteId: string, cameraId: string, issueType: "floor_litter" | "floor_spill" | "bin_service") {
  const key = `${siteId}:${cameraId}:${issueType}`; const observations = temporal.get(key) ?? [];
  const candidate = evidence.get(key);
  if (candidate && (!observations.some(o => o.sampleId === candidate.observation.sampleId) || Date.now() - candidate.observation.capturedAtMs > 30_000)) evidence.delete(key);
  return { observations: [...observations], candidate: evidence.get(key) ?? null };
}
export function clearV2EvidenceCandidate(siteId: string, cameraId: string, issueType: string) { evidence.delete(`${siteId}:${cameraId}:${issueType}`); }

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function issues(result: PipelineAnalysisResponse): LiveIssue[] {
  const floor = result.floorHazards.map((hazard, index) => ({ issueType: hazard.className, condition: hazard.className === "floor_litter" ? "litter" as const : "spill" as const, confidence: hazard.confidence, entityId: `floor-${index + 1}`, geometry: { bbox: hazard.bbox, polygon: hazard.polygon } }));
  const bins = result.bins.filter((bin) => bin.state === "full" || bin.state === "overflow").map((bin) => ({ issueType: "bin_service" as const, condition: bin.state as "full" | "overflow", confidence: bin.stateConfidence, entityId: bin.binId ?? `bin-${bin.binIndex}`, geometry: { bbox: bin.bbox, binId: bin.binId ?? null } }));
  return [...floor, ...bins];
}

export async function startMonitoringEpisode(input: { siteId: string; cameraId: string; sessionId: string; token: string }) {
  const session = runtimeSession(input.siteId);
  const [camera, site] = await Promise.all([firestore.collection("cameras").doc(input.cameraId).get(), firestore.collection("sites").doc(input.siteId).get()]);
  if (!session || !camera.exists || camera.data()?.siteId !== input.siteId) throw new HttpError(404, "Monitoring Session or Camera not found.");
  if (camera.data()?.status !== "active" || camera.data()?.monitoringEnabled !== true) throw new HttpError(409, "Camera monitoring is not enabled.");
  if (!shouldAcceptSample({ session, sessionId: input.sessionId, tokenHash: hash(input.token), expectedSequence: 0, sequence: 0, nowMs: Date.now() })) throw new HttpError(409, "Monitoring Session is not the active owner.");
  const current = activeRuntimeEpisode(input.cameraId);
  if (current && current.monitoringSessionId === input.sessionId && current.sourceRevisionId === camera.data()?.activeSourceRevisionId && current.registrationRevisionId === camera.data()?.activeRegistrationRevisionId && !current.ended) {
    return { episodeId: current.episodeId, nextSequence: current.sequence + 1, resumed: true, isSimulation: current.isSimulation };
  }
  if (current) await endMonitoringEpisode(input.siteId, input.cameraId, current.episodeId, current.monitoringSessionId, "source_or_owner_changed");
  const episodeRef = firestore.collection("monitoringEpisodes").doc();
  const mapRevisionId = String(site.data()?.activeMapRevisionId ?? "");
  const [placement, registration] = await Promise.all([
    firestore.collection("siteMapRevisions").doc(mapRevisionId).collection("cameraPlacements").doc(input.cameraId).get(),
    firestore.collection("cameraRegistrationRevisions").doc(String(camera.data()?.activeRegistrationRevisionId)).get(),
  ]);
  if (!placement.exists || placement.data()?.siteId !== input.siteId) throw new HttpError(409, "Camera Placement is missing from the Active Map Revision.");
  if (!registration.exists || registration.data()?.siteId !== input.siteId || registration.data()?.cameraId !== input.cameraId) throw new HttpError(409, "Active Camera Registration is missing.");
  if (site.data()?.status !== "active") throw new HttpError(409, "Site is inactive.");
  const reference = await loadRegistrationReference(registration.data()!);
  const zoneId = String(placement.data()?.zoneId ?? "");
  const zoneName = String(placement.data()?.zoneNameSnapshot ?? zoneId);
  const episode = {
    episodeId: episodeRef.id, siteId: input.siteId, cameraId: input.cameraId, cameraName: String(camera.data()?.name ?? input.cameraId),
    cameraRevision: Number(camera.data()?.revision ?? 0), monitoringSessionId: input.sessionId,
    sourceRevisionId: String(camera.data()?.activeSourceRevisionId), registrationRevisionId: String(camera.data()?.activeRegistrationRevisionId),
    mapRevisionId, zoneId, zoneName, timeZone: String(site.data()?.timeZone ?? "Asia/Kuala_Lumpur"),
    isSimulation: Boolean(camera.data()?.isSimulation), registration: registration.data()!, reference,
    sequence: 0, lastActivityAtMs: Date.now(), ended: false,
  };
  resetV2LiveMemory(input.cameraId, true);
  const batch = firestore.batch();
  batch.create(episodeRef, { schemaVersion: V2_SCHEMA_VERSION, episodeId: episodeRef.id, siteId: input.siteId, cameraId: input.cameraId, monitoringSessionId: input.sessionId, sourceRevisionId: episode.sourceRevisionId, registrationRevisionId: episode.registrationRevisionId, mapRevisionId, zoneId, zoneNameSnapshot: zoneName, timeZoneSnapshot: episode.timeZone, isSimulation: episode.isSimulation, startedAt: FieldValue.serverTimestamp(), endedAt: null, endReason: null, lastSequence: 0 });
  batch.set(firestore.collection("cameraRuntimeStates").doc(input.cameraId), { schemaVersion: 2, siteId: input.siteId, cameraId: input.cameraId, connectionStatus: "offline", monitoringSessionId: input.sessionId, monitoringEpisodeId: episodeRef.id, lastFrameCapturedAt: null, lastSampleAcceptedAt: null, sourceErrorCode: null, sourceErrorMessage: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
  setRuntimeEpisode(episode);
  setCameraRuntimeSnapshot({
    siteId: input.siteId, cameraId: input.cameraId, connectionStatus: "offline", cleanlinessState: cameraRuntimeSnapshot(input.cameraId)?.cleanlinessState ?? "unknown",
    monitoringSessionId: input.sessionId, monitoringEpisodeId: episode.episodeId, lastFrameCapturedAtMs: null,
    lastSampleAcceptedAtMs: null, lastInferenceSucceededAtMs: null, lastPeopleCount: null,
    lastIssueSummary: { litter: 0, spill: 0, full: 0, overflow: 0 }, sourceErrorCode: null, sourceErrorMessage: null, updatedAtMs: Date.now(),
  });
  return { episodeId: episode.episodeId, nextSequence: 1, resumed: false, isSimulation: episode.isSimulation };
}

export async function endMonitoringEpisode(siteId: string, cameraId: string, episodeId: string, sessionId: string, reason: string) {
  const episode = runtimeEpisode(episodeId);
  if (!episode || episode.siteId !== siteId || episode.cameraId !== cameraId || episode.monitoringSessionId !== sessionId) throw new HttpError(404, "Monitoring Episode not found.");
  endRuntimeEpisode(episodeId);
  updateCameraRuntimeSnapshot(siteId, cameraId, { connectionStatus: "offline", sourceErrorCode: reason, sourceErrorMessage: null, monitoringSessionId: null, monitoringEpisodeId: null });
  const batch = firestore.batch();
  batch.set(firestore.collection("monitoringEpisodes").doc(episodeId), { endedAt: FieldValue.serverTimestamp(), endReason: reason, lastSequence: episode.sequence }, { merge: true });
  batch.set(firestore.collection("cameraRuntimeStates").doc(cameraId), { connectionStatus: "offline", sourceErrorCode: reason, sourceErrorMessage: null, monitoringSessionId: null, monitoringEpisodeId: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
  publishCameraControl(siteId, cameraId, { configurationChanged: false });
}

let sweeping = false;
export async function sweepMonitoringRuntime() {
  if (sweeping) return; sweeping = true;
  try {
    for (const episode of activeRuntimeEpisodes()) {
      const session = runtimeSession(episode.siteId);
      if (!session || session.sessionId !== episode.monitoringSessionId || session.status !== "active" || session.leaseExpiresAtMs <= Date.now() || Date.now() - episode.lastActivityAtMs > 75000) await endMonitoringEpisode(episode.siteId, episode.cameraId, episode.episodeId, episode.monitoringSessionId, "session_lost");
    }
  } finally { sweeping = false; }
}

export async function processLiveSample(input: { siteId: string; cameraId: string; sessionId: string; episodeId: string; token: string; sequence: number; capturedAt: Date; frame: Express.Multer.File; sourceTimeSeconds?: number; playbackGeneration?: number }) {
  if (+input.capturedAt < Date.now() - 120000 || +input.capturedAt > Date.now() + 10000) throw new HttpError(400, "Live sample is outside the two-minute lateness window.");
  const detected = detectSupportedImage(input.frame.buffer); validateDeclaredImageType(input.frame.mimetype, detected.mimeType);
  const session = runtimeSession(input.siteId);
  const episode = runtimeEpisode(input.episodeId);
  if (!session || !episode || episode.ended || episode.siteId !== input.siteId || episode.cameraId !== input.cameraId || episode.monitoringSessionId !== input.sessionId) throw new HttpError(409, "Monitoring Episode is not active.");
  const expected = episode.sequence + 1;
  if (!shouldAcceptSample({ session, sessionId: input.sessionId, tokenHash: hash(input.token), expectedSequence: expected, sequence: input.sequence, nowMs: Date.now() })) throw new HttpError(409, "Live sample sequence or Monitoring Session is invalid.");
  episode.sequence = input.sequence;
  episode.lastActivityAtMs = Date.now();
  const minuteStart = `${input.capturedAt.toISOString().slice(0, 16)}:00.000Z`; const minuteKey = `${input.siteId}:${minuteStart}:${input.episodeId}:${input.cameraId}`;
  const accumulator = minute.get(minuteKey) ?? { contributionId: randomUUID(), pending: 0, siteId: input.siteId, minuteStart, timeZone: episode.timeZone, mapRevisionId: episode.mapRevisionId, cameraId: input.cameraId, zoneId: episode.zoneId, zoneName: episode.zoneName, sampleAttemptCount: 0, successfulSampleCount: 0, failedSampleCount: 0, peopleSum: 0, peopleMax: 0, litter: 0, spill: 0, full: 0, overflow: 0, simulation: 0, latencySum:0, latencyCount:0 }; accumulator.pending += 1; accumulator.sampleAttemptCount += 1; minute.set(minuteKey, accumulator);
  try {
    const result = await serializeInference(input.cameraId, () => inference({ contents: input.frame.buffer, fileName: input.frame.originalname || `sample-${input.sequence}.${detected.extension}`, mimeType: detected.mimeType, floorConfidence: 0.25, binLocalizerConfidence: 0.8, focusRegion: episode.registration.walkableFloorPolygon ?? [], registration: { ...episode.registration, status: "ready", alignmentStatus: "valid" }, reference: episode.reference as any, binReviewEnabled: true }));
    const latestSession = runtimeSession(input.siteId); const latestEpisode = runtimeEpisode(input.episodeId);
    if (!latestSession || latestSession.sessionId !== input.sessionId || latestSession.status !== "active" || latestSession.leaseExpiresAtMs <= Date.now() || latestEpisode !== episode || episode.ended) throw new HttpError(409, "Camera or Monitoring Session changed during inference.");
    const observation: V2LiveObservation = {
      cameraId: input.cameraId, episodeId: input.episodeId, sequence: input.sequence, image: result.image, sourceTimeSeconds: input.sourceTimeSeconds, playbackGeneration: input.playbackGeneration ?? 0, registrationRevisionId: episode.registrationRevisionId,
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
      isSimulation: episode.isSimulation,
    };
    for (const issueType of ["floor_litter", "floor_spill", "bin_service"] as const) { const key = `${input.siteId}:${input.cameraId}:${issueType}`; const values = temporal.get(key) ?? []; values.push(observation); temporal.set(key, values.slice(-5)); const matching = observation.issues.filter((issue) => issue.issueType === issueType); const best = matching.sort((a, b) => b.confidence - a.confidence)[0]; if (best) { const current = getV2LiveIssueState(input.siteId, input.cameraId, issueType).candidate; if (!current || best.confidence >= current.confidence) evidence.set(key, { confidence: best.confidence, frame: Buffer.from(input.frame.buffer), mimeType: detected.mimeType, observation }); } }
    accumulator.successfulSampleCount += 1; accumulator.latencySum+=result.processingTimeMs; accumulator.latencyCount++; accumulator.peopleSum += result.peopleCount; accumulator.peopleMax = Math.max(accumulator.peopleMax, result.peopleCount); accumulator.litter += observation.issues.filter((issue) => issue.condition === "litter" && issue.confidence >= 0.5).length; accumulator.spill += observation.issues.filter((issue) => issue.condition === "spill" && issue.confidence >= 0.5).length; accumulator.full += observation.issues.filter((issue) => issue.condition === "full" && issue.confidence >= 0.5).length; accumulator.overflow += observation.issues.filter((issue) => issue.condition === "overflow" && issue.confidence >= 0.5).length; accumulator.simulation += observation.isSimulation ? 1 : 0;
    const previousRuntime = cameraRuntimeSnapshot(input.cameraId);
    const summary = { litter: observation.issues.filter(issue => issue.condition === "litter").length, spill: observation.issues.filter(issue => issue.condition === "spill").length, full: observation.issues.filter(issue => issue.condition === "full").length, overflow: observation.issues.filter(issue => issue.condition === "overflow").length };
    updateCameraRuntimeSnapshot(input.siteId, input.cameraId, { connectionStatus: "online", monitoringSessionId: input.sessionId, monitoringEpisodeId: input.episodeId, lastFrameCapturedAtMs: input.capturedAt.getTime(), lastSampleAcceptedAtMs: Date.now(), lastInferenceSucceededAtMs: Date.now(), lastPeopleCount: result.peopleCount, lastIssueSummary: summary, sourceErrorCode: null, sourceErrorMessage: null });
    if (previousRuntime?.connectionStatus !== "online" || previousRuntime.monitoringEpisodeId !== input.episodeId) {
      await firestore.collection("cameraRuntimeStates").doc(input.cameraId).set({ connectionStatus: "online", monitoringSessionId: input.sessionId, monitoringEpisodeId: input.episodeId, lastFrameCapturedAt: Timestamp.fromDate(input.capturedAt), lastSampleAcceptedAt: FieldValue.serverTimestamp(), lastInferenceSucceededAt: FieldValue.serverTimestamp(), lastPeopleCount: result.peopleCount, lastIssueSummary: summary, sourceErrorCode: null, sourceErrorMessage: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      publishCameraControl(input.siteId, input.cameraId, { configurationChanged: false });
    }
    return { accepted: true, sequence: input.sequence, observation: { ...observation, issues: observation.issues, image: result.image, processingTimeMs: result.processingTimeMs } };
  } catch (error) {
    accumulator.failedSampleCount += 1;
    const previousRuntime = cameraRuntimeSnapshot(input.cameraId);
    updateCameraRuntimeSnapshot(input.siteId, input.cameraId, { lastFrameCapturedAtMs: input.capturedAt.getTime(), lastSampleAcceptedAtMs: Date.now(), sourceErrorCode: "inference_failed", sourceErrorMessage: "The sampled frame could not be analyzed." });
    if (previousRuntime?.sourceErrorCode !== "inference_failed") {
      await firestore.collection("cameraRuntimeStates").doc(input.cameraId).set({ lastFrameCapturedAt: Timestamp.fromDate(input.capturedAt), lastSampleAcceptedAt: FieldValue.serverTimestamp(), sourceErrorCode: "inference_failed", sourceErrorMessage: "The sampled frame could not be analyzed.", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      publishCameraControl(input.siteId, input.cameraId, { configurationChanged: false });
    }
    throw error;
  } finally {
    accumulator.pending -= 1;
  }
}

export async function markOfflineCameras(siteId: string, now = new Date(), timeoutSeconds = 10) {
  let changed = 0;
  for (const episode of activeRuntimeEpisodes().filter((item) => item.siteId === siteId)) {
    const runtime = cameraRuntimeSnapshot(episode.cameraId);
    const lastAcceptedAt = runtime?.lastSampleAcceptedAtMs ?? episode.lastActivityAtMs;
    // An executing or fairly queued slow inference is not a disconnected source.
    if (now.getTime() - Math.max(lastAcceptedAt, episode.lastActivityAtMs) < timeoutSeconds * 1000) continue;
    await endMonitoringEpisode(siteId, episode.cameraId, episode.episodeId, episode.monitoringSessionId, "session_lost");
    changed += 1;
  }
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
