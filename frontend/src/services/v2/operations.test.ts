import { beforeEach, describe, expect, it, vi } from "vitest";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./http", () => ({ v2Request: request }));

import { assignV2Alert, claimV2MonitoringSession, createV2Cleaner, createV2ManualWork, deleteV2SiteMapDraft, dismissV2Alert, dismissV2Work, heartbeatV2MonitoringSession, overrideV2Verification, publishV2CameraDraft, publishV2SiteMapDraft, reassignV2Work, releaseV2MonitoringSession, saveV2CameraDraftRegistration, saveV2SiteMapDraft, startV2CameraDraft, startV2MonitoringEpisode, submitV2MonitoringSample, takeOverV2Work, updateV2Cleaner, updateV2CleanerStation, validateV2CameraDraft, validateV2SiteMapDraft, verifyV2Work } from "./operations";

const alert = { id: "alert-1", revision: 4 } as any;
const work = { id: "work-1", revision: 6 } as any;

describe("V2 Supervisor action client", () => {
  beforeEach(() => request.mockReset().mockResolvedValue({}));

  it("uses canonical Alert endpoints with opaque IDs and an idempotency key", async () => {
    await assignV2Alert("alert-1", "cleaner-1");
    expect(request).toHaveBeenCalledWith("/api/alerts/alert-1/manual-assignment", expect.objectContaining({ method: "POST", json: expect.objectContaining({ assignedCleanerId: "cleaner-1", idempotencyKey: expect.stringMatching(/^assign-alert-/) }) }));
    await dismissV2Alert(alert, "Duplicate report");
    expect(request).toHaveBeenLastCalledWith("/api/alerts/alert-1/dismiss", expect.objectContaining({ method: "POST", json: { reason: "Duplicate report", expectedRevision: 4 } }));
  });

  it("uses the V2 Work mutation contracts rather than local status changes", async () => {
    await createV2ManualWork({ title: "Clean entrance", instructions: "Remove loose litter.", severity: "warning", assignedCleanerId: "cleaner-1", target: { type: "camera", cameraId: "camera-1" } });
    expect(request).toHaveBeenCalledWith("/api/work-orders/manual", expect.objectContaining({ method: "POST", json: expect.objectContaining({ assignedCleanerId: "cleaner-1", idempotencyKey: expect.stringMatching(/^manual-work-/) }) }));
    await reassignV2Work(work, "cleaner-2", "Closer to the issue");
    expect(request).toHaveBeenLastCalledWith("/api/work-orders/work-1/reassign", expect.objectContaining({ json: expect.objectContaining({ assignedCleanerId: "cleaner-2", expectedRevision: 6 }) }));
    await takeOverV2Work(work, "Supervisor intervention required");
    expect(request).toHaveBeenLastCalledWith("/api/work-orders/work-1/takeover", expect.objectContaining({ json: expect.objectContaining({ reason: "Supervisor intervention required" }) }));
    await dismissV2Work(work, "Issue no longer exists");
    expect(request).toHaveBeenLastCalledWith("/api/work-orders/work-1/dismiss", expect.objectContaining({ json: expect.objectContaining({ expectedRevision: 6 }) }));
    await verifyV2Work(work, "failed", "Litter remains visible");
    expect(request).toHaveBeenLastCalledWith("/api/work-orders/work-1/verification", expect.objectContaining({ json: expect.objectContaining({ outcome: "failed", reason: "Litter remains visible", expectedRevision: 6 }) }));
    await overrideV2Verification(work, "passed", "Supervisor reviewed the evidence.");
    expect(request).toHaveBeenLastCalledWith("/api/work-orders/work-1/verification/override", expect.objectContaining({ json: expect.objectContaining({ outcome: "passed", reason: "Supervisor reviewed the evidence.", expectedRevision: 6 }) }));
  });

  it("provisions and maintains Cleaners through the V2 contracts", async () => {
    await createV2Cleaner({ staffCode: "CLN-010", fullName: "Aina Rahman", phone: "+60123456789", email: "aina@example.com", password: "password123", weeklySchedule: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null }, stationPoint: { xMeters: 12, yMeters: 24 } });
    expect(request).toHaveBeenCalledWith("/api/cleaners", expect.objectContaining({ method: "POST", json: expect.objectContaining({ email: "aina@example.com", stationPoint: { xMeters: 12, yMeters: 24 }, idempotencyKey: expect.stringMatching(/^create-cleaner-/) }) }));
    const cleaner = { id: "cleaner-1", revision: 3 } as any;
    await updateV2Cleaner(cleaner, { fullName: "Aina R.", weeklySchedule: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } });
    expect(request).toHaveBeenLastCalledWith("/api/cleaners/cleaner-1", expect.objectContaining({ method: "PATCH", json: expect.objectContaining({ expectedRevision: 3, fullName: "Aina R." }) }));
    await updateV2CleanerStation("cleaner-1", { xMeters: 20, yMeters: 30 });
    expect(request).toHaveBeenLastCalledWith("/api/site-map/station-points/cleaner-1", expect.objectContaining({ method: "PUT", json: { point: { xMeters: 20, yMeters: 30 } } }));
  });

  it("uses the staged V2 Camera Draft contracts", async () => {
    await startV2CameraDraft({ kind: "create", name: "Entrance Camera", sourceType: "laptop_camera", placement: { point: { xMeters: 12, yMeters: 18 } } });
    expect(request).toHaveBeenLastCalledWith("/api/camera-creation/drafts/start", expect.objectContaining({ method: "POST", json: expect.objectContaining({ sourceType: "laptop_camera" }) }));
    await saveV2CameraDraftRegistration("draft-1", { sourceWidth: 1280, sourceHeight: 720, walkableFloorPolygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], bins: [] });
    expect(request).toHaveBeenLastCalledWith("/api/camera-creation/drafts/draft-1/registration", expect.objectContaining({ method: "PUT" }));
    await validateV2CameraDraft("draft-1");
    expect(request).toHaveBeenLastCalledWith("/api/camera-creation/drafts/draft-1/validate", expect.objectContaining({ method: "POST" }));
    await publishV2CameraDraft("draft-1");
    expect(request).toHaveBeenLastCalledWith("/api/camera-creation/drafts/draft-1/publish", expect.objectContaining({ method: "POST" }));
  });

  it("uses the guarded Site Map Draft lifecycle for adding a Zone", async () => {
    await saveV2SiteMapDraft({ baseRevisionId: "map-1", widthMeters: 100, heightMeters: 80, gridSizeMeters: 5, zones: [{ zoneId: "zone-1", zoneNameSnapshot: "New Zone", polygon: [{ xMeters: 0, yMeters: 0 }, { xMeters: 20, yMeters: 0 }, { xMeters: 20, yMeters: 20 }] }], cameraPlacements: [], cleanerStations: [] });
    expect(request).toHaveBeenLastCalledWith("/api/site-map/draft", expect.objectContaining({ method: "POST" }));
    await validateV2SiteMapDraft();
    expect(request).toHaveBeenLastCalledWith("/api/site-map/draft/validate", expect.objectContaining({ method: "POST" }));
    await publishV2SiteMapDraft();
    expect(request).toHaveBeenLastCalledWith("/api/site-map/draft/publish", expect.objectContaining({ method: "POST" }));
    await deleteV2SiteMapDraft();
    expect(request).toHaveBeenLastCalledWith("/api/site-map/draft", expect.objectContaining({ method: "DELETE" }));
  });

  it("uses a lease token for V2 monitoring lifecycle calls", async () => {
    request.mockResolvedValueOnce({ sessionId: "session-1", leaseToken: "token-1", leaseSeconds: 30 });
    const lease = await claimV2MonitoringSession();
    await heartbeatV2MonitoringSession(lease);
    expect(request).toHaveBeenLastCalledWith("/api/monitoring/sessions/session-1/heartbeat", expect.objectContaining({ headers: { "x-monitoring-token": "token-1" } }));
    request.mockResolvedValueOnce({ episodeId: "episode-1", nextSequence: 1, isSimulation: true });
    const episode = await startV2MonitoringEpisode(lease, "camera-1");
    const frame = new File(["frame"], "sample.jpg", { type: "image/jpeg" });
    await submitV2MonitoringSample(lease, "camera-1", episode.episodeId, 1, frame);
    expect(request).toHaveBeenLastCalledWith("/api/monitoring/sessions/session-1/cameras/camera-1/samples", expect.objectContaining({ method: "POST" }));
    await releaseV2MonitoringSession(lease);
    expect(request).toHaveBeenLastCalledWith("/api/monitoring/sessions/session-1/release", expect.objectContaining({ method: "POST" }));
  });
});
