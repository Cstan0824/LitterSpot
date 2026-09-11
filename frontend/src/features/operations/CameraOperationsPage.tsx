import { Component, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import type { Cleaner } from "../../services/cleanerAPI";
import type { CameraRecord, Site, Zone } from "../../services/locationAPI";
import type { LiveVideo } from "../pipeline/liveVideoStore";
import type { Alert, Camera } from "./types";
import { getV2CameraDetail, getV2CameraDraft, getV2WorkDetail, type V2Camera, type V2CameraDetail, type V2OperationsReadModel, type V2WorkOrder } from "../../services/v2/operations";
import { WorkDetailModal, workItemFromV2, type WorkAction, type WorkItem } from "./WorkManagementPage";
import { loadAuthenticatedMedia, releaseAuthenticatedMedia } from "../../services/v2/media";
import { V2CameraMonitor } from "./V2CameraMonitor";
import { CAMERA_VIEW_ASPECT_RATIO, CameraLiveView } from "./CameraLiveView";
import { useOptionalSiteMonitoring } from "./SiteMonitoringProvider";
import { RetainedCameraEvidence } from "../../components/RetainedCameraEvidence";
import { SiteMapViewer } from "../../components/SiteMapViewer";
import { recoverableCameraDraftId, V2CameraCreationPage } from "../../pages/V2CameraCreationPage";
import { changeSiteMapCameraPlacement, getActiveSiteMap, type ActiveSiteMap } from "../../services/v2/siteMap";
import { containingZoneId, validateZoneCandidate, type SiteMapPoint } from "../../services/v2/mapGeometry";
import type { V2CameraDraft } from "../../services/v2/operations";
import "./camera-list-header.css";
import "./camera-detail-monitoring.css";

type Props = {
  readOnly?: boolean;
  showPermissionNotice?: boolean;
  onNavigate?: (path: string, params?: Record<string, string>) => void;
  getCameraDetail?: (cameraId: string, signal?: AbortSignal) => Promise<V2CameraDetail>;
  getWorkDetail?: (workOrderId: string, signal?: AbortSignal) => Promise<import("../../services/v2/operations").V2WorkDetail>;
  allowWorkActions?: boolean;
  canManageCameraPlacement: boolean;
  sites: Site[];
  zones: Zone[];
  cameras: CameraRecord[];
  feeds: Camera[];
  liveVideos: LiveVideo[];
  alerts: Alert[];
  cleaners: Cleaner[];
  siteMap?: V2OperationsReadModel["siteMap"];
  workOrders?: V2WorkOrder[];
  availableCleanerIds?: string[];
  error?: string;
  onCreateZone: (siteId: string, name: string) => Promise<Zone>;
  onCreateCamera: (zoneId: string, code: string, name: string, sourceMode: "upload" | "stream") => Promise<CameraRecord>;
  onCameraPublished?: (cameraId: string) => void | Promise<void>;
  v2Cameras?: V2Camera[];
  onDismissCameraWork?: (workId: string, reason: string) => Promise<void>;
  onWorkAction?: (workId: string, action: WorkAction, options: { cleanerId?: string; reason: string; outcome?: "passed" | "failed" | "inconclusive" }) => Promise<void>;
};

type MapPoint = { x: number; y: number };
type CameraStateFilter = "all" | "enabled" | "disabled";

function existingZoneMapRect(index: number) {
  return { x: 12 + (index % 3) * 28, y: 18 + (Math.floor(index / 3) % 2) * 39, width: 25, height: 18 };
}

function pointIsInsideBoundary(point: MapPoint, boundary: MapPoint[]) {
  if (boundary.length < 3) return false;
  let inside = false;
  for (let current = 0, previous = boundary.length - 1; current < boundary.length; previous = current++) {
    const left = boundary[current];
    const right = boundary[previous];
    const crosses = (left.y > point.y) !== (right.y > point.y) && point.x < ((right.x - left.x) * (point.y - left.y)) / (right.y - left.y) + left.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

class ZonePlannerBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div className="camera-zone-planner-fallback"><strong>Map planner needs a refresh.</strong><span>The zone form is still open. Refresh the page, then try plotting the boundary again.</span></div>;
    return this.props.children;
  }
}

export function cameraMovePointAllowed(mode: "map_position_correction" | "physical_camera_move", currentZoneId: string | null | undefined, candidateZoneId: string | null) {
  return Boolean(candidateZoneId && (mode === "physical_camera_move" || candidateZoneId === currentZoneId));
}

function CameraMoveModal({ camera, cameraName, monitoringEnabled, onClose, onPublished, onPhysicalMove }: { camera: V2CameraDetail["camera"]; cameraName: string; monitoringEnabled: boolean; onClose: () => void; onPublished: () => Promise<void>; onPhysicalMove: (draft: V2CameraDraft) => void }) {
  const [siteMap, setSiteMap] = useState<ActiveSiteMap>();
  const [point, setPoint] = useState(camera.placement?.point ?? null);
  const [mode, setMode] = useState<"map_position_correction" | "physical_camera_move">("map_position_correction");
  const [destinationMode, setDestinationMode] = useState<"existing" | "new">("existing");
  const [newZoneName, setNewZoneName] = useState("");
  const [newZoneBoundary, setNewZoneBoundary] = useState<SiteMapPoint[]>([]);
  const [newZoneStage, setNewZoneStage] = useState<"boundary" | "placement">("boundary");
  const [provisionalZoneId] = useState(() => `zone-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { const controller = new AbortController(); void getActiveSiteMap(controller.signal).then(setSiteMap).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "The active Site Map could not be loaded."); }); return () => controller.abort(); }, []);
  const activeZones = siteMap?.zones.map((zone) => ({ id: zone.zoneId, name: zone.zoneNameSnapshot, polygon: zone.polygon })) ?? [];
  const provisionalZone = destinationMode === "new" ? { id: provisionalZoneId, name: newZoneName.trim() || "New Zone", polygon: newZoneBoundary } : null;
  const newZoneIssues = siteMap && provisionalZone ? validateZoneCandidate(provisionalZone, activeZones, siteMap.revision) : [];
  const displayedZones = provisionalZone ? [...activeZones, provisionalZone] : activeZones;
  const zoneId = point ? containingZoneId(point, displayedZones) : null;
  const zone = zoneId === provisionalZoneId ? { zoneNameSnapshot: newZoneName.trim() || "New Zone" } : siteMap?.zones.find((item) => item.zoneId === zoneId);
  const currentZoneId = camera.placement?.zoneId;
  const unchanged = Boolean(point && camera.placement && point.xMeters === camera.placement.point.xMeters && point.yMeters === camera.placement.point.yMeters);
  const provisionalReady = Boolean(provisionalZone && newZoneName.trim().length >= 2 && newZoneBoundary.length >= 3 && newZoneIssues.length === 0);
  const destinationValid = cameraMovePointAllowed(mode, currentZoneId, zoneId) && (destinationMode !== "new" || provisionalReady && zoneId === provisionalZoneId);
  const choosePoint = (candidate: SiteMapPoint) => {
    const candidateZoneId = containingZoneId(candidate, displayedZones);
    if (!cameraMovePointAllowed(mode, currentZoneId, candidateZoneId)) {
      setError(mode === "map_position_correction" ? "Map Position Correction must remain inside the Camera's current Zone." : "Place the Camera inside one valid destination Zone.");
      return;
    }
    if (destinationMode === "new" && candidateZoneId !== provisionalZoneId) { setError("Place the Camera inside the new Zone."); return; }
    setPoint(candidate); setError("");
  };
  const changeMoveMode = (next: "map_position_correction" | "physical_camera_move") => {
    setMode(next); setDestinationMode("existing"); setNewZoneStage("boundary"); setPoint(camera.placement?.point ?? null); setError("");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!point || !zoneId || !destinationValid || unchanged || reason.trim().length < 3 || !confirmed) return;
    setBusy(true); setError("");
    try {
      const result = await changeSiteMapCameraPlacement({ cameraId: camera.id, point, mode, reason: reason.trim(), expectedCameraRevision: camera.revision, expectedMapRevisionId: camera.activeMapRevisionId, provisionalZone: provisionalZone && destinationMode === "new" ? { zoneId: provisionalZone.id, zoneNameSnapshot: provisionalZone.name, polygon: provisionalZone.polygon } : null });
      if (result.status === "registration_required" && result.draft) { onPhysicalMove(result.draft); return; }
      await onPublished(); onClose();
    } catch (reason) {
      const existingDraftId = recoverableCameraDraftId(reason);
      if (existingDraftId) {
        try { const existing = (await getV2CameraDraft(existingDraftId)).draft; if (existing.kind === "physical_move") { onPhysicalMove(existing); return; } }
        catch (recoveryError) { setError(recoveryError instanceof Error ? recoveryError.message : "The unfinished Physical Camera Move could not be recovered."); return; }
      }
      setError(reason instanceof Error ? reason.message : "The Camera position could not be changed.");
    } finally { setBusy(false); }
  };
  const drawingNewZone = mode === "physical_camera_move" && destinationMode === "new" && newZoneStage === "boundary";
  return <div className="camera-modal-scrim camera-move-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><form className="camera-move-modal" onSubmit={(event) => void submit(event)}><header><div><span>ROOT STRUCTURAL CONTROL</span><h2>Move {cameraName}.</h2><p>Choose whether this is a map correction or a real physical move.</p></div><button type="button" onClick={onClose} disabled={busy} aria-label="Close Camera move">×</button></header><main><section className="camera-move-map"><header><div><span>{drawingNewZone ? "NEW ZONE BOUNDARY" : "NEW CAMERA POINT"}</span><strong>{drawingNewZone ? newZoneIssues[0]?.message ?? "Plot the new Zone boundary" : zone?.zoneNameSnapshot ?? "Place the Camera inside one Zone"}</strong></div>{point && !drawingNewZone && <b>X {point.xMeters.toFixed(2)} · Y {point.yMeters.toFixed(2)} m</b>}</header>{siteMap ? <SiteMapViewer boundary={{ widthMeters: siteMap.revision.widthMeters, heightMeters: siteMap.revision.heightMeters }} gridSizeMeters={siteMap.revision.gridSizeMeters} background={siteMap.background} backgroundTransform={siteMap.revision.backgroundTransform} zones={displayedZones} cameras={siteMap.cameraPlacements.filter((item) => item.cameraId !== camera.id)} selectedZoneId={mode === "map_position_correction" ? currentZoneId : zoneId ?? undefined} drawingZoneId={drawingNewZone ? provisionalZoneId : undefined} conflictingZoneIds={drawingNewZone && newZoneIssues.length ? new Set([provisionalZoneId]) : undefined} pointMarker={!drawingNewZone && point ? { point, label: cameraName, tone: "camera" } : null} onAddZonePoint={drawingNewZone ? (candidate) => { setNewZoneBoundary((current) => [...current, candidate]); setError(""); } : undefined} onPlacePoint={!drawingNewZone ? choosePoint : undefined} /> : <div className="camera-map-loading">Loading the active Site Map…</div>}</section><aside><fieldset><legend>Move type</legend><label><input type="radio" name="move-mode" checked={mode === "map_position_correction"} onChange={() => changeMoveMode("map_position_correction")} /><span><b>Map position correction</b><small>The physical Camera did not move. Its source and Registration remain valid.</small></span></label><label><input type="radio" name="move-mode" checked={mode === "physical_camera_move"} onChange={() => changeMoveMode("physical_camera_move")} /><span><b>Physical Camera move</b><small>The Camera moved in real life. Fresh reference, floor, and bin plotting are required.</small></span></label></fieldset>{mode === "physical_camera_move" && <section className="camera-move-zone-choice"><span>DESTINATION ZONE</span><div role="group" aria-label="Choose destination Zone type"><button type="button" className={destinationMode === "existing" ? "active" : ""} onClick={() => { setDestinationMode("existing"); setPoint(camera.placement?.point ?? null); setError(""); }}>Existing Zone</button><button type="button" className={destinationMode === "new" ? "active" : ""} onClick={() => { setDestinationMode("new"); setPoint(null); setNewZoneStage("boundary"); setError(""); }}>New Zone</button></div>{destinationMode === "new" && <><label>Zone name<input value={newZoneName} maxLength={120} onChange={(event) => { setNewZoneName(event.target.value); setError(""); }} placeholder="New Zone name" /></label><div className="camera-move-zone-tools"><button type="button" onClick={() => setNewZoneBoundary((current) => current.slice(0, -1))} disabled={!newZoneBoundary.length || newZoneStage !== "boundary"}>Undo point</button><button type="button" onClick={() => { setNewZoneBoundary([]); setPoint(null); setNewZoneStage("boundary"); }} disabled={!newZoneBoundary.length}>Redraw Zone</button>{newZoneStage === "boundary" ? <button type="button" className="primary" disabled={!provisionalReady} onClick={() => { setNewZoneStage("placement"); setPoint(null); setError(""); }}>Place Camera</button> : <button type="button" onClick={() => { setNewZoneStage("boundary"); setPoint(null); }}>Edit boundary</button>}</div></>}</section>}{mode === "physical_camera_move" && monitoringEnabled && <p className="camera-move-warning">Disable monitoring before starting a Physical Camera Move.</p>}<label className="camera-move-reason">Reason<textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="Explain why the Camera point is changing" /></label><label className="camera-move-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I confirm this point matches the Camera's real position.</span></label>{error && <p className="camera-modal-error" role="alert">{error}</p>}<dl><div><dt>Current</dt><dd>{camera.placement ? `X ${camera.placement.point.xMeters.toFixed(2)} · Y ${camera.placement.point.yMeters.toFixed(2)} m` : "Not recorded"}</dd></div><div><dt>New Zone</dt><dd>{zone?.zoneNameSnapshot ?? "Not selected"}</dd></div></dl></aside></main><footer><p>{mode === "map_position_correction" ? "Publishing retargets active Camera work to this corrected point." : "Continue into fresh Camera Registration before the moved point becomes active."}</p><div><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="primary" disabled={busy || !destinationValid || unchanged || reason.trim().length < 3 || !confirmed || mode === "physical_camera_move" && monitoringEnabled}>{busy ? "Saving…" : mode === "map_position_correction" ? "Publish correction" : "Continue to Registration"}</button></div></footer></form></div>;
}

const alertLabel = (kind: string) => ({ bin_overflow: "Bin overflow", floor_litter: "Floor litter", floor_spill: "Floor spill" }[kind] ?? kind.replaceAll("_", " "));
const when = (value?: string | null) => { if (!value) return "No recent signal"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "No recent signal" : date.toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); };

function cameraAlerts(camera: CameraRecord, alerts: Alert[]) {
  return alerts.filter((alert) => alert.cameraId === camera.id || alert.cameraId === camera.code || alert.cameraName === camera.name || alert.zone === camera.zoneName).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

const unresolvedAlert = (alert: Alert) => !["resolved", "dismissed"].includes(alert.status);

function zoneSignal(zone: Zone, cameras: CameraRecord[], alerts: Alert[], cameraIsOnline: (camera: CameraRecord) => boolean) {
  const zoneCameras = cameras.filter((camera) => camera.zoneId === zone.id);
  const openAlerts = alerts.filter((alert) => unresolvedAlert(alert) && (
    alert.zone === zone.name || zoneCameras.some((camera) => alert.cameraId === camera.id || alert.cameraId === camera.code || alert.cameraName === camera.name)
  ));
  if (openAlerts.some((alert) => alert.severity === "critical")) return { tone: "action", label: "Critical alert" };
  if (openAlerts.length) return { tone: "watch", label: "Warning alert" };
  if (!zoneCameras.some(cameraIsOnline)) return { tone: "stale", label: "No enabled Camera is online" };
  return { tone: "steady", label: "Cameras healthy" };
}

function cameraStateFilterFrom(query: URLSearchParams): CameraStateFilter {
  const value = query.get("cameraState");
  return value === "enabled" || value === "disabled" ? value : "all";
}

export function cameraDetailBackTarget(query: URLSearchParams) {
  if (query.get("from") === "dashboard") return { hash: "/", label: "Back to Dashboard" };
  if (query.get("from") === "work") return { hash: "/history", label: "Back to Work" };
  if (query.get("from") === "team") return { hash: "/admin", label: "Back to Team" };
  if (query.get("from") === "cameras") {
    const result = new URLSearchParams();
    const zoneId = query.get("zoneId"); const cameraState = cameraStateFilterFrom(query);
    if (zoneId && zoneId !== "all") result.set("zoneId", zoneId);
    if (cameraState !== "all") result.set("cameraState", cameraState);
    return { hash: `/cameras${result.size ? `?${result.toString()}` : ""}`, label: "Back to cameras" };
  }
  return { hash: "/cameras", label: "Back to all cameras" };
}

export function V2CameraWallPreview({ camera }: { camera: V2Camera; readOnly?: boolean }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => { if (!camera.monitoringEnabled || camera.sourceType !== "looped_video" || !camera.source?.contentUrl) { setUrl(undefined); return; } const key = `camera-wall:${camera.id}`; const controller = new AbortController(); void loadAuthenticatedMedia(key, camera.source.contentUrl, controller.signal).then(setUrl).catch(() => setUrl(undefined)); return () => { controller.abort(); releaseAuthenticatedMedia(key); }; }, [camera]);
  const disabled = !camera.monitoringEnabled;
  const playable = !disabled && camera.sourceType === "looped_video" && Boolean(url);
  return <div className="camera-live-view compact"><div className="camera-live-stage" style={{ aspectRatio: CAMERA_VIEW_ASPECT_RATIO }}>
    {playable ? <video src={url} autoPlay muted loop playsInline /> : <div className="camera-live-empty"><strong>{disabled ? "Camera is disabled" : "Waiting for a fresh analyzed frame"}</strong></div>}
    <span className={`camera-live-badge ${disabled ? "disabled" : playable ? "online" : "offline"}`}>{disabled ? "Disabled" : playable ? "Online" : "Offline"}</span>
  </div></div>;
}

function CameraPreview({ record, feed, video, latestAlert, monitoringCamera, mode = "wall", readOnly = false, onReconfigure, onMove }: { record: CameraRecord; feed?: Camera; video?: LiveVideo; latestAlert?: Alert; monitoringCamera?: V2Camera; mode?: "wall" | "detail"; readOnly?: boolean; onReconfigure?: () => void; onMove?: () => void }) {
  const analyzed = video?.analysis ?? feed?.latest;
  const capturedAt = video?.uploadedAt ?? feed?.latest?.createdAt;
  if (monitoringCamera) return readOnly ? <V2CameraWallPreview camera={monitoringCamera} readOnly /> : <CameraLiveView cameraId={monitoringCamera.id} compact={mode === "wall"} onReconfigure={onReconfigure} onMove={onMove} />;
  return <div className="camera-wall-preview">
    {video ? <video src={video.url} autoPlay muted loop playsInline /> : feed?.latest?.evidenceAvailable || latestAlert?.evidenceAvailable ? <img src="/mock/spill.jpg" alt={`Latest view from ${record.name}`} /> : <div className="camera-wall-no-signal"><span>NO CURRENT FRAME</span><small>Waiting for the next camera signal</small></div>}
    <span className={`camera-wall-live ${video ? "live" : record.availability === "unavailable" ? "offline" : "latest"}`}><i />{video ? "Live" : record.availability === "unavailable" ? "Offline" : "Latest view"}</span>
    {latestAlert && <span className={`camera-wall-alert ${latestAlert.severity}`}>{alertLabel(latestAlert.kind)}</span>}
    {analyzed && <span className="camera-wall-timecode">{analyzed.peopleCount} people · {when(capturedAt)}</span>}
  </div>;
}

function ProtectedSnapshot({ snapshot, alt }: { snapshot: { mediaId: string; contentUrl: string } | null; alt: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!snapshot) { setUrl(undefined); return; }
    const key = `camera-history:${snapshot.mediaId}`;
    const controller = new AbortController();
    void loadAuthenticatedMedia(key, snapshot.contentUrl, controller.signal).then(setUrl).catch(() => setUrl(undefined));
    return () => { controller.abort(); releaseAuthenticatedMedia(key); };
  }, [snapshot]);
  return url && snapshot ? <RetainedCameraEvidence mediaId={snapshot.mediaId} url={url} alt={alt} /> : <span>Snapshot unavailable</span>;
}

function CameraWorkCancel({ workId, disabled, onDismiss }: { workId: string; disabled: boolean; onDismiss?: (workId: string, reason: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  if (!onDismiss) return null;
  return <div className="camera-work-cancel">{open ? <><label>Cancellation reason<textarea value={reason} onChange={(event) => { setReason(event.target.value); setMessage(""); }} placeholder="Explain why this Work and its linked Alert should be dismissed" /></label><div><button type="button" onClick={() => setOpen(false)}>Keep Work</button><button type="button" disabled={!reason.trim() || pending} onClick={() => { setPending(true); setMessage(""); void onDismiss(workId, reason.trim()).catch((error) => setMessage(error instanceof Error ? error.message : "Cancellation failed.")).finally(() => setPending(false)); }}>{pending ? "Cancelling…" : "Cancel Work"}</button></div>{message && <p>{message}</p>}</> : <button type="button" className="camera-cancel-trigger" disabled={disabled} onClick={() => setOpen(true)}>Cancel Work</button>}</div>;
}

function AddCameraModal({ sites, zones, nextNumber, onClose, onCreated, onCreateZone, onCreateCamera }: Pick<Props, "sites" | "zones" | "onCreateZone" | "onCreateCamera"> & { nextNumber: number; onClose: () => void; onCreated: (camera: CameraRecord) => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const activeSites = sites.filter((site) => site.status === "active");
  const activeZones = zones.filter((zone) => zone.status === "active");
  const activeSite = activeSites[0];
  const [zoneMode, setZoneMode] = useState<"existing" | "new">("existing");
  const [zoneId, setZoneId] = useState(activeZones[0]?.id ?? "");
  const [zoneName, setZoneName] = useState("");
  const [code, setCode] = useState(`CAM-${String(nextNumber).padStart(2, "0")}`);
  const [name, setName] = useState(`Camera ${String(nextNumber).padStart(2, "0")}`);
  const [zoneBoundary, setZoneBoundary] = useState<MapPoint[]>([]);
  const [cameraPoint, setCameraPoint] = useState<MapPoint | null>(null);
  const [locationPlotting, setLocationPlotting] = useState(false);
  const [draggingPoint, setDraggingPoint] = useState<number | null>(null);
  const mapSurface = useRef<HTMLDivElement>(null);
  const dragged = useRef(false);
  const [message, setMessage] = useState<string>();
  const [saving, setSaving] = useState(false);
  const selectedZoneIndex = activeZones.findIndex((zone) => zone.id === zoneId);

  const pointFromScreen = (surface: HTMLDivElement, clientX: number, clientY: number): MapPoint => {
    const bounds = surface.getBoundingClientRect();
    return {
      x: Math.max(2, Math.min(98, ((clientX - bounds.left) / bounds.width) * 100)),
      y: Math.max(2, Math.min(98, ((clientY - bounds.top) / bounds.height) * 100)),
    };
  };
  const placeZonePoint = (event: MouseEvent<HTMLDivElement>) => {
    if (dragged.current) { dragged.current = false; return; }
    // Read the event coordinates before scheduling state work: React clears currentTarget
    // once the click handler has completed.
    const point = pointFromScreen(event.currentTarget, event.clientX, event.clientY);
    if (locationPlotting) {
      if (!pointIsInsideBoundary(point, zoneBoundary)) { setMessage("Place the camera pin inside the outlined zone."); return; }
      setMessage(undefined);
      setCameraPoint(point);
    }
    else setZoneBoundary((points) => [...points, point]);
  };
  const placeCameraPoint = (event: MouseEvent<HTMLDivElement>) => {
    if (dragged.current) { dragged.current = false; return; }
    if (!locationPlotting) { setMessage("Select the zone, then press Next: Plot camera location before placing the pin."); return; }
    const point = pointFromScreen(event.currentTarget, event.clientX, event.clientY);
    const area = existingZoneMapRect(selectedZoneIndex);
    const insideSelectedZone = selectedZoneIndex >= 0 && point.x >= area.x && point.x <= area.x + area.width && point.y >= area.y && point.y <= area.y + area.height;
    if (!insideSelectedZone) { setMessage("Place the camera pin inside the highlighted selected zone."); return; }
    setMessage(undefined);
    setCameraPoint(point);
  };
  const moveZonePoint = (event: PointerEvent<HTMLDivElement>) => {
    if (draggingPoint === null) return;
    dragged.current = true;
    const point = pointFromScreen(event.currentTarget, event.clientX, event.clientY);
    setZoneBoundary((points) => points.map((item, index) => index === draggingPoint ? point : item));
  };
  // Avoid Array.prototype.at so the planner also works in older embedded browsers.
  const selectedMapPoint = cameraPoint;
  const latitude = selectedMapPoint ? `${(3.23846 - selectedMapPoint.y * .000016).toFixed(5)}° N` : "Place a point";
  const longitude = selectedMapPoint ? `${(101.68292 + selectedMapPoint.x * .000019).toFixed(5)}° E` : "Place a point";
  const zoneReady = zoneMode === "existing" ? Boolean(zoneId) : Boolean(activeSite && zoneName.trim().length >= 2 && zoneBoundary.length >= 3);
  const stepOneComplete = zoneMode === "existing" ? Boolean(zoneReady && cameraPoint) : Boolean(zoneReady && cameraPoint && pointIsInsideBoundary(cameraPoint, zoneBoundary));

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    addEventListener("keydown", close);
    return () => { document.body.style.overflow = previous; removeEventListener("keydown", close); };
  }, [onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(undefined);
    try {
      let targetZoneId = zoneId;
      if (zoneMode === "new" && activeSite) targetZoneId = (await onCreateZone(activeSite.id, zoneName.trim())).id;
      const camera = await onCreateCamera(targetZoneId, code.trim().toUpperCase(), name.trim(), "stream");
      onCreated(camera);
      onClose();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "The camera could not be added.");
      setSaving(false);
    }
  }

  return <div className="camera-modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={`camera-add-modal ${locationPlotting ? "camera-location-plotting" : "camera-zone-selecting"}`} role="dialog" aria-modal="true" aria-labelledby="add-camera-title" tabIndex={-1} ref={dialog}>
      <header><div><span>NEW CAMERA · BATU CAVES</span><h2 id="add-camera-title">Create a new camera.</h2></div><button type="button" onClick={onClose} aria-label="Close camera registration">×</button></header>
      <form onSubmit={submit}>
        <div className="camera-add-body with-zone-map">
          <section className="camera-modal-section camera-modal-location">
            <span className="camera-modal-step">01 / ZONE & LOCATION</span>
            <div className="camera-zone-mode" role="group" aria-label="Choose zone setup">
              <button type="button" className={zoneMode === "existing" ? "active" : ""} onClick={() => { setZoneMode("existing"); setCameraPoint(null); }}><b>Existing zone</b><small>Select a registered area on the map</small></button>
              <button type="button" className={zoneMode === "new" ? "active" : ""} onClick={() => { setZoneMode("new"); setCameraPoint(null); }}><b>Create new zone</b><small>Name and outline a new area</small></button>
            </div>
            {zoneMode === "existing" ? <label>Cleaning zone<select value={zoneId} onChange={(event) => { setZoneId(event.target.value); setCameraPoint(null); }} required><option value="" disabled>Select a zone</option>{activeZones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name} · {zone.siteName}</option>)}</select></label> : <><label>New zone name<input value={zoneName} onChange={(event) => setZoneName(event.target.value)} placeholder="South concourse" minLength={2} required /></label><div className="camera-site-context"><span>Adding to site</span><strong>{activeSite?.name ?? "No active site"}</strong><small>The active site is applied automatically.</small></div></>}
            <ZonePlannerBoundary><section className="camera-zone-planner" aria-labelledby="zone-planner-title"><header><div><span>{zoneMode === "existing" ? "SELECTED ZONE" : "ZONE BOUNDARY"}</span><strong id="zone-planner-title">{zoneMode === "existing" ? "Choose the camera position in the highlighted zone." : zoneBoundary.length >= 3 ? "Place the camera position on the map." : "Outline the new zone on the site map."}</strong></div><b className={stepOneComplete ? "ready" : ""}>{stepOneComplete ? "Ready" : "Step 1"}</b></header><div className="camera-zone-map" ref={mapSurface} onClick={zoneMode === "existing" ? placeCameraPoint : placeZonePoint} onPointerMove={moveZonePoint} onPointerUp={() => setDraggingPoint(null)} aria-label="Site map. Select a zone and place the camera location."><div className="camera-zone-map-art" />{zoneMode === "existing" && <div className="camera-existing-zones">{activeZones.map((zone, index) => <button type="button" key={zone.id} className={zone.id === zoneId ? "selected" : ""} style={{ left: `${12 + (index % 3) * 28}%`, top: `${18 + (Math.floor(index / 3) % 2) * 39}%` }} onClick={(event) => { event.stopPropagation(); setZoneId(zone.id); setCameraPoint(null); }}>{zone.name}</button>)}</div>}<div className="camera-zone-map-toolbar">{zoneMode === "new" && <><button type="button" onClick={(event) => { event.stopPropagation(); setZoneBoundary((points) => points.slice(0, -1)); setCameraPoint(null); }} disabled={!zoneBoundary.length}>Undo</button><button type="button" onClick={(event) => { event.stopPropagation(); setZoneBoundary([]); setCameraPoint(null); }} disabled={!zoneBoundary.length}>Clear</button></>}</div><svg className="camera-zone-boundary" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{zoneMode === "new" && zoneBoundary.length >= 3 && <polygon points={zoneBoundary.map((point) => `${point.x},${point.y}`).join(" ")} />}{zoneMode === "new" && zoneBoundary.length >= 2 && <polyline points={zoneBoundary.map((point) => `${point.x},${point.y}`).join(" ")} />}</svg>{zoneMode === "new" && zoneBoundary.map((point, index) => <button type="button" className={`camera-zone-vertex ${index === zoneBoundary.length - 1 ? "latest" : ""}`} key={`${point.x}-${point.y}-${index}`} style={{ left: `${point.x}%`, top: `${point.y}%` }} aria-label={`Boundary point ${index + 1}. Drag to adjust.`} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); mapSurface.current?.setPointerCapture(event.pointerId); setDraggingPoint(index); }} />)}{cameraPoint && <i className="camera-location-pin" style={{ left: `${cameraPoint.x}%`, top: `${cameraPoint.y}%` }} aria-label="Selected camera location" />}<p className="camera-zone-map-instruction">{zoneMode === "new" && zoneBoundary.length < 3 ? "Click to outline the zone · Plot at least 3 points" : "Click the map to place the camera location"}</p></div><div className="camera-zone-readout"><div><span>CAMERA COORDINATES</span><strong>{latitude}</strong><small>{longitude}</small></div><div><span>STEP 1 STATUS</span><strong>{stepOneComplete ? "Zone and location ready" : "Complete the zone and location"}</strong><small>{zoneMode === "new" && zoneBoundary.length < 3 ? `${Math.max(0, 3 - zoneBoundary.length)} more boundary point${3 - zoneBoundary.length === 1 ? "" : "s"} needed` : cameraPoint ? "Camera pin selected" : "Place the camera pin on the map"}</small></div></div></section></ZonePlannerBoundary>
          </section>
          {!locationPlotting && <div className={`camera-location-next ${zoneMode}`}><button type="button" className="primary" disabled={!zoneReady} onClick={() => { setMessage(undefined); setLocationPlotting(true); }}>Next: Plot camera location →</button></div>}
          <section className={`camera-modal-section camera-modal-details ${stepOneComplete ? "ready" : "locked"}`}><span className="camera-modal-step">02 / CAMERA DETAILS</span><div className="camera-modal-fields"><label>Camera name<input value={name} onChange={(event) => setName(event.target.value)} minLength={2} required disabled={!stepOneComplete} /></label><label>Camera ID<input value={code} disabled /></label><label>Coordinate X<input value={cameraPoint ? cameraPoint.x.toFixed(1) : "Set from map"} disabled /></label><label>Coordinate Y<input value={cameraPoint ? cameraPoint.y.toFixed(1) : "Set from map"} disabled /></label></div><small className="camera-coverage-hint">Coordinates are defined automatically from the selected location on the map.</small></section>
        </div>
        {message && <p className="camera-modal-error" role="alert">{message}</p>}
        <footer><p>{locationPlotting ? "Click inside the selected zone to place the Camera pin. Camera details unlock once the location is set." : "Select an existing zone or finish the new zone boundary, then continue below to plot the Camera location."}</p><div><button type="button" className="outline-button" onClick={onClose}>Cancel</button><button type="submit" className="primary" disabled={saving || !locationPlotting || !stepOneComplete}>{saving ? "Saving…" : "Save zone & camera →"}</button></div></footer>
      </form>
    </div>
  </div>;
}

export function CameraOperationsPage({ readOnly = false, showPermissionNotice = true, onNavigate, getCameraDetail = getV2CameraDetail, getWorkDetail = getV2WorkDetail, allowWorkActions = false, canManageCameraPlacement, sites, zones, cameras, feeds, liveVideos, alerts, cleaners, siteMap, workOrders = [], availableCleanerIds = [], error, onCreateZone, onCreateCamera, onCameraPublished, onDismissCameraWork, onWorkAction, v2Cameras = [] }: Props) {
  const activeCameras = cameras.filter((camera) => camera.status === "active");
  const initialQuery = new URLSearchParams(location.hash.split("?")[1] ?? "");
  const [zoneId, setZoneId] = useState(initialQuery.get("zoneId") ?? "all");
  const [cameraStateFilter, setCameraStateFilter] = useState<CameraStateFilter>(cameraStateFilterFrom(initialQuery));
  const [selectedId, setSelectedId] = useState<string | undefined>(initialQuery.get("cameraId") ?? undefined);
  const [selectedWorkId, setSelectedWorkId] = useState<string | undefined>(initialQuery.get("workId") ?? undefined);
  const [selectedWork, setSelectedWork] = useState<WorkItem>();
  const [gridView, setGridView] = useState<"3x2" | "2x3" | "1x6">("3x2");
  const [showAdd, setShowAdd] = useState(false);
  const monitoring = useOptionalSiteMonitoring();
  const monitor = monitoring?.monitor;
  const monitoringCameras = monitoring?.state.cameras ?? {};
  const [showReconfigure, setShowReconfigure] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [physicalMoveDraft, setPhysicalMoveDraft] = useState<V2CameraDraft>();
  const [detail, setDetail] = useState<V2CameraDetail>();
  const [detailError, setDetailError] = useState("");
  const filterRail = useRef<HTMLElement>(null);
  const nextNumber = Math.max(0, ...cameras.map((camera) => Number(camera.code.match(/\d+$/)?.[0] ?? 0))) + 1;
  const monitoringEnabledFor = (camera: CameraRecord) => monitoringCameras[camera.id]?.camera.monitoringEnabled ?? v2Cameras.find((item) => item.id === camera.id)?.monitoringEnabled ?? false;
  const onlineFor = (camera: CameraRecord) => { const live = monitoringCameras[camera.id]; return Boolean(monitoringEnabledFor(camera) && (live?.lastReceivedAt ? Date.now() - live.lastReceivedAt < 10_000 : v2Cameras.find((item) => item.id === camera.id)?.runtime?.connectionStatus === "online")); };
  const filtered = activeCameras.filter((camera) => (zoneId === "all" || camera.zoneId === zoneId) && (cameraStateFilter === "all" || monitoringEnabledFor(camera) === (cameraStateFilter === "enabled")));
  const selected = cameras.find((camera) => camera.id === selectedId || camera.code === selectedId || camera.name === selectedId || camera.name === initialQuery.get("cameraName"));
  const selectedV2Camera = v2Cameras.find((camera) => camera.id === selected?.id);
  const selectedLive = selected ? monitoringCameras[selected.id] : undefined;
  const go = (path: string, params?: Record<string, string>) => onNavigate ? onNavigate(path, params) : location.hash = `${path}${params ? `?${new URLSearchParams(params)}` : ""}`;
  const selectedAlerts = selected ? cameraAlerts(selected, alerts) : [];
  const selectedFeed = selected ? feeds.find((feed) => feed.id === selected.id || feed.id === selected.code || feed.name === selected.name) : undefined;
  const selectedVideo = selected ? liveVideos.find((video) => video.cameraId === selected.id || video.cameraId === selected.code) : undefined;
  const zoneOptions = useMemo(() => zones.filter((zone) => activeCameras.some((camera) => camera.zoneId === zone.id)), [activeCameras, zones]);
  const gridColumns = gridView === "3x2" ? 3 : gridView === "2x3" ? 2 : 1;
  const currentAssignment = detail?.currentAssignments[0];

  useEffect(() => {
    const syncQuery = () => {
      const query = new URLSearchParams(location.hash.split("?")[1] ?? "");
      setSelectedId(query.get("cameraId") ?? undefined);
      setSelectedWorkId(query.get("workId") ?? undefined);
      setZoneId(query.get("zoneId") ?? "all");
      setCameraStateFilter(cameraStateFilterFrom(query));
    };
    addEventListener("hashchange", syncQuery);
    return () => removeEventListener("hashchange", syncQuery);
  }, []);

  useEffect(() => {
    if (!selectedWorkId) { setSelectedWork(undefined); return; }
    const listed = workOrders.find((work) => work.id === selectedWorkId);
    if (listed) { setSelectedWork(workItemFromV2(listed, alerts)); return; }
    const controller = new AbortController();
    void getWorkDetail(selectedWorkId, controller.signal).then((result) => setSelectedWork(workItemFromV2(result.workOrder, result.alert ? [result.alert] : alerts))).catch(() => { if (!controller.signal.aborted) setSelectedWork(undefined); });
    return () => controller.abort();
  }, [alerts, getWorkDetail, selectedWorkId, workOrders]);

  useEffect(() => {
    if (!selectedId) { setDetail(undefined); return; }
    const controller = new AbortController();
    setDetailError("");
    let pending = false;
    const refresh = () => { if (pending || controller.signal.aborted) return; pending = true; void getCameraDetail(selectedId, controller.signal).then(setDetail).catch((reason) => {
      if (controller.signal.aborted) return;
      setDetailError(reason instanceof Error ? reason.message : "Camera detail could not load.");
    }).finally(() => { pending = false; }); };
    refresh();
    window.addEventListener("litterspot:camera-workflow", refresh);
    return () => { controller.abort(); window.removeEventListener("litterspot:camera-workflow", refresh); };
  }, [getCameraDetail, selectedId]);

  const openCamera = (camera: CameraRecord) => {
    setSelectedId(camera.id);
    const query = new URLSearchParams({ cameraId: camera.id, from: "cameras", zoneId, cameraState: cameraStateFilter });
    go("/cameras", Object.fromEntries(query));
  };

  const showCameraList = (nextZoneId: string, nextState: CameraStateFilter = cameraStateFilter) => {
    setZoneId(nextZoneId); setCameraStateFilter(nextState);
    const query = new URLSearchParams();
    if (nextZoneId !== "all") query.set("zoneId", nextZoneId);
    if (nextState !== "all") query.set("cameraState", nextState);
    go("/cameras", Object.fromEntries(query));
  };

  if (selected) { const back = cameraDetailBackTarget(new URLSearchParams(location.hash.split("?")[1] ?? "")); const sourceLabel = selectedV2Camera?.sourceType === "laptop_camera" ? "Laptop Camera" : "Looped video"; return <section className="camera-detail-page camera-reference-detail">
    <header className="camera-reference-heading"><button type="button" onClick={() => { setSelectedId(undefined); if (onNavigate) { const [path, query] = back.hash.split("?"); onNavigate(path, Object.fromEntries(new URLSearchParams(query ?? ""))); } else location.hash = back.hash; }}>← {back.label}</button></header>
    {showReconfigure && <V2CameraCreationPage cameraId={selected.id} canCreateCamera={canManageCameraPlacement} onClose={() => setShowReconfigure(false)} onPublished={async cameraId => { setShowReconfigure(false); await monitor?.refresh(); await onCameraPublished?.(cameraId); }} />}
    {showMove && detail?.camera && <CameraMoveModal camera={detail.camera} cameraName={selected.name} monitoringEnabled={Boolean(selectedV2Camera?.monitoringEnabled)} onClose={() => setShowMove(false)} onPublished={async () => { await monitor?.refresh(); await onCameraPublished?.(selected.id); }} onPhysicalMove={(draft) => { setShowMove(false); setPhysicalMoveDraft(draft); }} />}
    {physicalMoveDraft && <V2CameraCreationPage initialDraft={physicalMoveDraft} cameraId={selected.id} canCreateCamera onClose={() => setPhysicalMoveDraft(undefined)} onPublished={async cameraId => { setPhysicalMoveDraft(undefined); await monitor?.refresh(); await onCameraPublished?.(cameraId); }} />}
    <div className="camera-reference-layout"><div className="camera-reference-main"><section className="camera-reference-visual"><CameraPreview readOnly={readOnly} record={selected} feed={selectedFeed} video={selectedVideo} latestAlert={selectedAlerts[0]} monitoringCamera={selectedV2Camera} mode="detail" onReconfigure={!readOnly && selectedV2Camera ? () => setShowReconfigure(true) : undefined} onMove={canManageCameraPlacement && detail?.camera ? () => setShowMove(true) : undefined} /><footer className="camera-reference-identity"><div><span>CAMERA</span><h1>{selected.name}</h1><p>{sourceLabel}</p></div><div><span>ZONE</span><h2>{selected.zoneName}</h2></div></footer></section><section className="camera-reference-history camera-orchestrator-trace"><header><span>SYSTEM LOG</span><button type="button" onClick={() => go("/status")}>Open System →</button></header>{detail?.orchestratorTrace.length ? <ol>{detail.orchestratorTrace.slice(0, 3).map((run) => <li key={run.id}><time>{run.completedAt ? new Date(run.completedAt).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "Running"}</time><p><strong>{run.type === "assignment" ? "Assignment decision" : "Review decision"}</strong><span>{run.decisionSummary ?? run.resultCode ?? run.status}</span></p></li>)}</ol> : <p className="camera-reference-empty">No system decision is linked to this Camera history.</p>}{detailError && <p className="camera-reference-empty">{detailError}</p>}</section></div>
      <aside className="camera-reference-sidebar"><section className="camera-reference-assignment"><header><span>CURRENT ASSIGNMENT</span><h2>{currentAssignment ? currentAssignment.title : "No active Work Order"}</h2></header>{currentAssignment ? <><div className="camera-supervision-meta"><span className={`work-priority ${currentAssignment.severity}`}>{currentAssignment.severity}</span><div className="camera-assignment-owner"><strong>Assigned to {currentAssignment.cleanerNameSnapshot}</strong><small>{currentAssignment.managementMode === "orchestrated" ? "System-selected" : "Supervisor assigned"}</small></div></div><button className="camera-assignment-open" type="button" onClick={() => go("/cameras", { cameraId: selected.id, zoneId, cameraState: cameraStateFilter, workId: currentAssignment.id })}>Open Work detail <b>→</b></button>{allowWorkActions && <CameraWorkCancel workId={currentAssignment.id} disabled={false} onDismiss={onDismissCameraWork} />}</> : <p className="camera-reference-empty">No active cleaning assignment.</p>}</section><section className="camera-reference-history"><header><span>RECENT HISTORY</span><button type="button" onClick={() => go("/history", { camera: selected.id })}>View all →</button></header><div className="camera-history-thumbnails" aria-label="Recent evidence thumbnails">{detail?.recentHistory.filter((entry) => entry.snapshot).slice(0, 3).map((entry) => <button type="button" key={entry.id} onClick={() => { if (entry.type === "alert") go("/alerts", { alert: entry.id }); }}><ProtectedSnapshot snapshot={entry.snapshot} alt={`${entry.issueType} snapshot`} /><i className={entry.severity} /></button>)}</div><ol>{detail?.recentHistory.slice(0, 3).map((entry) => <li key={`${entry.type}-${entry.id}`}><time>{entry.occurredAt ? new Date(entry.occurredAt).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "Not recorded"}</time><p><strong>{alertLabel(entry.issueType)}</strong><span>{entry.type === "work" && entry.assignedCleanerName ? `${entry.status} · ${entry.assignedCleanerName}` : entry.status}</span></p></li>)}{!detail?.recentHistory.length && <li className="empty"><p><strong>No recent history</strong><span>Camera events will appear here.</span></p></li>}</ol></section></aside>
    </div>{selectedWorkId && selectedWork && siteMap && <WorkDetailModal readOnly={readOnly} work={selectedWork} siteMap={siteMap} cleaners={cleaners} availableCleanerIds={new Set(availableCleanerIds)} onClose={() => go("/cameras", { cameraId: selected.id, zoneId, cameraState: cameraStateFilter })} onAction={onWorkAction ? (action, options) => onWorkAction(selectedWork.id, action, options) : undefined} onNavigate={onNavigate} />}
  </section>; }

  return <section className="ops-page camera-operations-page">
    <header className="camera-wall-header"><div><span>CAMERAS · LIVE OPERATIONS</span><h1>See every zone. Open the evidence.</h1><p>{readOnly ? "Inspect registered Camera views, Alerts, assigned Cleaners, and recent history." : "Monitor registered camera views, then select one to inspect its alerts, assigned Cleaner, and recent history."}</p></div>{canManageCameraPlacement && <button className="camera-add-button" type="button" onClick={() => setShowAdd(true)}><span>+</span>Add camera</button>}</header>{readOnly && showPermissionNotice && <p className="profile-feedback">Camera controls are unavailable for this account.</p>}
    {error && <p className="profile-feedback" role="alert">{error}</p>}
    <div className="camera-zone-slider">
      <div className="camera-zone-rail">
        <button type="button" aria-label="Previous zones" onClick={() => filterRail.current?.scrollBy({ left: -320, behavior: "smooth" })}>←</button>
        <nav className="camera-zone-filter" aria-label="Filter cameras by zone" ref={filterRail}>
        <button className={zoneId === "all" ? "active" : ""} aria-pressed={zoneId === "all"} onClick={() => showCameraList("all")}>
          <span>All zones</span><b>{activeCameras.length}</b>{zoneId === "all" && <i className="camera-zone-check" aria-hidden="true">✓</i>}
        </button>
        {zoneOptions.map((zone) => {
          const signal = zoneSignal(zone, activeCameras, alerts, onlineFor);
          return <button className={zoneId === zone.id ? "active" : ""} aria-pressed={zoneId === zone.id} key={zone.id} title={signal.label} onClick={() => showCameraList(zone.id)}>
            <span>{zone.name}</span><b>{activeCameras.filter((camera) => camera.zoneId === zone.id).length}</b><i className={`camera-zone-signal ${signal.tone}`} aria-hidden="true" />{zoneId === zone.id && <i className="camera-zone-check" aria-hidden="true">✓</i>}
          </button>;
        })}
        </nav>
        <button type="button" aria-label="Next zones" onClick={() => filterRail.current?.scrollBy({ left: 320, behavior: "smooth" })}>→</button>
      </div>
      <div className="camera-state-filter" role="group" aria-label="Filter Cameras by monitoring state">
        {(["all", "enabled", "disabled"] as const).map((value) => <button type="button" className={cameraStateFilter === value ? "active" : ""} aria-pressed={cameraStateFilter === value} key={value} onClick={() => showCameraList(zoneId, value)}>{value === "all" ? "Both" : value === "enabled" ? "Enabled" : "Disabled"}<b>{value === "all" ? activeCameras.length : activeCameras.filter((camera) => monitoringEnabledFor(camera) === (value === "enabled")).length}</b></button>)}
      </div>
    </div>
    <div className="camera-grid-toolbar atlas-camera-grid-toolbar"><span>Camera grid</span><div className="grid-view-switcher" role="group" aria-label="Choose camera grid layout">{([["1x6", "Single column", 1], ["2x3", "Two columns", 2], ["3x2", "Three columns", 6]] as const).map(([value, gridLabel, cells]) => <button className={gridView === value ? "active" : ""} aria-label={gridLabel} title={gridLabel} aria-pressed={gridView === value} key={value} onClick={() => setGridView(value)}><span className={`grid-view-icon cells-${cells}`} aria-hidden="true">{Array.from({ length: cells }, (_, index) => <i key={index} />)}</span></button>)}</div></div>
    <section className="camera-wall-grid" aria-label="Camera views" style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}>{filtered.map((record) => { const cameraFeed = feeds.find((feed) => feed.id === record.id || feed.id === record.code || feed.name === record.name); const video = liveVideos.find((item) => item.cameraId === record.id || item.cameraId === record.code); const related = cameraAlerts(record, alerts); const monitored = v2Cameras.find((camera) => camera.id === record.id); const open = related.filter(unresolvedAlert); const currentLive = monitoringCameras[record.id]; const enabled = monitoringEnabledFor(record); const busy = Boolean(currentLive?.controlBusy); const condition = open.some((alert) => alert.severity === "critical") ? { label: "Action", tone: "action" } : open.length ? { label: "Watch", tone: "watch" } : { label: "Clear", tone: "clear" }; return <article role="link" tabIndex={0} aria-label={`Open ${record.name}`} className="camera-wall-card" key={record.id} onClick={() => openCamera(record)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openCamera(record); } }}><CameraPreview readOnly={readOnly} record={record} feed={cameraFeed} video={video} latestAlert={related[0]} monitoringCamera={monitored} /><footer><div><strong>{record.name}</strong><span>{record.zoneName}</span></div><div className="camera-card-footer-actions"><b className={`camera-card-status ${condition.tone}`}><i />{condition.label}</b>{!readOnly && monitored && monitor && <button type="button" className={`camera-card-power ${enabled ? "enabled" : "disabled"}`} disabled={busy} aria-label={`${enabled ? "Disable" : "Enable"} ${record.name}`} onClick={(event) => { event.stopPropagation(); void monitor.toggle(record.id); }}>{busy ? "Updating…" : enabled ? "Disable" : "Enable"}</button>}</div></footer></article>; })}{!filtered.length && <div className="camera-wall-empty"><span>NO CAMERAS MATCH THIS VIEW</span><p>Change the Zone or monitoring-state filter to show another Camera.</p></div>}</section>
    {canManageCameraPlacement && showAdd && <V2CameraCreationPage canCreateCamera onClose={() => setShowAdd(false)} onPublished={async (cameraId) => { setShowAdd(false); await onCameraPublished?.(cameraId); go("/cameras", { cameraId, from: "cameras" }); }} />}
  </section>;
}
