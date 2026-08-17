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
  createdAt: string | null;
  updatedAt: string | null;
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
