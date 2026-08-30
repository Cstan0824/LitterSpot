export type V2IssueType = "floor_litter" | "floor_spill" | "bin_service";
export type V2AlertStatus = "waiting_for_cleaner" | "assigned" | "in_progress" | "awaiting_review" | "resolved" | "dismissed";
export type Observation = { positive: boolean; capturedAtMs: number; severity?: "warning" | "critical" };

export function qualifiesIssue(issueType: V2IssueType, observations: Observation[], nowMs = Number.POSITIVE_INFINITY) {
  const ordered = observations.filter((observation) => observation.capturedAtMs <= nowMs).sort((a, b) => a.capturedAtMs - b.capturedAtMs);
  if (issueType === "floor_litter") {
    const latest = ordered.slice(-5);
    return latest.length >= 3 && latest.filter((item) => item.positive).length >= 3 && latest[latest.length - 1].capturedAtMs - latest[0].capturedAtMs <= 30 * 60 * 1000;
  }
  if (issueType === "bin_service") {
    const latest = ordered.slice(-3);
    return latest.length >= 2 && latest.filter((item) => item.positive).length >= 2 && latest[latest.length - 1].capturedAtMs - latest[0].capturedAtMs <= 15 * 60 * 1000;
  }
  return Boolean(ordered.at(-1)?.positive);
}

export function priorityScore(input: { severity: "warning" | "critical"; createdAtMs: number; nowMs: number; baseWarning?: number; baseCritical?: number; escalationMinutes?: number }) {
  const base = input.severity === "critical" ? (input.baseCritical ?? 80) : (input.baseWarning ?? 40);
  const ageMinutes = Math.max(0, input.nowMs - input.createdAtMs) / 60000;
  const escalation = input.escalationMinutes ?? 15;
  return Math.min(100, base + Math.floor(ageMinutes / escalation) * 10);
}

export function nextAlertStatus(current: V2AlertStatus, next: V2AlertStatus) {
  const order: V2AlertStatus[] = ["waiting_for_cleaner", "assigned", "in_progress", "awaiting_review", "resolved"];
  if (next === "dismissed") return current !== "resolved" && current !== "dismissed";
  return order.indexOf(next) >= order.indexOf(current) && current !== "resolved" && current !== "dismissed";
}
