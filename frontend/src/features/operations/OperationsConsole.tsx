import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Alert, Camera, FrameResult, Placement } from "./types";
import { getLiveVideos, subscribeLiveVideo, type LiveVideo } from "../pipeline/liveVideoStore";
import { createCleaner, getCleaners, updateCleanerStatus, type Cleaner } from "../../services/cleanerAPI";
import { createCamera, createSite, createZone, getCameras, getSites, getZones, updateCamera, updateSite, updateZone, type CameraRecord, type Site, type Zone } from "../../services/locationAPI";

type Page = "dashboard" | "alerts" | "history" | "placement" | "cameras" | "admin";
type AdminProfile = { displayName: string; email: string };
const labelForKind = (kind: string) => ({ bin_overflow: "Bin overflow", floor_litter: "Floor litter", floor_spill: "Floor spill" }[kind] ?? kind.replaceAll("_", " "));
const evidenceUrl = (_analysisId: number) => "/mock/spill.jpg";
const formatTime = (value?: string | null) => value ? new Date(`${value.endsWith("Z") ? value : `${value}Z`}`).toLocaleString() : "—";
const statusClass = (value: string) => value.replaceAll("_", "-");

const demoFrame = (analysisId: number, cameraId: string, imageName: string, peopleCount: number, state: "normal" | "full" | "overflow", flags: FrameResult["flags"]): FrameResult => ({
  analysisId, cameraId, imageName, peopleCount, flags, createdAt: new Date(Date.now() - analysisId * 9 * 60_000).toISOString(),
  image: { width: 1280, height: 720 }, evidenceAvailable: true, isDemo: true,
  people: Array.from({ length: peopleCount }, (_, index) => ({ confidence: .91, bbox: { x1: 90 + index * 150, y1: 175, x2: 180 + index * 150, y2: 580 } })),
  bins: [{ binIndex: 1, state, bbox: { x1: 820, y1: 245, x2: 1060, y2: 630 } }], floorHazards: [],
});

const demoCameras: Camera[] = [
  { id: "CAMERA-1", name: "CAMERA-1", zone: "North Entrance", enabled: true, latest: demoFrame(1, "CAMERA-1", "north-entrance.jpg", 3, "normal", []) },
  { id: "CAMERA-2", name: "CAMERA-2", zone: "Food Court", enabled: true, latest: demoFrame(2, "CAMERA-2", "food-court.jpg", 5, "overflow", [{ severity: "critical", kind: "bin_overflow", message: "Bin capacity exceeded" }]) },
  { id: "CAMERA-3", name: "CAMERA-3", zone: "East Walkway", enabled: true, latest: demoFrame(3, "CAMERA-3", "east-walkway.jpg", 2, "full", [{ severity: "warning", kind: "floor_litter", message: "Loose litter detected" }]) },
  { id: "CAMERA-4", name: "CAMERA-4", zone: "Parking Lobby", enabled: true, latest: demoFrame(4, "CAMERA-4", "parking-lobby.jpg", 1, "normal", []) },
  { id: "CAMERA-5", name: "CAMERA-5", zone: "West Plaza", enabled: true, latest: demoFrame(5, "CAMERA-5", "west-plaza.jpg", 4, "full", [{ severity: "warning", kind: "floor_spill", message: "Possible spill detected" }]) },
  { id: "CAMERA-6", name: "CAMERA-6", zone: "Service Corridor", enabled: true, latest: null },
];

const demoAlerts: Alert[] = [
  { id: 1042, analysisId: 2, cameraId: "cam-02", cameraName: "CAM-02", zone: "Food Court", kind: "bin_overflow", severity: "critical", confidence: .96, status: "active", createdAt: new Date(Date.now() - 8 * 60_000).toISOString(), updatedAt: new Date().toISOString(), resolvedAt: null, imageName: "food-court.jpg", peopleCount: 5, evidenceAvailable: true },
  { id: 1041, analysisId: 3, cameraId: "cam-03", cameraName: "CAM-03", zone: "East Walkway", kind: "floor_litter", severity: "warning", confidence: .88, status: "active", createdAt: new Date(Date.now() - 28 * 60_000).toISOString(), updatedAt: new Date().toISOString(), resolvedAt: null, imageName: "east-walkway.jpg", peopleCount: 2, evidenceAvailable: true },
  { id: 1040, analysisId: 5, cameraId: "cam-05", cameraName: "CAM-05", zone: "West Plaza", kind: "floor_spill", severity: "warning", confidence: .84, status: "resolved", createdAt: new Date(Date.now() - 74 * 60_000).toISOString(), updatedAt: new Date().toISOString(), resolvedAt: new Date().toISOString(), imageName: "west-plaza.jpg", peopleCount: 4, evidenceAvailable: true },
  { id: 1039, analysisId: 1, cameraId: "cam-01", cameraName: "CAM-01", zone: "North Entrance", kind: "bin_overflow", severity: "critical", confidence: .92, status: "dismissed", createdAt: new Date(Date.now() - 3.5 * 3_600_000).toISOString(), updatedAt: new Date().toISOString(), resolvedAt: null, imageName: "north-entrance.jpg", peopleCount: 3, evidenceAvailable: true },
];

const demoPlacement: Placement[] = demoCameras.slice(0, 5).map((camera, index) => ({ cameraId: camera.id, cameraName: camera.name, zone: camera.zone, recommended: index === 1, status: index === 1 ? "action_required" : "monitoring", overflowRank: index + 1, overflowThreshold: 3, overflowEpisodes: 12 - index, popularityRank: [3, 1, 5, 4, 2][index], popularityThreshold: 3, averagePeoplePerFrame: [2.8, 6.4, 1.7, 2.1, 4.8][index], validDays: 7, requiredValidDays: 7, triggerReason: index === 1 ? "overflow_frequency" : null }));
function percentBox(box: { x1: number; y1: number; x2: number; y2: number }, image: FrameResult["image"]) {
  const left = Math.max(0, Math.min(100, box.x1 / image.width * 100));
  const top = Math.max(0, Math.min(100, box.y1 / image.height * 100));
  const right = Math.max(left, Math.min(100, box.x2 / image.width * 100));
  const bottom = Math.max(top, Math.min(100, box.y2 / image.height * 100));
  return { left: `${left}%`, top: `${top}%`, width: `${right - left}%`, height: `${bottom - top}%` };
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

function CameraFlagStatus({ flags, state = "ready" }: { flags: Array<{ severity: "critical" | "warning" }>; state?: "ready" | "pending" | "offline" }) {
  const critical = flags.filter((flag) => flag.severity === "critical").length;
  const warning = flags.filter((flag) => flag.severity === "warning").length;
  const kind = critical ? "critical" : warning ? "warning" : state;
  const label = critical ? `${critical} critical` : warning ? `${warning} warning` : state === "pending" ? "Awaiting analysis" : state === "offline" ? "Offline" : "Clear";
  return <span className={`camera-flag-status ${kind}`}><i />{label}</span>;
}

function CameraCard({ camera }: { camera: Camera }) {
  const flags = camera.latest?.flags ?? [];
  return <article className="camera-card"><CameraFlagStatus flags={flags} state={camera.latest ? "ready" : "offline"} />
    <div className="camera-image">{camera.latest?.evidenceAvailable ? <Frame result={camera.latest} /> : <div className="camera-empty">{camera.latest ? "Re-analyze to save evidence" : "Awaiting first frame"}</div>}<span className={`live-dot ${camera.latest?.isDemo ? "demo" : ""}`}>● {camera.latest?.isDemo ? "DEMO" : camera.latest?.evidenceAvailable ? "LATEST" : "READY"}</span></div>
    <div className="camera-tags">{flags.slice(0, 2).map((flag) => <span className={flag.severity} key={flag.kind}>{labelForKind(flag.kind)}</span>)}</div>
    <div className="camera-footer"><div><strong>{camera.zone}</strong><span>{camera.name}</span></div><small>{camera.latest ? `${camera.latest.peopleCount} people · ${formatTime(camera.latest.createdAt)}` : "Upload a frame to begin"}</small></div>
  </article>;
}

function UploadedVideoCard({ video }: { video: LiveVideo }) {
  const analysis = video.analysis;
  return <article className="camera-card uploaded-video-card"><CameraFlagStatus flags={analysis?.flags ?? []} state={analysis ? "ready" : "pending"} />
    <div className="camera-image"><div className="ops-frame"><video src={video.url} autoPlay muted loop playsInline controls />
      {analysis?.people.map((person, index) => <span className="ops-box person" key={`live-person-${index}`} style={percentBox(person.bbox, analysis.image)}><b>Person</b></span>)}
      {analysis?.bins.map((bin) => <span className={`ops-box bin ${bin.state}`} key={`live-bin-${bin.binIndex}`} style={percentBox(bin.bbox, analysis.image)}><b>{bin.state}</b></span>)}
      {analysis?.floorHazards.map((hazard, index) => <span className={`ops-box hazard ${hazard.className}`} key={`live-hazard-${index}`} style={percentBox(hazard.bbox, analysis.image)}><b>{hazard.className.replace("floor_", "")}</b></span>)}
    </div><span className="live-dot uploaded">● LIVE UPLOAD</span></div>
    <div className="camera-tags">{analysis?.flags.slice(0, 2).map((flag) => <span className={flag.severity} key={flag.kind}>{labelForKind(flag.kind)}</span>)}</div>
    <div className="camera-footer"><div><strong>{video.cameraId.toUpperCase()}</strong><span>Pipeline upload</span></div><small>{analysis ? `${analysis.peopleCount} people · ${analysis.flags.length} flags` : "Awaiting analysis"}<br />{video.name}</small></div>
  </article>;
}

function AlertTable({ alerts, onStatus }: { alerts: Alert[]; onStatus: (alert: Alert, status: Alert["status"]) => void }) {
  const [expanded, setExpanded] = useState<number>();
  return <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Alert</th><th>Camera / zone</th><th>Detected</th><th>Confidence</th><th>Severity</th><th>Status</th></tr></thead><tbody>{alerts.map((alert) => <>
    <tr key={alert.id} className={expanded === alert.id ? "selected" : ""} onClick={() => setExpanded(expanded === alert.id ? undefined : alert.id)}><td><strong>EVT-{String(alert.id).padStart(4, "0")}</strong><span>{labelForKind(alert.kind)}</span></td><td>{alert.cameraName}<span>{alert.zone}</span></td><td>{formatTime(alert.createdAt)}</td><td>{alert.confidence ? `${(alert.confidence * 100).toFixed(1)}%` : "—"}</td><td><b className={`severity ${alert.severity}`}>{alert.severity}</b></td><td><span className={`status-pill ${statusClass(alert.status)}`}>{alert.status}</span></td></tr>
    {expanded === alert.id && <tr className="alert-detail" key={`${alert.id}-detail`}><td colSpan={6}><div>{alert.evidenceAvailable && <img src={evidenceUrl(alert.analysisId)} alt="Alert evidence" />}<section><p>{alert.peopleCount} people in frame · latest evidence retained</p><div className="status-actions">{(["active", "resolved", "dismissed"] as const).map((status) => <button className={status === alert.status ? "selected" : ""} key={status} onClick={(event) => { event.stopPropagation(); onStatus(alert, status); }}>{status}</button>)}</div></section></div></td></tr>}
  </>)}</tbody></table>{alerts.length === 0 && <p className="empty-copy">No alerts match these filters.</p>}</div>;
}

function AlertFilters({ severity, status, onSeverity, onStatus }: { severity: string; status: string; onSeverity: (value: string) => void; onStatus: (value: string) => void }) {
  return <div className="alert-filter-groups">
    <div><span>Severity</span><div>{["all", "critical", "warning"].map((value) => <button className={severity === value ? "active" : ""} aria-pressed={severity === value} key={value} onClick={() => onSeverity(value)}>{value === "all" ? "All severity" : value}</button>)}</div></div>
    <div><span>Status</span><div>{["all", "active", "resolved", "dismissed"].map((value) => <button className={status === value ? "active" : ""} aria-pressed={status === value} key={value} onClick={() => onStatus(value)}>{value === "all" ? "All status" : value}</button>)}</div></div>
  </div>;
}

function LocationManagementPage({ sites, zones, cameras, error, onCreateSite, onCreateZone, onCreateCamera, onToggleSite, onToggleZone, onToggleCamera }: { sites: Site[]; zones: Zone[]; cameras: CameraRecord[]; error?: string; onCreateSite: (name: string) => Promise<void>; onCreateZone: (siteId: string, name: string) => Promise<void>; onCreateCamera: (zoneId: string, code: string, name: string) => Promise<void>; onToggleSite: (site: Site) => Promise<void>; onToggleZone: (zone: Zone) => Promise<void>; onToggleCamera: (camera: CameraRecord) => Promise<void> }) {
  const activeSites = sites.filter((site) => site.status === "active");
  const activeZones = zones.filter((zone) => zone.status === "active" && activeSites.some((site) => site.id === zone.siteId));
  const nextCameraNumber = Math.max(0, ...cameras.map((camera) => Number(camera.code.match(/\d+$/)?.[0] ?? 0))) + 1;
  const [siteName, setSiteName] = useState("");
  const [zoneSiteId, setZoneSiteId] = useState("");
  const [zoneName, setZoneName] = useState("");
  const [cameraZoneId, setCameraZoneId] = useState("");
  const [cameraCode, setCameraCode] = useState(`CAMERA-${nextCameraNumber}`);
  const [cameraName, setCameraName] = useState(`CAMERA-${nextCameraNumber}`);
  const [message, setMessage] = useState<string>();

  async function run(action: () => Promise<void>, success: string) {
    setMessage(undefined);
    try { await action(); setMessage(success); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "The location update failed."); }
  }

  return <section className="ops-page"><header className="page-title"><div><span>LOCATION SETUP</span><h1>Sites, zones, and cameras</h1><p>Configure the hierarchy used by detections, cleaner assignments, alerts, and analytics.</p></div></header>{error && <p className="profile-feedback" role="alert">{error}</p>}{message && <p className="register-message">{message}</p>}
    <div className="camera-register-layout"><form className="camera-register-card" onSubmit={(event) => { event.preventDefault(); void run(async () => { await onCreateSite(siteName); setSiteName(""); }, "Site created."); }}><div><span className="step">01</span><h2>Create site</h2></div><label>Site name<input value={siteName} onChange={(event) => setSiteName(event.target.value)} placeholder="Batu Caves" minLength={2} maxLength={80} required /></label><button className="primary" type="submit">Create site <span>→</span></button></form><section className="registered-camera-list"><div><h2>Sites</h2><b>{activeSites.length} active</b></div>{sites.map((site) => <article key={site.id}><i className={site.status === "active" ? "online" : ""} /><div><strong>{site.name}</strong><span>{site.timezone}</span></div><button className={`staff-status ${site.status}`} onClick={() => void run(() => onToggleSite(site), `Site marked ${site.status === "active" ? "inactive" : "active"}.`)}>{site.status}</button></article>)}</section></div>
    <div className="camera-register-layout"><form className="camera-register-card" onSubmit={(event) => { event.preventDefault(); void run(async () => { await onCreateZone(zoneSiteId, zoneName); setZoneName(""); }, "Zone created."); }}><div><span className="step">02</span><h2>Create cleaning zone</h2></div><label>Site<select value={zoneSiteId} onChange={(event) => setZoneSiteId(event.target.value)} required><option value="">{activeSites.length ? "Select an active site" : "Create an active site first"}</option>{activeSites.map((site) => <option value={site.id} key={site.id}>{site.name}</option>)}</select></label><label>Zone name<input value={zoneName} onChange={(event) => setZoneName(event.target.value)} placeholder="Lower Main Staircase" minLength={2} maxLength={80} required /></label><button className="primary" type="submit" disabled={!activeSites.length}>Create zone <span>→</span></button></form><section className="registered-camera-list"><div><h2>Cleaning zones</h2><b>{activeZones.length} active</b></div>{zones.map((zone) => <article key={zone.id}><i className={zone.status === "active" ? "online" : ""} /><div><strong>{zone.name}</strong><span>{zone.siteName}</span></div><button className={`staff-status ${zone.status}`} onClick={() => void run(() => onToggleZone(zone), `Zone marked ${zone.status === "active" ? "inactive" : "active"}.`)}>{zone.status}</button></article>)}</section></div>
    <div className="camera-register-layout"><form className="camera-register-card" onSubmit={(event) => { event.preventDefault(); void run(async () => { await onCreateCamera(cameraZoneId, cameraCode, cameraName); const following = nextCameraNumber + 1; setCameraCode(`CAMERA-${following}`); setCameraName(`CAMERA-${following}`); }, "Camera registered."); }}><div><span className="step">03</span><h2>Register camera</h2></div><label>Cleaning zone<select value={cameraZoneId} onChange={(event) => setCameraZoneId(event.target.value)} required><option value="">{activeZones.length ? "Select an active zone" : "Create an active zone first"}</option>{activeZones.map((zone) => <option value={zone.id} key={zone.id}>{zone.siteName} · {zone.name}</option>)}</select></label><label>Camera code<input value={cameraCode} onChange={(event) => setCameraCode(event.target.value.toUpperCase())} pattern="CAMERA-[1-9][0-9]*" required /></label><label>Display name<input value={cameraName} onChange={(event) => setCameraName(event.target.value)} minLength={2} maxLength={80} required /></label><button className="primary" type="submit" disabled={!activeZones.length}>Register camera <span>→</span></button></form><section className="registered-camera-list"><div><h2>Registered cameras</h2><b>{cameras.filter((camera) => camera.status === "active").length} active</b></div>{cameras.map((camera) => <article key={camera.id}><i className={camera.status === "active" ? "online" : ""} /><div><strong>{camera.name}</strong><span>{camera.code} · {camera.zoneName}</span></div><button className={`staff-status ${camera.status}`} onClick={() => void run(() => onToggleCamera(camera), `Camera marked ${camera.status === "active" ? "inactive" : "active"}.`)}>{camera.status}</button></article>)}</section></div>
  </section>;
}

function SupervisorProfileCard({ profile }: { profile: AdminProfile }) {
  const initials = profile.displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return <section className="admin-profile-manager"><div className="admin-profile-card"><div className="admin-avatar">{initials}</div><div><span>Authenticated Supervisor</span><strong>{profile.displayName}</strong><small>{profile.email}</small></div><b>SUPERVISOR</b></div></section>;
}

function AdminManagementPage({ profile, staff, zones, dataError, onRegister, onToggle }: { profile: AdminProfile; staff: Cleaner[]; zones: Zone[]; dataError?: string; onRegister: (input: { staffCode: string; fullName: string; phone: string; assignedZoneId: string }) => Promise<void>; onToggle: (cleaner: Cleaner) => Promise<void> }) {
  const nextNumber = Math.max(0, ...staff.map((person) => Number(person.staffCode.match(/\d+$/)?.[0] ?? 0))) + 1;
  const [staffId, setStaffId] = useState(`CLN-${String(nextNumber).padStart(3, "0")}`);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [zone, setZone] = useState("");
  const [message, setMessage] = useState<string>();
  const [errors, setErrors] = useState<Partial<Record<"staffId" | "name" | "phone" | "zone", string>>>({});

  async function submit(event: FormEvent) {
    event.preventDefault();
    const id = staffId.trim().toUpperCase();
    const nextErrors: typeof errors = {};
    if (!/^CLN-\d{3,}$/.test(id)) nextErrors.staffId = "Use CLN- followed by at least three digits, for example CLN-004.";
    else if (staff.some((person) => person.staffCode === id)) nextErrors.staffId = "This staff ID is already registered.";
    if (name.trim().length < 2 || name.trim().length > 60) nextErrors.name = "Enter a full name containing 2 to 60 characters.";
    if (!/^\+?[0-9 ()-]{8,20}$/.test(phone.trim())) nextErrors.phone = "Enter 8 to 20 digits; spaces, brackets, + and - are allowed.";
    if (!zone || !zones.some((item) => item.id === zone)) nextErrors.zone = "Select an active cleaning zone.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) { setMessage(undefined); return; }
    try {
      await onRegister({ staffCode: id, fullName: name.trim(), phone: phone.trim(), assignedZoneId: zone });
      const following = nextNumber + 1;
      setStaffId(`CLN-${String(following).padStart(3, "0")}`); setName(""); setPhone(""); setZone(""); setErrors({}); setMessage("Cleaner registered successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Cleaner could not be registered.");
    }
  }

  return <section className="ops-page"><header className="page-title"><div><span>PERSONNEL</span><h1>Cleaner management</h1><p>Maintain cleaner information and zone assignments. Cleaners do not log in to LitterSpot.</p></div></header><SupervisorProfileCard profile={profile} />{dataError && <p className="profile-feedback" role="alert">{dataError}</p>}<div className="staff-management-layout"><form className="camera-register-card staff-register-card" onSubmit={submit} noValidate><div><span className="step">01</span><h2>Register cleaner</h2></div>
    <label>Staff ID<input className={errors.staffId ? "invalid" : ""} aria-invalid={Boolean(errors.staffId)} value={staffId} onChange={(event) => { setStaffId(event.target.value.toUpperCase()); setErrors((current) => ({ ...current, staffId: undefined })); setMessage(undefined); }} placeholder="CLN-004" />{errors.staffId ? <small className="field-error">{errors.staffId}</small> : <small>Required format: CLN- followed by at least three digits.</small>}</label>
    <label>Full name<input className={errors.name ? "invalid" : ""} aria-invalid={Boolean(errors.name)} value={name} onChange={(event) => { setName(event.target.value); setErrors((current) => ({ ...current, name: undefined })); }} placeholder="Cleaner name" />{errors.name && <small className="field-error">{errors.name}</small>}</label>
    <label>Phone number<input className={errors.phone ? "invalid" : ""} aria-invalid={Boolean(errors.phone)} value={phone} onChange={(event) => { setPhone(event.target.value); setErrors((current) => ({ ...current, phone: undefined })); }} placeholder="+60 12-345 6789" />{errors.phone && <small className="field-error">{errors.phone}</small>}</label>
    <label>Assigned zone<select className={errors.zone ? "invalid" : ""} aria-invalid={Boolean(errors.zone)} value={zone} onChange={(event) => { setZone(event.target.value); setErrors((current) => ({ ...current, zone: undefined })); }}><option value="">{zones.length ? "Select an active zone" : "No active zones configured"}</option>{zones.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>{errors.zone && <small className="field-error">{errors.zone}</small>}</label>
    <button className="primary" type="submit" disabled={!zones.length}>Register cleaner <span>→</span></button>{message && <p className="register-message">{message}</p>}</form><section className="staff-directory"><header><div><span className="step">02</span><h2>Cleaner directory</h2></div><b>{staff.filter((person) => person.status === "active").length} active</b></header>{staff.map((person) => <article key={person.id}><div className="staff-avatar">{person.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</div><div><strong>{person.fullName}</strong><span>{person.staffCode} · {person.assignedZoneName}</span><small>{person.phone}</small></div><button className={`staff-status ${person.status}`} onClick={() => void onToggle(person)}>{person.status}</button></article>)}</section></div></section>;
}

export function OperationsConsole({ supervisor, page, onNavigate, onLogout }: { supervisor: AdminProfile & { uid: string }; page: Page; onNavigate: (page: Page) => void; onLogout: () => void }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [staff, setStaff] = useState<Cleaner[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [cameraRecords, setCameraRecords] = useState<CameraRecord[]>([]);
  const [staffError, setStaffError] = useState<string>();
  const [locationError, setLocationError] = useState<string>();
  const [liveVideos, setLiveVideos] = useState<LiveVideo[]>(() => getLiveVideos());
  useEffect(() => subscribeLiveVideo(() => setLiveVideos(getLiveVideos())), []);
  useEffect(() => {
    void Promise.all([getCleaners(), getSites(), getZones(), getCameras()])
      .then(([cleaners, siteItems, zoneItems, cameraItems]) => { setStaff(cleaners); setSites(siteItems); setZones(zoneItems); setCameraRecords(cameraItems); setStaffError(undefined); setLocationError(undefined); })
      .catch((error) => { const message = error instanceof Error ? error.message : "Cloud application data could not be loaded."; setStaffError(message); setLocationError(message); });
  }, []);
  const cameras = useMemo<Camera[]>(() => cameraRecords.filter((camera) => camera.status === "active").map((camera) => ({ id: camera.code, name: camera.name, zone: camera.zoneName, enabled: true, latest: null })), [cameraRecords]);
  const [allAlerts, setAllAlerts] = useState<Alert[]>(demoAlerts);
  const dashboard = useMemo(() => ({ cameras, summary: { activeAlerts: allAlerts.filter((item) => item.status === "active").length, resolvedAlerts: allAlerts.filter((item) => item.status === "resolved").length, configuredCameras: cameras.length } }), [allAlerts, cameras]);
  const [status, setStatus] = useState<string>("all");
  const [severity, setSeverity] = useState<string>("all");
  const [gridView, setGridView] = useState<"3x2" | "2x3" | "1x6">("3x2");
  const [historyQuery, setHistoryQuery] = useState("");
  const alerts = useMemo(() => allAlerts.filter((item) => (status === "all" || item.status === status) && (severity === "all" || item.severity === severity)), [allAlerts, severity, status]);
  const history = useMemo(() => { const query = historyQuery.trim().toLowerCase(); return allAlerts.filter((item) => item.status !== "active" && (!query || `${item.cameraName} ${item.zone} ${labelForKind(item.kind)}`.toLowerCase().includes(query))); }, [allAlerts, historyQuery]);
  const placement = demoPlacement;
  const gridColumns = gridView === "3x2" ? 3 : gridView === "2x3" ? 2 : 1;
  const loading = false;
  const error: string | undefined = undefined;
  const refreshDashboard = () => undefined;
  const refreshAlerts = () => undefined;
  const refreshHistory = () => undefined;
  const refreshPlacement = () => undefined;
  const load = () => undefined;

  function changeStatus(alert: Alert, next: Alert["status"]) {
    if (alert.status === next) return;
    setAllAlerts((items) => items.map((item) => item.id === alert.id ? { ...item, status: next, updatedAt: new Date().toISOString(), resolvedAt: next === "resolved" ? new Date().toISOString() : null } : item));
  }

  const content = useMemo(() => {
    if (page === "admin") return <AdminManagementPage profile={supervisor} staff={staff} zones={zones.filter((zone) => zone.status === "active")} dataError={staffError} onRegister={async (input) => { const cleaner = await createCleaner(input); setStaff((items) => [...items, cleaner].sort((left, right) => left.fullName.localeCompare(right.fullName))); setStaffError(undefined); }} onToggle={async (person) => { try { const cleaner = await updateCleanerStatus(person.id, person.status === "active" ? "inactive" : "active"); setStaff((items) => items.map((item) => item.id === cleaner.id ? cleaner : item)); setStaffError(undefined); } catch (error) { setStaffError(error instanceof Error ? error.message : "Cleaner status could not be updated."); } }} />;
    if (page === "cameras") return <LocationManagementPage sites={sites} zones={zones} cameras={cameraRecords} error={locationError} onCreateSite={async (name) => { const site = await createSite({ name }); setSites((items) => [...items, site].sort((left, right) => left.name.localeCompare(right.name))); setLocationError(undefined); }} onCreateZone={async (siteId, name) => { const zone = await createZone({ siteId, name }); setZones((items) => [...items, zone].sort((left, right) => left.name.localeCompare(right.name))); setLocationError(undefined); }} onCreateCamera={async (zoneId, code, name) => { const camera = await createCamera({ zoneId, code, name }); setCameraRecords((items) => [...items, camera].sort((left, right) => left.code.localeCompare(right.code, undefined, { numeric: true }))); setLocationError(undefined); }} onToggleSite={async (site) => { const updated = await updateSite(site.id, { status: site.status === "active" ? "inactive" : "active" }); setSites((items) => items.map((item) => item.id === updated.id ? updated : item)); }} onToggleZone={async (zone) => { const updated = await updateZone(zone.id, { status: zone.status === "active" ? "inactive" : "active" }); setZones((items) => items.map((item) => item.id === updated.id ? updated : item)); }} onToggleCamera={async (camera) => { const updated = await updateCamera(camera.id, { status: camera.status === "active" ? "inactive" : "active" }); setCameraRecords((items) => items.map((item) => item.id === updated.id ? updated : item)); }} />;
    if (page === "alerts") return <section className="ops-page"><header className="page-title"><div><span>ALERTS</span><h1>Alert center</h1><p>Review and manage detection events.</p></div><button className="outline-button" onClick={() => void refreshAlerts()}>Refresh</button></header><div className="summary-cards"><button onClick={() => setStatus("all")} className={status === "all" ? "active" : ""}><b>{allAlerts.length}</b><span>Total events</span></button><button onClick={() => setStatus("active")} className={status === "active" ? "active" : ""}><b>{allAlerts.filter((item) => item.status === "active").length}</b><span>Active</span></button><button onClick={() => setStatus("resolved")} className={status === "resolved" ? "active" : ""}><b>{allAlerts.filter((item) => item.status === "resolved").length}</b><span>Resolved</span></button><button onClick={() => setStatus("dismissed")} className={status === "dismissed" ? "active" : ""}><b>{allAlerts.filter((item) => item.status === "dismissed").length}</b><span>Dismissed</span></button></div><AlertFilters severity={severity} status={status} onSeverity={setSeverity} onStatus={setStatus} /><AlertTable alerts={alerts} onStatus={(alert, next) => void changeStatus(alert, next)} /></section>;
    if (page === "history") return <section className="ops-page"><header className="page-title"><div><span>HISTORY</span><h1>Resolved events</h1><p>Read-only record of completed detection cases.</p></div><button className="outline-button" onClick={() => void refreshHistory()}>Refresh</button></header><input className="search-field" placeholder="Search camera, zone, or detection type" value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} /><AlertTable alerts={history} onStatus={() => undefined} /></section>;
    if (page === "placement") return <section className="ops-page"><header className="page-title"><div><span>REPORTS</span><h1>Bin placement analysis</h1><p>Overflow frequency and people popularity are ranked independently.</p></div><button className="outline-button" onClick={() => void refreshPlacement()}>Refresh</button></header><div className="placement-grid">{placement.map((item) => <article className={`placement-tile ${item.recommended ? "recommended" : ""}`} key={item.cameraId}><div><span>{item.zone}</span><h2>{item.cameraName}</h2></div><b className={item.recommended ? "critical" : "ok"}>{item.recommended ? "RECOMMENDED" : item.status.replaceAll("_", " ")}</b><dl><div><dt>Overflow rank</dt><dd>{item.overflowRank} / {item.overflowThreshold}</dd></div><div><dt>Popularity rank</dt><dd>{item.popularityRank} / {item.popularityThreshold}</dd></div><div><dt>Observation</dt><dd>{item.validDays}/{item.requiredValidDays} days</dd></div></dl><p>{item.recommended ? `Raised by ${item.triggerReason?.replaceAll("_", " ") ?? "rank"}.` : "Continue collecting camera observations."}</p></article>)}</div></section>;
    return <section className="ops-page"><header className="page-title"><div><span>DASHBOARD</span><h1>Live camera overview</h1><p>Latest analyzed snapshots from each registered camera.</p></div><button className="outline-button" onClick={() => void refreshDashboard()}>Refresh</button></header><div className="dashboard-statline"><span><b>{dashboard?.summary.activeAlerts ?? 0}</b> Active alerts</span><span><b>{dashboard?.summary.resolvedAlerts ?? 0}</b> Resolved</span><span><b>{dashboard?.summary.configuredCameras ?? 0}</b> Cameras configured</span></div><div className="camera-grid-toolbar"><div className="grid-view-switcher" role="group" aria-label="Choose camera grid layout">{([['1x6', 'Single column', 1], ['2x3', 'Two columns', 2], ['3x2', 'Three columns', 6]] as const).map(([value, label, cells]) => <button className={gridView === value ? "active" : ""} aria-label={label} title={label} aria-pressed={gridView === value} key={value} onClick={() => setGridView(value)}><span className={`grid-view-icon cells-${cells}`} aria-hidden="true">{Array.from({ length: cells }, (_, index) => <i key={index} />)}</span></button>)}</div></div><section className="camera-grid camera-grid-adjustable" style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}>{dashboard.cameras.map((camera) => { const uploaded = liveVideos.find((video) => video.cameraId === camera.id); return uploaded ? <UploadedVideoCard video={uploaded} key={camera.id} /> : <CameraCard camera={camera} key={camera.id} />; })}</section><section className="dashboard-empty"><h2>Need a fresh camera frame?</h2><p>Use the pipeline playground to upload the exact camera image, plot a floor-only ROI, and create a saved evidence record.</p><button className="primary" onClick={() => { location.hash = "/pipeline"; }}>Open pipeline playground</button></section></section>;
  }, [alerts, allAlerts, cameraRecords, cameras, dashboard, gridColumns, gridView, history, historyQuery, liveVideos, locationError, page, placement, severity, sites, staff, staffError, status, supervisor, zones]);

  const go = (target: Page) => { onNavigate(target); setDrawerOpen(false); };
  return <div className={`ops-shell ${drawerOpen ? "drawer-open" : ""}`}>
    <button className="drawer-backdrop" aria-label="Close navigation" onClick={() => setDrawerOpen(false)} />
    <aside className="ops-sidebar"><div className="ops-brand"><b>♲</b><div><strong>LITTERSPOT</strong><span>AI Waste Monitor</span></div></div><nav>
      <p>MAIN</p>{(["dashboard", "alerts", "history"] as Page[]).map((item) => <button className={page === item ? "current" : ""} key={item} onClick={() => go(item)}>{item === "history" ? "History log" : item}<i>{item === "alerts" && dashboard.summary.activeAlerts ? dashboard.summary.activeAlerts : ""}</i></button>)}
      <p>LOCATION SETUP</p><button className={page === "cameras" ? "current" : ""} onClick={() => go("cameras")}>Sites & cameras</button>
      <p>PERSONNEL</p><button className={page === "admin" ? "current" : ""} onClick={() => go("admin")}>Cleaner management</button>
      <p>REPORTS</p><button className={page === "placement" ? "current" : ""} onClick={() => go("placement")}>Bin analysis</button>
    </nav><div className="sidebar-cameras"><p>CAMERAS</p>{dashboard.cameras.map((camera) => <span key={camera.id}><i className={camera.latest ? "online" : "offline"} />{camera.name}<small>{camera.latest?.flags.length ?? 0}</small></span>)}</div><div className="sidebar-user"><b>{supervisor.displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</b><span>{supervisor.displayName}<small>Supervisor</small></span></div></aside>
    <main className="ops-main"><header className="ops-topbar"><button className="mobile-nav" aria-label="Open navigation" onClick={() => setDrawerOpen(true)}>☰</button><span>{page}</span><div className="ops-topbar-actions"><button className="outline-button" onClick={() => { location.hash = "/pipeline"; }}>Analyze frame</button><button className="outline-button logout-button" onClick={onLogout}>Sign out</button></div></header>{loading ? <p className="ops-loading">Loading operations data…</p> : error ? <div className="ops-error"><p>{error}</p><button className="outline-button" onClick={() => void load()}>Try again</button></div> : content}</main>
  </div>;
}
