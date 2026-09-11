import { useEffect, useMemo, useState } from "react";
import { SiteMapViewer } from "../../components/SiteMapViewer";
import type { BinReplacementRecommendation } from "../../services/binReplacementAPI";
import type { Cleaner } from "../../services/cleanerAPI";
import type { CameraRecord, Zone } from "../../services/locationAPI";
import { getV2AlertsPage, getV2WorkOrdersPage, type V2Alert, type V2OperationsReadModel, type V2WorkOrder } from "../../services/v2/operations";
import type { Alert } from "./types";
import type { V2ListPage } from "../../services/v2/pagination";

type Tone = "action" | "review" | "watch" | "steady" | "stale";
type ZoneView = Zone & { tone: Tone; score: number };

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function defaultNavigate(path: string, params?: Record<string, string>) {
  const search = params ? `?${new URLSearchParams(params)}` : "";
  location.hash = `${path}${search}`;
}

function zoneAlerts(zone: Zone, alerts: Alert[]) {
  const name = zone.name.toLowerCase();
  return alerts.filter((alert) => !["resolved", "dismissed"].includes(alert.status) && alert.zone.toLowerCase() === name);
}

function zoneTone(zone: Zone, cameras: CameraRecord[], alerts: Alert[], recommendation?: BinReplacementRecommendation): Tone {
  const currentAlerts = zoneAlerts(zone, alerts);
  if (currentAlerts.some((alert) => alert.severity === "critical")) return "action";
  if (cameras.some((camera) => camera.zoneId === zone.id && camera.registrationStatus === "stale")) return "review";
  if (cameras.some((camera) => camera.zoneId === zone.id && camera.availability === "unavailable")) return "stale";
  if (currentAlerts.length || recommendation?.recommended) return "watch";
  return "steady";
}

function zoneScore(zone: Zone, cameras: CameraRecord[], alerts: Alert[], recommendation?: BinReplacementRecommendation) {
  const currentAlerts = zoneAlerts(zone, alerts);
  const alertPressure = currentAlerts.reduce((sum, alert) => sum + (alert.severity === "critical" ? 38 : 22), 0);
  const cameraPressure = cameras.filter((camera) => camera.zoneId === zone.id).reduce((sum, camera) => sum + (camera.availability === "unavailable" ? 18 : camera.registrationStatus !== "ready" ? 7 : 0), 0);
  const binPressure = recommendation ? recommendation.signals.binPressure * .25 : 0;
  return Math.min(100, Math.round(alertPressure + cameraPressure + binPressure));
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function relativeTime(value: string) {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  return minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} hr`;
}

export function GeographicOperationsDashboard({ zones, cameras, alerts, workOrders = [], loadAlertPage = getV2AlertsPage, loadWorkPage = getV2WorkOrdersPage, cleaners, recommendations, availabilityById = {}, busyZones, siteMap, siteName = "Active site", onNavigate = defaultNavigate, statusLabel = "Live monitoring", statusDetail = "Updated from V2" }: {
  zones: Zone[];
  cameras: CameraRecord[];
  alerts: Alert[];
  workOrders?: V2WorkOrder[];
  loadAlertPage?: (input: { limit?: number; cursor?: string; status?: string; zoneId?: string; severity?: string }, signal?: AbortSignal) => Promise<V2ListPage<V2Alert>>;
  loadWorkPage?: (input: { limit?: number; cursor?: string; status?: string; zoneId?: string; origin?: string }, signal?: AbortSignal) => Promise<V2ListPage<V2WorkOrder>>;
  cleaners: Cleaner[];
  recommendations: BinReplacementRecommendation[];
  availabilityById?: Record<string, { available: boolean; reasons: string[] }>;
  busyZones?: Array<{ zoneId: string; score: number; rank: number }>;
  siteMap: V2OperationsReadModel["siteMap"];
  siteName?: string;
  onNavigate?: (path: string, params?: Record<string, string>) => void;
  statusLabel?: string;
  statusDetail?: string;
}) {
  const zoneViews = useMemo<ZoneView[]>(() => zones.filter((zone) => zone.status === "active").map((zone) => {
    const recommendation = recommendations.find((item) => item.zoneId === zone.id);
    return { ...zone, tone: zoneTone(zone, cameras, alerts, recommendation), score: zoneScore(zone, cameras, alerts, recommendation) };
  }), [alerts, cameras, recommendations, zones]);
  const [selectedId, setSelectedId] = useState("");
  useEffect(() => { if (zoneViews.length && !zoneViews.some((zone) => zone.id === selectedId)) setSelectedId(zoneViews[0].id); }, [selectedId, zoneViews]);

  const selected = zoneViews.find((zone) => zone.id === selectedId) ?? zoneViews[0];
  const selectedCameras = cameras.filter((camera) => camera.zoneId === selected?.id && camera.status === "active");
  const fallbackAlerts = selected ? zoneAlerts(selected, alerts) : [];
  const fallbackWork = workOrders.filter((work) => work.zoneId === selected?.id && ["assigned", "in_progress", "awaiting_review"].includes(work.status)).sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));
  const [selectedAlerts, setSelectedAlerts] = useState<Array<Alert | V2Alert>>(fallbackAlerts);
  const [selectedWork, setSelectedWork] = useState<V2WorkOrder[]>(fallbackWork);
  const [selectedAlertCount, setSelectedAlertCount] = useState(fallbackAlerts.length);
  const [selectedWorkCount, setSelectedWorkCount] = useState(fallbackWork.length);
  useEffect(() => { if (!selected?.id) return; const controller = new AbortController(); void Promise.all([loadAlertPage({ zoneId: selected.id, status: "unresolved", limit: 3 }, controller.signal), loadWorkPage({ zoneId: selected.id, status: "active", limit: 3 }, controller.signal)]).then(([alertPage, workPage]) => { setSelectedAlerts(alertPage.items); setSelectedWork(workPage.items); setSelectedAlertCount(alertPage.totalCount); setSelectedWorkCount(workPage.totalCount); }).catch(() => { if (!controller.signal.aborted) { setSelectedAlerts(fallbackAlerts); setSelectedWork(fallbackWork); setSelectedAlertCount(fallbackAlerts.length); setSelectedWorkCount(fallbackWork.length); } }); return () => controller.abort(); }, [selected?.id, alerts, workOrders, loadAlertPage, loadWorkPage]);
  const topAlerts = alerts.filter((alert) => !["resolved", "dismissed"].includes(alert.status)).sort((left, right) => Number(right.severity === "critical") - Number(left.severity === "critical") || right.createdAt.localeCompare(left.createdAt)).slice(0, 3);
  const availableCleaners = cleaners.filter((cleaner) => availabilityById[cleaner.id]?.available).slice(0, 4);
  const busiest = busyZones?.map((item) => ({ ...zoneViews.find((zone) => zone.id === item.zoneId)!, score: item.score })).filter(Boolean) ?? [...zoneViews].sort((left, right) => right.score - left.score).slice(0, 3);
  const exceptions = cameras.filter((camera) => camera.status === "active" && (camera.availability === "unavailable" || camera.registrationStatus !== "ready")).slice(0, 3);
  const responsibilities = zoneViews.slice(0, 4).map((zone) => ({ zone, cleaner: cleaners.find((person) => person.assignedZoneId === zone.id) }));
  const selectedGeometry = siteMap.zones.find((zone) => zone.zoneId === selected?.id);
  const selectedCentre = selectedGeometry?.polygon.length ? selectedGeometry.polygon.reduce((sum, point) => ({ xMeters: sum.xMeters + point.xMeters / selectedGeometry.polygon.length, yMeters: sum.yMeters + point.yMeters / selectedGeometry.polygon.length }), { xMeters: 0, yMeters: 0 }) : null;
  const mapZones = siteMap.zones.map((zone) => ({ id: zone.zoneId, name: zone.zoneNameSnapshot, polygon: zone.polygon }));
  const mapCameras = siteMap.cameraPlacements.map((placement) => ({ ...placement, cameraNameSnapshot: cameras.find((camera) => camera.id === placement.cameraId)?.name ?? placement.cameraNameSnapshot }));
  const backgroundContentUrl = siteMap.background?.contentUrl ?? (siteMap.revision.backgroundMediaId ? `/api/media/${encodeURIComponent(siteMap.revision.backgroundMediaId)}/content` : null);

  return <section className="atlas-dashboard">
    <header className="atlas-page-title"><div><span>{siteName} · LIVE OPERATIONS</span><h1>{zoneViews.some((zone) => zone.tone === "action") ? "One zone needs action." : "Operations across every zone."}</h1><p>Conditions, assignments, and active responses.</p></div><div className="atlas-live"><i />{statusLabel}<small>{statusDetail}</small></div></header>

    <div className="atlas-map-layout">
      <section className="atlas-map shared" aria-label={`${siteName} monitored zones`}>
        <SiteMapViewer compact boundary={siteMap.revision} gridSizeMeters={siteMap.revision.gridSizeMeters} background={siteMap.background ?? null} backgroundContentUrl={backgroundContentUrl} backgroundTransform={siteMap.revision.backgroundTransform ?? null} zones={mapZones} cameras={mapCameras} stations={siteMap.cleanerStations} selectedZoneId={selected?.id} onSelectZone={setSelectedId} onSelectCamera={(cameraId) => onNavigate("/cameras", { cameraId, from: "dashboard" })} />
      </section>

      {selected ? <aside className="atlas-zone-inspector">
        <header><span>{String(zones.findIndex((zone) => zone.id === selected.id) + 1).padStart(2, "0")}</span><div><small>Selected zone</small><h2>{selected.name}</h2></div><b className={selected.tone}>{selected.tone}</b></header>
        <div className="atlas-coordinate"><span><small>Map X</small>{selectedCentre ? `${selectedCentre.xMeters.toFixed(1)} m` : "Not recorded"}</span><span><small>Map Y</small>{selectedCentre ? `${selectedCentre.yMeters.toFixed(1)} m` : "Not recorded"}</span></div>
        <section><div className="atlas-section-heading"><h3>Registered cameras</h3><b>{selectedCameras.length} total</b></div>{selectedCameras.slice(0, 3).map((camera) => <p className="atlas-data-row" key={camera.id}><button type="button" onClick={() => onNavigate("/cameras", { cameraId: camera.id, zoneId: selected.id, from: "dashboard" })}>{camera.name}</button><b className={camera.availability === "unavailable" ? "stale" : "steady"}><i />{camera.availability === "unavailable" ? "Offline" : "Online"}</b></p>)}{!selectedCameras.length && <p className="atlas-empty">No cameras registered.</p>}<button onClick={() => onNavigate("/cameras", { zoneId: selected.id })}>Open cameras →</button></section>
        <section><div className="atlas-section-heading"><h3>Unresolved alerts</h3><b>{selectedAlertCount} total</b></div>{selectedAlerts.slice(0, 3).map((alert) => <p className="atlas-data-row" key={alert.id}><button type="button" onClick={() => onNavigate("/alerts", { alert: alert.id, zoneId: selected.id })}>{label("kind" in alert ? alert.kind : alert.issueType)}</button><b className={alert.severity === "critical" ? "action" : "watch"}>{alert.severity}</b></p>)}{!selectedAlerts.length && <p className="atlas-empty">No unresolved alerts.</p>}<button onClick={() => onNavigate("/alerts", { zoneId: selected.id })}>Review alerts →</button></section>
        <section className="atlas-cleaner-task"><div className="atlas-section-heading"><h3>Active Work</h3><b>{selectedWorkCount} total</b></div>{selectedWork.slice(0, 3).map((work) => { const cleaner = cleaners.find((person) => person.id === work.assignedCleanerId); const state = work.status === "assigned" ? "Assigned" : work.status === "in_progress" ? "In progress" : work.latestVerificationOutcome === "failed" ? "Rework required" : "Awaiting review"; return <button className="atlas-work-row" type="button" key={work.id} onClick={() => onNavigate("/history", { zoneId: selected.id, workId: work.id, from: "dashboard" })}><i>{initials(cleaner?.fullName ?? work.cleanerNameSnapshot)}</i><span><strong>{cleaner?.fullName ?? work.cleanerNameSnapshot}</strong><small>{work.title}</small></span><b>{state}</b></button>; })}{!selectedWork.length && <p className="atlas-empty">{selectedAlerts.some((alert) => alert.status === "waiting_for_cleaner") ? "Waiting for Cleaner" : "No active Work in this Zone"}</p>}{selectedWork[0] && <div className="atlas-task-steps active" aria-label="Work lifecycle"><span className="done">Assigned</span><span className={selectedWork[0].status !== "assigned" ? "done" : ""}>In progress</span><span className={selectedWork[0].status === "awaiting_review" ? "done" : ""}>Awaiting review</span><span>Resolved</span></div>}<button onClick={() => onNavigate("/history", { zoneId: selected.id })}>Track work →</button></section>
      </aside> : <aside className="atlas-zone-inspector empty"><h2>No active zones</h2><p>Add a zone to populate this view.</p></aside>}
    </div>

    <section className="atlas-overview-grid">
      <OverviewCard title="Top alerts" action="View all alerts" onOpen={() => onNavigate("/alerts")} className="alerts"><ol>{topAlerts.map((alert) => <li key={alert.id}><i className={alert.severity === "critical" ? "action" : "watch"} /><button onClick={() => onNavigate("/alerts", { alert: String(alert.id) })}><strong>{label(alert.kind)}</strong><span>{alert.zone} · {relativeTime(alert.createdAt)} ago</span></button><b>{alert.severity}</b></li>)}</ol>{!topAlerts.length && <p className="atlas-empty">No active alerts.</p>}</OverviewCard>
      <OverviewCard title="Available cleaners" action="View all cleaners" onOpen={() => onNavigate("/admin")}><div className="atlas-cleaner-list">{availableCleaners.map((cleaner) => <div key={cleaner.id}><i>{initials(cleaner.fullName)}</i><p><strong>{cleaner.fullName}</strong><span>{cleaner.assignedZoneName}</span></p><b><i />Available</b></div>)}</div>{!availableCleaners.length && <p className="atlas-empty">No Cleaners are currently available.</p>}</OverviewCard>
      <OverviewCard title="Top 3 busy zones" action="Open insights" onOpen={() => onNavigate("/placement")}><ol className="atlas-busy-list">{busiest.map((zone, index) => <li key={zone.id}><b>{index + 1}</b><span>{zone.name}</span><i><em className={zone.tone} style={{ width: `${Math.max(7, zone.score)}%` }} /></i><strong>{Math.round(zone.score)}</strong></li>)}</ol></OverviewCard>
      <OverviewCard title="Evidence exceptions" action="Inspect cameras" onOpen={() => onNavigate("/cameras")}><div className="atlas-exception-list">{exceptions.map((camera) => <button key={camera.id} onClick={() => onNavigate("/cameras", { cameraId: camera.id, from: "dashboard" })}><i className={camera.availability === "unavailable" ? "action" : "review"} /><span><strong>{camera.name}</strong><small>{camera.zoneName} · {camera.availability === "unavailable" ? "Camera offline" : `${camera.registrationStatus} registration`}</small></span></button>)}{!exceptions.length && <p className="atlas-empty">All current evidence sources are healthy.</p>}</div></OverviewCard>
      <OverviewCard title="Nearest station points" action="View team" onOpen={() => onNavigate("/admin")} className="responsibility"><div className="atlas-responsibility-list">{responsibilities.map(({ zone, cleaner }) => <button key={zone.id} onClick={() => setSelectedId(zone.id)}><i className={zone.tone}>{String(zones.findIndex((item) => item.id === zone.id) + 1).padStart(2, "0")}</i><span><strong>{zone.name}</strong><small>{cleaner ? cleaner.fullName : "No nearby Station Point"}</small></span><b>{zoneAlerts(zone, alerts).length ? "Work active" : "Monitoring"}</b></button>)}</div></OverviewCard>
    </section>
  </section>;
}

function OverviewCard({ title, action, onOpen, className = "", children }: { title: string; action: string; onOpen: () => void; className?: string; children: React.ReactNode }) {
  return <article className={`atlas-overview-card ${className}`}><header><h2>{title}</h2><button type="button" onClick={onOpen}>{action} →</button></header>{children}</article>;
}
