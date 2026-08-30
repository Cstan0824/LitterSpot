import { useEffect, useMemo, useState } from "react";
import type { Cleaner } from "../../services/cleanerAPI";
import type { CameraRecord } from "../../services/locationAPI";
import type { Alert } from "./types";

type Props = {
  alerts: Alert[];
  cameras: CameraRecord[];
  cleaners: Cleaner[];
  onStatus: (alert: Alert, status: Alert["status"]) => void;
};

const evidenceUrl = (_analysisId: number) => "/mock/spill.jpg";
const label = (value: string) => ({ bin_overflow: "Bin overflow", floor_litter: "Floor litter", floor_spill: "Floor spill" }[value] ?? value.replaceAll("_", " "));
const when = (value?: string | null) => value ? new Date(value).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "Not reported";
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

export function AlertManagementPage({ alerts, cameras, cleaners, onStatus }: Props) {
  const initialQuery = new URLSearchParams(location.hash.split("?")[1] ?? "");
  const [selectedId, setSelectedId] = useState<number | undefined>(() => {
    const value = Number(initialQuery.get("alert"));
    return Number.isFinite(value) && value > 0 ? value : undefined;
  });
  const [severity, setSeverity] = useState("all");
  const [status, setStatus] = useState("all");
  const [zone, setZone] = useState(initialQuery.get("zone") ?? "all");
  const [overlay, setOverlay] = useState(true);

  useEffect(() => {
    const syncQuery = () => {
      const query = new URLSearchParams(location.hash.split("?")[1] ?? "");
      const value = Number(query.get("alert"));
      setSelectedId(Number.isFinite(value) && value > 0 ? value : undefined);
      setZone(query.get("zone") ?? "all");
    };
    addEventListener("hashchange", syncQuery);
    return () => removeEventListener("hashchange", syncQuery);
  }, []);

  const zones = useMemo(() => [...new Set(alerts.map((alert) => alert.zone))].sort(), [alerts]);
  const filtered = useMemo(() => alerts.filter((alert) => (severity === "all" || alert.severity === severity) && (status === "all" || alert.status === status) && (zone === "all" || alert.zone === zone)).sort((left, right) => +new Date(right.createdAt) - +new Date(left.createdAt)), [alerts, severity, status, zone]);
  const selected = alerts.find((alert) => alert.id === selectedId);

  const openAlert = (alert: Alert) => {
    setSelectedId(alert.id);
    location.hash = `/alerts?alert=${alert.id}`;
  };

  if (selected) {
    const cleaner = cleaners.find((person) => person.assignedZoneName.toLowerCase() === selected.zone.toLowerCase());
    const camera = cameras.find((item) => item.id === selected.cameraId || item.code === selected.cameraId || item.name === selected.cameraName || item.zoneName === selected.zone);
    return <section className="alert-case-page">
      <header className="alert-case-title"><button type="button" onClick={() => { setSelectedId(undefined); location.hash = "/alerts"; }}>← Back to alerts</button><div><span>{label(selected.kind)} · {selected.severity === "critical" ? "High priority" : "Warning"} · confirmed {when(selected.createdAt)}</span><h1>{selected.zone}<br />needs action.</h1></div></header>
      <div className="alert-case-layout">
        <section className="alert-evidence-panel"><header><div><span>{selected.cameraName} · {selected.zone}</span><small>{when(selected.createdAt)} · frame retained</small></div><div className="alert-overlay-switch"><button className={overlay ? "active" : ""} onClick={() => setOverlay(true)}>AI overlay</button><button className={!overlay ? "active" : ""} onClick={() => setOverlay(false)}>Original</button></div></header><div className="alert-evidence-image"><img src={evidenceUrl(selected.analysisId)} alt={`Evidence for ${label(selected.kind)} at ${selected.zone}`} />{overlay && <><span className="alert-detection-box"><b>{label(selected.kind)}</b></span><span className="alert-evidence-chip">{Math.round((selected.confidence ?? 0) * 100)}% confidence</span></>}</div><div className="alert-evidence-copy"><h2>Repeated evidence, not one frame.</h2><p>Multiple recent observations contributed to this alert. The latest retained frame remains available for Supervisor review.</p></div><section className="alert-repeat-strip"><header><h3>Repeated evidence</h3><span>Latest confirmation window</span></header><div>{[0, 1, 2, 3, 4].map((item) => <button className={item === 0 ? "active" : ""} key={item}><img src={evidenceUrl(selected.analysisId)} alt="" /><span>{item < 3 ? "Positive" : "Clear"}</span><small>{new Date(new Date(selected.createdAt).getTime() - item * 3 * 60_000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></button>)}</div></section></section>
        <aside className="alert-case-sidebar"><header><span>ALERT LS-{selected.id}</span><b className={selected.severity}>{selected.severity === "critical" ? "High priority" : "Warning"}</b></header><h2>{selected.status === "active" ? "In progress" : selected.status}</h2><section className="alert-assignee"><span>Assigned Cleaner</span>{cleaner ? <div><i>{initials(cleaner.fullName)}</i><p><strong>{cleaner.fullName}</strong><small>{cleaner.staffCode} · {cleaner.status === "active" ? "Available" : "Off duty"}</small></p></div> : <p>No Cleaner is assigned to this zone.</p>}</section><section><h3>Why this Cleaner was selected</h3><ul><li>Assigned to {selected.zone}</li><li>{cleaner?.status === "active" ? "Currently available" : "Current availability not reported"}</li><li>No conflicting work is shown</li><li>Eligible for this zone</li></ul></section><section><h3>About this evidence</h3><dl><div><dt>Connection</dt><dd>{camera?.availability === "unavailable" ? "Offline" : "Online"}</dd></div><div><dt>Frame freshness</dt><dd>{when(selected.updatedAt)}</dd></div><div><dt>Confirmation</dt><dd>3 of 5 positive</dd></div><div><dt>Confidence</dt><dd>{selected.confidence ? `${Math.round(selected.confidence * 100)}%` : "Not reported"}</dd></div><div><dt>People in frame</dt><dd>{selected.peopleCount}</dd></div><div><dt>Camera</dt><dd>{camera?.code ?? selected.cameraName}</dd></div></dl></section><div className="alert-status-actions">{(["active", "resolved", "dismissed"] as const).map((next) => <button className={selected.status === next ? "active" : ""} key={next} onClick={() => onStatus(selected, next)}>{next === "active" ? "Keep active" : next}</button>)}</div></aside>
      </div>
      <section className="alert-response-journey"><header><h2>Response journey</h2><span>Current operational handoff</span></header><ol><li className="done"><i>✓</i><b>First evidence</b><small>System · {when(selected.createdAt)}</small></li><li className="done"><i>✓</i><b>Alert confirmed</b><small>AI Supervisor</small></li><li className={cleaner ? "done" : ""}><i>{cleaner ? "✓" : ""}</i><b>Cleaner assigned</b><small>{cleaner?.fullName ?? "Pending"}</small></li><li className={selected.status === "active" ? "current" : "done"}><i>{selected.status === "active" ? "" : "✓"}</i><b>Travelling</b><small>Cleaner update</small></li><li><i /><b>Fresh proof required</b><small>Pending</small></li></ol></section>
    </section>;
  }

  return <section className="alert-management-page">
    <header className="alert-management-title"><div><span>ALERTS · EVIDENCE QUEUE</span><h1>Review what needs action.</h1><p>Prioritize confirmed issues, inspect their latest evidence, and follow each response through verification.</p></div><div><b>{alerts.filter((alert) => alert.status === "active").length}</b><span>Active alerts</span></div></header>
    <div className="alert-management-filters"><div><span>Severity</span>{["all", "critical", "warning"].map((value) => <button className={severity === value ? "active" : ""} key={value} onClick={() => setSeverity(value)}>{value === "all" ? "All severity" : value}</button>)}</div><div><span>Status</span>{["all", "active", "resolved", "dismissed"].map((value) => <button className={status === value ? "active" : ""} key={value} onClick={() => setStatus(value)}>{value === "all" ? "All status" : value}</button>)}</div><label>Zone<select value={zone} onChange={(event) => setZone(event.target.value)}><option value="all">All zones</option>{zones.map((item) => <option key={item} value={item}>{item}</option>)}</select></label></div>
    <section className="alert-card-list">{filtered.map((alert) => { const cleaner = cleaners.find((person) => person.assignedZoneName.toLowerCase() === alert.zone.toLowerCase()); return <article className={`alert-summary-card ${alert.severity}`} key={alert.id}><button className="alert-summary-main" onClick={() => openAlert(alert)}><span className="alert-summary-code">LS-{alert.id}</span><div><small>{label(alert.kind)}</small><h2>{alert.zone}</h2><p>{alert.cameraName} · {when(alert.createdAt)}</p></div><b>{alert.severity === "critical" ? "High priority" : "Warning"}</b><em>{alert.status}</em></button><button className="alert-summary-evidence" onClick={() => openAlert(alert)}>{alert.evidenceAvailable ? <img src={evidenceUrl(alert.analysisId)} alt={`Evidence thumbnail for ${alert.zone}`} /> : <span>No retained evidence</span>}<div><strong>Open evidence</strong><span>{alert.confidence ? `${Math.round(alert.confidence * 100)}% confidence` : "Confidence not reported"}</span><small>{cleaner ? `Assigned to ${cleaner.fullName}` : "Cleaner assignment required"}</small></div><i>→</i></button></article>; })}{!filtered.length && <p className="alert-list-empty">No alerts match the current filters.</p>}</section>
  </section>;
}
