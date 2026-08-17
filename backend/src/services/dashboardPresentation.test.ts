import { describe, expect, it } from "vitest";
import { buildDashboardDto } from "./dashboardPresentation.js";

const limits = { alertLimit: 10, detectionLimit: 10, failedJobLimit: 10 };
const noActiveAlerts = { new: 0, acknowledged: 0, inProgress: 0, total: 0 };

describe("dashboard API presentation", () => {
  it("builds a stable site dashboard with camera latest-run evidence", () => {
    const dashboard = buildDashboardDto({
      site: { id: "site-1", name: "Batu Caves", timezone: "Asia/Kuala_Lumpur", status: "active" },
      cameras: [
        { id: "camera-2", siteId: "site-1", code: "CAMERA-2", name: "Stairs", zoneId: "zone-1", status: "active", availability: "unavailable", latestAnalysisRunId: null },
        { id: "camera-1", siteId: "site-1", code: "CAMERA-1", name: "Entrance", zoneId: "zone-1", status: "active", availability: "available", latestAnalysisRunId: "run-1", latestAnalysisAt: "2026-08-13T09:00:00.000Z" },
      ],
      latestRuns: [{
        id: "run-1", cameraId: "camera-1", siteId: "site-1", zoneId: "zone-1", capturedAt: "2026-08-13T08:59:00.000Z", peopleCount: 3,
        issueKinds: ["floor_litter"], issueCounts: { floorLitter: 2 }, image: { width: 1920, height: 1080 }, evidenceMediaId: "media-1",
        alertWorkflowVersion: "grouped-temporal-v2", alertEvaluationStatus: "completed", isTest: false,
      }],
      activeAlerts: [], activeAlertCounts: noActiveAlerts, activeAlertsHasMore: false,
      recentDetections: [], recentFailedJobs: [], limits,
      generatedAt: "2026-08-13T10:00:00.000Z",
    });

    expect(dashboard.contractVersion).toBe("site-dashboard-v1");
    expect(dashboard.summary).toMatchObject({ configuredCameraCount: 2, activeCameraCount: 2, availableCameraCount: 1, unavailableCameraCount: 1 });
    expect(dashboard.cameras.map((camera) => camera.code)).toEqual(["CAMERA-1", "CAMERA-2"]);
    expect(dashboard.cameras[0].latestRun?.evidenceContentUrl).toBe("/api/media/media-1/content");
    expect(dashboard.cameras[0].latestRun?.image).toEqual({ width: 1920, height: 1080 });
    expect(dashboard.cameras[1].latestRun).toBeNull();
    expect(dashboard.completeness.activeAlerts).toBe("complete");
  });

  it.each([
    ["camera", { cameraId: "camera-other", siteId: "site-1", zoneId: "zone-1" }],
    ["site", { cameraId: "camera-1", siteId: "site-other", zoneId: "zone-1" }],
    ["zone", { cameraId: "camera-1", siteId: "site-1", zoneId: "zone-other" }],
  ])("rejects a latest run whose %s ownership does not match its camera", (_label, runOwnership) => {
    const dashboard = buildDashboardDto({
      site: { id: "site-1", name: "Batu Caves" },
      cameras: [{
        id: "camera-1", siteId: "site-1", zoneId: "zone-1", code: "CAMERA-1",
        status: "active", latestAnalysisRunId: "run-1",
      }],
      latestRuns: [{ id: "run-1", ...runOwnership }],
      activeAlerts: [], activeAlertCounts: noActiveAlerts, activeAlertsHasMore: false,
      recentDetections: [], recentFailedJobs: [], limits,
      generatedAt: "2026-08-13T10:00:00.000Z",
    });

    expect(dashboard.cameras[0].latestRun).toBeNull();
  });

  it("excludes resolved and pre-v2 alerts and summarizes only current active workflow alerts", () => {
    const dashboard = buildDashboardDto({
      site: { id: "site-1", name: "Batu Caves" }, cameras: [], latestRuns: [],
      activeAlerts: [
        { id: "alert-new", workflowVersion: "grouped-temporal-v2", status: "new", lastDetectedAt: "2026-08-13T09:00:00.000Z", latestEvidenceMediaId: "media-1" },
        { id: "alert-work", workflowVersion: "grouped-temporal-v2", status: "in_progress", lastDetectedAt: "2026-08-13T10:00:00.000Z" },
        { id: "alert-old", workflowVersion: "prototype-v1", status: "new", lastDetectedAt: "2026-08-13T11:00:00.000Z" },
        { id: "alert-done", workflowVersion: "grouped-temporal-v2", status: "resolved", lastDetectedAt: "2026-08-13T12:00:00.000Z" },
      ],
      activeAlertCounts: { new: 12, acknowledged: 3, inProgress: 8, total: 23 },
      activeAlertsHasMore: true,
      recentDetections: [], recentFailedJobs: [], limits: { ...limits, alertLimit: 1 }, generatedAt: "2026-08-13T13:00:00.000Z",
    });

    expect(dashboard.activeAlerts.map((alert) => alert.id)).toEqual(["alert-work"]);
    expect(dashboard.summary.activeAlertCounts).toEqual({ new: 12, acknowledged: 3, inProgress: 8, total: 23 });
    expect(dashboard.completeness.activeAlerts).toBe("more_available");
    expect(dashboard.sourceQueryMode.activeAlerts).toBe("indexed");
  });

  it("sorts and bounds detections and failed jobs without exposing geometry", () => {
    const dashboard = buildDashboardDto({
      site: { id: "site-1", name: "Batu Caves" }, cameras: [], latestRuns: [],
      activeAlerts: [], activeAlertCounts: noActiveAlerts, activeAlertsHasMore: false,
      recentDetections: [
        { id: "detection-old", capturedAt: "2026-08-13T08:00:00.000Z", polygonNormalized: [{ x: 0, y: 0 }] },
        { id: "detection-new", capturedAt: "2026-08-13T09:00:00.000Z", evidenceMediaId: "media-2", confidence: 0.8 },
      ],
      recentFailedJobs: [
        { id: "job-old", completedAt: "2026-08-13T07:00:00.000Z", error: { code: "OLD", message: "Old failure" } },
        { id: "job-new", completedAt: "2026-08-13T10:00:00.000Z", error: { code: "AI_FAILED", message: "Inference failed", occurredAt: "2026-08-13T10:00:01.000Z" } },
      ],
      limits: { alertLimit: 10, detectionLimit: 1, failedJobLimit: 1 },
      generatedAt: "2026-08-13T11:00:00.000Z",
      sourceTruncation: { detections: true, failedJobs: true },
    });

    expect(dashboard.recentDetections).toHaveLength(1);
    expect(dashboard.recentDetections[0]).toMatchObject({ id: "detection-new", evidenceContentUrl: "/api/media/media-2/content" });
    expect(dashboard.recentDetections[0]).not.toHaveProperty("polygonNormalized");
    expect(dashboard.recentFailedJobs).toEqual([expect.objectContaining({ id: "job-new", error: expect.objectContaining({ code: "AI_FAILED" }) })]);
    expect(dashboard.summary.latestJobFailureAt).toBe("2026-08-13T10:00:01.000Z");
    expect(dashboard.completeness).toMatchObject({ recentDetections: "bounded_source_scan", recentFailedJobs: "bounded_source_scan" });
  });
});
