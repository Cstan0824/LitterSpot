import { useEffect, useMemo, useState } from "react";
import type { Cleaner } from "../../services/cleanerAPI";
import type { CameraRecord } from "../../services/locationAPI";
import type { Alert } from "./types";
import { loadAuthenticatedMedia, releaseAuthenticatedMedia } from "../../services/v2/media";
import type { V2WorkOrder } from "../../services/v2/operations";
import { ObservationOverlay } from "./CameraLiveView";
import { alertResponseJourney } from "./alertJourney";
import { getV2AlertDetail, getV2AlertsPage, type V2Alert, type V2AlertDetail } from "../../services/v2/operations";
import type { V2ListPage } from "../../services/v2/pagination";

type Props = {
  readOnly?: boolean;
  showPermissionNotice?: boolean;
  onNavigate?: (path: string, params?: Record<string, string>) => void;
  mediaContentUrl?: (mediaId: string) => string;
  availableCleaners?: Cleaner[];
  onAssign?: (alert: Alert, cleanerId: string) => Promise<void>;
  onDismiss?: (alert: Alert, reason: string) => Promise<void>;
  workOrders?: V2WorkOrder[];
  alerts: Alert[];
  cameras: CameraRecord[];
  cleaners: Cleaner[];
  onStatus: (alert: Alert, status: Alert["status"]) => void;
  loadPage?: (input: { limit?: number; cursor?: string; status?: string; zoneId?: string; cameraId?: string; severity?: string }, signal?: AbortSignal) => Promise<V2ListPage<V2Alert>>;
  loadDetail?: (alertId: string, signal?: AbortSignal) => Promise<V2AlertDetail>;
};

const evidenceUrl = (_analysisId: number) => "/mock/spill.jpg";
const label = (value: string) => ({ bin_overflow: "Bin overflow", floor_litter: "Floor litter", floor_spill: "Floor spill" }[value] ?? value.replaceAll("_", " "));
const statusLabel = (value: string) => ({ waiting_for_cleaner: "Waiting for Cleaner", assigned: "Assigned", in_progress: "In progress", awaiting_review: "Awaiting review", resolved: "Resolved", dismissed: "Dismissed" }[value] ?? value.replaceAll("_", " "));
const when = (value?: string | null) => value ? new Date(value).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "Not reported";
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

function ProtectedEvidence({ alert, alt, overlay = true, mediaContentUrl = (mediaId) => `/api/media/${encodeURIComponent(mediaId)}/content` }: { alert: Alert; alt: string; overlay?: boolean; mediaContentUrl?: (mediaId: string) => string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!alert.evidenceMediaId) { setUrl(undefined); return; }
    const key = `alert-evidence:${alert.id}`;
    const controller = new AbortController();
    void loadAuthenticatedMedia(key, mediaContentUrl(alert.evidenceMediaId), controller.signal).then(setUrl).catch(() => setUrl(undefined));
    return () => { controller.abort(); releaseAuthenticatedMedia(key); };
  }, [alert.evidenceMediaId, alert.id, mediaContentUrl]);
  return url ? <div className="camera-retained-frame"><img src={url} alt={alt} />{overlay && alert.evidenceObservation?.image && <ObservationOverlay observation={alert.evidenceObservation} />}</div> : <span>No retained evidence</span>;
}

export function AlertManagementPage({ readOnly = false, showPermissionNotice = true, onNavigate, mediaContentUrl, availableCleaners = [], onAssign, onDismiss, workOrders = [], alerts, cameras, cleaners, onStatus, loadPage = getV2AlertsPage, loadDetail = getV2AlertDetail }: Props) {
  const go = (path: string, params?: Record<string, string>) => onNavigate ? onNavigate(path, params) : location.hash = `${path}${params ? `?${new URLSearchParams(params)}` : ""}`;
  const initialQuery = new URLSearchParams(location.hash.split("?")[1] ?? "");
  const [selectedId, setSelectedId] = useState<string | undefined>(() => initialQuery.get("alert") ?? undefined);
  const [severity, setSeverity] = useState("all");
  const [status, setStatus] = useState("all");
  const [zone, setZone] = useState(initialQuery.get("zoneId") ?? initialQuery.get("zone") ?? "all");
  const [overlay, setOverlay] = useState(true);
  const [actionCleanerId, setActionCleanerId] = useState("");
  const [actionReason, setActionReason] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const [pagedAlerts, setPagedAlerts] = useState(alerts);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(alerts.length);
  const [pageLoading, setPageLoading] = useState(false);
  const [deepLinkedAlert, setDeepLinkedAlert] = useState<Alert>();

  const adaptAlert = (alert: V2Alert): Alert => ({ id: alert.id, analysisId: 0, cameraId: alert.cameraId ?? "", cameraName: alert.cameraNameSnapshot, zoneId: alert.zoneId, zone: alert.zoneNameSnapshot || alerts.find((item) => item.zoneId === alert.zoneId)?.zone || "Unzoned", kind: alert.issueType, severity: alert.severity, confidence: alert.evidence?.confidence ?? null, status: alert.status, createdAt: alert.createdAt ?? "", updatedAt: alert.updatedAt ?? "", resolvedAt: alert.status === "resolved" ? alert.updatedAt : null, imageName: "", peopleCount: 0, evidenceAvailable: Boolean(alert.evidence?.mediaId), evidenceMediaId: alert.evidence?.mediaId ?? null, evidenceObservation: alert.evidence?.observation, activeWorkOrderId: alert.activeWorkOrderId });

  useEffect(() => {
    const syncQuery = () => {
      const query = new URLSearchParams(location.hash.split("?")[1] ?? "");
      setSelectedId(query.get("alert") ?? undefined);
      setZone(query.get("zoneId") ?? query.get("zone") ?? "all");
    };
    addEventListener("hashchange", syncQuery);
    return () => removeEventListener("hashchange", syncQuery);
  }, []);

  const zones = useMemo(() => [...new Map(alerts.map((alert) => [alert.zoneId ?? alert.zone, alert.zone])).entries()].sort((left, right) => left[1].localeCompare(right[1])), [alerts]);
  const filters = useMemo(() => ({ status, ...(severity !== "all" ? { severity } : {}), ...(zone !== "all" && zones.some(([id]) => id === zone) ? { zoneId: zone } : {}) }), [severity, status, zone, zones]);
  useEffect(() => { const controller = new AbortController(); setPageLoading(true); void loadPage({ ...filters, limit: 25 }, controller.signal).then((page) => { setPagedAlerts(page.items.map(adaptAlert)); setNextCursor(page.nextCursor); setTotalCount(page.totalCount); }).catch((error) => { if (!controller.signal.aborted) setActionError(error instanceof Error ? error.message : "Alerts could not be loaded."); }).finally(() => { if (!controller.signal.aborted) setPageLoading(false); }); return () => controller.abort(); }, [alerts, filters, loadPage]);
  const filtered = useMemo(() => pagedAlerts.filter((alert) => (severity === "all" || alert.severity === severity) && (status === "all" || alert.status === status) && (zone === "all" || alert.zoneId === zone || alert.zone === zone)).sort((left, right) => +new Date(right.createdAt) - +new Date(left.createdAt)), [pagedAlerts, severity, status, zone]);
  const selected = [...pagedAlerts, ...alerts].find((alert) => alert.id === selectedId) ?? (deepLinkedAlert?.id === selectedId ? deepLinkedAlert : undefined);
  const selectedInLists = Boolean(selectedId && [...pagedAlerts, ...alerts].some((alert) => alert.id === selectedId));
  useEffect(() => { if (!selectedId || selectedInLists) { setDeepLinkedAlert(undefined); return; } const controller = new AbortController(); void loadDetail(selectedId, controller.signal).then((detail) => setDeepLinkedAlert(adaptAlert(detail.alert))).catch((error) => { if (!controller.signal.aborted) setActionError(error instanceof Error ? error.message : "Alert detail could not be loaded."); }); return () => controller.abort(); }, [loadDetail, selectedId, selectedInLists]);
  const loadMore = async () => { if (!nextCursor || pageLoading) return; setPageLoading(true); try { const page = await loadPage({ ...filters, limit: 25, cursor: nextCursor }); const next = page.items.map(adaptAlert); setPagedAlerts((current) => [...current, ...next.filter((item) => !current.some((loaded) => loaded.id === item.id))]); setNextCursor(page.nextCursor); setTotalCount(page.totalCount); } catch (error) { setActionError(error instanceof Error ? error.message : "More Alerts could not be loaded."); } finally { setPageLoading(false); } };

  const openAlert = (alert: Alert) => {
    setSelectedId(alert.id);
    go("/alerts", { alert: alert.id });
  };

  if (selected) {
    const linkedWork = selected.activeWorkOrderId ? workOrders.find((work) => work.id === selected.activeWorkOrderId) : workOrders.find((work) => work.alertId === selected.id);
    const cleaner = linkedWork ? cleaners.find((person) => person.id === linkedWork.assignedCleanerId) : undefined;
    const camera = cameras.find((item) => item.id === selected.cameraId || item.code === selected.cameraId || item.name === selected.cameraName || item.zoneName === selected.zone);
    const hasStoredOverlay = Boolean(selected.evidenceObservation?.image);
    const journey = alertResponseJourney(selected, linkedWork);
    return <section className="alert-case-page">
      <header className="alert-case-title"><button type="button" onClick={() => { setSelectedId(undefined); go("/alerts"); }}>← Back to alerts</button><div><h1>{selected.zone}<br />needs action.</h1><span>{label(selected.kind)} · {selected.severity === "critical" ? "High priority" : "Warning"}<small>Confirmed {when(selected.createdAt)}</small></span></div></header>
      <div className="alert-case-layout">
        <section className="alert-evidence-panel"><header><div><span>{selected.cameraName} · {selected.zone}</span><small>{when(selected.createdAt)} · {selected.evidenceAvailable ? "frame retained" : "no retained frame"}</small></div>{hasStoredOverlay && <div className="alert-overlay-switch" role="group" aria-label="Evidence view"><button type="button" aria-pressed={overlay} className={overlay ? "active" : ""} onClick={() => setOverlay(true)}>AI overlay</button><button type="button" aria-pressed={!overlay} className={!overlay ? "active" : ""} onClick={() => setOverlay(false)}>Original frame</button></div>}</header><div className="alert-evidence-image">{selected.evidenceAvailable ? <><ProtectedEvidence alert={selected} overlay={overlay && hasStoredOverlay} alt={`Evidence for ${label(selected.kind)} at ${selected.zone}`} mediaContentUrl={mediaContentUrl} /></> : <span>No retained evidence is available for this Alert.</span>}</div><div className="alert-evidence-copy"><h2>{selected.evidenceAvailable ? "Latest retained evidence." : "Evidence is not retained for this Alert."}</h2><p>{hasStoredOverlay ? "AI overlay shows the model detections stored with this exact frame. Original frame hides the boxes without changing the evidence." : selected.evidenceAvailable ? "This retained frame has no stored detection overlay, so the original evidence is shown." : "No evidence frame was retained for this Alert."}</p></div></section>
        <aside className="alert-case-sidebar"><header><span>ALERT {selected.id.slice(0, 10)}</span><b className={selected.severity}>{selected.severity === "critical" ? "High priority" : "Warning"}</b></header><h2>{statusLabel(selected.status)}</h2><section className="alert-assignee"><span>Assigned Cleaner</span>{cleaner ? <div><i>{initials(cleaner.fullName)}</i><p><strong>{cleaner.fullName}</strong><small>{cleaner.staffCode} · {cleaner.status === "active" ? "Available" : "Off duty"}</small></p></div> : <p>No Cleaner is assigned to this Zone.</p>}</section><section><h3>About this evidence</h3><dl><div><dt>Connection</dt><dd>{camera?.availability === "unavailable" ? "Offline" : "Online"}</dd></div><div><dt>Frame freshness</dt><dd>{when(selected.updatedAt)}</dd></div><div><dt>Confidence</dt><dd>{selected.confidence ? `${Math.round(selected.confidence * 100)}%` : "Not reported"}</dd></div><div><dt>Camera</dt><dd>{camera?.code ?? selected.cameraName}</dd></div></dl></section>{!readOnly && selected.status === "waiting_for_cleaner" && <section className="alert-action-console"><header><span>ASSIGN RESPONSE</span><h3>Choose an available Cleaner.</h3><p>The assignment creates one Work Order for this Alert.</p></header><div className="alert-action-cleaners">{availableCleaners.map((person) => <button type="button" className={actionCleanerId === person.id ? "selected" : ""} key={person.id} onClick={() => { setActionCleanerId(person.id); setActionError(""); }}><i>{initials(person.fullName)}</i><span><b>{person.fullName}</b><small>{person.staffCode} · {person.assignedZoneName}</small></span>{actionCleanerId === person.id && <em>Selected</em>}</button>)}{!availableCleaners.length && <p>No Cleaner is currently available.</p>}</div><button type="button" className="alert-action-primary" disabled={!actionCleanerId || actionPending} onClick={() => { if (!onAssign) return; setActionPending(true); setActionError(""); void onAssign(selected, actionCleanerId).catch((error) => setActionError(error instanceof Error ? error.message : "Assignment failed.")).finally(() => setActionPending(false)); }}>{actionPending ? "Assigning…" : "Assign Cleaner"}</button></section>}{!readOnly && !selected.activeWorkOrderId && !["resolved", "dismissed"].includes(selected.status) && <section className="alert-action-console dismiss"><header><span>SUPERVISOR OVERRIDE</span><h3>Dismiss this Alert.</h3><p>Use only when no cleanup is required.</p></header><label>Reason<textarea value={actionReason} onChange={(event) => { setActionReason(event.target.value); setActionError(""); }} placeholder="Explain why no cleaning response is required" /></label><button type="button" className="alert-action-secondary" disabled={!actionReason.trim() || actionPending} onClick={() => { if (!onDismiss) return; setActionPending(true); setActionError(""); void onDismiss(selected, actionReason.trim()).catch((error) => setActionError(error instanceof Error ? error.message : "Dismissal failed.")).finally(() => setActionPending(false)); }}>{actionPending ? "Dismissing…" : "Dismiss Alert"}</button></section>}{actionError && <p className="profile-feedback">{actionError}</p>}</aside>
      </div>
      <section className="alert-response-journey"><header><h2>Response journey</h2><span>Current operational handoff</span></header><ol>{journey.map((stage) => <li className={stage.state} aria-current={stage.state === "current" ? "step" : undefined} key={stage.id}><i>{stage.state === "done" ? "✓" : stage.state === "terminal" ? "×" : ""}</i><b>{stage.label}</b><small>{stage.detail}</small></li>)}</ol></section>
    </section>;
  }

  return <section className="alert-management-page">
    <header className="alert-management-title"><div><span>ALERTS · EVIDENCE QUEUE</span><h1>Review what needs action.</h1><p>Prioritize confirmed issues, inspect their latest evidence, and follow each response through verification.</p></div><div><b>{totalCount}</b><span>Matching alerts</span></div></header>{readOnly && showPermissionNotice && <p className="profile-feedback">Alert actions are unavailable for this account.</p>}
    <div className="alert-management-filters"><div><span>Severity</span>{["all", "critical", "warning"].map((value) => <button className={severity === value ? "active" : ""} key={value} onClick={() => setSeverity(value)}>{value === "all" ? "All severity" : value}</button>)}</div><div><span>Status</span>{["all", "waiting_for_cleaner", "assigned", "in_progress", "awaiting_review", "resolved", "dismissed"].map((value) => <button className={status === value ? "active" : ""} key={value} onClick={() => setStatus(value)}>{value === "all" ? "All status" : value.replaceAll("_", " ")}</button>)}</div><label>Zone<select value={zone} onChange={(event) => setZone(event.target.value)}><option value="all">All zones</option>{zones.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label></div>
    <section className="alert-card-list">{filtered.map((alert) => { const linkedWork = alert.activeWorkOrderId ? workOrders.find((work) => work.id === alert.activeWorkOrderId) : undefined; const cleaner = linkedWork ? cleaners.find((person) => person.id === linkedWork.assignedCleanerId) : undefined; return <article className={`alert-summary-card ${alert.severity}`} key={alert.id}><button className="alert-summary-main" onClick={() => openAlert(alert)}><span className="alert-summary-code">LS-{alert.id.slice(0, 10)}</span><div><small>{label(alert.kind)}</small><h2>{alert.zone}</h2><p>{alert.cameraName} · {when(alert.createdAt)}</p></div><b>{alert.severity === "critical" ? "High priority" : "Warning"}</b><em className={`alert-status-tag ${alert.status}`}>{statusLabel(alert.status)}</em></button><button className="alert-summary-evidence" onClick={() => openAlert(alert)}>{alert.evidenceAvailable ? <ProtectedEvidence alert={alert} alt={`Evidence thumbnail for ${alert.zone}`} mediaContentUrl={mediaContentUrl} /> : <span>No retained evidence</span>}<div><strong>Open evidence</strong><span>{alert.confidence ? `${Math.round(alert.confidence * 100)}% confidence` : "Confidence not reported"}</span><small>{cleaner ? `Assigned to ${cleaner.fullName}` : "Cleaner assignment required"}</small></div><i>→</i></button></article>; })}{!filtered.length && !pageLoading && <p className="alert-list-empty">No alerts match the current filters.</p>}{nextCursor && <button className="operations-load-more" type="button" disabled={pageLoading} onClick={() => void loadMore()}>{pageLoading ? "Loading…" : `Load more · ${filtered.length} of ${totalCount}`}</button>}</section>
  </section>;
}
