import type { OperationsWorkOrder } from "../../services/api/operations";
import type { Alert } from "./types";

export type AlertJourneyStage = {
  id: "evidence" | "confirmed" | "assignment" | "cleaning" | "outcome";
  label: string;
  detail: string;
  state: "done" | "current" | "pending" | "terminal";
};

export function alertResponseJourney(alert: Pick<Alert, "status" | "evidenceAvailable">, work?: Pick<OperationsWorkOrder, "status" | "cleanerNameSnapshot" | "reworkCount" | "latestVerificationOutcome">): AlertJourneyStage[] {
  const cleaner = work?.cleanerNameSnapshot || "Cleaner assigned";
  const base: AlertJourneyStage[] = [
    { id: "evidence", label: alert.evidenceAvailable ? "Evidence retained" : "Evidence unavailable", detail: alert.evidenceAvailable ? "Camera frame stored" : "No retained frame", state: alert.evidenceAvailable ? "done" : "pending" },
    { id: "confirmed", label: "Alert confirmed", detail: "Confirmed", state: "done" },
    { id: "assignment", label: "Cleaner assignment", detail: "Pending", state: "pending" },
    { id: "cleaning", label: "Cleaning", detail: "Not started", state: "pending" },
    { id: "outcome", label: "Verification", detail: "Pending", state: "pending" },
  ];

  if (alert.status === "waiting_for_cleaner") {
    base[2] = { ...base[2], label: "Waiting for Cleaner", detail: "Assignment pending", state: "current" };
    return base;
  }

  if (alert.status === "dismissed") {
    if (work) base[2] = { ...base[2], label: "Cleaner assigned", detail: cleaner, state: "done" };
    base[4] = { ...base[4], label: "Alert dismissed", detail: "No further response", state: "terminal" };
    return base;
  }

  if (work || ["assigned", "in_progress", "awaiting_review", "resolved"].includes(alert.status)) {
    base[2] = { ...base[2], label: "Cleaner assigned", detail: cleaner, state: "done" };
  }

  if (alert.status === "assigned") {
    base[3] = { ...base[3], label: "Waiting to start", detail: "Cleaner notified", state: "current" };
  } else if (alert.status === "in_progress") {
    base[3] = { ...base[3], label: work?.reworkCount ? "Rework in progress" : "Cleaning in progress", detail: work?.reworkCount ? "Issue still visible" : "Cleaner working", state: "current" };
  } else if (alert.status === "awaiting_review") {
    base[3] = { ...base[3], label: "Cleaning submitted", detail: "Cleaner finished", state: "done" };
    base[4] = work?.latestVerificationOutcome === "inconclusive"
      ? { ...base[4], label: "Supervisor decision", detail: "Verification inconclusive", state: "current" }
      : { ...base[4], label: "Verification in progress", detail: "Fresh evidence required", state: "current" };
  } else if (alert.status === "resolved") {
    base[3] = { ...base[3], label: "Cleaning submitted", detail: "Cleaner finished", state: "done" };
    base[4] = { ...base[4], label: "Resolved", detail: "Verification passed", state: "done" };
  }
  return base;
}
