import type { AlertStatus } from "../schemas/alert.js";
import { HttpError } from "../shared/httpError.js";

const rank: Record<AlertStatus, number> = { new: 0, acknowledged: 1, in_progress: 2, awaiting_verification: 3, resolved: 4 };

export function assertForwardAlertTransition(current: AlertStatus, next: AlertStatus) {
  if (current === "resolved") throw new HttpError(409, "Resolved alerts cannot be reopened.");
  if (rank[next] <= rank[current]) throw new HttpError(409, "Alert status must move forward.");
}

export function assertReviewAlertTransition(current: AlertStatus, next: Extract<AlertStatus, "awaiting_verification" | "in_progress" | "resolved">) {
  if (current === "resolved") throw new HttpError(409, "Resolved alerts cannot be changed.");
  const allowed = current === "in_progress" && next === "awaiting_verification"
    || current === "awaiting_verification" && ["in_progress", "resolved"].includes(next);
  if (!allowed) throw new HttpError(409, `Alert cannot move from ${current} to ${next} during review.`);
}
