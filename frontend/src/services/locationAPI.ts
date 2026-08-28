import { apiFetch, readApiError } from "./apiClient";

export type RecordStatus = "active" | "inactive";

export type Site = {
  id: string;
  name: string;
  description: string | null;
  timezone: string;
  status: RecordStatus;
  createdAt: string | null;
  updatedAt: string | null;
};

export type Zone = {
  id: string;
  siteId: string;
  siteName: string;
  name: string;
  code: string | null;
  description: string | null;
  status: RecordStatus;
  createdAt: string | null;
  updatedAt: string | null;
};

export type CameraRecord = {
  id: string;
  siteId: string;
  siteName: string;
  zoneId: string;
  zoneName: string;
  code: string;
  name: string;
  sourceMode: "upload" | "stream";
  status: RecordStatus;
  availability: "unknown" | "available" | "unavailable";
  registrationStatus: "unregistered" | "ready" | "stale" | "invalid";
  registrationRevision: number;
  registrationUpdatedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type RegistrationPoint = { x: number; y: number };
export type RegistrationPolygon = RegistrationPoint[];
export type CameraRegistrationBin = {
  binId: string;
  displayName: string;
  binType: "open_top" | "lidded" | "unknown";
  binPolygon: RegistrationPolygon;
};
export type CameraRegistrationDraft = {
  schemaVersion: 2;
  referenceMediaId: string;
  sourceWidth: number;
  sourceHeight: number;
  walkableFloorPolygon: RegistrationPolygon;
  bins: CameraRegistrationBin[];
  quality?: { minAlignmentScore?: number; minRimVisibility?: number; maxFrameAgeSeconds?: number };
};
export type CameraRegistration = CameraRegistrationDraft & {
  id: string;
  cameraId: string;
  revision: number;
  status: "ready" | "stale" | "invalid";
  validation: unknown;
  publishedAt: string | null;
  publishedByUid: string | null;
  updatedAt: string | null;
};
export type CameraRegistrationWorkspace = {
  camera: CameraRecord;
  source: "draft" | "published" | "empty";
  publishedRevision: number;
  draftUpdatedAt: string | null;
  registration: CameraRegistrationDraft | null;
  reference: {
    id: string;
    contentUrl: string;
    originalFileName: string;
    mimeType: string;
    byteSize: number;
    width: number;
    height: number;
    available: boolean;
  } | null;
};
export type CameraRegistrationPreview = {
  image: { width: number; height: number };
  peopleCount: number;
  people: Array<{ confidence: number; bbox: { x1: number; y1: number; x2: number; y2: number } }>;
  bins: Array<{ binIndex: number; binId?: string; state: "normal" | "full" | "overflow" | "review" | "unknown"; stateConfidence: number; bbox: { x1: number; y1: number; x2: number; y2: number }; unknownReasons: string[] }>;
  floorHazards: Array<{ className: "floor_litter" | "floor_spill"; confidence: number; bbox: { x1: number; y1: number; x2: number; y2: number } }>;
  processingTimeMs: number;
  modelVersions?: { floorHazard?: string; people?: string; binLocalizer?: string; binState?: string };
  inferenceProvider?: "specialists" | "hybrid" | "legacy";
};

export type CameraRegistrationReferenceMedia = {
  id: string;
  contentUrl: string;
  originalFileName: string;
  mimeType: string;
  byteSize: number;
};

async function request<T>(url: string, init?: RequestInit) {
  const response = await apiFetch(url, init);
  if (!response.ok) throw new Error(await readApiError(response));
  return await response.json() as T;
}

const jsonRequest = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function getSites() {
  return (await request<{ sites: Site[] }>("/api/sites?status=all")).sites;
}

export async function createSite(input: { name: string; description?: string | null }) {
  return (await request<{ site: Site }>("/api/sites", jsonRequest("POST", input))).site;
}

export async function updateSite(siteId: string, input: Partial<Pick<Site, "name" | "description" | "status">>) {
  return (await request<{ site: Site }>(`/api/sites/${encodeURIComponent(siteId)}`, jsonRequest("PATCH", input))).site;
}

export async function getZones(status: RecordStatus | "all" = "all") {
  return (await request<{ zones: Zone[] }>(`/api/zones?status=${status}`)).zones;
}

export async function createZone(input: { siteId: string; name: string; code?: string | null; description?: string | null }) {
  return (await request<{ zone: Zone }>("/api/zones", jsonRequest("POST", input))).zone;
}

export async function updateZone(zoneId: string, input: Partial<Pick<Zone, "name" | "code" | "description" | "status">>) {
  return (await request<{ zone: Zone }>(`/api/zones/${encodeURIComponent(zoneId)}`, jsonRequest("PATCH", input))).zone;
}

export async function getCameras() {
  return (await request<{ cameras: CameraRecord[] }>("/api/cameras?status=all")).cameras;
}

export async function createCamera(input: { zoneId: string; code: string; name: string; sourceMode?: "upload" | "stream" }) {
  return (await request<{ camera: CameraRecord }>("/api/cameras", jsonRequest("POST", input))).camera;
}

export async function updateCamera(cameraId: string, input: Partial<Pick<CameraRecord, "name" | "zoneId" | "sourceMode" | "status">>) {
  return (await request<{ camera: CameraRecord }>(`/api/cameras/${encodeURIComponent(cameraId)}`, jsonRequest("PATCH", input))).camera;
}

export async function getCameraRegistrationWorkspace(cameraId: string) {
  return (await request<{ workspace: CameraRegistrationWorkspace }>(
    `/api/cameras/${encodeURIComponent(cameraId)}/registration/workspace`,
  )).workspace;
}

export async function saveCameraRegistrationDraft(cameraId: string, draft: CameraRegistrationDraft) {
  return (await request<{ savedDraft: { cameraId: string; referenceContentUrl: string; draft: CameraRegistrationDraft; updatedAt: string | null } }>(
    `/api/cameras/${encodeURIComponent(cameraId)}/registration/draft`,
    jsonRequest("PUT", draft),
  )).savedDraft;
}

export async function uploadCameraRegistrationReference(cameraId: string, file: File) {
  const form = new FormData();
  form.append("image", file, file.name);
  return (await request<{ media: CameraRegistrationReferenceMedia }>(
    `/api/cameras/${encodeURIComponent(cameraId)}/registration/reference`,
    { method: "POST", body: form },
  )).media;
}

export async function validateCameraRegistration(cameraId: string, draft: CameraRegistrationDraft) {
  return (await request<{ validation: { ready: boolean; checks: Array<{ code: string; passed: boolean; message: string }>; errors: Array<{ code: string; message: string }>; warnings: Array<{ code: string; message: string }> } }>(
    `/api/cameras/${encodeURIComponent(cameraId)}/registration/validate`,
    jsonRequest("POST", draft),
  )).validation;
}

export async function previewCameraRegistration(cameraId: string, file: File, draft: CameraRegistrationDraft, sourceType: "image" | "video", signal?: AbortSignal) {
  const form = new FormData();
  form.append("image", file, file.name);
  form.append("draft", JSON.stringify(draft));
  form.append("sourceType", sourceType);
  return (await request<{ preview: CameraRegistrationPreview }>(
    `/api/cameras/${encodeURIComponent(cameraId)}/registration/preview`,
    { method: "POST", body: form, signal },
  )).preview;
}

export async function publishCameraRegistration(cameraId: string, draft: CameraRegistrationDraft, expectedRevision: number) {
  return (await request<{ registration: CameraRegistration }>(
    `/api/cameras/${encodeURIComponent(cameraId)}/registration`,
    jsonRequest("PUT", { draft, expectedRevision }),
  )).registration;
}
