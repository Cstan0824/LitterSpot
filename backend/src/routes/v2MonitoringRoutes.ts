import { createHash, randomUUID } from "node:crypto";
import { Router } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { env } from "../config/env.js";
import { HttpError } from "../shared/httpError.js";
import { claimMonitoringSession, heartbeatMonitoringSession } from "../services/v2MonitoringLease.js";
import multer from "multer";
import { z } from "zod";
import { flushV2MinuteBuckets, markOfflineCameras, processLiveSample, startMonitoringEpisode } from "../services/v2LiveMonitoringService.js";
import { evaluateV2AlertsForCamera } from "../services/v2AlertService.js";
import { recordV2CameraVerificationObservation } from "../services/v2WorkOrderService.js";

export const v2MonitoringRoutes = Router();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const frameUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

v2MonitoringRoutes.post("/sessions/claim", async (req, res) => {
  const siteId = String(req.supervisor.siteId ?? req.body.siteId ?? "");
  if (!siteId) throw new HttpError(400, "A Site is required.");
  const reference = firestore.collection("monitoringSessions").doc(siteId);
  const sessionId = randomUUID();
  const rawToken = randomUUID();
  const now = Date.now();
  await firestore.runTransaction(async (transaction) => {
    const current = await transaction.get(reference);
    const data = current.data();
    const lease = data && typeof data.sessionId === "string" ? { sessionId: String(data.sessionId), ownerUid: String(data.ownerUid), tokenHash: String(data.leaseTokenHash), leaseExpiresAtMs: Number(data.leaseExpiresAt?.toMillis?.() ?? 0), status: data.status as "active" | "released", revision: Number(data.revision ?? 0) } : null;
    let next;
    try { next = claimMonitoringSession(lease, { sessionId, ownerUid: req.authUser.uid, tokenHash: hash(rawToken), nowMs: now, leaseSeconds: 30 }); }
    catch { throw new HttpError(409, "Another browser owns the active Monitoring Session."); }
    transaction.set(reference, { schemaVersion: 2, siteId, sessionId: next.sessionId, ownerUid: next.ownerUid, leaseTokenHash: next.tokenHash, claimedAt: FieldValue.serverTimestamp(), heartbeatAt: FieldValue.serverTimestamp(), leaseExpiresAt: new Date(next.leaseExpiresAtMs), status: next.status, revision: next.revision });
  });
  return res.status(201).json({ sessionId, leaseToken: rawToken, leaseSeconds: 30 });
});

v2MonitoringRoutes.post("/sessions/:sessionId/heartbeat", async (req, res) => {
  const siteId = String(req.supervisor.siteId ?? req.body.siteId ?? "");
  const token = String(req.header("x-monitoring-token") ?? req.body.leaseToken ?? "");
  const reference = firestore.collection("monitoringSessions").doc(siteId);
  await firestore.runTransaction(async (transaction) => {
    const current = await transaction.get(reference);
    const data = current.data();
    if (!data) throw new HttpError(404, "Monitoring Session not found.");
    const next = heartbeatMonitoringSession({ sessionId: String(data.sessionId), ownerUid: String(data.ownerUid), tokenHash: String(data.leaseTokenHash), leaseExpiresAtMs: Number(data.leaseExpiresAt?.toMillis?.() ?? 0), status: data.status, revision: Number(data.revision ?? 0) }, { sessionId: req.params.sessionId, tokenHash: hash(token), nowMs: Date.now(), leaseSeconds: 30 });
    transaction.update(reference, { heartbeatAt: FieldValue.serverTimestamp(), leaseExpiresAt: new Date(next.leaseExpiresAtMs), revision: next.revision });
  });
  return res.json({ ok: true });
});

v2MonitoringRoutes.post("/sessions/:sessionId/release", async (req, res) => {
  const siteId = String(req.supervisor.siteId ?? req.body.siteId ?? "");
  const token = String(req.header("x-monitoring-token") ?? req.body.leaseToken ?? "");
  const reference = firestore.collection("monitoringSessions").doc(siteId);
  await firestore.runTransaction(async (transaction) => { const current = await transaction.get(reference); if (!current.exists || current.data()?.sessionId !== req.params.sessionId || current.data()?.leaseTokenHash !== hash(token) || current.data()?.ownerUid !== req.authUser.uid) throw new HttpError(409, "Monitoring Session is not the active owner."); transaction.update(reference, { status: "released", leaseExpiresAt: new Date(), updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) }); });
  const episodes = await firestore.collection("monitoringEpisodes").where("siteId", "==", siteId).where("monitoringSessionId", "==", req.params.sessionId).get();
  for (const episode of episodes.docs) if (!episode.data().endedAt) { await episode.ref.update({ endedAt: FieldValue.serverTimestamp(), endReason: "session_lost" }); await firestore.collection("cameraRuntimeStates").doc(String(episode.data().cameraId)).set({ connectionStatus: "offline", sourceErrorCode: "session_released", sourceErrorMessage: "Monitoring Session was released.", updatedAt: FieldValue.serverTimestamp() }, { merge: true }); }
  return res.json({ ok: true });
});

v2MonitoringRoutes.post("/sessions/:sessionId/cameras/:cameraId/start", async (req, res) => {
  const token = String(req.header("x-monitoring-token") ?? req.body.leaseToken ?? "");
  return res.status(201).json(await startMonitoringEpisode({ siteId: String(req.supervisor.siteId), cameraId: String(req.params.cameraId), sessionId: String(req.params.sessionId), token }));
});

v2MonitoringRoutes.post("/sessions/:sessionId/cameras/:cameraId/samples", frameUpload.single("frame"), async (req, res) => {
  if (!req.file) throw new HttpError(400, "A JPEG, PNG, or WebP frame is required.");
  const input = z.object({ episodeId: z.string().min(1), sequence: z.coerce.number().int().positive(), capturedAt: z.string().datetime({ offset: true }) }).parse(req.body);
  const result = await processLiveSample({ siteId: String(req.supervisor.siteId), cameraId: String(req.params.cameraId), sessionId: String(req.params.sessionId), episodeId: input.episodeId, token: String(req.header("x-monitoring-token") ?? ""), sequence: input.sequence, capturedAt: new Date(input.capturedAt), frame: req.file });
  const alertEvaluation = await evaluateV2AlertsForCamera(String(req.supervisor.siteId), String(req.params.cameraId), input.episodeId);
  const verificationsApplied = await recordV2CameraVerificationObservation(String(req.supervisor.siteId), String(req.params.cameraId), result.observation);
  return res.json({ ...result, alertEvaluation, verificationsApplied });
});

v2MonitoringRoutes.post("/offline-sweep", async (req, res) => {
  const input = z.object({ timeoutSeconds: z.number().int().min(5).max(300).default(10) }).parse(req.body ?? {});
  return res.json({ camerasMarkedOffline: await markOfflineCameras(String(req.supervisor.siteId), new Date(), input.timeoutSeconds) });
});
v2MonitoringRoutes.post("/minute-flush", async (req, res) => res.json({ bucketsFlushed: await flushV2MinuteBuckets(String(req.supervisor.siteId), new Date()) }));
