import { collection, limit, onSnapshot, orderBy, query, where, type Unsubscribe } from "firebase/firestore";
import { firebaseAuth, firebaseDb } from "../../config/firebase";
import { createIdempotencyKey } from "./idempotency";
import { apiRequest } from "./http";
import type { OperationsCleaner, OperationsPoint, OperationsWorkOrder, OperationsZone } from "./operations";
import type { SiteBackgroundTransform } from "./siteMap";
import { cachedPageRequest, type ListPage } from "./pagination";

export type CleanerNotification = {
  id: string;
  recipientUid: string;
  siteId: string;
  type: "assigned" | "rework" | "resolved" | "dismissed" | string;
  title: string;
  message: string;
  workOrderId: string | null;
  createdAt: string | null;
};

export type CleanerMap = {
  siteId: string;
  siteName: string;
  activeRevisionId: string;
  revision: { widthMeters: number; heightMeters: number; gridSizeMeters: number; backgroundMediaId: string | null; backgroundTransform: SiteBackgroundTransform | null };
  zones: OperationsZone[];
  station: { point: OperationsPoint | null; zoneId: string | null; mapRevisionId: string } | null;
};

export const getCleanerSelf = (signal?: AbortSignal) => apiRequest<{ cleaner: OperationsCleaner & { email?: string; siteName?: string } }>("/api/cleaner/me", { signal });

export const getCleanerWorkOrders = (signal?: AbortSignal) => apiRequest<{ workOrders: OperationsWorkOrder[] }>("/api/cleaner/work-orders?status=all&limit=100", { signal });

export const getCleanerWorkOrder = (workOrderId: string, signal?: AbortSignal) => apiRequest<{ workOrder: OperationsWorkOrder }>(`/api/cleaner/work-orders/${encodeURIComponent(workOrderId)}`, { signal });

export const getCleanerMap = (signal?: AbortSignal) => apiRequest<{ map: CleanerMap }>("/api/cleaner/map", { signal });

export const startCleanerWork = (workOrderId: string) => apiRequest<{ workOrder: OperationsWorkOrder }>(`/api/cleaner/work-orders/${encodeURIComponent(workOrderId)}/start`, {
  method: "POST",
  json: { idempotencyKey: createIdempotencyKey("cleaner-start-work") },
});

export const uploadCleanerCompletionEvidence = (workOrderId: string, photo: File) => {
  const body = new FormData();
  body.append("photo", photo, photo.name);
  return apiRequest<{ evidence: { mediaId: string; contentUrl?: string } }>(`/api/cleaner/work-orders/${encodeURIComponent(workOrderId)}/completion-evidence`, { method: "POST", body });
};

export const submitCleanerForReview = (workOrderId: string, completionEvidenceMediaId?: string) => apiRequest<{ workOrder: OperationsWorkOrder }>(`/api/cleaner/work-orders/${encodeURIComponent(workOrderId)}/ready-for-review`, {
  method: "POST",
  json: { idempotencyKey: createIdempotencyKey("cleaner-ready-for-review"), ...(completionEvidenceMediaId ? { completionEvidenceMediaId } : {}) },
});

export const getCleanerNotifications = (signal?: AbortSignal) => apiRequest<{ notifications: CleanerNotification[]; nextCursor: string | null; hasMore: boolean; totalCount: number }>("/api/cleaner/notifications?limit=20", { signal });
export const getCleanerNotificationsPage = (cursor?: string, signal?: AbortSignal): Promise<ListPage<CleanerNotification>> => { const url = `/api/cleaner/notifications?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`; return cachedPageRequest(url, async () => { const result = await apiRequest<{ notifications: CleanerNotification[]; nextCursor: string | null; hasMore: boolean; totalCount: number }>(url); return { items: result.notifications, nextCursor: result.nextCursor, hasMore: result.hasMore, totalCount: result.totalCount }; }, 30_000, signal); };

function notificationFromSnapshot(id: string, value: Record<string, unknown>): CleanerNotification {
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
export function subscribeCleanerNotifications(siteId: string, onChange: (notifications: CleanerNotification[], hasNewEvents: boolean) => void, onError?: (error: Error) => void): Unsubscribe | undefined {
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
