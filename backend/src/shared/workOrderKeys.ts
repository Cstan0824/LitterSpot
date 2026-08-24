import { createHash } from "node:crypto";

export function activeWorkOrderKeyId(alertId: string) {
  return createHash("sha256")
    .update("active-work-order-key-v1")
    .update("\0")
    .update(alertId)
    .digest("hex");
}
