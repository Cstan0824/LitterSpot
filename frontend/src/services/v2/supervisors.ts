import { createIdempotencyKey } from "./idempotency";
import { v2Request } from "./http";

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

export const getV2Supervisors = (signal?: AbortSignal) => v2Request<{ supervisors: V2SupervisorListItem[] }>("/api/supervisors", { signal });

export const createV2RegularSupervisor = (input: CreateV2RegularSupervisorInput) => v2Request<{ supervisor: { uid: string; replayed: boolean } }>("/api/supervisors", {
  method: "POST",
  json: { ...input, idempotencyKey: createIdempotencyKey("create-supervisor") },
});

export const updateV2SupervisorAccount = (supervisor: V2SupervisorManagementItem, input: { fullName?: string; phone?: string | null; status?: "active" | "inactive" }) => v2Request<{ supervisor: { uid: string; status: "active" | "inactive" } }>(`/api/supervisors/${encodeURIComponent(supervisor.uid)}`, {
  method: "PATCH",
  json: { ...input, expectedRevision: supervisor.revision },
});
