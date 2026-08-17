import { describe, expect, it } from "vitest";
import { ALERT_WORKFLOW_VERSION } from "../shared/workflowVersions.js";
import {
  activeCurrentWorkflowAlert,
  classifyJobForRetentionSafety,
  collectMediaReferenceIds,
  decideMediaRetentionCandidate,
  ownedMediaStorageKey,
} from "./mediaRetentionPolicy.js";

const oldTimestamp = { toMillis: () => 1_000 };
const baseMedia = {
  storageStatus: "available",
  kind: "original_upload",
  storageKey: "media/media-1/original.jpg",
  createdAt: oldTimestamp,
};

function decide(overrides = {}, safety: { alert?: string[]; job?: string[] } = {}) {
  return decideMediaRetentionCandidate({
    mediaId: "media-1",
    data: { ...baseMedia, ...overrides },
    cutoffMillis: 2_000,
    activeAlertMediaIds: new Set(safety.alert ?? []),
    inFlightJobSourceMediaIds: new Set(safety.job ?? []),
  });
}

describe("media retention policy", () => {
  it("accepts only old, available local originals or extracted frames with owned keys", () => {
    expect(decide()).toEqual({ eligible: true, storageKey: "media/media-1/original.jpg", createdAtMillis: 1_000 });
    expect(decide({ kind: "extracted_frame", storageKey: "media/media-1/frame-claim.jpg" }).eligible).toBe(true);
    expect(decide({ kind: "evidence" })).toEqual({ eligible: false, reason: "unsupported_kind" });
    expect(decide({ storageStatus: "deleted" })).toEqual({ eligible: false, reason: "storage_not_available" });
    expect(decide({ storageProvider: "cloud_storage" })).toEqual({ eligible: false, reason: "non_local_storage" });
    expect(decide({ createdAt: { toMillis: () => 2_000 } })).toEqual({ eligible: false, reason: "newer_than_cutoff" });
    expect(decide({ createdAt: "not-a-timestamp" })).toEqual({ eligible: false, reason: "invalid_created_at" });
  });

  it("protects active-alert evidence and in-flight job sources", () => {
    expect(decide({}, { alert: ["media-1"] })).toEqual({ eligible: false, reason: "active_alert_reference" });
    expect(decide({}, { job: ["media-1"] })).toEqual({ eligible: false, reason: "in_flight_job_source" });
  });

  it("rejects keys outside the exact media document directory", () => {
    expect(ownedMediaStorageKey("media-1", "media/media-1/original.jpg")).toBe("media/media-1/original.jpg");
    for (const key of [
      "/tmp/original.jpg",
      "media/media-2/original.jpg",
      "media/media-1/nested/original.jpg",
      "media/media-1/../original.jpg",
      "media\\media-1\\original.jpg",
    ]) expect(ownedMediaStorageKey("media-1", key)).toBeNull();
  });

  it("treats malformed current-workflow alerts and unknown job states as uncertain", () => {
    expect(activeCurrentWorkflowAlert({ workflowVersion: ALERT_WORKFLOW_VERSION, status: "new" })).toBe("active");
    expect(activeCurrentWorkflowAlert({ workflowVersion: ALERT_WORKFLOW_VERSION, status: "resolved" })).toBe("inactive");
    expect(activeCurrentWorkflowAlert({ workflowVersion: ALERT_WORKFLOW_VERSION, status: "mystery" })).toBe("uncertain");
    expect(activeCurrentWorkflowAlert({ workflowVersion: "legacy", status: "new" })).toBe("inactive");
    expect(classifyJobForRetentionSafety({ status: "processing" })).toBe("in_flight");
    expect(classifyJobForRetentionSafety({ status: "completed" })).toBe("terminal");
    expect(classifyJobForRetentionSafety({ status: "mystery" })).toBe("uncertain");
  });

  it("finds nested singular and plural media references and reports malformed fields", () => {
    const result = collectMediaReferenceIds({
      firstEvidenceMediaId: "media-1",
      latestEvidenceMediaId: null,
      nested: { relatedMediaIds: ["media-2", "media-3"], badMediaId: 42 },
    });
    expect([...result.references].sort()).toEqual(["media-1", "media-2", "media-3"]);
    expect(result.invalidPaths).toEqual(["nested.badMediaId"]);
  });
});
