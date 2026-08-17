import type { DocumentData } from "firebase-admin/firestore";
import { ALERT_WORKFLOW_VERSION } from "../shared/workflowVersions.js";

export const ACTIVE_ALERT_STATUSES = new Set(["new", "acknowledged", "in_progress"]);
export const IN_FLIGHT_JOB_STATUSES = new Set(["uploading", "queued", "processing"]);
export const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);
export const RETAINABLE_MEDIA_KINDS = new Set(["original_upload", "extracted_frame"]);

export type MediaRetentionSkipReason =
  | "storage_not_available"
  | "unsupported_kind"
  | "non_local_storage"
  | "invalid_created_at"
  | "newer_than_cutoff"
  | "active_alert_reference"
  | "in_flight_job_source"
  | "invalid_storage_key";

export type MediaRetentionCandidateDecision =
  | { eligible: true; storageKey: string; createdAtMillis: number }
  | { eligible: false; reason: MediaRetentionSkipReason };

export function timestampMillis(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (!value || typeof value !== "object") return null;
  const toMillis = (value as { toMillis?: unknown }).toMillis;
  if (typeof toMillis !== "function") return null;
  try {
    const result = toMillis.call(value);
    return typeof result === "number" && Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

export function ownedMediaStorageKey(mediaId: string, value: unknown): string | null {
  if (typeof value !== "string" || !value || value.includes("\0") || value.includes("\\")) return null;
  const segments = value.split("/");
  if (segments.length !== 3
    || segments[0] !== "media"
    || segments[1] !== mediaId
    || !segments[2]
    || segments[2] === "."
    || segments[2] === "..") return null;
  return value;
}

export function decideMediaRetentionCandidate(input: {
  mediaId: string;
  data: DocumentData;
  cutoffMillis: number;
  activeAlertMediaIds: ReadonlySet<string>;
  inFlightJobSourceMediaIds: ReadonlySet<string>;
}): MediaRetentionCandidateDecision {
  const { data } = input;
  if (data.storageStatus !== "available") return { eligible: false, reason: "storage_not_available" };
  if (!RETAINABLE_MEDIA_KINDS.has(data.kind)) return { eligible: false, reason: "unsupported_kind" };
  if (data.storageProvider !== undefined
    && data.storageProvider !== null
    && data.storageProvider !== "local"
    && data.storageProvider !== "local_filesystem") {
    return { eligible: false, reason: "non_local_storage" };
  }
  const createdAtMillis = timestampMillis(data.createdAt);
  if (createdAtMillis === null) return { eligible: false, reason: "invalid_created_at" };
  if (createdAtMillis >= input.cutoffMillis) return { eligible: false, reason: "newer_than_cutoff" };
  if (input.activeAlertMediaIds.has(input.mediaId)) return { eligible: false, reason: "active_alert_reference" };
  if (input.inFlightJobSourceMediaIds.has(input.mediaId)) return { eligible: false, reason: "in_flight_job_source" };
  const storageKey = ownedMediaStorageKey(input.mediaId, data.storageKey);
  if (!storageKey) return { eligible: false, reason: "invalid_storage_key" };
  return { eligible: true, storageKey, createdAtMillis };
}

export function activeCurrentWorkflowAlert(data: DocumentData) {
  if (data.workflowVersion !== ALERT_WORKFLOW_VERSION) return "inactive" as const;
  if (ACTIVE_ALERT_STATUSES.has(data.status)) return "active" as const;
  if (data.status === "resolved") return "inactive" as const;
  return "uncertain" as const;
}

export function classifyJobForRetentionSafety(data: DocumentData) {
  if (IN_FLIGHT_JOB_STATUSES.has(data.status)) return "in_flight" as const;
  if (TERMINAL_JOB_STATUSES.has(data.status)) return "terminal" as const;
  return "uncertain" as const;
}

function visitMediaReferenceFields(
  value: unknown,
  references: Set<string>,
  path: string,
  invalidPaths: string[],
) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitMediaReferenceFields(item, references, `${path}[${index}]`, invalidPaths));
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const itemPath = path ? `${path}.${key}` : key;
    if (key.endsWith("MediaId")) {
      if (item === null || item === undefined) continue;
      if (typeof item === "string" && item.length > 0) references.add(item);
      else invalidPaths.push(itemPath);
      continue;
    }
    if (key.endsWith("MediaIds")) {
      if (item === null || item === undefined) continue;
      if (Array.isArray(item) && item.every((entry) => typeof entry === "string" && entry.length > 0)) {
        item.forEach((entry) => references.add(entry as string));
      } else {
        invalidPaths.push(itemPath);
      }
      continue;
    }
    visitMediaReferenceFields(item, references, itemPath, invalidPaths);
  }
}

export function collectMediaReferenceIds(data: DocumentData) {
  const references = new Set<string>();
  const invalidPaths: string[] = [];
  visitMediaReferenceFields(data, references, "", invalidPaths);
  return { references, invalidPaths };
}
