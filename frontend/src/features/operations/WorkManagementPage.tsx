import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";
import type { Cleaner } from "../../services/cleanerAPI";
import type { CameraRecord, Zone } from "../../services/locationAPI";
import type { Alert } from "./types";
import type { V2OperationsReadModel, V2Point, V2WorkOrder } from "../../services/v2/operations";
import { loadAuthenticatedMedia, releaseAuthenticatedMedia } from "../../services/v2/media";
import { clampWorkPoint, workPointFromFraction, workZoneAtPoint, workZoneCentroid } from "./workTargetMap";
import "./work-create-map-v2.css";

type Point = { x: number; y: number };
type WorkStatus = "Assigned" | "In Progress" | "Awaiting Review" | "Resolved" | "Dismissed";
type WorkOrigin = "ai" | "manual";
type WorkAction = "reassign" | "takeover" | "dismiss" | "verify" | "override";
type ManualWorkTarget = { type: "camera"; cameraId: string } | { type: "coordinate"; point: V2Point };
type ManualWorkInput = { title: string; instructions: string; severity: "warning" | "critical"; assignedCleanerId: string; target: ManualWorkTarget };
type WorkSiteMap = V2OperationsReadModel["siteMap"];
type WorkCameraOption = { id: string; name: string; point: V2Point; zoneId: string; zoneName: string };
export type WorkItem = {
  id: string; origin: WorkOrigin; issue: string; description: string; zoneId?: string; zoneName: string;
  cleanerId?: string; status: WorkStatus; priority: "Low" | "Medium" | "High"; createdAt: string; updatedAt: string;
  point?: Point; cameraId?: string; cameraName?: string; alertId?: string; managementMode?: string; verificationOutcome?: string | null; evidenceAvailable?: boolean; evidenceMediaId?: string; detectionTime?: string;
};

const anchors = [{ x: 13, y: 18 }, { x: 8, y: 72 }, { x: 64, y: 16 }, { x: 40, y: 44 }, { x: 60, y: 70 }, { x: 82, y: 72 }, { x: 23, y: 40 }, { x: 83, y: 40 }];
const statusOptions: WorkStatus[] = ["Assigned", "In Progress", "Awaiting Review", "Resolved", "Dismissed"];

function anchorFor(zone: Zone, index: number): Point {
  const name = zone.name.toLowerCase();
  if (name.includes("main") || name.includes("entrance")) return anchors[0];
  if (name.includes("lower") && name.includes("stair")) return anchors[1];
  if (name.includes("upper") && name.includes("stair")) return anchors[2];
  if (name.includes("temple") || name.includes("courtyard")) return anchors[3];
  if (name.includes("food") || name.includes("vendor")) return anchors[4];
  if (name.includes("car") || name.includes("park")) return anchors[5];
  return anchors[index % anchors.length];
}

function title(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function clock(value: string) { return new Date(value).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
function statusClass(value: WorkStatus) { return value.toLowerCase().replaceAll(" ", "-"); }
function scenarioLabel(work: Pick<WorkItem, "origin" | "cameraId">) { return work.origin === "ai" ? "Automated · Camera" : work.cameraId ? "Manual · Camera" : "Manual · Map point"; }
function nextAction(work: Pick<WorkItem, "status" | "managementMode">) {
  if (work.status === "Assigned") return "Cleaner to start";
  if (work.status === "In Progress") return "Cleaner working";
  if (work.status === "Awaiting Review") return work.managementMode === "orchestrated" ? "System reviewing" : "Supervisor review";
  if (work.status === "Resolved") return "Completed";
  return "No further action";
}
function relativeActivity(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return "Updated just now";
  if (elapsed < 3_600_000) return `Updated ${Math.floor(elapsed / 60_000)} min ago`;
  if (elapsed < 86_400_000) return `Updated ${Math.floor(elapsed / 3_600_000)} hr ago`;
  return `Updated ${clock(value)}`;
}
function workMapBackgroundStyle(siteMap: WorkSiteMap, backgroundUrl?: string): CSSProperties | undefined {
  if (!backgroundUrl) return undefined;
  const transform = siteMap.revision.backgroundTransform ?? {};
  const x = Number(transform.xMeters ?? 0); const y = Number(transform.yMeters ?? 0);
  const width = Number(transform.widthMeters ?? siteMap.revision.widthMeters); const height = Number(transform.heightMeters ?? siteMap.revision.heightMeters);
  return { left: `${x / siteMap.revision.widthMeters * 100}%`, top: `${y / siteMap.revision.heightMeters * 100}%`, width: `${width / siteMap.revision.widthMeters * 100}%`, height: `${height / siteMap.revision.heightMeters * 100}%`, opacity: Number(transform.opacity ?? 1), backgroundImage: `url(${JSON.stringify(backgroundUrl)})` };
}

function WorkTargetMap({ siteMap, point, cameras, selectedCameraId, mode, backgroundUrl, onPoint, onCamera, readOnly = false }: { siteMap: WorkSiteMap; point: V2Point | null; cameras: WorkCameraOption[]; selectedCameraId: string; mode: "coordinate" | "camera"; backgroundUrl?: string; onPoint: (point: V2Point) => void; onCamera: (cameraId: string) => void; readOnly?: boolean }) {
  const size = siteMap.revision;
  const percentage = (value: V2Point) => ({ left: `${value.xMeters / size.widthMeters * 100}%`, top: `${value.yMeters / size.heightMeters * 100}%` });
  const updateFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (readOnly || mode !== "coordinate") return;
    const rect = event.currentTarget.getBoundingClientRect();
    onPoint(workPointFromFraction((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height, size));
  };
  const moveWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (readOnly || mode !== "coordinate" || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const current = point ?? { xMeters: size.widthMeters / 2, yMeters: size.heightMeters / 2 };
    const step = Math.max(.25, Number(size.gridSizeMeters || 1));
    onPoint(clampWorkPoint({ xMeters: current.xMeters + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0), yMeters: current.yMeters + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0) }, size));
  };
  return <div className={`work-target-map-v2 ${mode} ${readOnly ? "read-only" : ""}`} onPointerDown={(event) => { if (readOnly || mode !== "coordinate") return; event.currentTarget.setPointerCapture(event.pointerId); updateFromPointer(event); }} onPointerMove={(event) => { if (!readOnly && mode === "coordinate" && event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event); }} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onKeyDown={moveWithKeyboard} role={readOnly ? "img" : mode === "coordinate" ? "application" : "group"} tabIndex={!readOnly && mode === "coordinate" ? 0 : undefined} aria-label={readOnly ? `Selected Manual Work point in ${point ? workZoneAtPoint(point, siteMap.zones)?.zoneNameSnapshot ?? "Unzoned area" : "the Site Map"}` : mode === "coordinate" ? "Active Site Map. Click or use arrow keys to place the Manual Work point." : "Active Site Map. Select a registered Camera as the Manual Work point."}>
    <div className={`work-target-map-background ${backgroundUrl ? "has-image" : ""}`} style={workMapBackgroundStyle(siteMap, backgroundUrl)} />
    <svg viewBox={`0 0 ${size.widthMeters} ${size.heightMeters}`} preserveAspectRatio="none" aria-hidden="true">{siteMap.zones.map((zone) => <polygon className={point && workZoneAtPoint(point, siteMap.zones)?.id === zone.id ? "selected" : ""} key={zone.id} points={zone.polygon.map((vertex) => `${vertex.xMeters},${vertex.yMeters}`).join(" ")} />)}</svg>
    {siteMap.zones.map((zone) => { const centroid = workZoneCentroid(zone); return <span className="work-target-zone-label" key={zone.id} style={percentage(centroid)}>{zone.zoneNameSnapshot}</span>; })}
    {cameras.map((camera) => mode === "camera" ? <button type="button" className={`work-target-camera ${selectedCameraId === camera.id ? "selected" : ""}`} key={camera.id} style={percentage(camera.point)} onPointerDown={(event) => event.stopPropagation()} onClick={() => onCamera(camera.id)} aria-label={`Use ${camera.name} as the Work point`}><i /><span>{camera.name}</span></button> : <span className="work-target-camera muted" key={camera.id} style={percentage(camera.point)} aria-hidden="true"><i /></span>)}
    {point && mode === "coordinate" && <span className="work-target-pin" style={percentage(point)}><i /><b>Work point</b></span>}
    <span className="work-target-map-hint">{readOnly ? "Selected Work point" : mode === "coordinate" ? "Click anywhere or use arrow keys to place the Work point" : "Select a Camera from the map or list"}</span>
  </div>;
}

function ProtectedWorkEvidence({ mediaId, alt }: { mediaId?: string; alt: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!mediaId) { setUrl(undefined); return; }
    const key = `work-evidence:${mediaId}`;
    const controller = new AbortController();
    void loadAuthenticatedMedia(key, `/api/media/${encodeURIComponent(mediaId)}/content`, controller.signal).then(setUrl).catch(() => {
      if (!controller.signal.aborted) setUrl(undefined);
    });
    return () => { controller.abort(); releaseAuthenticatedMedia(key); };
  }, [mediaId]);
  return url ? <img src={url} alt={alt} /> : <div className="work-evidence-waiting"><strong>Loading submitted evidence…</strong><small>The protected completion image is being retrieved.</small></div>;
}

function WorkCreateModal({ siteMap, cleaners, cameras, availableCleanerIds, onClose, onCreate }: { siteMap: WorkSiteMap; cleaners: Cleaner[]; cameras: WorkCameraOption[]; availableCleanerIds: Set<string>; onClose: () => void; onCreate: (input: ManualWorkInput) => Promise<void> }) {
  const activeCleaners = cleaners.filter((cleaner) => availableCleanerIds.has(cleaner.id));
  const [issue, setIssue] = useState("General clean-up");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<"warning" | "critical">("warning");
  const [targetMode, setTargetMode] = useState<"coordinate" | "camera">("coordinate");
  const [coordinatePoint, setCoordinatePoint] = useState<V2Point | null>(null);
  const [cleanerId, setCleanerId] = useState("");
  const [cameraId, setCameraId] = useState("");
  const [cleanerQuery, setCleanerQuery] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [backgroundUrl, setBackgroundUrl] = useState<string>();
  const selectedCamera = cameras.find((camera) => camera.id === cameraId);
  const point = targetMode === "camera" ? selectedCamera?.point ?? null : coordinatePoint;
  const selectedZone = point ? workZoneAtPoint(point, siteMap.zones) : null;
  const locationName = targetMode === "camera" ? selectedCamera?.zoneName ?? "Choose a Camera" : point ? selectedZone?.zoneNameSnapshot ?? "Unzoned area" : "Place the Work point";
  const visibleCleaners = activeCleaners.filter((cleaner) => cleaner.fullName.toLowerCase().includes(cleanerQuery.toLowerCase()) || cleaner.staffCode.toLowerCase().includes(cleanerQuery.toLowerCase()));

  useEffect(() => {
    const mediaId = siteMap.revision.backgroundMediaId;
    if (!mediaId) { setBackgroundUrl(undefined); return; }
    const key = `manual-work-map:${siteMap.activeRevisionId}`;
    const controller = new AbortController();
    void loadAuthenticatedMedia(key, `/api/media/${encodeURIComponent(mediaId)}/content`, controller.signal).then(setBackgroundUrl).catch(() => setBackgroundUrl(undefined));
    return () => { controller.abort(); releaseAuthenticatedMedia(key); };
  }, [siteMap.activeRevisionId, siteMap.revision.backgroundMediaId]);

  useEffect(() => {
    const close = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape" && !pending) onClose(); };
    addEventListener("keydown", close);
    return () => removeEventListener("keydown", close);
  }, [onClose, pending]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!description.trim()) { setError("Add instructions before creating the Manual Work Order."); return; }
    if (!cleanerId) { setError("Select one available Cleaner for this Manual Work Order."); return; }
    if (targetMode === "coordinate" && !coordinatePoint) { setError("Place the Work point on the Site Map."); return; }
    if (targetMode === "camera" && !selectedCamera) { setError("Select one registered Camera as the Work point."); return; }
    const target: ManualWorkTarget = targetMode === "camera" ? { type: "camera", cameraId: selectedCamera!.id } : { type: "coordinate", point: coordinatePoint! };
    setPending(true); setError("");
    try { await onCreate({ title: issue, instructions: description.trim(), severity, assignedCleanerId: cleanerId, target }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The Work Order could not be created."); }
    finally { setPending(false); }
  }

  return <div className="work-modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}><form className="work-create-modal" onSubmit={submit} aria-busy={pending}>
    <header><div><span>MANUAL WORK</span><h2>Create a Work Order.</h2><p>Choose a free map point or tie the Work to a registered Camera.</p></div><button type="button" onClick={onClose} aria-label="Close Manual Work Order" disabled={pending}>×</button></header>
    <div className="work-create-body">
      <section className="work-create-fields"><label>Work / issue type<select value={issue} disabled={pending} onChange={(event) => setIssue(event.target.value)}><option>General clean-up</option><option>Floor litter</option><option>Floor spill</option><option>Bin service</option><option>Inspection</option></select></label><label>Severity<select value={severity} disabled={pending} onChange={(event) => setSeverity(event.target.value as "warning" | "critical")}><option value="warning">Warning</option><option value="critical">Critical</option></select></label><label className="wide">Description / instruction<textarea value={description} disabled={pending} maxLength={1000} onChange={(event) => { setDescription(event.target.value); setError(""); }} placeholder="Describe the work the Cleaner needs to complete" /></label><div className="work-evidence-rule wide"><span>COMPLETION EVIDENCE</span><strong>1 Cleaner photo required</strong><small>The Supervisor reviews the submitted photo for both target types.</small></div></section>
      <section className="work-create-location"><header><div><span>WORK TARGET</span><strong>{locationName}</strong></div><div className="work-target-mode" role="group" aria-label="Choose Manual Work target type"><button type="button" className={targetMode === "coordinate" ? "active" : ""} aria-pressed={targetMode === "coordinate"} disabled={pending} onClick={() => { setTargetMode("coordinate"); setError(""); }}>Map point</button><button type="button" className={targetMode === "camera" ? "active" : ""} aria-pressed={targetMode === "camera"} disabled={pending || !cameras.length} onClick={() => { setTargetMode("camera"); setError(""); }}>Camera</button></div></header>
        {targetMode === "camera" && <label className="work-target-camera-select">Registered Camera<select value={cameraId} disabled={pending} onChange={(event) => { setCameraId(event.target.value); setError(""); }}><option value="">Select a Camera</option>{cameras.map((camera) => <option value={camera.id} key={camera.id}>{camera.name} · {camera.zoneName}</option>)}</select></label>}
        <WorkTargetMap siteMap={siteMap} point={point} cameras={cameras} selectedCameraId={cameraId} mode={targetMode} backgroundUrl={backgroundUrl} onPoint={(next) => { setCoordinatePoint(next); setError(""); }} onCamera={(nextId) => { setCameraId(nextId); setError(""); }} />
        <div className="work-target-readout"><div><span>LOCATION</span><strong>{locationName}</strong><small>{targetMode === "camera" ? selectedCamera?.name ?? "No Camera selected" : selectedZone ? "Inside active Zone" : point ? "Outside active Zones" : "Waiting for map point"}</small></div><div><span>COORDINATES</span><strong>{point ? `X ${point.xMeters.toFixed(1)} m` : "Not selected"}</strong><small>{point ? `Y ${point.yMeters.toFixed(1)} m` : `Map ${siteMap.revision.widthMeters} × ${siteMap.revision.heightMeters} m`}</small></div></div>
      </section>
      <section className="work-create-cleaner"><header><div><span>ASSIGN CLEANER</span><strong>{cleanerId ? activeCleaners.find((cleaner) => cleaner.id === cleanerId)?.fullName ?? "Cleaner selected" : "Required at creation"}</strong></div><input value={cleanerQuery} disabled={pending} onChange={(event) => setCleanerQuery(event.target.value)} placeholder="Search available Cleaners" /></header><div>{visibleCleaners.map((cleaner) => <button type="button" disabled={pending} key={cleaner.id} className={cleanerId === cleaner.id ? "selected" : ""} onClick={() => { setCleanerId(cleanerId === cleaner.id ? "" : cleaner.id); setError(""); }}><i>{initials(cleaner.fullName)}</i><span><b>{cleaner.fullName}</b><small>{cleaner.staffCode} · {cleaner.assignedZoneName}</small></span>{cleanerId === cleaner.id && <em>✓</em>}</button>)}{!visibleCleaners.length && <p>{activeCleaners.length ? "No available Cleaners match this search." : "No Cleaner is currently available for assignment."}</p>}</div></section>
    </div>
    {error && <p className="work-create-error" role="alert">{error}</p>}<footer><p>The selected Cleaner receives this Work immediately and must submit one completion photo for Supervisor review.</p><div><button type="button" onClick={onClose} disabled={pending}>Cancel</button><button type="submit" disabled={pending}>{pending ? "Creating…" : "Create Work Order →"}</button></div></footer>
  </form></div>;
}

function WorkDetailDrawer({ work, siteMap, cleaners, availableCleanerIds, onClose, onAction, readOnly = false }: { work: WorkItem; siteMap: WorkSiteMap; cleaners: Cleaner[]; availableCleanerIds: Set<string>; onClose: () => void; onAction?: (action: WorkAction, options: { cleanerId?: string; reason: string; outcome?: "passed" | "failed" | "inconclusive" }) => Promise<void>; readOnly?: boolean }) {
  const [query, setQuery] = useState("");
  const [selectedCleanerId, setSelectedCleanerId] = useState("");
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState<"passed" | "failed" | "inconclusive">("passed");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [mapBackgroundUrl, setMapBackgroundUrl] = useState<string>();
  const activeCleaners = cleaners.filter((cleaner) => availableCleanerIds.has(cleaner.id) && `${cleaner.fullName} ${cleaner.staffCode}`.toLowerCase().includes(query.toLowerCase()));
  const cleaner = cleaners.find((item) => item.id === work.cleanerId);
  const mapZone = siteMap.zones.find((item) => item.id === work.zoneId);
  const fallbackPoint = mapZone ? workZoneCentroid(mapZone) : { xMeters: siteMap.revision.widthMeters / 2, yMeters: siteMap.revision.heightMeters / 2 };
  const mapPoint = work.point ? { xMeters: work.point.x, yMeters: work.point.y } : fallbackPoint;
  const point = { x: mapPoint.xMeters, y: mapPoint.yMeters };
  useEffect(() => {
    if (work.cameraId || !siteMap.revision.backgroundMediaId) { setMapBackgroundUrl(undefined); return; }
    const mediaId = siteMap.revision.backgroundMediaId;
    const key = `manual-work-detail-map:${siteMap.activeRevisionId}`;
    const controller = new AbortController();
    void loadAuthenticatedMedia(key, `/api/media/${encodeURIComponent(mediaId)}/content`, controller.signal).then(setMapBackgroundUrl).catch(() => setMapBackgroundUrl(undefined));
    return () => { controller.abort(); releaseAuthenticatedMedia(key); };
  }, [siteMap.activeRevisionId, siteMap.revision.backgroundMediaId, work.cameraId]);
  const runAction = (action: WorkAction, actionOutcome?: "passed" | "failed" | "inconclusive") => {
    if (!onAction || !reason.trim()) return;
    setPending(true);
    setMessage("");
    void onAction(action, { reason: reason.trim(), outcome: actionOutcome }).then(() => setCancelling(false)).catch((error) => setMessage(error instanceof Error ? error.message : "The Work action failed.")).finally(() => setPending(false));
  };
  if (!work.cameraId) return <div className="work-detail-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="work-detail-drawer work-proof-modal" role="dialog" aria-modal="true" aria-label={`Manual cleanup proof for ${work.id}`}>
    <header><div><span>MANUAL CLEANUP PROOF</span><h2>{work.id.slice(0, 12)} · {work.issue}</h2></div><div className="work-proof-header-actions"><span className={`work-record-status ${statusClass(work.status)}`}>{work.status}</span><button type="button" onClick={onClose} aria-label="Close Manual Cleanup Proof">×</button></div></header>
    <div className="work-proof-layout">
      <section className="work-proof-main">
        <div className={`work-proof-visual ${work.evidenceAvailable ? "submitted" : "waiting"}`}>
          {work.evidenceAvailable ? <><ProtectedWorkEvidence mediaId={work.evidenceMediaId} alt={`Completion evidence submitted for ${work.issue}`} /><span>COMPLETION EVIDENCE · 1 PHOTO</span><time>{clock(work.updatedAt)}</time></> : <div className="work-evidence-waiting"><strong>Waiting for evidence…</strong><small>The Cleaner must submit one completion photo before this Manual Work can be reviewed.</small></div>}
        </div>
        <div className="work-proof-context"><span>WORK LOCATION</span><strong>{work.zoneName}</strong><small>Site coordinate · X {point.x.toFixed(1)}, Y {point.y.toFixed(1)}</small><WorkTargetMap siteMap={siteMap} point={mapPoint} cameras={[]} selectedCameraId="" mode="coordinate" backgroundUrl={mapBackgroundUrl} onPoint={() => undefined} onCamera={() => undefined} readOnly /></div>
      </section>
      <aside className="work-proof-sidebar">
        <section className="work-proof-cleaner"><span>ASSIGNED CLEANER</span><strong>{cleaner?.fullName ?? "No Cleaner assigned"}</strong><dl><div><dt>Target</dt><dd>{work.zoneName}</dd></div><div><dt>Submitted</dt><dd>{work.evidenceAvailable ? clock(work.updatedAt) : "Waiting for evidence"}</dd></div></dl></section>
        {!readOnly && !["Resolved", "Dismissed"].includes(work.status) && <section className="work-proof-actions"><span>REVIEW ACTION</span><label><b>Supervisor note</b><textarea value={reason} onChange={(event) => { setReason(event.target.value); setMessage(""); }} placeholder={work.status === "Awaiting Review" ? "Record the reason for this review decision" : "Required when cancelling this Work Order"} /></label>{work.status === "Awaiting Review" && <><button type="button" className="resolve" disabled={!reason.trim() || pending} onClick={() => runAction("verify", "passed")}>Resolve</button><button type="button" className="rework" disabled={!reason.trim() || pending} onClick={() => runAction("verify", "failed")}>Request rework</button></>}<button type="button" className="cancel" onClick={() => setCancelling(true)}>Cancel work</button>{work.status !== "Awaiting Review" && <small>Resolve and rework unlock after the Cleaner submits completion evidence.</small>}</section>}
        {cancelling && <section className="work-cancellation"><header><span>CANCEL WORK ORDER</span><button type="button" onClick={() => setCancelling(false)} aria-label="Close cancellation form">×</button></header><p>This dismisses the Work Order{work.alertId ? " and its linked Alert" : ""}.</p><button type="button" disabled={!reason.trim() || pending} onClick={() => runAction("dismiss")}>Confirm cancellation</button></section>}
        {message && <p className="work-action-message">{message}</p>}
        <p className="work-proof-note">One Cleaner completion photo is required for every Manual Work Order.</p>
      </aside>
    </div>
  </aside></div>;
  return <div className="work-detail-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="work-detail-drawer" aria-label={`Work details for ${work.id}`}>
    <header><div><span>{work.origin === "ai" ? "AI ALERT WORK" : "MANUAL WORK"}</span><h2>{work.issue}</h2><p>{work.id} · created {clock(work.createdAt)}</p></div><button type="button" onClick={onClose} aria-label="Close work details">×</button></header>
    <div className="work-detail-status">{statusOptions.map((status) => <button type="button" disabled className={work.status === status ? "active" : ""} key={status}>{status}</button>)}</div>
    <section className="work-detail-overview"><span className={`work-origin ${work.origin}`}>{work.origin === "ai" ? "AI Alert" : "Manual"}</span><span className={`work-priority ${work.priority.toLowerCase()}`}>{work.priority} priority</span><p>{work.description}</p><dl><div><dt>Zone</dt><dd>{work.zoneName}</dd></div><div><dt>Location</dt><dd>{work.point ? `Map point · X ${point.x.toFixed(1)}, Y ${point.y.toFixed(1)}` : "Camera location"}</dd></div><div><dt>Camera</dt><dd>{work.cameraName ?? "Not linked"}</dd></div><div><dt>Updated</dt><dd>{clock(work.updatedAt)}</dd></div></dl></section>
    {work.origin === "ai" && <section className="work-ai-context"><header><span>DETECTION CONTEXT</span><b>{work.alertId ? `ALERT ${work.alertId}` : "AI ALERT"}</b></header>{work.evidenceAvailable && <img src="/mock/spill.jpg" alt="Alert evidence" />}<p>{work.cameraName ?? "Camera not reported"} · detected {work.detectionTime ? clock(work.detectionTime) : "—"}</p>{work.cameraId && <button type="button" onClick={() => { const query = new URLSearchParams({ cameraId: work.cameraId!, zoneId: work.zoneId ?? "all", from: "work" }); location.hash = `/cameras?${query.toString()}`; }}>Open camera context →</button>}</section>}
    {work.origin === "manual" && <section className="work-manual-context"><header><span>MAP LOCATION</span><b>Custom point</b></header><WorkTargetMap siteMap={siteMap} point={mapPoint} cameras={[]} selectedCameraId="" mode="coordinate" backgroundUrl={mapBackgroundUrl} onPoint={() => undefined} onCamera={() => undefined} readOnly /><p>Selected map location in {work.zoneName}.</p></section>}
    <section className="work-reassign"><header><div><span>ASSIGNED CLEANER</span><h3>{cleaner ? cleaner.fullName : "No Cleaner available"}</h3></div>{!readOnly && <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search available Cleaners" />}</header><div>{activeCleaners.slice(0, 5).map((person) => <button type="button" disabled={readOnly} className={selectedCleanerId === person.id ? "selected" : ""} key={person.id} onClick={() => { setSelectedCleanerId(person.id); setMessage(""); }}><i>{initials(person.fullName)}</i><span><b>{person.fullName}</b><small>{person.staffCode} · {person.assignedZoneName}</small></span>{person.id === work.cleanerId ? <em>Current</em> : selectedCleanerId === person.id ? <em>Selected</em> : null}</button>)}</div></section>
    {!readOnly && !["Resolved", "Dismissed"].includes(work.status) && <section className="work-action-console"><header><span>SUPERVISOR ACTION</span><h3>Control this response.</h3><p>Actions are recorded in the Work history and refresh the linked Alert.</p></header><label>Reason<textarea value={reason} onChange={(event) => { setReason(event.target.value); setMessage(""); }} placeholder="Explain this operational decision" /></label>{work.status === "Awaiting Review" && <div className="work-review-outcomes" role="group" aria-label="Verification outcome">{(["passed", "failed", "inconclusive"] as const).map((value) => <button type="button" className={outcome === value ? "selected" : ""} key={value} onClick={() => setOutcome(value)}>{value === "passed" ? "Pass review" : value === "failed" ? "Request rework" : "Inconclusive"}</button>)}</div>}<div className="work-action-buttons">{selectedCleanerId && selectedCleanerId !== work.cleanerId && <button type="button" onClick={() => { if (!onAction || !reason.trim()) return; setPending(true); setMessage(""); void onAction("reassign", { cleanerId: selectedCleanerId, reason: reason.trim() }).catch((error) => setMessage(error instanceof Error ? error.message : "Reassignment failed.")).finally(() => setPending(false)); }} disabled={!reason.trim() || pending}>Reassign Cleaner</button>}{work.managementMode === "orchestrated" && <button type="button" className="outline-button" onClick={() => { if (!onAction || !reason.trim()) return; setPending(true); setMessage(""); void onAction("takeover", { reason: reason.trim() }).catch((error) => setMessage(error instanceof Error ? error.message : "Takeover failed.")).finally(() => setPending(false)); }} disabled={!reason.trim() || pending}>Take over</button>}{work.status === "Awaiting Review" && <button type="button" onClick={() => { if (!onAction || !reason.trim()) return; setPending(true); setMessage(""); void onAction("verify", { reason: reason.trim(), outcome }).catch((error) => setMessage(error instanceof Error ? error.message : "Review failed.")).finally(() => setPending(false)); }} disabled={!reason.trim() || pending}>{outcome === "passed" ? "Resolve Work" : outcome === "failed" ? "Request rework" : "Record review"}</button>}{work.status === "Awaiting Review" && work.verificationOutcome && <button type="button" className="outline-button" onClick={() => { if (!onAction || !reason.trim()) return; setPending(true); setMessage(""); void onAction("override", { reason: reason.trim(), outcome }).catch((error) => setMessage(error instanceof Error ? error.message : "Override failed.")).finally(() => setPending(false)); }} disabled={!reason.trim() || pending}>Override review</button>}<button type="button" className="danger" onClick={() => { if (!onAction || !reason.trim()) return; setPending(true); setMessage(""); void onAction("dismiss", { reason: reason.trim() }).catch((error) => setMessage(error instanceof Error ? error.message : "Dismissal failed.")).finally(() => setPending(false)); }} disabled={!reason.trim() || pending}>Dismiss Work</button></div>{message && <p className="work-action-message">{message}</p>}</section>}
  </aside></div>;
}

export function WorkManagementPage({ siteMap, cleaners, zones, cameras, alerts, workOrders, availableCleanerIds = [], onCreateV2Work, onV2Action, readOnly = false }: { siteMap: WorkSiteMap; cleaners: Cleaner[]; zones: Zone[]; cameras: CameraRecord[]; alerts: Alert[]; workOrders?: V2WorkOrder[]; availableCleanerIds?: string[]; onCreateV2Work?: (input: ManualWorkInput) => Promise<void>; onV2Action?: (workId: string, action: WorkAction, options: { cleanerId?: string; reason: string; outcome?: "passed" | "failed" | "inconclusive" }) => Promise<void>; readOnly?: boolean }) {
  const activeZones = useMemo(() => zones.filter((zone) => zone.status === "active"), [zones]);
  const [manualWork, setManualWork] = useState<WorkItem[]>([]);
  const [changes, setChanges] = useState<Record<string, Partial<WorkItem>>>({});
  const [statusFilter, setStatusFilter] = useState<"All" | WorkStatus>("All");
  const [zoneFilter, setZoneFilter] = useState("all");
  const [originFilter, setOriginFilter] = useState<"all" | WorkOrigin>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>(() => new URLSearchParams(location.hash.split("?")[1] ?? "").get("workId") ?? undefined);
  const nextManual = useRef(1);
  const availableCleanerSet = useMemo(() => new Set(availableCleanerIds), [availableCleanerIds]);

  const backendWork = useMemo<WorkItem[]>(() => (workOrders ?? []).map((work) => ({ id: work.id, origin: work.origin === "alert" ? "ai" : "manual", issue: title(work.issueType), description: work.instructions, zoneId: work.zoneId ?? undefined, zoneName: work.target.zoneNameSnapshot, cleanerId: work.assignedCleanerId, status: ({ assigned: "Assigned", in_progress: "In Progress", awaiting_review: "Awaiting Review", resolved: "Resolved", dismissed: "Dismissed" }[work.status] ?? "Assigned") as WorkStatus, priority: work.severity === "critical" ? "High" : "Medium", createdAt: work.createdAt ?? "", updatedAt: work.updatedAt ?? "", point: work.target.point ? { x: work.target.point.xMeters, y: work.target.point.yMeters } : undefined, cameraId: work.cameraId ?? undefined, cameraName: work.target.cameraNameSnapshot ?? undefined, alertId: work.alertId ?? undefined, managementMode: work.managementMode, verificationOutcome: work.latestVerificationOutcome, evidenceAvailable: Boolean(work.completionEvidenceMediaId), evidenceMediaId: work.completionEvidenceMediaId ?? undefined, detectionTime: work.createdAt ?? undefined })), [workOrders]);

  const aiWork = useMemo<WorkItem[]>(() => alerts.filter((alert) => Boolean(alert.cameraId)).slice(0, 1).map((alert, index) => {
    const linkedCamera = cameras.find((camera) => camera.status === "active" && (camera.id === alert.cameraId || camera.code === alert.cameraId || camera.name === alert.cameraName || camera.zoneName === alert.zone));
    const zone = activeZones.find((item) => item.id === linkedCamera?.zoneId || item.name.toLowerCase() === alert.zone.toLowerCase());
    const activeCleaners = cleaners.filter((person) => person.status === "active");
    const assigned = activeCleaners[index % Math.max(1, activeCleaners.length)];
    const status: WorkStatus = alert.status === "dismissed" ? "Dismissed" : alert.status !== "active" ? "Resolved" : index % 3 === 0 ? "Assigned" : index % 3 === 1 ? "In Progress" : "Awaiting Review";
    return { id: `WO-${String(alert.id).padStart(4, "0")}`, origin: "ai", issue: title(alert.kind), description: `Automated Camera Work created by the Orchestrator from ${linkedCamera?.name ?? alert.cameraName}. Review and clear the reported condition.`, zoneId: zone?.id, zoneName: zone?.name ?? alert.zone, cleanerId: assigned?.id, status, priority: alert.severity === "critical" ? "High" : "Medium", createdAt: alert.createdAt, updatedAt: alert.updatedAt, point: zone ? anchorFor(zone, activeZones.findIndex((item) => item.id === zone.id)) : undefined, cameraId: linkedCamera?.id ?? alert.cameraId, cameraName: linkedCamera?.name ?? alert.cameraName, alertId: alert.id, evidenceAvailable: alert.evidenceAvailable, detectionTime: alert.createdAt };
  }), [activeZones, alerts, cameras, cleaners]);
  const allWork = useMemo(() => (workOrders ? backendWork : [...manualWork, ...aiWork.map((item) => ({ ...item, ...changes[item.id] }))]).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)), [aiWork, backendWork, changes, manualWork, workOrders]);
  const selected = allWork.find((item) => item.id === selectedId);
  const filtered = allWork.filter((item) => (statusFilter === "All" || item.status === statusFilter) && (zoneFilter === "all" || (zoneFilter === "unzoned" ? !item.zoneId : item.zoneId === zoneFilter)) && (originFilter === "all" || item.origin === originFilter));
  const metrics = statusOptions.reduce((result, status) => ({ ...result, [status]: allWork.filter((item) => item.status === status).length }), {} as Record<WorkStatus, number>);
  const cameraOptions = useMemo<WorkCameraOption[]>(() => { const placements = new Map(siteMap.cameraPlacements.map((placement) => [placement.cameraId, placement])); const zoneNames = new Map(siteMap.zones.map((zone) => [zone.id, zone.zoneNameSnapshot])); return cameras.filter((camera) => camera.status === "active").flatMap((camera) => { const placement = placements.get(camera.id); return placement ? [{ id: camera.id, name: `${camera.name} · ${camera.code}`, point: placement.point, zoneId: placement.zoneId, zoneName: zoneNames.get(placement.zoneId) ?? camera.zoneName }] : []; }); }, [cameras, siteMap.cameraPlacements, siteMap.zones]);

  function updateWork(id: string, patch: Partial<WorkItem>) {
    if (readOnly) return;
    if (id.startsWith("WO-")) setChanges((current) => ({ ...current, [id]: { ...current[id], ...patch, updatedAt: new Date().toISOString() } }));
    else setManualWork((current) => current.map((item) => item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item));
  }
  function createWork(input: Omit<WorkItem, "id" | "origin" | "createdAt" | "updatedAt">) {
    if (readOnly) return;
    const now = new Date().toISOString();
    const item = { ...input, id: `MAN-${String(nextManual.current++).padStart(3, "0")}`, origin: "manual" as const, createdAt: now, updatedAt: now };
    setManualWork((current) => [item, ...current]); setShowCreate(false); setSelectedId(item.id);
  }
  function openWork(work: WorkItem) {
    if (!work.cameraId) { setSelectedId(work.id); return; }
    const query = new URLSearchParams({ cameraId: work.cameraId, zoneId: work.zoneId ?? "all", workId: work.id, from: "work" });
    location.hash = `/cameras?${query.toString()}`;
  }

  return <section className="work-management-page work-list-page">
    <header className="work-list-heading"><div><span>WORK ORDER MANAGEMENT</span><h1>Keep every response moving.</h1><p>Review automated Camera Work and supervisor-created Manual Work Orders from one operational queue.</p></div>{!readOnly && <button type="button" onClick={() => setShowCreate(true)}><b>+</b>Create Work Order</button>}</header>{readOnly && <p className="profile-feedback">Read-only V2 Work data.</p>}
    <section className="work-metric-grid"><article><span>WORK ORDERS</span><b>{allWork.length}</b></article><article className="assigned"><span>Assigned</span><b>{metrics.Assigned}</b></article><article className="progress"><span>In progress</span><b>{metrics["In Progress"]}</b></article><article className="review"><span>Awaiting review</span><b>{metrics["Awaiting Review"]}</b></article><article className="complete"><span>Resolved</span><b>{metrics.Resolved}</b></article></section>
    <section className="work-list-controls"><div className="work-status-filter" role="group" aria-label="Filter work by status"><button className={statusFilter === "All" ? "active" : ""} onClick={() => setStatusFilter("All")}>All</button>{statusOptions.slice(0, 4).map((status) => <button className={statusFilter === status ? "active" : ""} key={status} onClick={() => setStatusFilter(status)}>{status}</button>)}</div><div className="work-select-filters"><label>Zone<select value={zoneFilter} onChange={(event) => setZoneFilter(event.target.value)}><option value="all">All zones</option>{activeZones.map((zone) => <option value={zone.id} key={zone.id}>{zone.name}</option>)}<option value="unzoned">Unzoned area</option></select></label><label>Origin<select value={originFilter} onChange={(event) => setOriginFilter(event.target.value as "all" | WorkOrigin)}><option value="all">Automated + Manual</option><option value="ai">Automated</option><option value="manual">Manual</option></select></label></div></section>
    <section className="work-records"><header><div><span>WORK ORDER QUEUE</span><h2>{filtered.length} Work Orders</h2></div><small>Camera targets open live context. Map points open completion-evidence review.</small></header><div className="work-records-scroll"><table><thead><tr><th>Work</th><th>Scenario</th><th>Zone / location</th><th>Cleaner</th><th>Status</th><th>Next action</th><th>Priority</th><th>Created</th></tr></thead><tbody>{filtered.map((work) => { const cleaner = cleaners.find((item) => item.id === work.cleanerId); return <tr key={work.id} tabIndex={0} onClick={() => openWork(work)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openWork(work); }}><td><strong>{work.issue}</strong><small>{work.description}</small></td><td><span className={`work-origin ${work.origin}`}>{scenarioLabel(work)}</span></td><td><strong>{work.zoneName}</strong><small>{work.cameraId ? work.cameraName ?? "Camera linked" : work.point ? "Map point" : "Location not set"}</small></td><td>{cleaner ? <span className="work-cleaner-cell"><i>{initials(cleaner.fullName)}</i><b>{cleaner.fullName}</b></span> : <span className="work-unassigned">No Cleaner available</span>}</td><td><span className={`work-record-status ${statusClass(work.status)}`}>{work.status}</span></td><td><span className={`work-next-action ${statusClass(work.status)}`}><b>{nextAction(work)}</b><small>{relativeActivity(work.updatedAt)}</small></span></td><td><span className={`work-priority ${work.priority.toLowerCase()}`}>{work.priority}</span></td><td>{clock(work.createdAt)}</td></tr>; })}</tbody></table>{!filtered.length && <div className="work-empty-state"><b>No Work Orders found.</b><span>Try changing the filters or create a Manual Work Order.</span></div>}</div></section>
    {!readOnly && showCreate && <WorkCreateModal siteMap={siteMap} cleaners={cleaners} cameras={cameraOptions} availableCleanerIds={availableCleanerSet} onClose={() => setShowCreate(false)} onCreate={async (input) => { if (onCreateV2Work) await onCreateV2Work(input); else { const cameraId = input.target.type === "camera" ? input.target.cameraId : undefined; const camera = cameraId ? cameraOptions.find((item) => item.id === cameraId) : undefined; const zone = input.target.type === "coordinate" ? workZoneAtPoint(input.target.point, siteMap.zones) : undefined; createWork({ issue: input.title, description: input.instructions, priority: input.severity === "critical" ? "High" : "Medium", zoneId: camera?.zoneId ?? zone?.id, zoneName: camera?.zoneName ?? zone?.zoneNameSnapshot ?? "Unzoned area", point: input.target.type === "coordinate" ? { x: input.target.point.xMeters, y: input.target.point.yMeters } : camera ? { x: camera.point.xMeters, y: camera.point.yMeters } : undefined, cleanerId: input.assignedCleanerId, status: "Assigned", cameraId: camera?.id, cameraName: camera?.name }); } setShowCreate(false); }} />}
    {selected && <WorkDetailDrawer readOnly={readOnly} work={selected} siteMap={siteMap} cleaners={cleaners} availableCleanerIds={availableCleanerSet} onClose={() => setSelectedId(undefined)} onAction={onV2Action ? (action, options) => onV2Action(selected.id, action, options) : undefined} />}
  </section>;
}
