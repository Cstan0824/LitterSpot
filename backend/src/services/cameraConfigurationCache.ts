import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { cameraRuntimeSnapshot } from "./monitoringRuntimeRegistry.js";

type CameraConfiguration = {
  id: string;
  camera: FirebaseFirestore.DocumentData;
  placement: FirebaseFirestore.DocumentData | null;
  source: FirebaseFirestore.DocumentData | null;
  registration: FirebaseFirestore.DocumentData | null;
  durableRuntime: FirebaseFirestore.DocumentData | null;
};

type SiteCameraConfiguration = {
  siteId: string;
  enabledLaptopCameraId: string | null;
  activeMapRevisionId: string;
  cameras: CameraConfiguration[];
};

const configurations = new Map<string, Promise<SiteCameraConfiguration>>();

function runtime(cameraId: string, durable: FirebaseFirestore.DocumentData | null) {
  const live = cameraRuntimeSnapshot(cameraId);
  if (!live) return durable?.connectionStatus === "online" ? { ...durable, connectionStatus: "offline" } : durable;
  const timestamp = (value: number | null) => value === null ? null : Timestamp.fromMillis(value);
  return {
    ...durable,
    siteId: live.siteId,
    cameraId: live.cameraId,
    connectionStatus: live.connectionStatus,
    cleanlinessState: live.cleanlinessState ?? durable?.cleanlinessState ?? "unknown",
    monitoringSessionId: live.monitoringSessionId,
    monitoringEpisodeId: live.monitoringEpisodeId,
    lastFrameCapturedAt: timestamp(live.lastFrameCapturedAtMs),
    lastSampleAcceptedAt: timestamp(live.lastSampleAcceptedAtMs),
    lastInferenceSucceededAt: timestamp(live.lastInferenceSucceededAtMs),
    lastPeopleCount: live.lastPeopleCount,
    lastIssueSummary: live.lastIssueSummary,
    sourceErrorCode: live.sourceErrorCode,
    sourceErrorMessage: live.sourceErrorMessage,
    updatedAt: Timestamp.fromMillis(live.updatedAtMs),
  };
}

async function load(siteId: string): Promise<SiteCameraConfiguration> {
  const [site, cameras] = await Promise.all([
    firestore.collection("sites").doc(siteId).get(),
    firestore.collection("cameras").where("siteId", "==", siteId).limit(100).get(),
  ]);
  const activeMapRevisionId = String(site.data()?.activeMapRevisionId ?? "");
  const records = await Promise.all(cameras.docs.filter((document) => document.data().schemaVersion === 2).map(async (document) => {
    const data = document.data();
    const [placement, source, registration, durableRuntime] = await Promise.all([
      firestore.collection("siteMapRevisions").doc(activeMapRevisionId).collection("cameraPlacements").doc(document.id).get(),
      firestore.collection("cameraSourceRevisions").doc(String(data.activeSourceRevisionId)).get(),
      firestore.collection("cameraRegistrationRevisions").doc(String(data.activeRegistrationRevisionId)).get(),
      firestore.collection("cameraRuntimeStates").doc(document.id).get(),
    ]);
    return {
      id: document.id,
      camera: data,
      placement: placement.exists ? placement.data()! : null,
      source: source.exists ? source.data()! : null,
      registration: registration.exists ? registration.data()! : null,
      durableRuntime: durableRuntime.exists ? durableRuntime.data()! : null,
    };
  }));
  return { siteId, enabledLaptopCameraId: site.data()?.enabledLaptopCameraId ?? null, activeMapRevisionId, cameras: records };
}

async function configuration(siteId: string) {
  let value = configurations.get(siteId);
  if (!value) {
    value = load(siteId).catch((error) => { configurations.delete(siteId); throw error; });
    configurations.set(siteId, value);
  }
  return value;
}

export function invalidateSiteCameraConfiguration(siteId: string) {
  configurations.delete(siteId);
}

export async function getLiveCameraConfiguration(siteId: string) {
  const value = await configuration(siteId);
  return {
    siteId,
    enabledLaptopCameraId: value.enabledLaptopCameraId,
    cameras: value.cameras.map(({ id, camera, source, registration, durableRuntime }) => {
      const playback = camera.demoPlayback?.sourceRevisionId === camera.activeSourceRevisionId ? camera.demoPlayback : null;
      const mediaId = playback?.mediaId ?? source?.sourceMediaId;
      return {
        id, name: camera.name, status: camera.status, monitoringEnabled: Boolean(camera.monitoringEnabled), sourceType: camera.sourceType,
        revision: camera.revision, isSimulation: camera.isSimulation, activeSourceRevisionId: camera.activeSourceRevisionId,
        activeRegistrationRevisionId: camera.activeRegistrationRevisionId, playbackGeneration: playback?.generation ?? 0,
        source: { contentUrl: mediaId ? `/api/media/${mediaId}/content` : null, sampleIntervalSeconds: source?.sampleIntervalSeconds ?? 1 },
        registration, runtime: runtime(id, durableRuntime),
      };
    }),
  };
}

export async function getCameraListConfiguration(siteId: string) {
  const value = await configuration(siteId);
  return {
    activeMapRevisionId: value.activeMapRevisionId,
    cameras: value.cameras.map(({ id, camera, placement, source, registration, durableRuntime }) => ({
      id, ...camera, placement, runtime: runtime(id, durableRuntime),
      source: source ? { ...source, contentUrl: source.sourceMediaId ? `/api/media/${source.sourceMediaId}/content` : null } : null,
      registration,
    })),
  };
}
