import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent } from "react";
import type { Cleaner } from "../../services/cleanerAPI";
import type { CameraRecord, Zone } from "../../services/locationAPI";
import type { Alert } from "./types";
import type { V2WorkOrder } from "../../services/v2/operations";
import { loadAuthenticatedMedia, releaseAuthenticatedMedia } from "../../services/v2/media";

type Point = { x: number; y: number };
type WorkStatus = "Assigned" | "In Progress" | "Awaiting Review" | "Resolved" | "Dismissed";
type WorkOrigin = "ai" | "manual";
type WorkAction = "reassign" | "takeover" | "dismiss" | "verify" | "override";
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
function scenarioLabel(work: Pick<WorkItem, "origin" | "cameraId">) { return work.origin === "ai" ? "Automated · Camera" : work.cameraId ? "Manual · Camera" : "Manual · Station Point"; }
function distance(left: Point, right: Point) { return Math.hypot(left.x - right.x, left.y - right.y); }
function nearestZoneFor(point: Point, zones: Zone[]) { return zones.map((zone, index) => ({ zone, point: anchorFor(zone, index) })).sort((left, right) => distance(point, left.point) - distance(point, right.point))[0]?.zone; }

function pointFromEvent(event: PointerEvent<HTMLDivElement>): Point {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: Math.max(2, Math.min(98, (event.clientX - rect.left) / rect.width * 100)), y: Math.max(3, Math.min(97, (event.clientY - rect.top) / rect.height * 100)) };
}

function SitePointMap({ point, zones, onChange, compact = false }: { point: Point; zones: Zone[]; onChange?: (point: Point) => void; compact?: boolean }) {
  const activeZones = zones.filter((zone) => zone.status === "active");
  const nearest = activeZones.map((zone, index) => ({ zone, point: anchorFor(zone, index) })).sort((left, right) => distance(point, left.point) - distance(point, right.point))[0];
  return <div className={`work-site-map ${compact ? "compact" : ""} ${onChange ? "interactive" : ""}`} onPointerDown={(event) => { if (!onChange) return; event.currentTarget.setPointerCapture(event.pointerId); onChange(pointFromEvent(event)); }} onPointerMove={(event) => { if (onChange && event.currentTarget.hasPointerCapture(event.pointerId)) onChange(pointFromEvent(event)); }} onPointerUp={(event) => { if (onChange && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} role={onChange ? "application" : undefined} tabIndex={onChange ? 0 : undefined} aria-label={onChange ? "Interactive site map. Click to set a work location." : "Selected work location on site map"}>
    <div className="work-site-art" />
    {activeZones.map((zone, index) => { const anchor = anchorFor(zone, index); return <span className="work-site-zone" key={zone.id} style={{ left: `${anchor.x}%`, top: `${anchor.y}%` } as CSSProperties}><b>{String(index + 1).padStart(2, "0")}</b><i>{zone.name}</i></span>; })}
    <span className="work-site-point" style={{ left: `${point.x}%`, top: `${point.y}%` } as CSSProperties}><i /><b>Work point</b></span>
    {onChange && <span className="work-site-hint">Click anywhere to relocate the pin</span>}
    {!compact && <span className="work-site-nearest">{nearest ? `Nearest zone · ${nearest.zone.name}` : "Custom site location"}</span>}
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

function WorkCreateModal({ zones, cleaners, cameras, availableCleanerIds, onClose, onCreate }: { zones: Zone[]; cleaners: Cleaner[]; cameras: Array<{ id: string; name: string }>; availableCleanerIds: Set<string>; onClose: () => void; onCreate: (input: { title: string; instructions: string; severity: "warning" | "critical"; assignedCleanerId: string; target: { type: "camera"; cameraId: string } }) => Promise<void> }) {
  const activeZones = zones.filter((zone) => zone.status === "active");
  const activeCleaners = cleaners.filter((cleaner) => availableCleanerIds.has(cleaner.id));
  const [issue, setIssue] = useState("General clean-up");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<"warning" | "critical">("warning");
  const [point, setPoint] = useState<Point>(activeZones[0] ? anchorFor(activeZones[0], 0) : { x: 50, y: 50 });
  const [cleanerId, setCleanerId] = useState("");
  const [cameraId, setCameraId] = useState("");
  const [cleanerQuery, setCleanerQuery] = useState("");
  const [error, setError] = useState("");
  const selectedCamera = cameras.find((camera) => camera.id === cameraId);
  const visibleCleaners = activeCleaners.filter((cleaner) => cleaner.fullName.toLowerCase().includes(cleanerQuery.toLowerCase()) || cleaner.staffCode.toLowerCase().includes(cleanerQuery.toLowerCase()));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!description.trim()) { setError("Add instructions before creating the Manual Work Order."); return; }
    if (!cleanerId) { setError("Select one available Cleaner for this Manual Work Order."); return; }
    const camera = cameras.find((item) => item.id === cameraId);
    if (!camera) { setError("Choose a Camera. Coordinate Work needs the real Site Map renderer, which is not connected yet."); return; }
    try { await onCreate({ title: issue, instructions: description.trim(), severity, assignedCleanerId: cleanerId, target: { type: "camera", cameraId: camera.id } }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The Work Order could not be created."); }
  }

  return <div className="work-modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="work-create-modal" onSubmit={submit}>
    <header><div><span>MANUAL WORK</span><h2>Create a Work Order.</h2><p>A Camera is optional. The selected Station Point is the primary location.</p></div><button type="button" onClick={onClose} aria-label="Close Manual Work Order">×</button></header>
    <div className="work-create-body">
      <section className="work-create-fields"><label>Work / issue type<select value={issue} onChange={(event) => setIssue(event.target.value)}><option>General clean-up</option><option>Floor litter</option><option>Floor spill</option><option>Bin service</option><option>Inspection</option></select></label><label>Severity<select value={severity} onChange={(event) => setSeverity(event.target.value as "warning" | "critical")}><option value="warning">Warning</option><option value="critical">Critical</option></select></label><label className="wide">Description / instruction<textarea value={description} onChange={(event) => { setDescription(event.target.value); setError(""); }} placeholder="Describe the work the Cleaner needs to complete" /></label><label className="wide">Camera<select value={cameraId} onChange={(event) => setCameraId(event.target.value)}><option value="">Select a Camera</option>{cameras.map((camera) => <option value={camera.id} key={camera.id}>{camera.name}</option>)}</select><small>The Camera placement supplies the Work Zone and location.</small></label></section>
      <section className="work-create-location"><div><span>CAMERA TARGET</span><strong>{selectedCamera?.name ?? "Choose a Camera"}</strong><small>{selectedCamera ? "The published Camera placement will be used for this Work Order." : "Coordinate Work becomes available with the real Site Map renderer."}</small></div><SitePointMap point={point} zones={activeZones} compact /></section>
      <section className="work-create-cleaner"><header><div><span>ASSIGN CLEANER</span><strong>{cleanerId ? "Cleaner selected" : "Optional at creation"}</strong></div><input value={cleanerQuery} onChange={(event) => setCleanerQuery(event.target.value)} placeholder="Search registered Cleaners" /></header><div>{visibleCleaners.map((cleaner) => <button type="button" key={cleaner.id} className={cleanerId === cleaner.id ? "selected" : ""} onClick={() => setCleanerId(cleanerId === cleaner.id ? "" : cleaner.id)}><i>{initials(cleaner.fullName)}</i><span><b>{cleaner.fullName}</b><small>{cleaner.staffCode} · {cleaner.assignedZoneName}</small></span>{cleanerId === cleaner.id && <em>✓</em>}</button>)}{!visibleCleaners.length && <p>No registered Cleaners match this search.</p>}</div></section>
    </div>
    {error && <p className="work-create-error" role="alert">{error}</p>}<footer><p>This creates one real Camera-linked Work Order. Coordinate Work is added with the real Site Map renderer.</p><div><button type="button" onClick={onClose}>Cancel</button><button type="submit">Create Work Order →</button></div></footer>
  </form></div>;
}

function WorkDetailDrawer({ work, zones, cleaners, availableCleanerIds, onClose, onUpdate, onAction, readOnly = false }: { work: WorkItem; zones: Zone[]; cleaners: Cleaner[]; availableCleanerIds: Set<string>; onClose: () => void; onUpdate: (patch: Partial<WorkItem>) => void; onAction?: (action: WorkAction, options: { cleanerId?: string; reason: string; outcome?: "passed" | "failed" | "inconclusive" }) => Promise<void>; readOnly?: boolean }) {
  const [query, setQuery] = useState("");
  const [selectedCleanerId, setSelectedCleanerId] = useState("");
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState<"passed" | "failed" | "inconclusive">("passed");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const activeCleaners = cleaners.filter((cleaner) => availableCleanerIds.has(cleaner.id) && `${cleaner.fullName} ${cleaner.staffCode}`.toLowerCase().includes(query.toLowerCase()));
  const cleaner = cleaners.find((item) => item.id === work.cleanerId);
  const zone = zones.find((item) => item.id === work.zoneId);
  const point = work.point ?? (zone ? anchorFor(zone, zones.findIndex((item) => item.id === zone.id)) : { x: 50, y: 50 });
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
        <div className="work-proof-context"><span>WORK LOCATION</span><strong>{work.zoneName}</strong><small>Site coordinate · X {point.x.toFixed(1)}, Y {point.y.toFixed(1)}</small></div>
      </section>
      <aside className="work-proof-sidebar">
        <section className="work-proof-cleaner"><span>ASSIGNED CLEANER</span><strong>{cleaner?.fullName ?? "No Cleaner assigned"}</strong><dl><div><dt>Target</dt><dd>{work.zoneName}</dd></div><div><dt>Submitted</dt><dd>{work.evidenceAvailable ? clock(work.updatedAt) : "Waiting for evidence"}</dd></div></dl></section>
        {!readOnly && !["Resolved", "Dismissed"].includes(work.status) && <section className="work-proof-actions"><span>REVIEW ACTION</span><label>Supervisor note<textarea value={reason} onChange={(event) => { setReason(event.target.value); setMessage(""); }} placeholder={work.status === "Awaiting Review" ? "Record the reason for this review decision" : "Required when cancelling this Work Order"} /></label>{work.status === "Awaiting Review" && <><button type="button" className="resolve" disabled={!reason.trim() || pending} onClick={() => runAction("verify", "passed")}>Resolve</button><button type="button" className="rework" disabled={!reason.trim() || pending} onClick={() => runAction("verify", "failed")}>Request rework</button></>}<button type="button" className="cancel" onClick={() => setCancelling(true)}>Cancel work</button>{work.status !== "Awaiting Review" && <small>Resolve and rework unlock after the Cleaner submits completion evidence.</small>}</section>}
        {cancelling && <section className="work-cancellation"><header><span>CANCEL WORK ORDER</span><button type="button" onClick={() => setCancelling(false)} aria-label="Close cancellation form">×</button></header><p>This dismisses the Work Order{work.alertId ? " and its linked Alert" : ""}.</p><button type="button" disabled={!reason.trim() || pending} onClick={() => runAction("dismiss")}>Confirm cancellation</button></section>}
        {message && <p className="work-action-message">{message}</p>}
        <p className="work-proof-note">Photo required for Manual Work without Camera coverage.</p>
      </aside>
    </div>
  </aside></div>;
  return <div className="work-detail-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="work-detail-drawer" aria-label={`Work details for ${work.id}`}>
    <header><div><span>{work.origin === "ai" ? "AI ALERT WORK" : "MANUAL WORK"}</span><h2>{work.issue}</h2><p>{work.id} · created {clock(work.createdAt)}</p></div><button type="button" onClick={onClose} aria-label="Close work details">×</button></header>
    <div className="work-detail-status">{statusOptions.map((status) => <button type="button" disabled className={work.status === status ? "active" : ""} key={status}>{status}</button>)}</div>
    <section className="work-detail-overview"><span className={`work-origin ${work.origin}`}>{work.origin === "ai" ? "AI Alert" : "Manual"}</span><span className={`work-priority ${work.priority.toLowerCase()}`}>{work.priority} priority</span><p>{work.description}</p><dl><div><dt>Zone</dt><dd>{work.zoneName}</dd></div><div><dt>Location</dt><dd>{work.point ? `Map point · X ${point.x.toFixed(1)}, Y ${point.y.toFixed(1)}` : "Camera location"}</dd></div><div><dt>Camera</dt><dd>{work.cameraName ?? "Not linked"}</dd></div><div><dt>Updated</dt><dd>{clock(work.updatedAt)}</dd></div></dl></section>
    {work.origin === "ai" && <section className="work-ai-context"><header><span>DETECTION CONTEXT</span><b>{work.alertId ? `ALERT ${work.alertId}` : "AI ALERT"}</b></header>{work.evidenceAvailable && <img src="/mock/spill.jpg" alt="Alert evidence" />}<p>{work.cameraName ?? "Camera not reported"} · detected {work.detectionTime ? clock(work.detectionTime) : "—"}</p>{work.cameraId && <button type="button" onClick={() => { location.hash = `/cameras?cameraId=${encodeURIComponent(work.cameraId!)}`; }}>Open camera context →</button>}</section>}
    {work.origin === "manual" && <section className="work-manual-context"><header><span>MAP LOCATION</span><b>Custom point</b></header><SitePointMap point={point} zones={zones} compact /><p>Approximate map location inside {work.zoneName}.</p></section>}
    <section className="work-reassign"><header><div><span>ASSIGNED CLEANER</span><h3>{cleaner ? cleaner.fullName : "No Cleaner available"}</h3></div>{!readOnly && <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search available Cleaners" />}</header><div>{activeCleaners.slice(0, 5).map((person) => <button type="button" disabled={readOnly} className={selectedCleanerId === person.id ? "selected" : ""} key={person.id} onClick={() => { setSelectedCleanerId(person.id); setMessage(""); }}><i>{initials(person.fullName)}</i><span><b>{person.fullName}</b><small>{person.staffCode} · {person.assignedZoneName}</small></span>{person.id === work.cleanerId ? <em>Current</em> : selectedCleanerId === person.id ? <em>Selected</em> : null}</button>)}</div></section>
    {!readOnly && !["Resolved", "Dismissed"].includes(work.status) && <section className="work-action-console"><header><span>SUPERVISOR ACTION</span><h3>Control this response.</h3><p>Actions are recorded in the Work history and refresh the linked Alert.</p></header><label>Reason<textarea value={reason} onChange={(event) => { setReason(event.target.value); setMessage(""); }} placeholder="Explain this operational decision" /></label>{work.status === "Awaiting Review" && <div className="work-review-outcomes" role="group" aria-label="Verification outcome">{(["passed", "failed", "inconclusive"] as const).map((value) => <button type="button" className={outcome === value ? "selected" : ""} key={value} onClick={() => setOutcome(value)}>{value === "passed" ? "Pass review" : value === "failed" ? "Request rework" : "Inconclusive"}</button>)}</div>}<div className="work-action-buttons">{selectedCleanerId && selectedCleanerId !== work.cleanerId && <button type="button" onClick={() => { if (!onAction || !reason.trim()) return; setPending(true); setMessage(""); void onAction("reassign", { cleanerId: selectedCleanerId, reason: reason.trim() }).catch((error) => setMessage(error instanceof Error ? error.message : "Reassignment failed.")).finally(() => setPending(false)); }} disabled={!reason.trim() || pending}>Reassign Cleaner</button>}{work.managementMode === "orchestrated" && <button type="button" className="outline-button" onClick={() => { if (!onAction || !reason.trim()) return; setPending(true); setMessage(""); void onAction("takeover", { reason: reason.trim() }).catch((error) => setMessage(error instanceof Error ? error.message : "Takeover failed.")).finally(() => setPending(false)); }} disabled={!reason.trim() || pending}>Take over</button>}{work.status === "Awaiting Review" && <button type="button" onClick={() => { if (!onAction || !reason.trim()) return; setPending(true); setMessage(""); void onAction("verify", { reason: reason.trim(), outcome }).catch((error) => setMessage(error instanceof Error ? error.message : "Review failed.")).finally(() => setPending(false)); }} disabled={!reason.trim() || pending}>{outcome === "passed" ? "Resolve Work" : outcome === "failed" ? "Request rework" : "Record review"}</button>}{work.status === "Awaiting Review" && work.verificationOutcome && <button type="button" className="outline-button" onClick={() => { if (!onAction || !reason.trim()) return; setPending(true); setMessage(""); void onAction("override", { reason: reason.trim(), outcome }).catch((error) => setMessage(error instanceof Error ? error.message : "Override failed.")).finally(() => setPending(false)); }} disabled={!reason.trim() || pending}>Override review</button>}<button type="button" className="danger" onClick={() => { if (!onAction || !reason.trim()) return; setPending(true); setMessage(""); void onAction("dismiss", { reason: reason.trim() }).catch((error) => setMessage(error instanceof Error ? error.message : "Dismissal failed.")).finally(() => setPending(false)); }} disabled={!reason.trim() || pending}>Dismiss Work</button></div>{message && <p className="work-action-message">{message}</p>}</section>}
  </aside></div>;
}

export function WorkManagementPage({ cleaners, zones, cameras, alerts, workOrders, availableCleanerIds = [], onCreateV2Work, onV2Action, readOnly = false }: { cleaners: Cleaner[]; zones: Zone[]; cameras: CameraRecord[]; alerts: Alert[]; workOrders?: V2WorkOrder[]; availableCleanerIds?: string[]; onCreateV2Work?: (input: { title: string; instructions: string; severity: "warning" | "critical"; assignedCleanerId: string; target: { type: "camera"; cameraId: string } }) => Promise<void>; onV2Action?: (workId: string, action: WorkAction, options: { cleanerId?: string; reason: string; outcome?: "passed" | "failed" | "inconclusive" }) => Promise<void>; readOnly?: boolean }) {
  const activeZones = useMemo(() => zones.filter((zone) => zone.status === "active"), [zones]);
  const [manualWork, setManualWork] = useState<WorkItem[]>([]);
  const [changes, setChanges] = useState<Record<string, Partial<WorkItem>>>({});
  const [statusFilter, setStatusFilter] = useState<"All" | WorkStatus>("All");
  const [zoneFilter, setZoneFilter] = useState("all");
  const [originFilter, setOriginFilter] = useState<"all" | WorkOrigin>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const nextManual = useRef(1);
  const availableCleanerSet = useMemo(() => new Set(availableCleanerIds), [availableCleanerIds]);

  const backendWork = useMemo<WorkItem[]>(() => (workOrders ?? []).map((work) => ({ id: work.id, origin: work.origin === "alert" ? "ai" : "manual", issue: title(work.issueType), description: work.instructions, zoneId: work.zoneId, zoneName: work.target.zoneNameSnapshot, cleanerId: work.assignedCleanerId, status: ({ assigned: "Assigned", in_progress: "In Progress", awaiting_review: "Awaiting Review", resolved: "Resolved", dismissed: "Dismissed" }[work.status] ?? "Assigned") as WorkStatus, priority: work.severity === "critical" ? "High" : "Medium", createdAt: work.createdAt ?? "", updatedAt: work.updatedAt ?? "", point: work.target.point ? { x: work.target.point.xMeters, y: work.target.point.yMeters } : undefined, cameraId: work.cameraId ?? undefined, cameraName: work.target.cameraNameSnapshot ?? undefined, alertId: work.alertId ?? undefined, managementMode: work.managementMode, verificationOutcome: work.latestVerificationOutcome, evidenceAvailable: Boolean(work.completionEvidenceMediaId), evidenceMediaId: work.completionEvidenceMediaId ?? undefined, detectionTime: work.createdAt ?? undefined })), [workOrders]);

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
  const filtered = allWork.filter((item) => (statusFilter === "All" || item.status === statusFilter) && (zoneFilter === "all" || item.zoneId === zoneFilter) && (originFilter === "all" || item.origin === originFilter));
  const metrics = statusOptions.reduce((result, status) => ({ ...result, [status]: allWork.filter((item) => item.status === status).length }), {} as Record<WorkStatus, number>);
  const cameraOptions = useMemo(() => cameras.filter((camera) => camera.status === "active").map((camera) => ({ id: camera.id, name: `${camera.name} · ${camera.code}` })), [cameras]);

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
    const query = new URLSearchParams({ cameraId: work.cameraId, zoneId: work.zoneId ?? "all", workId: work.id });
    location.hash = `/cameras?${query.toString()}`;
  }

  return <section className="work-management-page work-list-page">
    <header className="work-list-heading"><div><span>WORK ORDER MANAGEMENT</span><h1>Keep every response moving.</h1><p>Review automated Camera Work and supervisor-created Manual Work Orders from one operational queue.</p></div>{!readOnly && <button type="button" onClick={() => setShowCreate(true)}><b>+</b>Create Work Order</button>}</header>{readOnly && <p className="profile-feedback">Read-only V2 Work data.</p>}
    <section className="work-metric-grid"><article><span>WORK ORDERS</span><b>{allWork.length}</b></article><article className="assigned"><span>Assigned</span><b>{metrics.Assigned}</b></article><article className="progress"><span>In progress</span><b>{metrics["In Progress"]}</b></article><article className="review"><span>Awaiting review</span><b>{metrics["Awaiting Review"]}</b></article><article className="complete"><span>Resolved</span><b>{metrics.Resolved}</b></article></section>
    <section className="work-list-controls"><div className="work-status-filter" role="group" aria-label="Filter work by status"><button className={statusFilter === "All" ? "active" : ""} onClick={() => setStatusFilter("All")}>All</button>{statusOptions.slice(0, 4).map((status) => <button className={statusFilter === status ? "active" : ""} key={status} onClick={() => setStatusFilter(status)}>{status}</button>)}</div><div className="work-select-filters"><label>Zone<select value={zoneFilter} onChange={(event) => setZoneFilter(event.target.value)}><option value="all">All zones</option>{activeZones.map((zone) => <option value={zone.id} key={zone.id}>{zone.name}</option>)}</select></label><label>Origin<select value={originFilter} onChange={(event) => setOriginFilter(event.target.value as "all" | WorkOrigin)}><option value="all">Automated + Manual</option><option value="ai">Automated</option><option value="manual">Manual</option></select></label></div></section>
    <section className="work-records"><header><div><span>WORK ORDER QUEUE</span><h2>{filtered.length} Work Orders</h2></div><small>Camera-linked Work opens the live Camera detail. Coordinate Work opens its evidence review.</small></header><div className="work-records-scroll"><table><thead><tr><th>Work Order ID</th><th>Title</th><th>Scenario</th><th>Zone / location</th><th>Cleaner</th><th>Status</th><th>Priority</th><th>Created</th></tr></thead><tbody>{filtered.map((work) => { const cleaner = cleaners.find((item) => item.id === work.cleanerId); return <tr key={work.id} tabIndex={0} onClick={() => openWork(work)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openWork(work); }}><td><strong>{work.id}</strong></td><td><strong>{work.issue}</strong><small>{work.description}</small></td><td><span className={`work-origin ${work.origin}`}>{scenarioLabel(work)}</span></td><td><strong>{work.zoneName}</strong><small>{work.cameraId ? work.cameraName ?? "Camera linked" : work.point ? "Station Point" : "Location not set"}</small></td><td>{cleaner ? <span className="work-cleaner-cell"><i>{initials(cleaner.fullName)}</i><b>{cleaner.fullName}</b></span> : <span className="work-unassigned">No Cleaner available</span>}</td><td><span className={`work-record-status ${statusClass(work.status)}`}>{work.status}</span></td><td><span className={`work-priority ${work.priority.toLowerCase()}`}>{work.priority}</span></td><td>{clock(work.createdAt)}</td></tr>; })}</tbody></table>{!filtered.length && <div className="work-empty-state"><b>No Work Orders found.</b><span>Try changing the filters or create a Manual Work Order.</span></div>}</div></section>
    {!readOnly && showCreate && <WorkCreateModal zones={activeZones} cleaners={cleaners} cameras={cameraOptions} availableCleanerIds={availableCleanerSet} onClose={() => setShowCreate(false)} onCreate={async (input) => { if (onCreateV2Work) await onCreateV2Work(input); else createWork({ issue: input.title, description: input.instructions, priority: input.severity === "critical" ? "High" : "Medium", zoneName: "", cleanerId: input.assignedCleanerId, status: "Assigned", cameraId: input.target.cameraId }); setShowCreate(false); }} />}
    {selected && <WorkDetailDrawer readOnly={readOnly} work={selected} zones={activeZones} cleaners={cleaners} availableCleanerIds={availableCleanerSet} onClose={() => setSelectedId(undefined)} onUpdate={(patch) => updateWork(selected.id, patch)} onAction={onV2Action ? (action, options) => onV2Action(selected.id, action, options) : undefined} />}
  </section>;
}
