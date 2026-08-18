import { describe, expect, it } from "vitest";
import {
  orchestratorClaimSchema,
  orchestratorCompletionSchema,
  orchestratorDecisionSchema,
  orchestratorRunListQuerySchema,
  orchestratorWorkOrderSchema,
  orchestratorReviewDecisionSchema,
  orchestratorReviewRequestSchema,
} from "./orchestrator.js";

describe("orchestrator API schemas", () => {
  it("defaults bounded run queries and claims", () => {
    expect(orchestratorRunListQuerySchema.parse({})).toMatchObject({ status: "all", limit: 25 });
    expect(orchestratorClaimSchema.parse({ workerId: "worker-1" })).toMatchObject({ workerId: "worker-1", leaseSeconds: 300 });
  });

  it("requires an error code when a worker fails a run", () => {
    expect(orchestratorCompletionSchema.safeParse({ workerId: "worker-1", claimToken: "claim-1", status: "failed" }).success).toBe(false);
    expect(orchestratorCompletionSchema.safeParse({ workerId: "worker-1", claimToken: "claim-1", status: "failed", errorCode: "provider_unavailable" }).success).toBe(true);
  });

  it("rejects unsupported or malformed tool decisions", () => {
    expect(orchestratorDecisionSchema.safeParse({
      claimToken: "claim-1",
      actionId: "short",
      toolName: "not-a-tool",
      outcome: "succeeded",
      idempotencyKey: "short",
    }).success).toBe(false);
  });

  it("accepts a typed orchestrator work-order command", () => {
    expect(orchestratorWorkOrderSchema.parse({
      runId: "run-1",
      claimToken: "claim-1",
      decisionId: "decision-001",
      alertId: "alert-1",
      assignedCleanerId: "cleaner-1",
      instructions: "Clean the zone and submit evidence.",
      idempotencyKey: "work-order-001",
    })).toMatchObject({ overrideAvailability: false });
  });

  it("requires a claim for review commands", () => {
    expect(orchestratorReviewRequestSchema.safeParse({
      workOrderId: "work-1",
      alertId: "alert-1",
      idempotencyKey: "request-001",
    }).success).toBe(false);
    expect(orchestratorReviewDecisionSchema.safeParse({
      claimToken: "claim-1",
      workOrderId: "work-1",
      alertId: "alert-1",
      reviewRequestId: "request-1",
      decision: "rework",
      rationaleSummary: "Visible litter remains.",
      idempotencyKey: "decision-001",
    }).success).toBe(true);
  });
});
