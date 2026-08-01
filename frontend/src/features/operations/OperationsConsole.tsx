import { useEffect, useMemo, useState } from "react";
import type { Alert, Camera, FrameResult, Placement } from "./types";

type Page = "dashboard" | "alerts" | "history" | "placement";
const labelForKind = (kind: string) => ({ bin_overflow: "Bin overflow", floor_litter: "Floor litter", floor_spill: "Floor spill" }[kind] ?? kind.replaceAll("_", " "));
const evidenceUrl = (analysisId: number) => `/api/operations/evidence/${analysisId}`;
const formatTime = (value?: string | null) => value ? new Date(`${value.endsWith("Z") ? value : `${value}Z`}`).toLocaleString() : "—";
const statusClass = (value: string) => value.replaceAll("_", "-");

function percentBox(box: { x1: number; y1: number; x2: number; y2: number }, image: FrameResult["image"]) {
  return { left: `${box.x1 / image.width * 100}%`, top: `${box.y1 / image.height * 100}%`, width: `${(box.x2 - box.x1) / image.width * 100}%`, height: `${(box.y2 - box.y1) / image.height * 100}%` };
}

function Frame({ result }: { result: FrameResult }) {
  return <div className="ops-frame">
    <img src={evidenceUrl(result.analysisId)} alt={`Latest result: ${result.imageName}`} />
    {result.people.map((person, index) => <span className="ops-box person" key={`person-${index}`} style={percentBox(person.bbox, result.image)}><b>Person</b></span>)}
    {result.bins.map((bin) => <span className={`ops-box bin ${bin.state}`} key={`bin-${bin.binIndex}`} style={percentBox(bin.bbox, result.image)}><b>{bin.state === "overflow" ? "Overflow" : `Bin ${bin.binIndex}`}</b></span>)}
    {result.floorHazards.map((hazard, index) => <span className={`ops-box hazard ${hazard.className}`} key={`hazard-${index}`} style={percentBox(hazard.bbox, result.image)}><b>{hazard.className === "floor_spill" ? "Spill" : "Litter"}</b></span>)}
    <svg className="ops-spill" viewBox={`0 0 ${result.image.width} ${result.image.height}`} preserveAspectRatio="none">{result.floorHazards.filter((hazard) => hazard.className === "floor_spill").map((hazard, index) => <polygon key={index} points={hazard.polygon.map((point) => `${point.x},${point.y}`).join(" ")} />)}</svg>
  </div>;
}

function CameraCard({ camera }: { camera: Camera }) {
  const flags = camera.latest?.flags ?? [];
  return <article className="camera-card">
    <div className="camera-image">{camera.latest?.evidenceAvailable ? <Frame result={camera.latest} /> : <div className="camera-empty">{camera.latest ? "Re-analyze to save evidence" : "Awaiting first frame"}</div>}<span className={`live-dot ${camera.latest?.isDemo ? "demo" : ""}`}>● {camera.latest?.isDemo ? "DEMO" : camera.latest?.evidenceAvailable ? "LATEST" : "READY"}</span></div>
    <div className="camera-tags">{flags.slice(0, 2).map((flag) => <span className={flag.severity} key={flag.kind}>{labelForKind(flag.kind)}</span>)}</div>
    <div className="camera-footer"><div><strong>{camera.zone}</strong><span>{camera.name}</span></div><small>{camera.latest ? `${camera.latest.peopleCount} people · ${formatTime(camera.latest.createdAt)}` : "Upload a frame to begin"}</small></div>
  </article>;
}

function AlertTable({ alerts, onStatus }: { alerts: Alert[]; onStatus: (alert: Alert, status: Alert["status"]) => void }) {
  const [expanded, setExpanded] = useState<number>();
  return <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Alert</th><th>Camera / zone</th><th>Detected</th><th>Confidence</th><th>Severity</th><th>Status</th></tr></thead><tbody>{alerts.map((alert) => <>
    <tr key={alert.id} className={expanded === alert.id ? "selected" : ""} onClick={() => setExpanded(expanded === alert.id ? undefined : alert.id)}><td><strong>EVT-{String(alert.id).padStart(4, "0")}</strong><span>{labelForKind(alert.kind)}</span></td><td>{alert.cameraName}<span>{alert.zone}</span></td><td>{formatTime(alert.createdAt)}</td><td>{alert.confidence ? `${(alert.confidence * 100).toFixed(1)}%` : "—"}</td><td><b className={`severity ${alert.severity}`}>{alert.severity}</b></td><td><span className={`status-pill ${statusClass(alert.status)}`}>{alert.status}</span></td></tr>
    {expanded === alert.id && <tr className="alert-detail" key={`${alert.id}-detail`}><td colSpan={6}><div>{alert.evidenceAvailable && <img src={evidenceUrl(alert.analysisId)} alt="Alert evidence" />}<section><p>{alert.peopleCount} people in frame · latest evidence retained</p><div className="status-actions">{(["active", "resolved", "dismissed"] as const).map((status) => <button className={status === alert.status ? "selected" : ""} key={status} onClick={(event) => { event.stopPropagation(); onStatus(alert, status); }}>{status}</button>)}</div></section></div></td></tr>}
  </>)}</tbody></table>{alerts.length === 0 && <p className="empty-copy">No alerts match these filters.</p>}</div>;
}

export function OperationsConsole({ page, onNavigate }: { page: Page; onNavigate: (page: Page) => void }) {
  const [dashboard, setDashboard] = useState<{ cameras: Camera[]; summary: { activeAlerts: number; resolvedAlerts: number; configuredCameras: number } }>();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [history, setHistory] = useState<Alert[]>([]);
  const [placement, setPlacement] = useState<Placement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>("all");
  const [severity, setSeverity] = useState<string>("all");
  const [historyQuery, setHistoryQuery] = useState("");

  async function request<T>(path: string): Promise<T> { const response = await fetch(path); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Could not load operations data."); return body as T; }
  async function refreshDashboard() { setDashboard(await request("/api/operations/dashboard")); }
  async function refreshAlerts() { const query = new URLSearchParams(); if (status !== "all") query.set("status", status); if (severity !== "all") query.set("severity", severity); const response = await request<{ items: Alert[] }>(`/api/operations/alerts?${query}`); setAlerts(response.items); }
  async function refreshHistory() { const query = new URLSearchParams(); if (historyQuery.trim()) query.set("query", historyQuery.trim()); const response = await request<{ items: Alert[] }>(`/api/operations/history?${query}`); setHistory(response.items); }
  async function refreshPlacement() { const response = await request<{ items: Placement[] }>("/api/operations/placement"); setPlacement(response.items); }
  async function load() { setLoading(true); setError(undefined); try { await Promise.all([refreshDashboard(), refreshAlerts(), refreshHistory(), refreshPlacement()]); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load operations data."); } finally { setLoading(false); } }
  useEffect(() => { void load(); }, []);
  useEffect(() => { void refreshAlerts().catch(() => undefined); }, [status, severity]);
  useEffect(() => { const task = setTimeout(() => void refreshHistory().catch(() => undefined), 250); return () => clearTimeout(task); }, [historyQuery]);
  useEffect(() => { const timer = setInterval(() => void refreshDashboard().catch(() => undefined), 30_000); return () => clearInterval(timer); }, []);

  async function changeStatus(alert: Alert, next: Alert["status"]) {
    if (alert.status === next) return;
    try { await fetch(`/api/operations/alerts/${alert.id}/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: next, operatorName: "MVP operator" }) }); await Promise.all([refreshDashboard(), refreshAlerts(), refreshHistory()]); }
    catch { setError("Could not update alert status."); }
  }

  const content = useMemo(() => {
    if (page === "alerts") return <section className="ops-page"><header className="page-title"><div><span>ALERTS</span><h1>Alert center</h1><p>Review and manage detection events.</p></div><button className="outline-button" onClick={() => void refreshAlerts()}>Refresh</button></header><div className="summary-cards"><button onClick={() => setStatus("all")} className={status === "all" ? "active" : ""}><b>{alerts.length}</b><span>Total events</span></button><button onClick={() => setStatus("active")} className={status === "active" ? "active" : ""}><b>{alerts.filter((item) => item.status === "active").length}</b><span>Active</span></button><button onClick={() => setStatus("resolved")} className={status === "resolved" ? "active" : ""}><b>{alerts.filter((item) => item.status === "resolved").length}</b><span>Resolved</span></button><button onClick={() => setStatus("dismissed")} className={status === "dismissed" ? "active" : ""}><b>{alerts.filter((item) => item.status === "dismissed").length}</b><span>Dismissed</span></button></div><div className="filter-row"><select value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="all">All severity</option><option value="critical">Critical</option><option value="warning">Warning</option></select><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All status</option><option value="active">Active</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select></div><AlertTable alerts={alerts} onStatus={(alert, next) => void changeStatus(alert, next)} /></section>;
    if (page === "history") return <section className="ops-page"><header className="page-title"><div><span>HISTORY</span><h1>Resolved events</h1><p>Read-only record of completed detection cases.</p></div><button className="outline-button" onClick={() => void refreshHistory()}>Refresh</button></header><input className="search-field" placeholder="Search camera, zone, or detection type" value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} /><AlertTable alerts={history} onStatus={() => undefined} /></section>;
    if (page === "placement") return <section className="ops-page"><header className="page-title"><div><span>REPORTS</span><h1>Bin placement analysis</h1><p>Overflow frequency and people popularity are ranked independently.</p></div><button className="outline-button" onClick={() => void refreshPlacement()}>Refresh</button></header><div className="placement-grid">{placement.map((item) => <article className={`placement-tile ${item.recommended ? "recommended" : ""}`} key={item.cameraId}><div><span>{item.zone}</span><h2>{item.cameraName}</h2></div><b className={item.recommended ? "critical" : "ok"}>{item.recommended ? "RECOMMENDED" : item.status.replaceAll("_", " ")}</b><dl><div><dt>Overflow rank</dt><dd>{item.overflowRank} / {item.overflowThreshold}</dd></div><div><dt>Popularity rank</dt><dd>{item.popularityRank} / {item.popularityThreshold}</dd></div><div><dt>Observation</dt><dd>{item.validDays}/{item.requiredValidDays} days</dd></div></dl><p>{item.recommended ? `Raised by ${item.triggerReason?.replaceAll("_", " ") ?? "rank"}.` : "Continue collecting camera observations."}</p></article>)}</div></section>;
    return <section className="ops-page"><header className="page-title"><div><span>DASHBOARD</span><h1>Live camera overview</h1><p>Latest analyzed snapshots from each registered camera.</p></div><button className="outline-button" onClick={() => void refreshDashboard()}>Refresh</button></header><div className="dashboard-statline"><span><b>{dashboard?.summary.activeAlerts ?? 0}</b> Active alerts</span><span><b>{dashboard?.summary.resolvedAlerts ?? 0}</b> Resolved</span><span><b>{dashboard?.summary.configuredCameras ?? 0}/6</b> Cameras configured</span></div><section className="camera-grid">{dashboard?.cameras.map((camera) => <CameraCard camera={camera} key={camera.id} />)}</section><section className="dashboard-empty"><h2>Need a fresh camera frame?</h2><p>Use the pipeline playground to upload the exact camera image, plot a floor-only ROI, and create a saved evidence record.</p><button className="primary" onClick={() => { location.hash = "/pipeline"; }}>Open pipeline playground</button></section></section>;
  }, [alerts, dashboard, history, historyQuery, page, placement, severity, status]);

  return <div className="ops-shell"><aside className="ops-sidebar"><div className="ops-brand"><b>♲</b><div><strong>LITTERSPOT</strong><span>AI Waste Monitor</span></div></div><nav><p>MAIN</p>{(["dashboard", "alerts", "history"] as Page[]).map((item) => <button className={page === item ? "current" : ""} key={item} onClick={() => onNavigate(item)}>{item === "history" ? "History log" : item}<i>{item === "alerts" && dashboard?.summary.activeAlerts ? dashboard.summary.activeAlerts : ""}</i></button>)}<p>REPORTS</p><button className={page === "placement" ? "current" : ""} onClick={() => onNavigate("placement")}>Bin analysis</button></nav><div className="sidebar-cameras"><p>CAMERAS</p>{dashboard?.cameras.map((camera) => <span key={camera.id}><i className={camera.latest ? "online" : "offline"} />{camera.name}<small>{camera.latest?.flags.length ?? 0}</small></span>)}</div><div className="sidebar-user"><b>MO</b><span>MVP operator<small>Local console</small></span></div></aside><main className="ops-main"><header className="ops-topbar"><button className="mobile-nav" onClick={() => document.body.classList.toggle("nav-open")}>☰</button><span>{page}</span><button className="outline-button" onClick={() => { location.hash = "/pipeline"; }}>Analyze frame</button></header>{loading ? <p className="ops-loading">Loading operations data…</p> : error ? <div className="ops-error"><p>{error}</p><button className="outline-button" onClick={() => void load()}>Try again</button></div> : content}</main></div>;
}
