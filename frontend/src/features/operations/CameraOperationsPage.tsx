import { Component, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import type { Cleaner } from "../../services/cleanerAPI";
import type { CameraRecord, Site, Zone } from "../../services/locationAPI";
import type { LiveVideo } from "../pipeline/liveVideoStore";
import type { Alert, Camera } from "./types";
import { getV2CameraDetail, type V2Camera, type V2CameraDetail } from "../../services/v2/operations";
import { loadAuthenticatedMedia, releaseAuthenticatedMedia } from "../../services/v2/media";
import { V2CameraMonitor } from "./V2CameraMonitor";

type Props = {
  readOnly?: boolean;
  allowWorkActions?: boolean;
  canManageCameraPlacement: boolean;
  sites: Site[];
  zones: Zone[];
  cameras: CameraRecord[];
  feeds: Camera[];
  liveVideos: LiveVideo[];
  alerts: Alert[];
  cleaners: Cleaner[];
  error?: string;
  onCreateZone: (siteId: string, name: string) => Promise<Zone>;
  onCreateCamera: (zoneId: string, code: string, name: string, sourceMode: "upload" | "stream") => Promise<CameraRecord>;
  onStartCreation?: () => void;
  v2Cameras?: V2Camera[];
  onDismissCameraWork?: (workId: string, reason: string) => Promise<void>;
};

type MapPoint = { x: number; y: number };

class ZonePlannerBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div className="camera-zone-planner-fallback"><strong>Map planner needs a refresh.</strong><span>The zone form is still open. Refresh the page, then try plotting the boundary again.</span></div>;
    return this.props.children;
  }
}

const alertLabel = (kind: string) => ({ bin_overflow: "Bin overflow", floor_litter: "Floor litter", floor_spill: "Floor spill" }[kind] ?? kind.replaceAll("_", " "));
const when = (value?: string | null) => value ? new Date(value).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "No recent signal";

function cameraAlerts(camera: CameraRecord, alerts: Alert[]) {
  return alerts.filter((alert) => alert.cameraId === camera.id || alert.cameraId === camera.code || alert.cameraName === camera.name || alert.zone === camera.zoneName).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

function zoneSignal(zone: Zone, cameras: CameraRecord[], alerts: Alert[]) {
  const zoneCameras = cameras.filter((camera) => camera.zoneId === zone.id);
  const openAlerts = alerts.filter((alert) => alert.status === "active" && (
    alert.zone === zone.name || zoneCameras.some((camera) => alert.cameraId === camera.id || alert.cameraId === camera.code || alert.cameraName === camera.name)
  ));
  if (openAlerts.some((alert) => alert.severity === "critical")) return { tone: "action", label: "Critical alert" };
  if (openAlerts.length) return { tone: "watch", label: "Warning alert" };
  if (zoneCameras.length && zoneCameras.every((camera) => camera.availability === "unavailable")) return { tone: "stale", label: "Cameras offline" };
  return { tone: "steady", label: "Cameras healthy" };
}

function V2CameraWallPreview({ camera }: { camera: V2Camera }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => { if (!camera.monitoringEnabled || camera.sourceType !== "looped_video" || !camera.source?.contentUrl) { setUrl(undefined); return; } const key = `camera-wall:${camera.id}`; const controller = new AbortController(); void loadAuthenticatedMedia(key, camera.source.contentUrl, controller.signal).then(setUrl).catch(() => setUrl(undefined)); return () => { controller.abort(); releaseAuthenticatedMedia(key); }; }, [camera]);
  if (!camera.monitoringEnabled) return <div className="camera-wall-no-signal"><span>MONITORING DISABLED</span><small>Enable this Camera in its detail view to run a demo.</small></div>;
  if (camera.sourceType === "laptop_camera") return <div className="camera-wall-no-signal"><span>LAPTOP CAMERA READY</span><small>Open detail to start the owner monitoring session.</small></div>;
  return url ? <video src={url} autoPlay muted loop playsInline /> : <div className="camera-wall-no-signal"><span>LOADING CAMERA SOURCE</span><small>Waiting for the authenticated video source.</small></div>;
}

function CameraPreview({ record, feed, video, latestAlert, monitoringCamera, mode = "wall" }: { record: CameraRecord; feed?: Camera; video?: LiveVideo; latestAlert?: Alert; monitoringCamera?: V2Camera; mode?: "wall" | "detail" }) {
  const analyzed = video?.analysis ?? feed?.latest;
  const capturedAt = video?.uploadedAt ?? feed?.latest?.createdAt;
  if (monitoringCamera && mode === "detail") return <V2CameraMonitor camera={monitoringCamera} embedded />;
  if (monitoringCamera) return <div className="camera-wall-preview"><V2CameraWallPreview camera={monitoringCamera} /><span className={`camera-wall-live ${monitoringCamera.monitoringEnabled ? "live" : "offline"}`}><i />{monitoringCamera.monitoringEnabled ? "Enabled" : "Disabled"}</span></div>;
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
  return url ? <img src={url} alt={alt} /> : <span>Snapshot unavailable</span>;
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
  const [coverage, setCoverage] = useState("Area overview");
  const [zoneBoundary, setZoneBoundary] = useState<MapPoint[]>([]);
  const [draggingPoint, setDraggingPoint] = useState<number | null>(null);
  const mapSurface = useRef<HTMLDivElement>(null);
  const dragged = useRef(false);
  const [message, setMessage] = useState<string>();
  const [saving, setSaving] = useState(false);

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
    setZoneBoundary((points) => [...points, point]);
  };
  const moveZonePoint = (event: PointerEvent<HTMLDivElement>) => {
    if (draggingPoint === null) return;
    dragged.current = true;
    const point = pointFromScreen(event.currentTarget, event.clientX, event.clientY);
    setZoneBoundary((points) => points.map((item, index) => index === draggingPoint ? point : item));
  };
  // Avoid Array.prototype.at so the planner also works in older embedded browsers.
  const selectedMapPoint = zoneBoundary[zoneBoundary.length - 1];
  const latitude = selectedMapPoint ? `${(3.23846 - selectedMapPoint.y * .000016).toFixed(5)}° N` : "Place a point";
  const longitude = selectedMapPoint ? `${(101.68292 + selectedMapPoint.x * .000019).toFixed(5)}° E` : "Place a point";

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
    <div className="camera-add-modal" role="dialog" aria-modal="true" aria-labelledby="add-camera-title" tabIndex={-1} ref={dialog}>
      <header><div><span>{zoneMode === "new" ? "ZONE PLANNING · BATU CAVES" : "NEW CAMERA · BATU CAVES"}</span><h2 id="add-camera-title">{zoneMode === "new" ? "Create a new zone." : "Add a view to the wall."}</h2></div><button type="button" onClick={onClose} aria-label="Close camera registration">×</button></header>
      <form onSubmit={submit}>
        <div className={`camera-add-body ${zoneMode === "new" ? "with-zone-map" : ""}`}><section className="camera-modal-section camera-modal-location"><span className="camera-modal-step">{zoneMode === "new" ? "CREATE NEW ZONE" : "01 / LOCATION"}</span><div className="camera-zone-mode" role="group" aria-label="Choose zone setup">
          <button type="button" className={zoneMode === "existing" ? "active" : ""} onClick={() => setZoneMode("existing")}><b>Existing zone</b><small>Place the camera in a registered area</small></button>
          <button type="button" className={zoneMode === "new" ? "active" : ""} onClick={() => setZoneMode("new")}><b>Create new zone</b><small>Add an area without leaving this page</small></button>
        </div>
        {zoneMode === "existing" ? <label>Cleaning zone<select value={zoneId} onChange={(event) => setZoneId(event.target.value)} required><option value="" disabled>Select a zone</option>{activeZones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name} · {zone.siteName}</option>)}</select></label> : <><label>New zone name<input value={zoneName} onChange={(event) => setZoneName(event.target.value)} placeholder="South concourse" minLength={2} required /></label><div className="camera-site-context"><span>Adding to site</span><strong>{activeSite?.name ?? "No active site"}</strong><small>The active site is applied automatically.</small></div><ZonePlannerBoundary><section className="camera-zone-planner" aria-labelledby="zone-planner-title"><header><div><span>ZONE BOUNDARY</span><strong id="zone-planner-title">Plot the area on the site map.</strong></div><b className={zoneBoundary.length >= 3 ? "ready" : ""}>{zoneBoundary.length} {zoneBoundary.length === 1 ? "point" : "points"}</b></header><div className="camera-zone-map" ref={mapSurface} onClick={placeZonePoint} onPointerMove={moveZonePoint} onPointerUp={() => setDraggingPoint(null)} aria-label="Site map. Click to plot the zone boundary."><div className="camera-zone-map-art" /><div className="camera-zone-map-toolbar"><span>DRAW BOUNDARY</span><button type="button" onClick={(event) => { event.stopPropagation(); setZoneBoundary((points) => points.slice(0, -1)); }} disabled={!zoneBoundary.length}>Undo</button><button type="button" onClick={(event) => { event.stopPropagation(); setZoneBoundary([]); }} disabled={!zoneBoundary.length}>Clear</button></div><svg className="camera-zone-boundary" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{zoneBoundary.length >= 3 && <polygon points={zoneBoundary.map((point) => `${point.x},${point.y}`).join(" ")} />}{zoneBoundary.length >= 2 && <polyline points={zoneBoundary.map((point) => `${point.x},${point.y}`).join(" ")} />}</svg>{zoneBoundary.map((point, index) => <button type="button" className={`camera-zone-vertex ${index === zoneBoundary.length - 1 ? "latest" : ""}`} key={`${point.x}-${point.y}-${index}`} style={{ left: `${point.x}%`, top: `${point.y}%` }} aria-label={`Boundary point ${index + 1}. Drag to adjust.`} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); mapSurface.current?.setPointerCapture(event.pointerId); setDraggingPoint(index); }} />)}<p className="camera-zone-map-instruction">Click to place points · Drag points to refine · Plot at least 3 points</p></div><div className="camera-zone-readout"><div><span>LAST POINT</span><strong>{latitude}</strong><small>{longitude}</small></div><div><span>BOUNDARY STATUS</span><strong>{zoneBoundary.length >= 3 ? "Ready to save" : "Keep plotting"}</strong><small>{zoneBoundary.length >= 3 ? "Area is outlined" : `${Math.max(0, 3 - zoneBoundary.length)} more point${3 - zoneBoundary.length === 1 ? "" : "s"} needed`}</small></div></div></section></ZonePlannerBoundary></>}</section>
          <section className="camera-modal-section camera-modal-details"><span className="camera-modal-step">02 / CAMERA DETAILS</span><div className="camera-modal-fields"><label>Camera ID<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} minLength={2} required /></label><label>Display name<input value={name} onChange={(event) => setName(event.target.value)} minLength={2} required /></label></div><label>Camera coverage<select value={coverage} onChange={(event) => setCoverage(event.target.value)}><option>Area overview</option><option>Entrance / exit</option><option>Walkway / stairway</option><option>Waste point</option></select><small className="camera-coverage-hint">Helps supervisors understand what this view is intended to cover.</small></label></section></div>
        {message && <p className="camera-modal-error" role="alert">{message}</p>}
        <footer><p>{zoneMode === "new" ? "Draw at least three points to outline the new zone. The plotted boundary is shown here for frontend review." : "Detection areas and bin regions can be calibrated after the camera is created."}</p><div><button type="button" className="outline-button" onClick={onClose}>Cancel</button><button type="submit" className="primary" disabled={saving || (zoneMode === "existing" ? !zoneId : !activeSite || zoneName.trim().length < 2 || zoneBoundary.length < 3)}>{saving ? "Adding camera…" : zoneMode === "new" ? "Save zone & camera →" : "Add camera →"}</button></div></footer>
      </form>
    </div>
  </div>;
}

export function CameraOperationsPage({ readOnly = false, allowWorkActions = false, canManageCameraPlacement, sites, zones, cameras, feeds, liveVideos, alerts, cleaners, error, onCreateZone, onCreateCamera, onStartCreation, onDismissCameraWork, v2Cameras = [] }: Props) {
  const activeCameras = cameras.filter((camera) => camera.status === "active");
  const initialQuery = new URLSearchParams(location.hash.split("?")[1] ?? "");
  const [zoneId, setZoneId] = useState(initialQuery.get("zoneId") ?? "all");
  const [selectedId, setSelectedId] = useState<string | undefined>(initialQuery.get("cameraId") ?? undefined);
  const [createdId, setCreatedId] = useState<string | undefined>(initialQuery.get("created") === "1" ? initialQuery.get("cameraId") ?? undefined : undefined);
  const [gridView, setGridView] = useState<"3x2" | "2x3" | "1x6">("3x2");
  const [showAdd, setShowAdd] = useState(false);
  const [detail, setDetail] = useState<V2CameraDetail>();
  const [detailError, setDetailError] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [showCancel, setShowCancel] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const filterRail = useRef<HTMLElement>(null);
  const supervision = initialQuery.get("workId") ? { id: initialQuery.get("workId")!, issue: initialQuery.get("workIssue") ?? "Cleaning task", status: initialQuery.get("workStatus") ?? "Assigned", priority: initialQuery.get("workPriority") ?? "Medium", cleaner: initialQuery.get("workCleaner") ?? "", updated: initialQuery.get("workUpdated") ?? "" } : undefined;
  const nextNumber = Math.max(0, ...cameras.map((camera) => Number(camera.code.match(/\d+$/)?.[0] ?? 0))) + 1;
  const filtered = activeCameras.filter((camera) => zoneId === "all" || camera.zoneId === zoneId);
  const selected = cameras.find((camera) => camera.id === selectedId || camera.code === selectedId || camera.name === selectedId || camera.name === initialQuery.get("cameraName"));
  const selectedV2Camera = v2Cameras.find((camera) => camera.id === selected?.id);
  const selectedAlerts = selected ? cameraAlerts(selected, alerts) : [];
  const selectedCleaner = cleaners.find((cleaner) => cleaner.assignedZoneId === selected?.zoneId && cleaner.status === "active") ?? cleaners.find((cleaner) => cleaner.assignedZoneId === selected?.zoneId);
  const selectedFeed = selected ? feeds.find((feed) => feed.id === selected.id || feed.id === selected.code || feed.name === selected.name) : undefined;
  const selectedVideo = selected ? liveVideos.find((video) => video.cameraId === selected.id || video.cameraId === selected.code) : undefined;
  const zoneOptions = useMemo(() => zones.filter((zone) => activeCameras.some((camera) => camera.zoneId === zone.id)), [activeCameras, zones]);
  const gridColumns = gridView === "3x2" ? 3 : gridView === "2x3" ? 2 : 1;
  const currentWorkOrder = selectedAlerts[0] ? `WO-${String(selectedAlerts[0].id).replace(/\D/g, "").padStart(4, "0")}` : undefined;
  const currentAssignment = detail?.currentAssignments[0];

  useEffect(() => {
    const syncQuery = () => {
      const query = new URLSearchParams(location.hash.split("?")[1] ?? "");
      setSelectedId(query.get("cameraId") ?? undefined);
      setZoneId(query.get("zoneId") ?? "all");
      setCreatedId(query.get("created") === "1" ? query.get("cameraId") ?? undefined : undefined);
    };
    addEventListener("hashchange", syncQuery);
    return () => removeEventListener("hashchange", syncQuery);
  }, []);

  useEffect(() => {
    if (!selectedId) { setDetail(undefined); return; }
    const controller = new AbortController();
    setDetailError("");
    void getV2CameraDetail(selectedId, controller.signal).then(setDetail).catch((reason) => setDetailError(reason instanceof Error ? reason.message : "Camera detail could not load."));
    return () => controller.abort();
  }, [selectedId]);

  const openCamera = (camera: CameraRecord, created = false) => {
    setSelectedId(camera.id);
    setZoneId(camera.zoneId);
    if (created) setCreatedId(camera.id);
    location.hash = `/cameras?cameraId=${encodeURIComponent(camera.id)}&zoneId=${encodeURIComponent(camera.zoneId)}${created ? "&created=1" : ""}`;
  };

  if (selected) return <section className={`camera-detail-page camera-reference-detail ${createdId === selected.id ? "camera-created" : ""}`}>
    <header className="camera-reference-heading"><button type="button" onClick={() => { setSelectedId(undefined); setCreatedId(undefined); location.hash = `/cameras?zoneId=${encodeURIComponent(zoneId)}`; }}>← Back to all cameras</button><span>{selected.code} · selected view</span></header>
    {createdId === selected.id && <div className="camera-created-banner"><b>Camera added</b><span>This new view is ready for registration and calibration.</span><button type="button" onClick={() => setCreatedId(undefined)}>Dismiss</button></div>}
    <div className="camera-reference-layout"><section className="camera-reference-visual"><CameraPreview record={selected} feed={selectedFeed} video={selectedVideo} latestAlert={selectedAlerts[0]} monitoringCamera={selectedV2Camera} mode="detail" /><footer><div><h1>{selected.name}</h1><p>{selected.zoneName} · {selected.sourceMode === "stream" ? "Live camera feed" : "Uploaded camera frame"}</p></div><p>All imagery is synthetic demonstration evidence. No identity recognition is performed.</p></footer></section>
      <aside className="camera-reference-sidebar"><section className="camera-reference-info"><header><span>CAMERA INFORMATION</span><b className={selected.availability === "unavailable" ? "offline" : "online"}><i />{selected.availability === "unavailable" ? "Offline" : "Online"}</b></header><dl><div><dt>Camera name</dt><dd>{selected.code}</dd></div><div><dt>Zone</dt><dd>{selected.zoneName}</dd></div><div><dt>Source</dt><dd>{selected.sourceMode === "stream" ? "Live stream" : "Uploaded frame"}</dd></div><div><dt>Frame freshness</dt><dd>{selectedVideo ? when(selectedVideo.uploadedAt) : "Not reported"}</dd></div></dl></section>
        <section className="camera-reference-assignment"><header><span>CURRENT ASSIGNMENT</span><h2>{currentAssignment ? `${currentAssignment.id.slice(0, 10)} · ${currentAssignment.title}` : "No active Work Order"}</h2></header>{currentAssignment ? <><div className="camera-supervision-meta"><span className={`work-priority ${currentAssignment.severity}`}>{currentAssignment.severity}</span><span className={`work-record-status ${currentAssignment.status}`}>{currentAssignment.status.replaceAll("_", " ")}</span></div><p><i aria-hidden="true" /><strong>{currentAssignment.cleanerNameSnapshot}</strong><span>{currentAssignment.managementMode === "orchestrated" ? "System assignment in progress" : "Supervisor-created Work in progress"}</span></p><small className="camera-supervision-note">{currentAssignment.managementMode === "orchestrated" ? "The system selected this response. You may cancel it if a Supervisor intervention is required." : "The Cleaner updates progress. Resolve or rework becomes available after Cleaner submission."}</small>{allowWorkActions && <CameraWorkCancel workId={currentAssignment.id} disabled={false} onDismiss={onDismissCameraWork} />}<button type="button" onClick={() => { location.hash = `/history?workId=${encodeURIComponent(currentAssignment.id)}`; }}>Open Work detail <b>→</b></button></> : <p className="camera-reference-empty">No active cleaning assignment.</p>}</section>
        <section className="camera-reference-history"><header><span>RECENT HISTORY</span><button type="button" onClick={() => { location.hash = `/history?camera=${encodeURIComponent(selected.code)}`; }}>View all →</button></header><div className="camera-history-thumbnails" aria-label="Recent evidence thumbnails">{detail?.recentHistory.filter((entry) => entry.snapshot).slice(0, 5).map((entry) => <button type="button" key={entry.id} onClick={() => entry.type === "alert" && (location.hash = `/alerts?alert=${entry.id}`)}><ProtectedSnapshot snapshot={entry.snapshot} alt={`${entry.issueType} snapshot`} /><i className={entry.severity} /></button>)}</div><ol>{detail?.recentHistory.slice(0, 5).map((entry) => <li key={`${entry.type}-${entry.id}`}><time>{entry.occurredAt ? new Date(entry.occurredAt).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "Not recorded"}</time><p><strong>{alertLabel(entry.issueType)}</strong><span>{entry.type === "work" && entry.assignedCleanerName ? `${entry.status} · ${entry.assignedCleanerName}` : entry.status}</span></p></li>)}{!detail?.recentHistory.length && <li className="empty"><p><strong>No recent history</strong><span>Camera events will appear here.</span></p></li>}</ol></section><section className="camera-reference-history camera-orchestrator-trace"><header><span>SYSTEM LOG</span><button type="button" onClick={() => { location.hash = "/status"; }}>Open System →</button></header>{detail?.orchestratorTrace.length ? <ol>{detail.orchestratorTrace.map((run) => <li key={run.id}><time>{run.completedAt ? new Date(run.completedAt).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "Running"}</time><p><strong>{run.type === "assignment" ? "Assignment decision" : "Review decision"}</strong><span>{run.decisionSummary ?? run.resultCode ?? run.status}</span></p></li>)}</ol> : <p className="camera-reference-empty">No system decision is linked to this Camera history.</p>}{detailError && <p className="camera-reference-empty">{detailError}</p>}</section></aside>
    </div>
  </section>;

  return <section className="ops-page camera-operations-page">
    <header className="camera-wall-header"><div><span>CAMERAS · LIVE OPERATIONS</span><h1>See every zone.<br />Open the evidence.</h1><p>Monitor registered camera views, then select one to inspect its alerts, assigned Cleaner, and recent history.</p></div>{canManageCameraPlacement && <button className="camera-add-button" type="button" onClick={onStartCreation ?? (() => setShowAdd(true))}><span>+</span>Add camera</button>}</header>{readOnly && !onStartCreation && <p className="profile-feedback">Read-only V2 Camera data. Camera creation and monitoring begin in Phase 12.5 and 12.6.</p>}
    {error && <p className="profile-feedback" role="alert">{error}</p>}
    <div className="camera-zone-slider">
      <button type="button" aria-label="Previous zones" onClick={() => filterRail.current?.scrollBy({ left: -320, behavior: "smooth" })}>←</button>
      <nav className="camera-zone-filter" aria-label="Filter cameras by zone" ref={filterRail}>
        <button className={zoneId === "all" ? "active" : ""} aria-pressed={zoneId === "all"} onClick={() => { setZoneId("all"); location.hash = "/cameras"; }}>
          <span>All zones</span><b>{activeCameras.length}</b>{zoneId === "all" && <i className="camera-zone-check" aria-hidden="true">✓</i>}
        </button>
        {zoneOptions.map((zone) => {
          const signal = zoneSignal(zone, activeCameras, alerts);
          return <button className={zoneId === zone.id ? "active" : ""} aria-pressed={zoneId === zone.id} key={zone.id} title={signal.label} onClick={() => { setZoneId(zone.id); location.hash = `/cameras?zoneId=${encodeURIComponent(zone.id)}`; }}>
            <span>{zone.name}</span><b>{activeCameras.filter((camera) => camera.zoneId === zone.id).length}</b><i className={`camera-zone-signal ${signal.tone}`} aria-hidden="true" />{zoneId === zone.id && <i className="camera-zone-check" aria-hidden="true">✓</i>}
          </button>;
        })}
      </nav>
      <button type="button" aria-label="Next zones" onClick={() => filterRail.current?.scrollBy({ left: 320, behavior: "smooth" })}>→</button>
    </div>
    <div className="camera-wall-summary"><p><i />{activeCameras.filter((camera) => camera.availability !== "unavailable").length} available</p><p>{alerts.filter((alert) => alert.status === "active").length} unresolved alerts</p><p>{zoneId === "all" ? "Showing all registered zones" : `Filtered to ${zones.find((zone) => zone.id === zoneId)?.name ?? "selected zone"}`}</p></div>
    <div className="camera-grid-toolbar atlas-camera-grid-toolbar"><span>Camera grid</span><div className="grid-view-switcher" role="group" aria-label="Choose camera grid layout">{([["1x6", "Single column", 1], ["2x3", "Two columns", 2], ["3x2", "Three columns", 6]] as const).map(([value, gridLabel, cells]) => <button className={gridView === value ? "active" : ""} aria-label={gridLabel} title={gridLabel} aria-pressed={gridView === value} key={value} onClick={() => setGridView(value)}><span className={`grid-view-icon cells-${cells}`} aria-hidden="true">{Array.from({ length: cells }, (_, index) => <i key={index} />)}</span></button>)}</div></div>
    <section className="camera-wall-grid" aria-label="Camera views" style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}>{filtered.map((record) => { const cameraFeed = feeds.find((feed) => feed.id === record.id || feed.id === record.code || feed.name === record.name); const video = liveVideos.find((item) => item.cameraId === record.id || item.cameraId === record.code); const related = cameraAlerts(record, alerts); const monitored = v2Cameras.find((camera) => camera.id === record.id); const open = related.filter((alert) => !["resolved", "dismissed"].includes(alert.status)); const status = record.availability === "unavailable" ? { label: "Offline", tone: "offline" } : open.some((alert) => alert.severity === "critical") ? { label: "Action", tone: "action" } : open.length ? { label: "Watch", tone: "watch" } : { label: "Clear", tone: "clear" }; return <button type="button" className="camera-wall-card" key={record.id} onClick={() => openCamera(record)}><CameraPreview record={record} feed={cameraFeed} video={video} latestAlert={related[0]} monitoringCamera={monitored} /><footer><div><strong>{record.name}</strong><span>{record.code} · {record.zoneName}</span></div><b className={`camera-card-status ${status.tone}`}><i />{status.label}</b></footer></button>; })}{!filtered.length && <div className="camera-wall-empty"><span>NO CAMERAS IN THIS ZONE</span><p>{!readOnly && canManageCameraPlacement ? "Add a camera or choose another registered zone." : "Choose another registered zone."}</p>{!readOnly && canManageCameraPlacement && <button type="button" onClick={() => setShowAdd(true)}>+ Add camera</button>}</div>}</section>
    {!readOnly && canManageCameraPlacement && showAdd && <AddCameraModal sites={sites} zones={zones} nextNumber={nextNumber} onClose={() => setShowAdd(false)} onCreated={(camera) => openCamera(camera, true)} onCreateZone={onCreateZone} onCreateCamera={onCreateCamera} />}
  </section>;
}
