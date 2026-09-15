import {
  FieldPath,
  FieldValue,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import type { MediaRetentionOptions } from "../schemas/mediaRetention.js";
import {
  ACTIVE_ALERT_STATUSES,
  TERMINAL_ALERT_STATUSES,
  classifyJobForRetentionSafety,
  collectMediaReferenceIds,
  decideMediaRetentionCandidate,
  type MediaRetentionSkipReason,
} from "./mediaRetentionPolicy.js";
import { deleteStoredMedia } from "./localMediaStorage.js";

export const MEDIA_RETENTION_POLICY_VERSION = "local-media-retention-v1";

type ProtectionState = {
  activeAlertMediaIds: Set<string>;
  inFlightJobSourceMediaIds: Set<string>;
  scannedAlerts: number;
  scannedJobs: number;
};

type RetentionSummary = {
  policyVersion: typeof MEDIA_RETENTION_POLICY_VERSION;
  mode: "dry_run" | "execute";
  cutoffDays: number;
  cutoffAt: string;
  pageSize: number;
  scannedMedia: number;
  eligibleMedia: number;
  deletedMedia: number;
  protectedActiveAlertMedia: number;
  protectedInFlightJobMedia: number;
  scannedAlerts: number;
  scannedJobs: number;
  skipped: Record<MediaRetentionSkipReason, number>;
};

const skipReasons: MediaRetentionSkipReason[] = [
  "storage_not_available",
  "unsupported_kind",
  "non_local_storage",
  "invalid_created_at",
  "newer_than_cutoff",
  "active_alert_reference",
  "in_flight_job_source",
  "invalid_storage_key",
];

async function scanCollection(
  collectionName: string,
  pageSize: number,
  visit: (snapshot: QueryDocumentSnapshot<DocumentData>) => Promise<void> | void,
) {
  let cursor: string | null = null;
  let scanned = 0;
  do {
    let query = firestore.collection(collectionName)
      .orderBy(FieldPath.documentId())
      .limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    for (const document of snapshot.docs) {
      await visit(document);
      scanned += 1;
    }
    cursor = snapshot.size === pageSize ? snapshot.docs.at(-1)?.id ?? null : null;
  } while (cursor);
  return scanned;
}

function addAlertReferences(document: QueryDocumentSnapshot, target: Set<string>) {
  const data = document.data();
  const status = data.status;
  if (ACTIVE_ALERT_STATUSES.has(status)) {
    const references = collectMediaReferenceIds(data);
    if (references.invalidPaths.length > 0) {
      throw new Error(`Active alert ${document.id} has malformed media references: ${references.invalidPaths.join(", ")}.`);
    }
    references.references.forEach((reference) => target.add(reference));
    return;
  }
  if (!TERMINAL_ALERT_STATUSES.has(status)) throw new Error(`Alert ${document.id} has unknown status ${String(status)}; retention stopped safely.`);
}

function addJobReference(document: QueryDocumentSnapshot, target: Set<string>) {
  const data = document.data();
  const classification = classifyJobForRetentionSafety(data);
  if (classification === "uncertain") {
    throw new Error(`Processing job ${document.id} has unknown status ${String(data.status)}; retention stopped safely.`);
  }
  if (classification !== "in_flight") return;
  if (typeof data.sourceMediaId !== "string" || !data.sourceMediaId) {
    throw new Error(`In-flight processing job ${document.id} has no valid sourceMediaId; retention stopped safely.`);
  }
  target.add(data.sourceMediaId);
}

async function loadProtectionState(pageSize: number): Promise<ProtectionState> {
  const activeAlertMediaIds = new Set<string>();
  const inFlightJobSourceMediaIds = new Set<string>();
  const scannedAlerts = await scanCollection("alerts", pageSize, (item) => addAlertReferences(item, activeAlertMediaIds));
  const scannedJobs = await scanCollection("processingJobs", pageSize, (item) => addJobReference(item, inFlightJobSourceMediaIds));
  return { activeAlertMediaIds, inFlightJobSourceMediaIds, scannedAlerts, scannedJobs };
}

export async function runMediaRetention(
  options: MediaRetentionOptions,
  now = new Date(),
): Promise<RetentionSummary> {
  if (Number.isNaN(now.getTime())) throw new Error("Retention time must be valid.");
  const cutoffMillis = now.getTime() - options.cutoffDays * 24 * 60 * 60 * 1_000;
  const protection = await loadProtectionState(options.pageSize);
  const skipped = Object.fromEntries(skipReasons.map((reason) => [reason, 0])) as Record<MediaRetentionSkipReason, number>;
  let eligibleMedia = 0;
  let deletedMedia = 0;

  const scannedMedia = await scanCollection("mediaAssets", options.pageSize, async (document) => {
    const decision = decideMediaRetentionCandidate({
      mediaId: document.id,
      data: document.data(),
      cutoffMillis,
      activeAlertMediaIds: protection.activeAlertMediaIds,
      inFlightJobSourceMediaIds: protection.inFlightJobSourceMediaIds,
    });
    if (!decision.eligible) {
      skipped[decision.reason] += 1;
      return;
    }
    eligibleMedia += 1;
    if (!options.execute) return;

    // Execute only during the documented maintenance window. File deletion is
    // idempotent; if the Firestore update fails, the next run safely retries it.
    await deleteStoredMedia(decision.storageKey);
    await document.ref.update({
      storageStatus: "deleted",
      storageKey: FieldValue.delete(),
      storageCheckedAt: FieldValue.serverTimestamp(),
      deletedAt: FieldValue.serverTimestamp(),
      deletionReason: "retention_policy",
      retentionPolicyVersion: MEDIA_RETENTION_POLICY_VERSION,
      retentionCutoffAt: new Date(cutoffMillis),
    });
    deletedMedia += 1;
  });

  return {
    policyVersion: MEDIA_RETENTION_POLICY_VERSION,
    mode: options.execute ? "execute" : "dry_run",
    cutoffDays: options.cutoffDays,
    cutoffAt: new Date(cutoffMillis).toISOString(),
    pageSize: options.pageSize,
    scannedMedia,
    eligibleMedia,
    deletedMedia,
    protectedActiveAlertMedia: protection.activeAlertMediaIds.size,
    protectedInFlightJobMedia: protection.inFlightJobSourceMediaIds.size,
    scannedAlerts: protection.scannedAlerts,
    scannedJobs: protection.scannedJobs,
    skipped,
  };
}
