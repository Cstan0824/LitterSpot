import { useEffect, useMemo, useState } from "react";
import type { BinReplacementRecommendation } from "../../services/binReplacementAPI";
import type { Cleaner } from "../../services/cleanerAPI";
import type { CameraRecord, Zone } from "../../services/locationAPI";
import type { Alert } from "./types";

type Tone = "action" | "review" | "watch" | "steady" | "stale";
type ZoneView = Zone & { x: number; y: number; tone: Tone; score: number };

const anchors = [
  { x: 13, y: 18 }, { x: 8, y: 72 }, { x: 64, y: 16 },
  { x: 40, y: 44 }, { x: 60, y: 70 }, { x: 82, y: 72 },
  { x: 23, y: 40 }, { x: 83, y: 40 },
];

function siteAnchor(zone: Zone, index: number) {
  const name = zone.name.toLowerCase();
  if (name.includes("main") || name.includes("entrance")) return anchors[0];
  if (name.includes("lower") && name.includes("stair")) return anchors[1];
  if (name.includes("upper") && name.includes("stair")) return anchors[2];
  if (name.includes("temple") || name.includes("courtyard")) return anchors[3];
  if (name.includes("food") || name.includes("vendor")) return anchors[4];
  if (name.includes("car") || name.includes("park")) return anchors[5];
  return anchors[index % anchors.length];
}

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function navigate(path: string, params?: Record<string, string>) {
  const search = params ? `?${new URLSearchParams(params)}` : "";
  location.hash = `${path}${search}`;
}

function zoneAlerts(zone: Zone, alerts: Alert[]) {
  const name = zone.name.toLowerCase();
  return alerts.filter((alert) => alert.status === "active" && alert.zone.toLowerCase() === name);
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

export function GeographicOperationsDashboard({ zones, cameras, alerts, cleaners, recommendations }: {
  zones: Zone[];
  cameras: CameraRecord[];
  alerts: Alert[];
  cleaners: Cleaner[];
  recommendations: BinReplacementRecommendation[];
}) {
  const zoneViews = useMemo<ZoneView[]>(() => zones.filter((zone) => zone.status === "active").map((zone, index) => {
    const recommendation = recommendations.find((item) => item.zoneId === zone.id);
    return { ...zone, ...siteAnchor(zone, index), tone: zoneTone(zone, cameras, alerts, recommendation), score: zoneScore(zone, cameras, alerts, recommendation) };
  }), [alerts, cameras, recommendations, zones]);
  const [selectedId, setSelectedId] = useState("");
  const [zoom, setZoom] = useState(1);
  useEffect(() => { if (zoneViews.length && !zoneViews.some((zone) => zone.id === selectedId)) setSelectedId(zoneViews[0].id); }, [selectedId, zoneViews]);

  const selected = zoneViews.find((zone) => zone.id === selectedId) ?? zoneViews[0];
  const selectedCameras = cameras.filter((camera) => camera.zoneId === selected?.id && camera.status === "active");
  const selectedAlerts = selected ? zoneAlerts(selected, alerts) : [];
  const selectedCleaner = cleaners.find((cleaner) => cleaner.assignedZoneId === selected?.id && cleaner.status === "active") ?? cleaners.find((cleaner) => cleaner.assignedZoneId === selected?.id);
  const topAlerts = alerts.filter((alert) => alert.status === "active").sort((left, right) => Number(right.severity === "critical") - Number(left.severity === "critical") || right.createdAt.localeCompare(left.createdAt)).slice(0, 3);
  const availableCleaners = cleaners.filter((cleaner) => cleaner.status === "active").slice(0, 4);
  const busyZones = [...zoneViews].sort((left, right) => right.score - left.score).slice(0, 3);
  const exceptions = cameras.filter((camera) => camera.status === "active" && (camera.availability === "unavailable" || camera.registrationStatus !== "ready")).slice(0, 3);
  const responsibilities = zoneViews.slice(0, 4).map((zone) => ({ zone, cleaner: cleaners.find((person) => person.assignedZoneId === zone.id) }));

  return <section className="atlas-dashboard">
    <header className="atlas-page-title"><div><span>BATU CAVES · LIVE SYSTEM STATUS</span><h1>{zoneViews.some((zone) => zone.tone === "action") ? "One zone needs action." : "Operations across every zone."}</h1><p>Monitor site conditions, current responsibility, camera evidence, and active response from one live view.</p></div><div className="atlas-live"><i />Live monitoring<small>Updated just now</small></div></header>

    <div className="atlas-map-layout">
      <section className="atlas-map" aria-label="Batu Caves monitored zones">
        <div className="atlas-map-layer" style={{ transform: `scale(${zoom})` }}>
          <div className="atlas-map-art" />
          {zoneViews.map((zone, index) => <button type="button" aria-pressed={selected?.id === zone.id} aria-label={`${zone.name}, ${zone.tone}`} className={`atlas-zone-marker ${zone.tone} ${selected?.id === zone.id ? "selected" : ""}`} style={{ left: `${zone.x}%`, top: `${zone.y}%`, "--marker-delay": `${index * 90}ms` } as React.CSSProperties} key={zone.id} onClick={() => setSelectedId(zone.id)}><i>{String(zones.findIndex((item) => item.id === zone.id) + 1).padStart(2, "0")}</i><span>{zone.name}<small>{zone.tone}</small></span></button>)}
        </div>
        <div className="atlas-map-controls"><button type="button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(1.16, value + .04))}>+</button><button type="button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(1, value - .04))}>−</button></div>
        <div className="atlas-map-legend">{(["action", "review", "watch", "steady", "stale"] as Tone[]).map((tone) => <span className={tone} key={tone}><i />{tone}</span>)}</div>
      </section>

      {selected ? <aside className="atlas-zone-inspector">
        <header><span>{String(zones.findIndex((zone) => zone.id === selected.id) + 1).padStart(2, "0")}</span><div><small>Selected zone</small><h2>{selected.name}</h2></div><b className={selected.tone}>{selected.tone}</b></header>
        <div className="atlas-coordinate"><span><small>Latitude</small>3.23786° N</span><span><small>Longitude</small>101.68394° E</span></div>
        <section><div className="atlas-section-heading"><h3>Registered cameras</h3><b>{selectedCameras.length} total</b></div>{selectedCameras.slice(0, 3).map((camera) => <p className="atlas-data-row" key={camera.id}><span>{camera.code}</span><b className={camera.availability === "unavailable" ? "stale" : "steady"}><i />{camera.availability === "unavailable" ? "Offline" : "Online"}</b></p>)}{!selectedCameras.length && <p className="atlas-empty">No cameras registered.</p>}<button onClick={() => navigate("/cameras", { zoneId: selected.id })}>Open cameras →</button></section>
        <section><div className="atlas-section-heading"><h3>Unresolved alerts</h3><b>{selectedAlerts.length}</b></div>{selectedAlerts.slice(0, 2).map((alert) => <p className="atlas-data-row" key={alert.id}><span>{label(alert.kind)}</span><b className={alert.severity === "critical" ? "action" : "watch"}>{alert.severity}</b></p>)}{!selectedAlerts.length && <p className="atlas-empty">No unresolved alerts.</p>}<button onClick={() => navigate("/alerts", { zone: selected.name })}>Review alerts →</button></section>
        <section className="atlas-cleaner-task"><div className="atlas-section-heading"><h3>Cleaner task</h3><b>{selectedCleaner?.staffCode ?? "Unassigned"}</b></div>{selectedCleaner ? <div className="atlas-person"><i>{initials(selectedCleaner.fullName)}</i><p><strong>{selectedCleaner.fullName}</strong><span>{selectedAlerts.length ? "Assigned · awaiting update" : "Available for this zone"}</span></p></div> : <p className="atlas-empty">No Cleaner assigned to this zone.</p>}<div className={`atlas-task-steps ${selectedAlerts.length ? "active" : ""}`}><span>Assigned</span><span>Travelling</span><span>Clean</span><span>Verify</span></div><button onClick={() => navigate("/history", { zone: selected.name })}>Track work →</button></section>
      </aside> : <aside className="atlas-zone-inspector empty"><h2>No active zones</h2><p>Add a zone to populate this view.</p></aside>}
    </div>

    <section className="atlas-overview-grid">
      <OverviewCard title="Top alerts" action="View all alerts" onOpen={() => navigate("/alerts")} className="alerts"><ol>{topAlerts.map((alert) => <li key={alert.id}><i className={alert.severity === "critical" ? "action" : "watch"} /><button onClick={() => navigate("/alerts", { alert: String(alert.id) })}><strong>{label(alert.kind)}</strong><span>{alert.zone} · {relativeTime(alert.createdAt)} ago</span></button><b>{alert.severity}</b></li>)}</ol>{!topAlerts.length && <p className="atlas-empty">No active alerts.</p>}</OverviewCard>
      <OverviewCard title="Available cleaners" action="View all cleaners" onOpen={() => navigate("/admin")}><div className="atlas-cleaner-list">{availableCleaners.map((cleaner) => <div key={cleaner.id}><i>{initials(cleaner.fullName)}</i><p><strong>{cleaner.fullName}</strong><span>{cleaner.assignedZoneName}</span></p><b><i />Available</b></div>)}</div>{!availableCleaners.length && <p className="atlas-empty">No Cleaners are currently available.</p>}</OverviewCard>
      <OverviewCard title="Top 3 busy zones" action="Open insights" onOpen={() => navigate("/placement")}><ol className="atlas-busy-list">{busyZones.map((zone, index) => <li key={zone.id}><b>{index + 1}</b><span>{zone.name}</span><i><em className={zone.tone} style={{ width: `${Math.max(7, zone.score)}%` }} /></i><strong>{zone.score}</strong></li>)}</ol></OverviewCard>
      <OverviewCard title="Evidence exceptions" action="Inspect cameras" onOpen={() => navigate("/cameras")}><div className="atlas-exception-list">{exceptions.map((camera) => <button key={camera.id} onClick={() => navigate("/cameras", { cameraId: camera.id })}><i className={camera.availability === "unavailable" ? "action" : "review"} /><span><strong>{camera.name}</strong><small>{camera.zoneName} · {camera.availability === "unavailable" ? "Camera offline" : `${camera.registrationStatus} registration`}</small></span></button>)}{!exceptions.length && <p className="atlas-empty">All current evidence sources are healthy.</p>}</div></OverviewCard>
      <OverviewCard title="Zone responsibility" action="View team" onOpen={() => navigate("/admin")} className="responsibility"><div className="atlas-responsibility-list">{responsibilities.map(({ zone, cleaner }) => <button key={zone.id} onClick={() => setSelectedId(zone.id)}><i className={zone.tone}>{String(zones.findIndex((item) => item.id === zone.id) + 1).padStart(2, "0")}</i><span><strong>{zone.name}</strong><small>{cleaner ? cleaner.fullName : "No Cleaner assigned"}</small></span><b>{zoneAlerts(zone, alerts).length ? "Work active" : "Monitoring"}</b></button>)}</div></OverviewCard>
    </section>
  </section>;
}

function OverviewCard({ title, action, onOpen, className = "", children }: { title: string; action: string; onOpen: () => void; className?: string; children: React.ReactNode }) {
  return <article className={`atlas-overview-card ${className}`}><header><h2>{title}</h2><button type="button" onClick={onOpen}>{action} →</button></header>{children}</article>;
}
