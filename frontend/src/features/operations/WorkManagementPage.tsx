import { useMemo, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent } from "react";
import type { Cleaner } from "../../services/cleanerAPI";
import type { Zone } from "../../services/locationAPI";
import type { Alert } from "./types";

type Point = { x: number; y: number };
type WorkStatus = "Assigned" | "In Progress" | "Awaiting Review" | "Resolved" | "Dismissed";
type WorkOrigin = "ai" | "manual";
type WorkItem = {
  id: string; origin: WorkOrigin; issue: string; description: string; zoneId?: string; zoneName: string;
  cleanerId?: string; status: WorkStatus; priority: "Low" | "Medium" | "High"; createdAt: string; updatedAt: string;
  point?: Point; cameraId?: string; cameraName?: string; alertId?: number; evidenceAvailable?: boolean; detectionTime?: string;
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

function WorkDetailDrawer({ work, zones, cleaners, onClose, onUpdate }: { work: WorkItem; zones: Zone[]; cleaners: Cleaner[]; onClose: () => void; onUpdate: (patch: Partial<WorkItem>) => void }) {
  const [query, setQuery] = useState("");
  const activeCleaners = cleaners.filter((cleaner) => cleaner.status === "active" && `${cleaner.fullName} ${cleaner.staffCode}`.toLowerCase().includes(query.toLowerCase()));
  const cleaner = cleaners.find((item) => item.id === work.cleanerId);
  const zone = zones.find((item) => item.id === work.zoneId);
  const point = work.point ?? (zone ? anchorFor(zone, zones.findIndex((item) => item.id === zone.id)) : { x: 50, y: 50 });
  return <div className="work-detail-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="work-detail-drawer" aria-label={`Work details for ${work.id}`}>
    <header><div><span>{work.origin === "ai" ? "AI ALERT WORK" : "MANUAL WORK"}</span><h2>{work.issue}</h2><p>{work.id} · created {clock(work.createdAt)}</p></div><button type="button" onClick={onClose} aria-label="Close work details">×</button></header>
    <div className="work-detail-status">{statusOptions.map((status) => <button type="button" className={work.status === status ? "active" : ""} key={status} onClick={() => onUpdate({ status })}>{status}</button>)}</div>
    <section className="work-detail-overview"><span className={`work-origin ${work.origin}`}>{work.origin === "ai" ? "AI Alert" : "Manual"}</span><span className={`work-priority ${work.priority.toLowerCase()}`}>{work.priority} priority</span><p>{work.description}</p><dl><div><dt>Zone</dt><dd>{work.zoneName}</dd></div><div><dt>Location</dt><dd>{work.point ? `Map point · X ${point.x.toFixed(1)}, Y ${point.y.toFixed(1)}` : "Camera location"}</dd></div><div><dt>Camera</dt><dd>{work.cameraName ?? "Not linked"}</dd></div><div><dt>Updated</dt><dd>{clock(work.updatedAt)}</dd></div></dl></section>
    {work.origin === "ai" && <section className="work-ai-context"><header><span>DETECTION CONTEXT</span><b>{work.alertId ? `ALERT ${work.alertId}` : "AI ALERT"}</b></header>{work.evidenceAvailable && <img src="/mock/spill.jpg" alt="Alert evidence" />}<p>{work.cameraName ?? "Camera not reported"} · detected {work.detectionTime ? clock(work.detectionTime) : "—"}</p>{work.cameraId && <button type="button" onClick={() => { location.hash = `/cameras?cameraId=${encodeURIComponent(work.cameraId!)}`; }}>Open camera context →</button>}</section>}
    {work.origin === "manual" && <section className="work-manual-context"><header><span>MAP LOCATION</span><b>Custom point</b></header><SitePointMap point={point} zones={zones} compact /><p>Approximate map location inside {work.zoneName}.</p></section>}
    <section className="work-reassign"><header><div><span>ASSIGNED CLEANER</span><h3>{cleaner ? cleaner.fullName : "No Cleaner available"}</h3></div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Cleaners" /></header><div>{activeCleaners.slice(0, 5).map((person) => <button type="button" className={person.id === work.cleanerId ? "selected" : ""} key={person.id} onClick={() => onUpdate({ cleanerId: person.id })}><i>{initials(person.fullName)}</i><span><b>{person.fullName}</b><small>{person.staffCode} · Available</small></span>{person.id === work.cleanerId && <em>Assigned</em>}</button>)}</div></section>
  </aside></div>;
}

export function WorkManagementPage({ cleaners, zones, alerts }: { cleaners: Cleaner[]; zones: Zone[]; alerts: Alert[] }) {
  const activeZones = useMemo(() => zones.filter((zone) => zone.status === "active"), [zones]);
  const [manualWork, setManualWork] = useState<WorkItem[]>([]);
  const [changes, setChanges] = useState<Record<string, Partial<WorkItem>>>({});
  const [statusFilter, setStatusFilter] = useState<"All" | WorkStatus>("All");
  const [zoneFilter, setZoneFilter] = useState("all");
  const [originFilter, setOriginFilter] = useState<"all" | WorkOrigin>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const nextManual = useRef(1);

  const aiWork = useMemo<WorkItem[]>(() => alerts.map((alert, index) => {
    const zone = activeZones.find((item) => item.name.toLowerCase() === alert.zone.toLowerCase());
    const activeCleaners = cleaners.filter((person) => person.status === "active");
    const assigned = activeCleaners[index % Math.max(1, activeCleaners.length)];
    const status: WorkStatus = alert.status === "dismissed" ? "Dismissed" : alert.status !== "active" ? "Resolved" : index % 3 === 0 ? "Assigned" : index % 3 === 1 ? "In Progress" : "Awaiting Review";
    return { id: `WO-${String(alert.id).padStart(4, "0")}`, origin: "ai", issue: title(alert.kind), description: `AI Alert from ${alert.cameraName}. Review and clear the reported condition.`, zoneId: zone?.id, zoneName: zone?.name ?? alert.zone, cleanerId: assigned?.id, status, priority: alert.severity === "critical" ? "High" : "Medium", createdAt: alert.createdAt, updatedAt: alert.updatedAt, point: zone ? anchorFor(zone, activeZones.findIndex((item) => item.id === zone.id)) : undefined, cameraId: alert.cameraId, cameraName: alert.cameraName, alertId: alert.id, evidenceAvailable: alert.evidenceAvailable, detectionTime: alert.createdAt };
  }), [activeZones, alerts, cleaners]);
  const allWork = useMemo(() => [...manualWork, ...aiWork.map((item) => ({ ...item, ...changes[item.id] }))].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)), [aiWork, changes, manualWork]);
  const selected = allWork.find((item) => item.id === selectedId);
  const filtered = allWork.filter((item) => (statusFilter === "All" || item.status === statusFilter) && (zoneFilter === "all" || item.zoneId === zoneFilter) && (originFilter === "all" || item.origin === originFilter));
  const metrics = statusOptions.reduce((result, status) => ({ ...result, [status]: allWork.filter((item) => item.status === status).length }), {} as Record<WorkStatus, number>);
  const cameraOptions = useMemo(() => Array.from(new Map(alerts.filter((alert) => alert.cameraId).map((alert) => [alert.cameraId, { id: alert.cameraId, name: alert.cameraName }])).values()), [alerts]);

  function updateWork(id: string, patch: Partial<WorkItem>) {
    if (id.startsWith("AI-")) setChanges((current) => ({ ...current, [id]: { ...current[id], ...patch, updatedAt: new Date().toISOString() } }));
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
    const query = new URLSearchParams({ cameraId: work.cameraId, zoneId: work.zoneId ?? "all", workId: work.id, workIssue: work.issue, workStatus: work.status, workPriority: work.priority, workCleaner: assignedCleaner?.fullName ?? "", workUpdated: work.updatedAt, cameraName: work.cameraName ?? "" });
    location.hash = `/cameras?${query.toString()}`;
  }

  return <section className="work-management-page work-list-page">
    <header className="work-list-heading"><div><span>WORK ORDER MANAGEMENT · BATU CAVES</span><h1>Keep every response moving.</h1><p>Review AI Alerts and supervisor-created Manual Work Orders from one operational queue.</p></div><button type="button" onClick={() => setShowCreate(true)}><b>+</b>Create Work Order</button></header>
    <section className="work-metric-grid"><article><span>WORK ORDERS</span><b>{allWork.length}</b></article><article className="assigned"><span>Assigned</span><b>{metrics.Assigned}</b></article><article className="progress"><span>In progress</span><b>{metrics["In Progress"]}</b></article><article className="review"><span>Awaiting review</span><b>{metrics["Awaiting Review"]}</b></article><article className="complete"><span>Resolved</span><b>{metrics.Resolved}</b></article></section>
    <section className="work-list-controls"><div className="work-status-filter" role="group" aria-label="Filter work by status"><button className={statusFilter === "All" ? "active" : ""} onClick={() => setStatusFilter("All")}>All</button>{statusOptions.slice(0, 4).map((status) => <button className={statusFilter === status ? "active" : ""} key={status} onClick={() => setStatusFilter(status)}>{status}</button>)}</div><div className="work-select-filters"><label>Zone<select value={zoneFilter} onChange={(event) => setZoneFilter(event.target.value)}><option value="all">All zones</option>{activeZones.map((zone) => <option value={zone.id} key={zone.id}>{zone.name}</option>)}</select></label><label>Origin<select value={originFilter} onChange={(event) => setOriginFilter(event.target.value as "all" | WorkOrigin)}><option value="all">AI Alert + Manual</option><option value="ai">AI Alert</option><option value="manual">Manual</option></select></label></div></section>
    <section className="work-records"><header><div><span>WORK ORDER QUEUE</span><h2>{filtered.length} Work Orders</h2></div><small>Open Camera-targeted Work Orders to supervise them in the live view.</small></header><div className="work-records-scroll"><table><thead><tr><th>Work Order ID</th><th>Title</th><th>Origin</th><th>Zone / location</th><th>Cleaner</th><th>Status</th><th>Priority</th><th>Created</th></tr></thead><tbody>{filtered.map((work) => { const cleaner = cleaners.find((item) => item.id === work.cleanerId); return <tr key={work.id} tabIndex={0} onClick={() => openWork(work)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openWork(work); }}><td><strong>{work.id}</strong></td><td><strong>{work.issue}</strong><small>{work.description}</small></td><td><span className={`work-origin ${work.origin}`}>{work.origin === "ai" ? "AI Alert" : "Manual"}</span></td><td><strong>{work.zoneName}</strong><small>{work.origin === "ai" ? work.cameraName ?? "Camera linked" : work.point ? "Station Point" : "Location not set"}</small></td><td>{cleaner ? <span className="work-cleaner-cell"><i>{initials(cleaner.fullName)}</i><b>{cleaner.fullName}</b></span> : <span className="work-unassigned">No Cleaner available</span>}</td><td><span className={`work-record-status ${statusClass(work.status)}`}>{work.status}</span></td><td><span className={`work-priority ${work.priority.toLowerCase()}`}>{work.priority}</span></td><td>{clock(work.createdAt)}</td></tr>; })}</tbody></table>{!filtered.length && <div className="work-empty-state"><b>No Work Orders found.</b><span>Try changing the filters or create a Manual Work Order.</span></div>}</div></section>
    {showCreate && <WorkCreateModal zones={activeZones} cleaners={cleaners} cameras={cameraOptions} onClose={() => setShowCreate(false)} onCreate={createWork} />}
    {selected && <WorkDetailDrawer work={selected} zones={activeZones} cleaners={cleaners} onClose={() => setSelectedId(undefined)} onUpdate={(patch) => updateWork(selected.id, patch)} />}
  </section>;
}
