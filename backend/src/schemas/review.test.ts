import { describe, expect, it } from "vitest";
import {
  cleanerReviewSubmissionSchema,
  reviewDecisionInputSchema,
  reviewListQuerySchema,
  reviewRequestSchema,
} from "./review.js";

describe("review API schemas", () => {
  it("accepts bounded Cleaner evidence submissions", () => {
    expect(cleanerReviewSubmissionSchema.parse({
      idempotencyKey: "review-submit-001",
      evidenceMediaIds: ["media-before-1", "media-after-1"],
    })).toMatchObject({ evidenceMediaIds: ["media-before-1", "media-after-1"] });
    expect(cleanerReviewSubmissionSchema.safeParse({
      idempotencyKey: "review-submit-001",
      evidenceMediaIds: Array.from({ length: 21 }, (_, index) => `media-${index}`),
    }).success).toBe(false);
  });

  it("requires durable request and decision identifiers", () => {
    expect(reviewRequestSchema.safeParse({
      workOrderId: "work-1",
      alertId: "alert-1",
      idempotencyKey: "request-001",
    }).success).toBe(true);
    expect(reviewDecisionInputSchema.parse({
      workOrderId: "work-1",
      alertId: "alert-1",
      reviewRequestId: "request-1",
      decision: "clean",
      rationaleSummary: "The reviewed evidence shows the area is clean.",
      idempotencyKey: "decision-001",
    })).toMatchObject({ afterEvidenceMediaIds: [], visionResults: {}, modelVersions: {} });
  });

  it("rejects unsupported decisions and defaults bounded review queries", () => {
    expect(reviewDecisionInputSchema.safeParse({
      workOrderId: "work-1",
      alertId: "alert-1",
      reviewRequestId: "request-1",
      decision: "auto_resolve",
      rationaleSummary: "Unsupported decision.",
      idempotencyKey: "decision-001",
    }).success).toBe(false);
    expect(reviewListQuerySchema.parse({})).toMatchObject({ status: "all", limit: 25 });
  });
});
