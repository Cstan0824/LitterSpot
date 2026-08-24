import { apiFetch, readApiError } from "./apiClient";

export type CleanerStatus = "active" | "inactive";

export type Cleaner = {
  id: string;
  staffCode: string;
  fullName: string;
  phone: string;
  assignedSiteId: string;
  assignedZoneId: string;
  assignedZoneName: string;
  status: CleanerStatus;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  deactivatedAt: string | null;
};

export async function getCleaners() {
  const response = await apiFetch("/api/cleaners");
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json() as { cleaners: Cleaner[] }).cleaners;
}

export async function createCleaner(input: {
  staffCode: string;
  fullName: string;
  phone: string;
  assignedZoneId: string;
}) {
  const response = await apiFetch("/api/cleaners", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json() as { cleaner: Cleaner }).cleaner;
}

export async function updateCleanerStatus(cleanerId: string, status: CleanerStatus) {
  const response = await apiFetch(`/api/cleaners/${encodeURIComponent(cleanerId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json() as { cleaner: Cleaner }).cleaner;
}
