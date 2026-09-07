import { collection, limit, onSnapshot, orderBy, query, where, type Unsubscribe } from "firebase/firestore";
import { firebaseAuth, firebaseDb } from "../../config/firebase";
import { createIdempotencyKey } from "./idempotency";
import { v2Request } from "./http";
import type { V2Cleaner, V2Point, V2WorkOrder, V2Zone } from "./operations";
import type { SiteBackgroundTransform } from "./siteMap";

export type V2CleanerNotification = {
  id: string;
  recipientUid: string;
  siteId: string;
  type: "assigned" | "rework" | "resolved" | "dismissed" | string;
  title: string;
  message: string;
  workOrderId: string | null;
  createdAt: string | null;
};

export type V2CleanerMap = {
  siteId: string;
  siteName: string;
  activeRevisionId: string;
  revision: { widthMeters: number; heightMeters: number; gridSizeMeters: number; backgroundMediaId: string | null; backgroundTransform: SiteBackgroundTransform | null };
  zones: V2Zone[];
  station: { point: V2Point | null; zoneId: string | null; mapRevisionId: string } | null;
};

export const getV2CleanerSelf = (signal?: AbortSignal) => v2Request<{ cleaner: V2Cleaner & { email?: string; siteName?: string } }>("/api/cleaner/me", { signal });

export const getV2CleanerWorkOrders = (signal?: AbortSignal) => v2Request<{ workOrders: V2WorkOrder[] }>("/api/cleaner/work-orders?status=all&limit=100", { signal });

export const getV2CleanerWorkOrder = (workOrderId: string, signal?: AbortSignal) => v2Request<{ workOrder: V2WorkOrder }>(`/api/cleaner/work-orders/${encodeURIComponent(workOrderId)}`, { signal });

export const getV2CleanerMap = (signal?: AbortSignal) => v2Request<{ map: V2CleanerMap }>("/api/cleaner/map", { signal });

export const startV2CleanerWork = (workOrderId: string) => v2Request<{ workOrder: V2WorkOrder }>(`/api/cleaner/work-orders/${encodeURIComponent(workOrderId)}/start`, {
  method: "POST",
  json: { idempotencyKey: createIdempotencyKey("cleaner-start-work") },
});

export const uploadV2CleanerCompletionEvidence = (workOrderId: string, photo: File) => {
  const body = new FormData();
  body.append("photo", photo, photo.name);
  return v2Request<{ evidence: { mediaId: string; contentUrl?: string } }>(`/api/cleaner/work-orders/${encodeURIComponent(workOrderId)}/completion-evidence`, { method: "POST", body });
};

export const submitV2CleanerForReview = (workOrderId: string, completionEvidenceMediaId?: string) => v2Request<{ workOrder: V2WorkOrder }>(`/api/cleaner/work-orders/${encodeURIComponent(workOrderId)}/ready-for-review`, {
  method: "POST",
  json: { idempotencyKey: createIdempotencyKey("cleaner-ready-for-review"), ...(completionEvidenceMediaId ? { completionEvidenceMediaId } : {}) },
});

export const getV2CleanerNotifications = (signal?: AbortSignal) => v2Request<{ notifications: V2CleanerNotification[] }>("/api/cleaner/notifications?limit=50", { signal });

function notificationFromSnapshot(id: string, value: Record<string, unknown>): V2CleanerNotification {
  const createdAt = value.createdAt && typeof value.createdAt === "object" && "toDate" in value.createdAt && typeof value.createdAt.toDate === "function"
    ? value.createdAt.toDate().toISOString()
    : typeof value.createdAt === "string" ? value.createdAt : null;
  return {
    id,
    recipientUid: String(value.recipientUid ?? ""),
    siteId: String(value.siteId ?? ""),
    type: String(value.type ?? "notification"),
    title: String(value.title ?? "Update"),
    message: String(value.message ?? ""),
    workOrderId: typeof value.workOrderId === "string" ? value.workOrderId : null,
    createdAt,
  };
}

/** Notification documents are immutable. This listener only delivers new server events to the active Cleaner session. */
export function subscribeV2CleanerNotifications(siteId: string, onChange: (notifications: V2CleanerNotification[], hasNewEvents: boolean) => void, onError?: (error: Error) => void): Unsubscribe | undefined {
  const uid = firebaseAuth.currentUser?.uid;
  if (!uid || !siteId) return undefined;
  const source = query(collection(firebaseDb, "notifications"), where("recipientUid", "==", uid), where("siteId", "==", siteId), orderBy("createdAt", "desc"), limit(50));
  let initial = true;
  return onSnapshot(source, (snapshot) => {
    const hasNewEvents = !initial && snapshot.docChanges().some((change) => change.type === "added");
    initial = false;
    onChange(snapshot.docs.map((item) => notificationFromSnapshot(item.id, item.data())), hasNewEvents);
  }, (error) => onError?.(error));
}
