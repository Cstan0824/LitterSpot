import { describe, expect, it } from "vitest";
import { applyVerification, canTransitionWork, requiresCompletionEvidence } from "./v2WorkPolicy.js";

describe("V2 Work policy", () => {
  it("treats assignment as acceptance and allows only defined transitions", () => {
    expect(canTransitionWork("assigned", "in_progress")).toBe(true);
    expect(canTransitionWork("assigned", "resolved")).toBe(false);
    expect(canTransitionWork("resolved", "in_progress")).toBe(false);
  });
  it("applies deterministic verification outcomes", () => {
    expect(applyVerification({ outcome: "passed", managementMode: "orchestrated", origin: "alert" })).toMatchObject({ workStatus: "resolved", requiresSupervisorDecision: false });
    expect(applyVerification({ outcome: "failed", managementMode: "orchestrated", origin: "alert" })).toMatchObject({ workStatus: "in_progress" });
    expect(applyVerification({ outcome: "passed", managementMode: "manual", origin: "manual" })).toMatchObject({ workStatus: "awaiting_review", requiresSupervisorDecision: true });
    expect(requiresCompletionEvidence("coordinate")).toBe(true);
  });
});

