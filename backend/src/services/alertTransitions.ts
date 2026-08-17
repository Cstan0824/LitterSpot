import type { AlertStatus } from "../schemas/alert.js";
import { HttpError } from "../shared/httpError.js";

const rank: Record<AlertStatus, number> = { new: 0, acknowledged: 1, in_progress: 2, resolved: 3 };

export function assertForwardAlertTransition(current: AlertStatus, next: AlertStatus) {
  if (current === "resolved") throw new HttpError(409, "Resolved alerts cannot be reopened.");
  if (rank[next] <= rank[current]) throw new HttpError(409, "Alert status must move forward.");
}
