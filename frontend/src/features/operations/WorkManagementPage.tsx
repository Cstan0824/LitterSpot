import { useMemo, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent } from "react";
import type { Cleaner } from "../../services/cleanerAPI";
import type { CameraRecord, Zone } from "../../services/locationAPI";
import type { Alert } from "./types";

type Point = { x: number; y: number };
type WorkStatus = "Assigned" | "In Progress" | "Awaiting Review" | "Resolved" | "Rework Required" | "Dismissed";
type WorkOrigin = "ai" | "manual";
type WorkItem = {
  id: string; origin: WorkOrigin; issue: string; description: string; zoneId?: string; zoneName: string;
  cleanerId?: string; status: WorkStatus; priority: "Low" | "Medium" | "High"; createdAt: string; updatedAt: string;
  point?: Point; cameraId?: string; cameraName?: string; alertId?: number; evidenceAvailable?: boolean; detectionTime?: string;
};

const anchors = [{ x: 13, y: 18 }, { x: 8, y: 72 }, { x: 64, y: 16 }, { x: 40, y: 44 }, { x: 60, y: 70 }, { x: 82, y: 72 }, { x: 23, y: 40 }, { x: 83, y: 40 }];
const statusOptions: WorkStatus[] = ["Assigned", "In Progress", "Awaiting Review", "Resolved", "Rework Required", "Dismissed"];

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

function WorkCreateModal({ zones, cleaners, cameras, onClose, onCreate }: { zones: Zone[]; cleaners: Cleaner[]; cameras: Array<{ id: string; name: string }>; onClose: () => void; onCreate: (input: Omit<WorkItem, "id" | "origin" | "createdAt" | "updatedAt">) => void }) {
  const activeZones = zones.filter((zone) => zone.status === "active");
  const activeCleaners = cleaners.filter((cleaner) => cleaner.status === "active");
  const [issue, setIssue] = useState("General clean-up");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<WorkItem["priority"]>("Medium");
  const [zoneId, setZoneId] = useState(activeZones[0]?.id ?? "");
  const [point, setPoint] = useState<Point>(activeZones[0] ? anchorFor(activeZones[0], 0) : { x: 50, y: 50 });
  const [cleanerId, setCleanerId] = useState("");
  const [cameraId, setCameraId] = useState("");
  const [cleanerQuery, setCleanerQuery] = useState("");
  const [error, setError] = useState("");
  const nearestZone = nearestZoneFor(point, activeZones);
  const visibleCleaners = activeCleaners.filter((cleaner) => cleaner.fullName.toLowerCase().includes(cleanerQuery.toLowerCase()) || cleaner.staffCode.toLowerCase().includes(cleanerQuery.toLowerCase()));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!description.trim()) { setError("Add instructions before creating the Manual Work Order."); return; }
    if (!cleanerId) { setError("Select one available Cleaner for this Manual Work Order."); return; }
    const zone = activeZones.find((item) => item.id === zoneId) ?? nearestZone;
    const camera = cameras.find((item) => item.id === cameraId);
    onCreate({ issue, description: description.trim(), priority, zoneId: zone?.id, zoneName: zone?.name ?? "Custom site point", cleanerId, status: "Assigned", point, cameraId: camera?.id, cameraName: camera?.name });
  }

  return <div className="work-modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="work-create-modal" onSubmit={submit}>
    <header><div><span>MANUAL WORK</span><h2>Create a Work Order.</h2><p>A Camera is optional. The selected Station Point is the primary location.</p></div><button type="button" onClick={onClose} aria-label="Close Manual Work Order">×</button></header>
    <div className="work-create-body">
      <section className="work-create-fields"><label>Work / issue type<select value={issue} onChange={(event) => setIssue(event.target.value)}><option>General clean-up</option><option>Floor litter</option><option>Floor spill</option><option>Bin overflow</option><option>Inspection</option></select></label><label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value as WorkItem["priority"])}><option>Low</option><option>Medium</option><option>High</option></select></label><label className="wide">Description / instruction<textarea value={description} onChange={(event) => { setDescription(event.target.value); setError(""); }} placeholder="Describe the work the Cleaner needs to complete" /></label><label>Zone<select value={zoneId} onChange={(event) => setZoneId(event.target.value)}><option value="">Use nearest map zone</option>{activeZones.map((zone) => <option value={zone.id} key={zone.id}>{zone.name}</option>)}</select></label><label>Camera <small>Optional</small><select value={cameraId} onChange={(event) => setCameraId(event.target.value)}><option value="">No camera linked</option>{cameras.map((camera) => <option value={camera.id} key={camera.id}>{camera.name}</option>)}</select></label></section>
      <section className="work-create-location"><div><span>LOCATION</span><strong>{nearestZone?.name ?? "Custom site point"}</strong><small>X {point.x.toFixed(1)} · Y {point.y.toFixed(1)} · click to adjust</small></div><SitePointMap point={point} zones={activeZones} onChange={(next) => { setPoint(next); const resolvedZone = nearestZoneFor(next, activeZones); if (resolvedZone) setZoneId(resolvedZone.id); }} /></section>
      <section className="work-create-cleaner"><header><div><span>ASSIGN CLEANER</span><strong>{cleanerId ? "Cleaner selected" : "Optional at creation"}</strong></div><input value={cleanerQuery} onChange={(event) => setCleanerQuery(event.target.value)} placeholder="Search registered Cleaners" /></header><div>{visibleCleaners.map((cleaner) => <button type="button" key={cleaner.id} className={cleanerId === cleaner.id ? "selected" : ""} onClick={() => setCleanerId(cleanerId === cleaner.id ? "" : cleaner.id)}><i>{initials(cleaner.fullName)}</i><span><b>{cleaner.fullName}</b><small>{cleaner.staffCode} · {cleaner.assignedZoneName}</small></span>{cleanerId === cleaner.id && <em>✓</em>}</button>)}{!visibleCleaners.length && <p>No registered Cleaners match this search.</p>}</div></section>
    </div>
    {error && <p className="work-create-error" role="alert">{error}</p>}<footer><p>Manual Work Orders are shown locally in this frontend prototype. They do not create backend records.</p><div><button type="button" onClick={onClose}>Cancel</button><button type="submit">Create Work Order →</button></div></footer>
  </form></div>;
}

function WorkDetailDrawer({ work, cleaners, onClose, onUpdate }: { work: WorkItem; cleaners: Cleaner[]; onClose: () => void; onUpdate: (patch: Partial<WorkItem>) => void }) {
  const cleaner = cleaners.find((item) => item.id === work.cleanerId);
  const [cancelling, setCancelling] = useState(false);
  const [cancellationReason, setCancellationReason] = useState("");
  return <div className="work-detail-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="work-detail-drawer work-proof-modal" role="dialog" aria-modal="true" aria-label={`Manual cleanup proof for ${work.id}`}>
    <header><div><span>MANUAL CLEANUP PROOF</span><h2>{work.id} · {work.issue}</h2></div><div className="work-proof-header-actions"><span className={`work-record-status ${statusClass(work.status)}`}>{work.status}</span><button type="button" onClick={onClose} aria-label="Close Manual Cleanup Proof">×</button></div></header>
    <div className="work-proof-layout">
      <section className="work-proof-main">
        <div className={`work-proof-visual ${work.evidenceAvailable ? "submitted" : "waiting"}`}>
          {work.evidenceAvailable ? <><img src="/mock/spill.jpg" alt={`Completion evidence submitted for ${work.issue}`} /><span>COMPLETION EVIDENCE · 1 PHOTO</span><time>{clock(work.updatedAt)}</time><button type="button" aria-label="Enlarge completion evidence">⌕</button></> : <div className="work-evidence-waiting"><strong>Waiting for evidence…</strong><small>The Cleaner must submit one completion photo before this Manual Work can be reviewed.</small></div>}
        </div>
        <div className="work-proof-context"><span>WORK LOCATION</span><strong>{work.zoneName}</strong><small>{work.point ? `Station Point · X ${work.point.x.toFixed(1)}, Y ${work.point.y.toFixed(1)}` : "Station Point"}</small></div>
      </section>
      <aside className="work-proof-sidebar">
        <section className="work-proof-cleaner"><span>ASSIGNED CLEANER</span><strong>{cleaner?.fullName ?? "No Cleaner available"}</strong><dl><div><dt>Station Point</dt><dd>{work.zoneName}</dd></div><div><dt>Submitted</dt><dd>{work.evidenceAvailable ? clock(work.updatedAt) : "Waiting for evidence"}</dd></div></dl></section>
        <section className="work-proof-actions"><span>REVIEW ACTION</span><button type="button" className="resolve" onClick={() => onUpdate({ status: "Resolved" })}>Resolve</button><button type="button" className="rework" onClick={() => onUpdate({ status: "Rework Required" })}>Request rework</button><button type="button" className="cancel" onClick={() => setCancelling(true)}>Cancel work</button></section>
        {cancelling && <section className="work-cancellation"><header><span>CANCEL WORK ORDER</span><button type="button" onClick={() => setCancelling(false)} aria-label="Close cancellation form">×</button></header><label>Cancellation reason<textarea value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} placeholder="Explain why this Work Order is being cancelled" /></label><button type="button" disabled={!cancellationReason.trim()} onClick={() => { onUpdate({ status: "Dismissed" }); setCancelling(false); }}>Confirm cancellation</button></section>}
        <p className="work-proof-note">Photo required for Manual Work without Camera coverage.</p>
      </aside>
    </div>
  </aside></div>;
}

export function WorkManagementPage({ cleaners, zones, cameras, alerts }: { cleaners: Cleaner[]; zones: Zone[]; cameras: CameraRecord[]; alerts: Alert[] }) {
  const activeZones = useMemo(() => zones.filter((zone) => zone.status === "active"), [zones]);
  const [manualWork, setManualWork] = useState<WorkItem[]>(() => {
    const cameraAlert = alerts.find((alert) => Boolean(alert.cameraId)) ?? alerts[0];
    const linkedCamera = cameras.find((camera) => camera.status === "active" && (camera.id === cameraAlert?.cameraId || camera.code === cameraAlert?.cameraId || camera.name === cameraAlert?.cameraName || camera.zoneName === cameraAlert?.zone)) ?? cameras.find((camera) => camera.status === "active");
    const cameraZone = activeZones.find((zone) => zone.id === linkedCamera?.zoneId || zone.name.toLowerCase() === cameraAlert?.zone.toLowerCase()) ?? activeZones[0];
    const stationZone = activeZones.find((zone) => zone.id !== cameraZone?.id) ?? cameraZone;
    const availableCleaners = cleaners.filter((cleaner) => cleaner.status === "active");
    const now = Date.now();
    return [
      {
        id: "MAN-CAM-001", origin: "manual", issue: "Floor spill · supervisor assigned",
        description: "Supervisor-assigned Camera Work. Open the live Camera view to supervise the clean-up and decide the outcome.",
        zoneId: cameraZone?.id, zoneName: cameraZone?.name ?? cameraAlert?.zone ?? "Main Entrance",
        cleanerId: availableCleaners[0]?.id, status: "Awaiting Review", priority: "High",
        createdAt: new Date(now - 12 * 60_000).toISOString(), updatedAt: new Date(now - 8 * 60_000).toISOString(),
        point: cameraZone ? anchorFor(cameraZone, activeZones.findIndex((zone) => zone.id === cameraZone.id)) : { x: 40, y: 44 },
        cameraId: linkedCamera?.id ?? cameraAlert?.cameraId, cameraName: linkedCamera?.name ?? cameraAlert?.cameraName, alertId: cameraAlert?.id, evidenceAvailable: true,
      },
      {
        id: "MAN-MAP-002", origin: "manual", issue: "Manual clean-up · completion proof required",
        description: "Supervisor-assigned Station Point without Camera coverage. The Cleaner must submit one completion photo before review.",
        zoneId: stationZone?.id, zoneName: stationZone?.name ?? "Food & Vendor",
        cleanerId: availableCleaners[1]?.id ?? availableCleaners[0]?.id, status: "In Progress", priority: "Medium",
        createdAt: new Date(now - 22 * 60_000).toISOString(), updatedAt: new Date(now - 15 * 60_000).toISOString(),
        point: stationZone ? anchorFor(stationZone, activeZones.findIndex((zone) => zone.id === stationZone.id)) : { x: 60, y: 70 }, evidenceAvailable: true,
      },
    ];
  });
  const [changes, setChanges] = useState<Record<string, Partial<WorkItem>>>({});
  const [statusFilter, setStatusFilter] = useState<"All" | WorkStatus>("All");
  const [zoneFilter, setZoneFilter] = useState("all");
  const [originFilter, setOriginFilter] = useState<"all" | WorkOrigin>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const nextManual = useRef(3);

  const aiWork = useMemo<WorkItem[]>(() => alerts.filter((alert) => Boolean(alert.cameraId)).slice(0, 1).map((alert, index) => {
    const linkedCamera = cameras.find((camera) => camera.status === "active" && (camera.id === alert.cameraId || camera.code === alert.cameraId || camera.name === alert.cameraName || camera.zoneName === alert.zone));
    const zone = activeZones.find((item) => item.id === linkedCamera?.zoneId || item.name.toLowerCase() === alert.zone.toLowerCase());
    const activeCleaners = cleaners.filter((person) => person.status === "active");
    const assigned = activeCleaners[index % Math.max(1, activeCleaners.length)];
    const status: WorkStatus = alert.status === "dismissed" ? "Dismissed" : alert.status !== "active" ? "Resolved" : index % 3 === 0 ? "Assigned" : index % 3 === 1 ? "In Progress" : "Awaiting Review";
    return { id: `WO-${String(alert.id).padStart(4, "0")}`, origin: "ai", issue: title(alert.kind), description: `Automated Camera Work created by the Orchestrator from ${linkedCamera?.name ?? alert.cameraName}. Review and clear the reported condition.`, zoneId: zone?.id, zoneName: zone?.name ?? alert.zone, cleanerId: assigned?.id, status, priority: alert.severity === "critical" ? "High" : "Medium", createdAt: alert.createdAt, updatedAt: alert.updatedAt, point: zone ? anchorFor(zone, activeZones.findIndex((item) => item.id === zone.id)) : undefined, cameraId: linkedCamera?.id ?? alert.cameraId, cameraName: linkedCamera?.name ?? alert.cameraName, alertId: alert.id, evidenceAvailable: alert.evidenceAvailable, detectionTime: alert.createdAt };
  }), [activeZones, alerts, cameras, cleaners]);
  const allWork = useMemo(() => [...manualWork, ...aiWork.map((item) => ({ ...item, ...changes[item.id] }))].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)), [aiWork, changes, manualWork]);
  const selected = allWork.find((item) => item.id === selectedId);
  const filtered = allWork.filter((item) => (statusFilter === "All" || item.status === statusFilter) && (zoneFilter === "all" || item.zoneId === zoneFilter) && (originFilter === "all" || item.origin === originFilter));
  const metrics = statusOptions.reduce((result, status) => ({ ...result, [status]: allWork.filter((item) => item.status === status).length }), {} as Record<WorkStatus, number>);
  const cameraOptions = useMemo(() => cameras.filter((camera) => camera.status === "active").map((camera) => ({ id: camera.id, name: `${camera.name} · ${camera.code}` })), [cameras]);

  function updateWork(id: string, patch: Partial<WorkItem>) {
    if (id.startsWith("WO-")) setChanges((current) => ({ ...current, [id]: { ...current[id], ...patch, updatedAt: new Date().toISOString() } }));
    else setManualWork((current) => current.map((item) => item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item));
  }
  function createWork(input: Omit<WorkItem, "id" | "origin" | "createdAt" | "updatedAt">) {
    const now = new Date().toISOString();
    const item = { ...input, id: `MAN-${String(nextManual.current++).padStart(3, "0")}`, origin: "manual" as const, createdAt: now, updatedAt: now };
    setManualWork((current) => [item, ...current]); setShowCreate(false); setSelectedId(item.id);
  }
  function openWork(work: WorkItem) {
    if (!work.cameraId) { setSelectedId(work.id); return; }
    const assignedCleaner = cleaners.find((person) => person.id === work.cleanerId);
    const query = new URLSearchParams({ cameraId: work.cameraId, zoneId: work.zoneId ?? "all", workId: work.id, workIssue: work.issue, workStatus: work.status, workPriority: work.priority, workCleaner: assignedCleaner?.fullName ?? "", workUpdated: work.updatedAt, workOrigin: work.origin, workAlertId: work.alertId ? String(work.alertId) : "", workEvidence: work.evidenceAvailable ? "submitted" : "pending", cameraName: work.cameraName ?? "" });
    location.hash = `/cameras?${query.toString()}`;
  }

  return <section className="work-management-page work-list-page">
    <header className="work-list-heading"><div><span>WORK ORDER MANAGEMENT · BATU CAVES</span><h1>Keep every response moving.</h1><p>Review automated Camera Work and supervisor-created Manual Work Orders from one operational queue.</p></div><button type="button" onClick={() => setShowCreate(true)}><b>+</b>Create Work Order</button></header>
    <section className="work-metric-grid"><article><span>WORK ORDERS</span><b>{allWork.length}</b></article><article className="assigned"><span>Assigned</span><b>{metrics.Assigned}</b></article><article className="progress"><span>In progress</span><b>{metrics["In Progress"]}</b></article><article className="review"><span>Awaiting review</span><b>{metrics["Awaiting Review"]}</b></article><article className="complete"><span>Resolved</span><b>{metrics.Resolved}</b></article></section>
    <section className="work-list-controls"><div className="work-status-filter" role="group" aria-label="Filter work by status"><button className={statusFilter === "All" ? "active" : ""} onClick={() => setStatusFilter("All")}>All</button>{statusOptions.slice(0, 4).map((status) => <button className={statusFilter === status ? "active" : ""} key={status} onClick={() => setStatusFilter(status)}>{status}</button>)}</div><div className="work-select-filters"><label>Zone<select value={zoneFilter} onChange={(event) => setZoneFilter(event.target.value)}><option value="all">All zones</option>{activeZones.map((zone) => <option value={zone.id} key={zone.id}>{zone.name}</option>)}</select></label><label>Origin<select value={originFilter} onChange={(event) => setOriginFilter(event.target.value as "all" | WorkOrigin)}><option value="all">Automated + Manual</option><option value="ai">Automated</option><option value="manual">Manual</option></select></label></div></section>
    <section className="work-records"><header><div><span>WORK ORDER QUEUE</span><h2>{filtered.length} Work Orders</h2></div><small>Each example follows one of the three supervisor review scenarios.</small></header><div className="work-records-scroll"><table><thead><tr><th>Work Order ID</th><th>Title</th><th>Scenario</th><th>Zone / location</th><th>Cleaner</th><th>Status</th><th>Priority</th><th>Created</th></tr></thead><tbody>{filtered.map((work) => { const cleaner = cleaners.find((item) => item.id === work.cleanerId); return <tr key={work.id} tabIndex={0} onClick={() => openWork(work)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openWork(work); }}><td><strong>{work.id}</strong></td><td><strong>{work.issue}</strong><small>{work.description}</small></td><td><span className={`work-origin ${work.origin}`}>{scenarioLabel(work)}</span></td><td><strong>{work.zoneName}</strong><small>{work.cameraId ? work.cameraName ?? "Camera linked" : work.point ? "Station Point" : "Location not set"}</small></td><td>{cleaner ? <span className="work-cleaner-cell"><i>{initials(cleaner.fullName)}</i><b>{cleaner.fullName}</b></span> : <span className="work-unassigned">No Cleaner available</span>}</td><td><span className={`work-record-status ${statusClass(work.status)}`}>{work.status}</span></td><td><span className={`work-priority ${work.priority.toLowerCase()}`}>{work.priority}</span></td><td>{clock(work.createdAt)}</td></tr>; })}</tbody></table>{!filtered.length && <div className="work-empty-state"><b>No Work Orders found.</b><span>Try changing the filters or create a Manual Work Order.</span></div>}</div></section>
    {showCreate && <WorkCreateModal zones={activeZones} cleaners={cleaners} cameras={cameraOptions} onClose={() => setShowCreate(false)} onCreate={createWork} />}
    {selected && <WorkDetailDrawer work={selected} cleaners={cleaners} onClose={() => setSelectedId(undefined)} onUpdate={(patch) => updateWork(selected.id, patch)} />}
  </section>;
}
