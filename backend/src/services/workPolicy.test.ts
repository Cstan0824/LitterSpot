import { describe, expect, it } from "vitest";
import { canTransitionWork, determineVerificationResult, requiresCompletionEvidence } from "./workPolicy.js";

describe("Work policy", () => {
  it("treats assignment as acceptance and allows only defined transitions", () => {
    expect(canTransitionWork("assigned", "in_progress")).toBe(true);
    expect(canTransitionWork("assigned", "resolved")).toBe(false);
    expect(canTransitionWork("resolved", "in_progress")).toBe(false);
  });
  it("applies deterministic verification outcomes", () => {
    expect(determineVerificationResult({ outcome: "passed", managementMode: "orchestrated", origin: "alert" })).toMatchObject({ workStatus: "resolved", requiresSupervisorDecision: false });
    expect(determineVerificationResult({ outcome: "failed", managementMode: "orchestrated", origin: "alert" })).toMatchObject({ workStatus: "in_progress" });
    expect(determineVerificationResult({ outcome: "passed", managementMode: "manual", origin: "manual" })).toMatchObject({ workStatus: "awaiting_review", requiresSupervisorDecision: true });
    expect(requiresCompletionEvidence("manual")).toBe(true);
    expect(requiresCompletionEvidence("alert")).toBe(false);
  });
});
