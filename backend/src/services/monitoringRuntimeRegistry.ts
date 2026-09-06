import type { DocumentData } from "firebase-admin/firestore";
import type { MonitoringLease } from "./v2MonitoringLease.js";

export type MonitoringRuntimeSession = MonitoringLease & {
  siteId: string;
  ownerUid: string;
  lastHeartbeatAtMs: number;
};

export type MonitoringEpisodeRuntime = {
  episodeId: string;
  siteId: string;
  cameraId: string;
  cameraName: string;
  cameraRevision: number;
  monitoringSessionId: string;
  sourceRevisionId: string;
  registrationRevisionId: string;
  mapRevisionId: string;
  zoneId: string;
  zoneName: string;
  timeZone: string;
  isSimulation: boolean;
  registration: DocumentData;
  reference: unknown;
  sequence: number;
  lastActivityAtMs: number;
  ended: boolean;
};

export type CameraRuntimeSnapshot = {
  siteId: string;
  cameraId: string;
  connectionStatus: "offline" | "online";
  cleanlinessState?: string;
  monitoringSessionId: string | null;
  monitoringEpisodeId: string | null;
  lastFrameCapturedAtMs: number | null;
  lastSampleAcceptedAtMs: number | null;
  lastInferenceSucceededAtMs: number | null;
  lastPeopleCount: number | null;
  lastIssueSummary: { litter: number; spill: number; full: number; overflow: number };
  sourceErrorCode: string | null;
  sourceErrorMessage: string | null;
  updatedAtMs: number;
};

const sessions = new Map<string, MonitoringRuntimeSession>();
const episodes = new Map<string, MonitoringEpisodeRuntime>();
const activeEpisodeByCamera = new Map<string, string>();
const cameraRuntime = new Map<string, CameraRuntimeSnapshot>();

export function runtimeSession(siteId: string) {
  return sessions.get(siteId) ?? null;
}

export function setRuntimeSession(session: MonitoringRuntimeSession) {
  sessions.set(session.siteId, session);
  return session;
}

export function deleteRuntimeSession(siteId: string, sessionId: string) {
  const current = sessions.get(siteId);
  if (!current || current.sessionId !== sessionId) return false;
  sessions.delete(siteId);
  return true;
}

export function expireRuntimeSessionForTests(siteId: string) {
  const current = sessions.get(siteId);
  if (current) current.leaseExpiresAtMs = 0;
}

export function runtimeEpisode(episodeId: string) {
  return episodes.get(episodeId) ?? null;
}

export function activeRuntimeEpisode(cameraId: string) {
  const episodeId = activeEpisodeByCamera.get(cameraId);
  return episodeId ? episodes.get(episodeId) ?? null : null;
}

export function setRuntimeEpisode(episode: MonitoringEpisodeRuntime) {
  episodes.set(episode.episodeId, episode);
  activeEpisodeByCamera.set(episode.cameraId, episode.episodeId);
  return episode;
}

export function endRuntimeEpisode(episodeId: string) {
  const episode = episodes.get(episodeId);
  if (!episode) return null;
  episode.ended = true;
  if (activeEpisodeByCamera.get(episode.cameraId) === episodeId) activeEpisodeByCamera.delete(episode.cameraId);
  return episode;
}

export function activeRuntimeEpisodes() {
  return [...episodes.values()].filter((episode) => !episode.ended);
}

export function cameraRuntimeSnapshot(cameraId: string) {
  const value = cameraRuntime.get(cameraId);
  return value ? { ...value, lastIssueSummary: { ...value.lastIssueSummary } } : null;
}

export function setCameraRuntimeSnapshot(value: CameraRuntimeSnapshot) {
  cameraRuntime.set(value.cameraId, value);
  return value;
}

export function updateCameraRuntimeSnapshot(siteId: string, cameraId: string, values: Partial<CameraRuntimeSnapshot>) {
  const current = cameraRuntime.get(cameraId) ?? {
    siteId, cameraId, connectionStatus: "offline" as const, monitoringSessionId: null, monitoringEpisodeId: null,
    lastFrameCapturedAtMs: null, lastSampleAcceptedAtMs: null, lastInferenceSucceededAtMs: null, lastPeopleCount: null,
    lastIssueSummary: { litter: 0, spill: 0, full: 0, overflow: 0 }, sourceErrorCode: null, sourceErrorMessage: null,
    updatedAtMs: Date.now(),
  };
  const next = { ...current, ...values, updatedAtMs: values.updatedAtMs ?? Date.now() };
  cameraRuntime.set(cameraId, next);
  return next;
}

export function resetMonitoringRuntime(cameraId?: string) {
  if (!cameraId) {
    sessions.clear(); episodes.clear(); activeEpisodeByCamera.clear(); cameraRuntime.clear();
    return;
  }
  const activeId = activeEpisodeByCamera.get(cameraId);
  if (activeId) episodes.delete(activeId);
  for (const [id, episode] of episodes) if (episode.cameraId === cameraId) episodes.delete(id);
  activeEpisodeByCamera.delete(cameraId);
  cameraRuntime.delete(cameraId);
}
