import { describe, expect, it } from "vitest";
import { buildDashboardSummaryFields } from "./dashboardSummary.js";

describe("dashboard summary reconciliation", () => {
  it("rebuilds current-workflow alert and camera counts from authorities", () => {
    const summary = buildDashboardSummaryFields({
      siteId: "site-1",
      cameras: [
        { status: "active", availability: "available" },
        { status: "active", availability: "unavailable" },
        { status: "active", availability: "unknown" },
        { status: "inactive", availability: "available" },
      ],
      alerts: [
        { workflowVersion: "grouped-temporal-v2", status: "new" },
        { workflowVersion: "grouped-temporal-v2", status: "in_progress" },
        { workflowVersion: "grouped-temporal-v2", status: "awaiting_verification" },
        { workflowVersion: "grouped-temporal-v2", status: "resolved" },
        { workflowVersion: "prototype-v1", status: "new" },
      ],
      latestDetectionAt: "2026-08-13T10:00:00.000Z",
      latestJobFailureAt: null,
    });

    expect(summary).toMatchObject({
      siteId: "site-1",
      workflowVersion: "grouped-temporal-v2",
      configuredCameraCount: 4,
      activeCameraCount: 3,
      availableCameraCount: 1,
      unavailableCameraCount: 1,
      unknownCameraCount: 1,
      activeAlertCounts: { new: 1, acknowledged: 0, inProgress: 1, awaitingVerification: 1, total: 3 },
      resolvedAlertCount: 1,
      latestDetectionAt: "2026-08-13T10:00:00.000Z",
    });
  });
});
