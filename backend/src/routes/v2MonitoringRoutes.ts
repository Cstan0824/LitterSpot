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
import { endMonitoringEpisode } from "../services/v2LiveMonitoringService.js";
import { cameraSampleQueue } from "../services/cameraSampleQueue.js";
import { publishCameraFrame, publishCameraWorkflow } from "../services/cameraLiveEvents.js";
import { activeRuntimeEpisodes, deleteRuntimeSession, runtimeSession, setRuntimeSession } from "../services/monitoringRuntimeRegistry.js";

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
  let next;
  try { next = claimMonitoringSession(runtimeSession(siteId), { sessionId, ownerUid: req.authUser.uid, tokenHash: hash(rawToken), nowMs: now, leaseSeconds: 30 }); }
  catch { throw new HttpError(409, "Another browser owns the active Monitoring Session."); }
  setRuntimeSession({ ...next, siteId, lastHeartbeatAtMs: now });
  try {
    await reference.set({ schemaVersion: 2, siteId, sessionId: next.sessionId, ownerUid: next.ownerUid, leaseTokenHash: next.tokenHash, claimedAt: FieldValue.serverTimestamp(), heartbeatAt: FieldValue.serverTimestamp(), leaseExpiresAt: new Date(next.leaseExpiresAtMs), status: next.status, revision: next.revision });
  } catch (error) {
    deleteRuntimeSession(siteId, sessionId);
    throw error;
  }
  return res.status(201).json({ sessionId, leaseToken: rawToken, leaseSeconds: 30 });
});

v2MonitoringRoutes.post("/sessions/:sessionId/heartbeat", async (req, res) => {
  const siteId = String(req.supervisor.siteId ?? req.body.siteId ?? "");
  const token = String(req.header("x-monitoring-token") ?? req.body.leaseToken ?? "");
  const current = runtimeSession(siteId);
  if (!current || current.ownerUid !== req.authUser.uid) throw new HttpError(409, "Monitoring Session is not the active owner.");
  let next;
  try { next = heartbeatMonitoringSession(current, { sessionId: req.params.sessionId, tokenHash: hash(token), nowMs: Date.now(), leaseSeconds: 30 }); }
  catch { throw new HttpError(409, "Monitoring Session is not the active owner."); }
  setRuntimeSession({ ...current, ...next, lastHeartbeatAtMs: Date.now() });
  return res.json({ ok: true });
});

v2MonitoringRoutes.post("/sessions/:sessionId/release", async (req, res) => {
  const siteId = String(req.supervisor.siteId ?? req.body.siteId ?? "");
  const token = String(req.header("x-monitoring-token") ?? req.body.leaseToken ?? "");
  const current = runtimeSession(siteId);
  if (!current || current.sessionId !== req.params.sessionId || current.tokenHash !== hash(token) || current.ownerUid !== req.authUser.uid) throw new HttpError(409, "Monitoring Session is not the active owner.");
  deleteRuntimeSession(siteId, req.params.sessionId);
  for (const episode of activeRuntimeEpisodes().filter((item) => item.siteId === siteId && item.monitoringSessionId === req.params.sessionId)) await endMonitoringEpisode(siteId, episode.cameraId, episode.episodeId, req.params.sessionId, "session_lost");
  await firestore.collection("monitoringSessions").doc(siteId).set({ status: "released", leaseExpiresAt: new Date(), updatedAt: FieldValue.serverTimestamp(), revision: FieldValue.increment(1) }, { merge: true });
  return res.json({ ok: true });
});

v2MonitoringRoutes.post("/sessions/:sessionId/cameras/:cameraId/start", async (req, res) => {
  const token = String(req.header("x-monitoring-token") ?? req.body.leaseToken ?? "");
  return res.status(201).json(await startMonitoringEpisode({ siteId: String(req.supervisor.siteId), cameraId: String(req.params.cameraId), sessionId: String(req.params.sessionId), token }));
});

v2MonitoringRoutes.post("/sessions/:sessionId/cameras/:cameraId/samples", frameUpload.single("frame"), async (req, res) => {
  if (!req.file) throw new HttpError(400, "A JPEG, PNG, or WebP frame is required.");
  const input = z.object({ episodeId: z.string().min(1), sequence: z.coerce.number().int().positive(), capturedAt: z.string().datetime({ offset: true }), sourceTimeSeconds: z.coerce.number().nonnegative().optional(), playbackGeneration: z.coerce.number().int().nonnegative().optional() }).parse(req.body);
  const owner = runtimeSession(String(req.supervisor.siteId));
  if (!owner || owner.ownerUid !== req.authUser.uid || owner.sessionId !== req.params.sessionId || owner.tokenHash !== hash(String(req.header("x-monitoring-token") ?? "")) || owner.status !== "active" || owner.leaseExpiresAtMs <= Date.now()) throw new HttpError(409, "Monitoring Session is not the active owner.");
  const response = await cameraSampleQueue.submit(`${req.supervisor.siteId}:${req.params.cameraId}`, async () => {
  const result = await processLiveSample({ ...input, siteId: String(req.supervisor.siteId), cameraId: String(req.params.cameraId), sessionId: String(req.params.sessionId), token: String(req.header("x-monitoring-token") ?? ""), capturedAt: new Date(input.capturedAt), frame: req.file! });
  const alertEvaluation = await evaluateV2AlertsForCamera(String(req.supervisor.siteId), String(req.params.cameraId), input.episodeId);
  const verificationsApplied = await recordV2CameraVerificationObservation(String(req.supervisor.siteId), String(req.params.cameraId), result.observation);
  if (alertEvaluation.length > 0 || verificationsApplied > 0) publishCameraWorkflow(String(req.supervisor.siteId), String(req.params.cameraId));
  publishCameraFrame(String(req.supervisor.siteId), String(req.params.cameraId), result.observation, req.file!.buffer, req.file!.mimetype);
  return { ...result, nextSequence: input.sequence + 1, alertEvaluation, verificationsApplied, queue: { pending: cameraSampleQueue.pending, skipped: cameraSampleQueue.skipped } };
  });
  return res.json(response);
});

v2MonitoringRoutes.post("/sessions/:sessionId/cameras/:cameraId/stop", async (req, res) => {
  const input = z.object({ episodeId: z.string().min(1), reason: z.enum(["disabled", "source_failure", "reconfigured", "session_lost"]).default("source_failure") }).parse(req.body);
  const session = runtimeSession(String(req.supervisor.siteId));
  if (!session || session.sessionId !== req.params.sessionId || session.ownerUid !== req.authUser.uid || session.tokenHash !== hash(String(req.header("x-monitoring-token") ?? ""))) throw new HttpError(409, "Monitoring Session is not the active owner.");
  await endMonitoringEpisode(String(req.supervisor.siteId), req.params.cameraId, input.episodeId, req.params.sessionId, input.reason);
  res.json({ ok: true });
});

v2MonitoringRoutes.post("/offline-sweep", async (req, res) => {
  const input = z.object({ timeoutSeconds: z.number().int().min(5).max(300).default(10) }).parse(req.body ?? {});
  return res.json({ camerasMarkedOffline: await markOfflineCameras(String(req.supervisor.siteId), new Date(), input.timeoutSeconds) });
});
v2MonitoringRoutes.post("/minute-flush", async (req, res) => res.json({ bucketsFlushed: await flushV2MinuteBuckets(String(req.supervisor.siteId), new Date()) }));
