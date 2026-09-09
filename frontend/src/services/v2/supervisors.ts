import { createIdempotencyKey } from "./idempotency";
import { v2Request } from "./http";
import { cachedPageRequest, type V2ListPage } from "./pagination";

export type V2SupervisorDirectoryItem = {
  uid: string;
  fullName: string;
  authority: "root" | "regular";
};

export type V2SupervisorManagementItem = V2SupervisorDirectoryItem & {
  email: string;
  phone: string | null;
  status: "active" | "inactive";
  revision: number;
};

export type V2SupervisorListItem = V2SupervisorDirectoryItem | V2SupervisorManagementItem;

export type CreateV2RegularSupervisorInput = {
  email: string;
  password: string;
  fullName: string;
  phone: string | null;
};

export function isV2SupervisorManagementItem(supervisor: V2SupervisorListItem): supervisor is V2SupervisorManagementItem {
  return "status" in supervisor && "email" in supervisor && "revision" in supervisor;
}

export const getV2Supervisors = (signal?: AbortSignal) => v2Request<{ supervisors: V2SupervisorListItem[]; nextCursor: string | null; hasMore: boolean; totalCount: number }>("/api/supervisors?limit=25", { signal });
export const getV2SupervisorsPage = (cursor?: string, signal?: AbortSignal): Promise<V2ListPage<V2SupervisorListItem>> => { const url = `/api/supervisors?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`; return cachedPageRequest(url, async () => { const result = await v2Request<{ supervisors: V2SupervisorListItem[]; nextCursor: string | null; hasMore: boolean; totalCount: number }>(url); return { items: result.supervisors, nextCursor: result.nextCursor, hasMore: result.hasMore, totalCount: result.totalCount }; }, 30_000, signal); };

export const createV2RegularSupervisor = (input: CreateV2RegularSupervisorInput) => v2Request<{ supervisor: { uid: string; replayed: boolean } }>("/api/supervisors", {
  method: "POST",
  json: { ...input, idempotencyKey: createIdempotencyKey("create-supervisor") },
});

export const updateV2SupervisorAccount = (supervisor: V2SupervisorManagementItem, input: { fullName?: string; phone?: string | null; status?: "active" | "inactive" }) => v2Request<{ supervisor: { uid: string; status: "active" | "inactive" } }>(`/api/supervisors/${encodeURIComponent(supervisor.uid)}`, {
  method: "PATCH",
  json: { ...input, expectedRevision: supervisor.revision },
});
