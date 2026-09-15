export type WorkStatus = "assigned" | "in_progress" | "awaiting_review" | "resolved" | "dismissed";
export type VerificationOutcome = "passed" | "failed" | "inconclusive";

const transitions: Record<WorkStatus, WorkStatus[]> = {
  assigned: ["in_progress", "dismissed"],
  in_progress: ["awaiting_review", "dismissed"],
  awaiting_review: ["resolved", "in_progress", "dismissed"],
  resolved: [],
  dismissed: [],
};

export function canTransitionWork(current: WorkStatus, next: WorkStatus) { return transitions[current].includes(next); }

export function determineVerificationResult(input: { outcome: VerificationOutcome; managementMode: "orchestrated" | "manual"; origin: "alert" | "manual" }) {
  if (input.managementMode === "manual" || input.origin === "manual") return { workStatus: "awaiting_review" as const, requiresSupervisorDecision: true };
  if (input.outcome === "passed") return { workStatus: "resolved" as const, requiresSupervisorDecision: false };
  if (input.outcome === "failed") return { workStatus: "in_progress" as const, requiresSupervisorDecision: false };
  return { workStatus: "awaiting_review" as const, requiresSupervisorDecision: true };
}

export function requiresCompletionEvidence(origin: "alert" | "manual") { return origin === "manual"; }
