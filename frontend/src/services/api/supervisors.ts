import { createIdempotencyKey } from "./idempotency";
import { apiRequest } from "./http";
import { cachedPageRequest, type ListPage } from "./pagination";

export type SupervisorDirectoryItem = {
  uid: string;
  fullName: string;
  authority: "root" | "regular";
};

export type SupervisorManagementItem = SupervisorDirectoryItem & {
  email: string;
  phone: string | null;
  status: "active" | "inactive";
  revision: number;
};

export type SupervisorListItem = SupervisorDirectoryItem | SupervisorManagementItem;

export type CreateRegularSupervisorInput = {
  email: string;
  password: string;
  fullName: string;
  phone: string | null;
};

export function isSupervisorManagementItem(supervisor: SupervisorListItem): supervisor is SupervisorManagementItem {
  return "status" in supervisor && "email" in supervisor && "revision" in supervisor;
}

export const getSupervisors = (signal?: AbortSignal) => apiRequest<{ supervisors: SupervisorListItem[]; nextCursor: string | null; hasMore: boolean; totalCount: number }>("/api/supervisors?limit=25", { signal });
export const getSupervisorsPage = (cursor?: string, signal?: AbortSignal): Promise<ListPage<SupervisorListItem>> => { const url = `/api/supervisors?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`; return cachedPageRequest(url, async () => { const result = await apiRequest<{ supervisors: SupervisorListItem[]; nextCursor: string | null; hasMore: boolean; totalCount: number }>(url); return { items: result.supervisors, nextCursor: result.nextCursor, hasMore: result.hasMore, totalCount: result.totalCount }; }, 30_000, signal); };

export const createRegularSupervisor = (input: CreateRegularSupervisorInput) => apiRequest<{ supervisor: { uid: string; replayed: boolean } }>("/api/supervisors", {
  method: "POST",
  json: { ...input, idempotencyKey: createIdempotencyKey("create-supervisor") },
});

export const updateSupervisorAccount = (supervisor: SupervisorManagementItem, input: { fullName?: string; phone?: string | null; status?: "active" | "inactive" }) => apiRequest<{ supervisor: { uid: string; status: "active" | "inactive" } }>(`/api/supervisors/${encodeURIComponent(supervisor.uid)}`, {
  method: "PATCH",
  json: { ...input, expectedRevision: supervisor.revision },
});
