import { beforeEach, describe, expect, it, vi } from "vitest";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./http", () => ({ apiRequest: request }));

import { assignAlertToCleaner, claimMonitoringSession, createCleanerAccount, createManualWorkOrder, deleteSiteMapDraft, dismissAlertRecord, dismissWorkOrder, getAlertsPage, getCameraDraftForCamera, heartbeatMonitoringSession, overrideWorkVerification, publishCameraDraft, publishSiteMapDraft, reassignWorkOrder, releaseMonitoringSession, removeCameraFromSite, saveCameraDraftRegistration, saveSiteMapDraft, startCameraDraft, startMonitoringEpisode, submitMonitoringSample, takeOverWorkOrder, updateCleanerAccount, updateCleanerStation, validateCameraDraft, validateSiteMapDraft, verifyWorkOrder } from "./operations";

const alert = { id: "alert-1", revision: 4 } as any;
const work = { id: "work-1", revision: 6 } as any;

describe("Supervisor action client", () => {
  beforeEach(() => request.mockReset().mockResolvedValue({}));

  it("uses canonical Alert endpoints with opaque IDs and an idempotency key", async () => {
    await assignAlertToCleaner("alert-1", "cleaner-1");
    expect(request).toHaveBeenCalledWith("/api/alerts/alert-1/manual-assignment", expect.objectContaining({ method: "POST", json: expect.objectContaining({ assignedCleanerId: "cleaner-1", idempotencyKey: expect.stringMatching(/^assign-alert-/) }) }));
    await dismissAlertRecord(alert, "Duplicate report");
    expect(request).toHaveBeenLastCalledWith("/api/alerts/alert-1/dismiss", expect.objectContaining({ method: "POST", json: { reason: "Duplicate report", expectedRevision: 4 } }));
  });

  it("keeps a shared Alert page request alive when its first caller unmounts", async () => {
    let resolve!: (value: unknown) => void;
    request.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const firstController = new AbortController();
    const secondController = new AbortController();
    const input = { cameraId: "abort-isolation-camera" };

    const first = getAlertsPage(input, firstController.signal);
    const second = getAlertsPage(input, secondController.signal);
    firstController.abort();
    resolve({ alerts: [{ id: "alert-1" }], nextCursor: "next", hasMore: true, totalCount: 193 });

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).resolves.toMatchObject({ totalCount: 193, hasMore: true, nextCursor: "next" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("/api/alerts?limit=25&cameraId=abort-isolation-camera");
  });

  it("uses the Work mutation contracts rather than local status changes", async () => {
    await createManualWorkOrder({ title: "Clean entrance", instructions: "Remove loose litter.", severity: "warning", assignedCleanerId: "cleaner-1", target: { type: "camera", cameraId: "camera-1" } });
    expect(request).toHaveBeenCalledWith("/api/work-orders/manual", expect.objectContaining({ method: "POST", json: expect.objectContaining({ assignedCleanerId: "cleaner-1", target: { type: "camera", cameraId: "camera-1" }, idempotencyKey: expect.stringMatching(/^manual-work-/) }) }));
    await createManualWorkOrder({ title: "Clean walkway", instructions: "Remove loose litter.", severity: "warning", assignedCleanerId: "cleaner-1", target: { type: "coordinate", point: { xMeters: 50.1, yMeters: 30.2 } } });
    expect(request).toHaveBeenLastCalledWith("/api/work-orders/manual", expect.objectContaining({ method: "POST", json: expect.objectContaining({ target: { type: "coordinate", point: { xMeters: 50.1, yMeters: 30.2 } }, idempotencyKey: expect.stringMatching(/^manual-work-/) }) }));
    await reassignWorkOrder(work, "cleaner-2", "Closer to the issue");
    expect(request).toHaveBeenLastCalledWith("/api/work-orders/work-1/reassign", expect.objectContaining({ json: expect.objectContaining({ assignedCleanerId: "cleaner-2", expectedRevision: 6 }) }));
    await takeOverWorkOrder(work, "Supervisor intervention required");
    expect(request).toHaveBeenLastCalledWith("/api/work-orders/work-1/takeover", expect.objectContaining({ json: expect.objectContaining({ reason: "Supervisor intervention required" }) }));
    await dismissWorkOrder(work, "Issue no longer exists");
    expect(request).toHaveBeenLastCalledWith("/api/work-orders/work-1/dismiss", expect.objectContaining({ json: expect.objectContaining({ expectedRevision: 6 }) }));
    await verifyWorkOrder(work, "failed", "Litter remains visible");
    expect(request).toHaveBeenLastCalledWith("/api/work-orders/work-1/verification", expect.objectContaining({ json: expect.objectContaining({ outcome: "failed", reason: "Litter remains visible", expectedRevision: 6 }) }));
    await overrideWorkVerification(work, "passed", "Supervisor reviewed the evidence.");
    expect(request).toHaveBeenLastCalledWith("/api/work-orders/work-1/verification/override", expect.objectContaining({ json: expect.objectContaining({ outcome: "passed", reason: "Supervisor reviewed the evidence.", expectedRevision: 6 }) }));
  });

  it("provisions and maintains Cleaners through the contracts", async () => {
    await createCleanerAccount({ staffCode: "CLN-010", fullName: "Aina Rahman", phone: "+60123456789", email: "aina@example.com", password: "password123", weeklySchedule: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null }, stationPoint: { xMeters: 12, yMeters: 24 } });
    expect(request).toHaveBeenCalledWith("/api/cleaners", expect.objectContaining({ method: "POST", json: expect.objectContaining({ email: "aina@example.com", stationPoint: { xMeters: 12, yMeters: 24 }, idempotencyKey: expect.stringMatching(/^create-cleaner-/) }) }));
    const cleaner = { id: "cleaner-1", revision: 3 } as any;
    await updateCleanerAccount(cleaner, { fullName: "Aina R.", weeklySchedule: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } });
    expect(request).toHaveBeenLastCalledWith("/api/cleaners/cleaner-1", expect.objectContaining({ method: "PATCH", json: expect.objectContaining({ expectedRevision: 3, fullName: "Aina R." }) }));
    await updateCleanerAccount(cleaner, { availabilityOverride: "unavailable" });
    expect(request).toHaveBeenLastCalledWith("/api/cleaners/cleaner-1", expect.objectContaining({ method: "PATCH", json: { availabilityOverride: "unavailable", expectedRevision: 3 } }));
    await updateCleanerStation("cleaner-1", { xMeters: 20, yMeters: 30 });
    expect(request).toHaveBeenLastCalledWith("/api/site-map/station-points/cleaner-1", expect.objectContaining({ method: "PUT", json: { point: { xMeters: 20, yMeters: 30 } } }));
  });

  it("uses the staged Camera Draft contracts", async () => {
    await getCameraDraftForCamera("camera-1");
    expect(request).toHaveBeenLastCalledWith("/api/camera-creation/cameras/camera-1/draft", { signal: undefined });
    await startCameraDraft({ kind: "create", name: "Entrance Camera", sourceType: "laptop_camera", placement: { point: { xMeters: 12, yMeters: 18 } } });
    expect(request).toHaveBeenLastCalledWith("/api/camera-creation/drafts/start", expect.objectContaining({ method: "POST", json: expect.objectContaining({ sourceType: "laptop_camera" }) }));
    await saveCameraDraftRegistration("draft-1", { sourceWidth: 1280, sourceHeight: 720, walkableFloorPolygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], bins: [] });
    expect(request).toHaveBeenLastCalledWith("/api/camera-creation/drafts/draft-1/registration", expect.objectContaining({ method: "PUT" }));
    await validateCameraDraft("draft-1");
    expect(request).toHaveBeenLastCalledWith("/api/camera-creation/drafts/draft-1/validate", expect.objectContaining({ method: "POST" }));
    await publishCameraDraft("draft-1");
    expect(request).toHaveBeenLastCalledWith("/api/camera-creation/drafts/draft-1/publish", expect.objectContaining({ method: "POST" }));
  });

  it("sends the guarded Camera removal contract", async () => {
    await removeCameraFromSite({ id: "camera/1", revision: 7, activeMapRevisionId: "map-3" } as any, "Camera removed after venue renovation.", "remove-key-1");
    expect(request).toHaveBeenLastCalledWith("/api/camera-creation/cameras/camera%2F1/remove", {
      method: "POST",
      json: { reason: "Camera removed after venue renovation.", confirmation: true, expectedCameraRevision: 7, expectedMapRevisionId: "map-3", idempotencyKey: "remove-key-1" },
    });
  });

  it("uses the guarded Site Map Draft lifecycle for adding a Zone", async () => {
    await saveSiteMapDraft({ baseRevisionId: "map-1", widthMeters: 100, heightMeters: 80, gridSizeMeters: 5, zones: [{ zoneId: "zone-1", zoneNameSnapshot: "New Zone", polygon: [{ xMeters: 0, yMeters: 0 }, { xMeters: 20, yMeters: 0 }, { xMeters: 20, yMeters: 20 }] }], cameraPlacements: [], cleanerStations: [] });
    expect(request).toHaveBeenLastCalledWith("/api/site-map/draft", expect.objectContaining({ method: "POST" }));
    await validateSiteMapDraft();
    expect(request).toHaveBeenLastCalledWith("/api/site-map/draft/validate", expect.objectContaining({ method: "POST" }));
    await publishSiteMapDraft();
    expect(request).toHaveBeenLastCalledWith("/api/site-map/draft/publish", expect.objectContaining({ method: "POST" }));
    await deleteSiteMapDraft();
    expect(request).toHaveBeenLastCalledWith("/api/site-map/draft", expect.objectContaining({ method: "DELETE" }));
  });

  it("uses a lease token for monitoring lifecycle calls", async () => {
    request.mockResolvedValueOnce({ sessionId: "session-1", leaseToken: "token-1", leaseSeconds: 30 });
    const lease = await claimMonitoringSession();
    await heartbeatMonitoringSession(lease);
    expect(request).toHaveBeenLastCalledWith("/api/monitoring/sessions/session-1/heartbeat", expect.objectContaining({ headers: { "x-monitoring-token": "token-1" } }));
    request.mockResolvedValueOnce({ episodeId: "episode-1", nextSequence: 1, isSimulation: true });
    const episode = await startMonitoringEpisode(lease, "camera-1");
    const frame = new File(["frame"], "sample.jpg", { type: "image/jpeg" });
    await submitMonitoringSample(lease, "camera-1", episode.episodeId, 1, frame);
    expect(request).toHaveBeenLastCalledWith("/api/monitoring/sessions/session-1/cameras/camera-1/samples", expect.objectContaining({ method: "POST" }));
    await releaseMonitoringSession(lease);
    expect(request).toHaveBeenLastCalledWith("/api/monitoring/sessions/session-1/release", expect.objectContaining({ method: "POST" }));
  });
});
