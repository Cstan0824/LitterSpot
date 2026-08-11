import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Alert, Camera, FrameResult, Placement } from "./types";
import { getLiveVideos, subscribeLiveVideo, type LiveVideo } from "../pipeline/liveVideoStore";

type Page = "dashboard" | "alerts" | "history" | "placement" | "cameras" | "admin";
type Staff = { id: string; name: string; phone: string; zone: string; status: "active" | "inactive" };
type AdminProfile = { name: string; email: string };
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
const initialStaff: Staff[] = [
  { id: "CLN-001", name: "Aisyah Rahman", phone: "+60 12-345 6789", zone: "North Entrance", status: "active" },
  { id: "CLN-002", name: "Daniel Lim", phone: "+60 17-882 1044", zone: "Food Court", status: "active" },
  { id: "CLN-003", name: "Kumar Raj", phone: "+60 11-2034 8891", zone: "West Plaza", status: "inactive" },
];

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

function RegisterCameraPage({ cameras, onRegister }: { cameras: Camera[]; onRegister: (camera: Camera) => void }) {
  const nextNumber = cameras.length + 1;
  const [cameraId, setCameraId] = useState(`CAMERA-${nextNumber}`);
  const [name, setName] = useState(`CAMERA-${nextNumber}`);
  const [zone, setZone] = useState("");
  const [message, setMessage] = useState<string>();

  function submit(event: FormEvent) {
    event.preventDefault();
    const id = cameraId.trim().toUpperCase();
    if (!/^CAMERA-[1-9]\d*$/.test(id)) { setMessage("Camera ID must use CAMERA- followed by a positive number, for example CAMERA-7."); return; }
    if (cameras.some((camera) => camera.id.toUpperCase() === id)) { setMessage("That camera ID is already registered."); return; }
    if (name.trim().length < 2 || name.trim().length > 40) { setMessage("Display name must contain 2 to 40 characters."); return; }
    if (zone.trim().length < 2 || zone.trim().length > 60) { setMessage("Zone must contain 2 to 60 characters."); return; }
    onRegister({ id, name: name.trim(), zone: zone.trim(), enabled: true, latest: null });
    const following = cameras.length + 2;
    setCameraId(`CAMERA-${following}`); setName(`CAMERA-${following}`); setZone(""); setMessage("Camera registered and added to the live overview.");
  }

  return <section className="ops-page"><header className="page-title"><div><span>CAMERA SETUP</span><h1>Register camera view</h1><p>Add a camera slot now and connect its stream or analysis source later.</p></div></header><div className="camera-register-layout"><form className="camera-register-card" onSubmit={submit} noValidate><div><span className="step">01</span><h2>Camera details</h2></div><label>Camera ID<input value={cameraId} onChange={(event) => { setCameraId(event.target.value.toUpperCase()); setMessage(undefined); }} placeholder="CAMERA-7" pattern="CAMERA-[1-9][0-9]*" aria-describedby="camera-id-format" required /><small id="camera-id-format">Required format: CAMERA- followed by a positive number.</small></label><label>Display name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="CAMERA-7" required /></label><label>Zone or location<input value={zone} onChange={(event) => setZone(event.target.value)} placeholder="South entrance" required /></label><button className="primary" type="submit">Register camera <span>→</span></button>{message && <p className="register-message">{message}</p>}</form><aside className="registered-camera-list"><div><span className="step">02</span><h2>Registered views</h2><b>{cameras.length}</b></div>{cameras.map((camera) => <article key={camera.id}><i className={camera.latest ? "online" : ""} /><div><strong>{camera.name}</strong><span>{camera.zone}</span></div><small>{camera.id}</small></article>)}</aside></div></section>;
}

function AdminProfileManager({ profile, onSave }: { profile: AdminProfile; onSave: (profile: AdminProfile) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profile.name);
  const [email, setEmail] = useState(profile.email);
  const [password, setPassword] = useState("");
  const [feedback, setFeedback] = useState<string>();
  const [errors, setErrors] = useState<Partial<Record<"name" | "email" | "password", string>>>({});
  const initials = profile.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  function save(event: FormEvent) { event.preventDefault(); const nextErrors: typeof errors = {}; if (name.trim().length < 2 || name.trim().length > 60) nextErrors.name = "Enter 2 to 60 characters."; if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) nextErrors.email = "Enter a valid email address."; if (password && password.length < 8) nextErrors.password = "New password must contain at least 8 characters."; setErrors(nextErrors); if (Object.keys(nextErrors).length) return; onSave({ name: name.trim(), email: email.trim().toLowerCase() }); setPassword(""); setFeedback(password ? "Profile and demo password updated." : "Profile updated."); setEditing(false); }
  return <section className="admin-profile-manager"><div className="admin-profile-card"><div className="admin-avatar">{initials}</div><div><span>System administrator</span><strong>{profile.name}</strong><small>{profile.email}</small></div><b>SOLE ADMIN</b><button className="outline-button" onClick={() => { setEditing(!editing); setFeedback(undefined); }}>{editing ? "Cancel" : "Manage profile"}</button></div>{editing && <form className="admin-profile-form" onSubmit={save} noValidate><label>Display name<input className={errors.name ? "invalid" : ""} value={name} onChange={(event) => { setName(event.target.value); setErrors((current) => ({ ...current, name: undefined })); }} />{errors.name && <small className="field-error">{errors.name}</small>}</label><label>Email address<input className={errors.email ? "invalid" : ""} value={email} onChange={(event) => { setEmail(event.target.value); setErrors((current) => ({ ...current, email: undefined })); }} />{errors.email && <small className="field-error">{errors.email}</small>}</label><label>New password<input className={errors.password ? "invalid" : ""} type="password" value={password} onChange={(event) => { setPassword(event.target.value); setErrors((current) => ({ ...current, password: undefined })); }} placeholder="Leave blank to keep current" />{errors.password && <small className="field-error">{errors.password}</small>}</label><button className="primary" type="submit">Save profile</button></form>}{feedback && <p className="profile-feedback">{feedback}</p>}</section>;
}

function AdminManagementPage({ profile, staff, zones, onSaveProfile, onRegister, onToggle }: { profile: AdminProfile; staff: Staff[]; zones: string[]; onSaveProfile: (profile: AdminProfile) => void; onRegister: (staff: Staff) => void; onToggle: (id: string) => void }) {
  const nextNumber = staff.length + 1;
  const [staffId, setStaffId] = useState(`CLN-${String(nextNumber).padStart(3, "0")}`);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [zone, setZone] = useState("");
  const [message, setMessage] = useState<string>();
  const [errors, setErrors] = useState<Partial<Record<"staffId" | "name" | "phone" | "zone", string>>>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    const id = staffId.trim().toUpperCase();
    const nextErrors: typeof errors = {};
    if (!/^CLN-\d{3,}$/.test(id)) nextErrors.staffId = "Use CLN- followed by at least three digits, for example CLN-004.";
    else if (staff.some((person) => person.id === id)) nextErrors.staffId = "This staff ID is already registered.";
    if (name.trim().length < 2 || name.trim().length > 60) nextErrors.name = "Enter a full name containing 2 to 60 characters.";
    if (!/^\+?[0-9 ()-]{8,20}$/.test(phone.trim())) nextErrors.phone = "Enter 8 to 20 digits; spaces, brackets, + and - are allowed.";
    if (!zone || !zones.includes(zone)) nextErrors.zone = "Select a zone registered to an existing camera.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) { setMessage(undefined); return; }
    onRegister({ id, name: name.trim(), phone: phone.trim(), zone: zone.trim(), status: "active" });
    const following = staff.length + 2;
    setStaffId(`CLN-${String(following).padStart(3, "0")}`); setName(""); setPhone(""); setZone(""); setErrors({}); setMessage("Cleaner registered successfully.");
  }

  return <section className="ops-page"><header className="page-title"><div><span>ADMINISTRATION</span><h1>Admin management</h1><p>One administrator manages cleaner access and assignments.</p></div></header><AdminProfileManager profile={profile} onSave={onSaveProfile} /><div className="staff-management-layout"><form className="camera-register-card staff-register-card" onSubmit={submit} noValidate><div><span className="step">01</span><h2>Register cleaner</h2></div>
    <label>Staff ID<input className={errors.staffId ? "invalid" : ""} aria-invalid={Boolean(errors.staffId)} value={staffId} onChange={(event) => { setStaffId(event.target.value.toUpperCase()); setErrors((current) => ({ ...current, staffId: undefined })); setMessage(undefined); }} placeholder="CLN-004" />{errors.staffId ? <small className="field-error">{errors.staffId}</small> : <small>Required format: CLN- followed by at least three digits.</small>}</label>
    <label>Full name<input className={errors.name ? "invalid" : ""} aria-invalid={Boolean(errors.name)} value={name} onChange={(event) => { setName(event.target.value); setErrors((current) => ({ ...current, name: undefined })); }} placeholder="Cleaner name" />{errors.name && <small className="field-error">{errors.name}</small>}</label>
    <label>Phone number<input className={errors.phone ? "invalid" : ""} aria-invalid={Boolean(errors.phone)} value={phone} onChange={(event) => { setPhone(event.target.value); setErrors((current) => ({ ...current, phone: undefined })); }} placeholder="+60 12-345 6789" />{errors.phone && <small className="field-error">{errors.phone}</small>}</label>
    <label>Assigned zone<select className={errors.zone ? "invalid" : ""} aria-invalid={Boolean(errors.zone)} value={zone} onChange={(event) => { setZone(event.target.value); setErrors((current) => ({ ...current, zone: undefined })); }}><option value="">Select an existing zone</option>{zones.map((item) => <option value={item} key={item}>{item}</option>)}</select>{errors.zone && <small className="field-error">{errors.zone}</small>}</label>
    <button className="primary" type="submit">Register cleaner <span>→</span></button>{message && <p className="register-message">{message}</p>}</form><section className="staff-directory"><header><div><span className="step">02</span><h2>Cleaner directory</h2></div><b>{staff.filter((person) => person.status === "active").length} active</b></header>{staff.map((person) => <article key={person.id}><div className="staff-avatar">{person.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</div><div><strong>{person.name}</strong><span>{person.id} · {person.zone}</span><small>{person.phone}</small></div><button className={`staff-status ${person.status}`} onClick={() => onToggle(person.id)}>{person.status}</button></article>)}</section></div></section>;
}

export function OperationsConsole({ page, onNavigate, onLogout }: { page: Page; onNavigate: (page: Page) => void; onLogout: () => void }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [cameras, setCameras] = useState<Camera[]>(demoCameras);
  const [staff, setStaff] = useState<Staff[]>(initialStaff);
  const [adminProfile, setAdminProfile] = useState<AdminProfile>({ name: "MVP Operator", email: "admin@litterspot.local" });
  const [liveVideos, setLiveVideos] = useState<LiveVideo[]>(() => getLiveVideos());
  useEffect(() => subscribeLiveVideo(() => setLiveVideos(getLiveVideos())), []);
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
    if (page === "admin") return <AdminManagementPage profile={adminProfile} staff={staff} zones={Array.from(new Set(cameras.map((camera) => camera.zone))).sort()} onSaveProfile={setAdminProfile} onRegister={(person) => setStaff((items) => [...items, person])} onToggle={(id) => setStaff((items) => items.map((person) => person.id === id ? { ...person, status: person.status === "active" ? "inactive" : "active" } : person))} />;
    if (page === "cameras") return <RegisterCameraPage cameras={cameras} onRegister={(camera) => setCameras((items) => [...items, camera])} />;
    if (page === "alerts") return <section className="ops-page"><header className="page-title"><div><span>ALERTS</span><h1>Alert center</h1><p>Review and manage detection events.</p></div><button className="outline-button" onClick={() => void refreshAlerts()}>Refresh</button></header><div className="summary-cards"><button onClick={() => setStatus("all")} className={status === "all" ? "active" : ""}><b>{allAlerts.length}</b><span>Total events</span></button><button onClick={() => setStatus("active")} className={status === "active" ? "active" : ""}><b>{allAlerts.filter((item) => item.status === "active").length}</b><span>Active</span></button><button onClick={() => setStatus("resolved")} className={status === "resolved" ? "active" : ""}><b>{allAlerts.filter((item) => item.status === "resolved").length}</b><span>Resolved</span></button><button onClick={() => setStatus("dismissed")} className={status === "dismissed" ? "active" : ""}><b>{allAlerts.filter((item) => item.status === "dismissed").length}</b><span>Dismissed</span></button></div><AlertFilters severity={severity} status={status} onSeverity={setSeverity} onStatus={setStatus} /><AlertTable alerts={alerts} onStatus={(alert, next) => void changeStatus(alert, next)} /></section>;
    if (page === "history") return <section className="ops-page"><header className="page-title"><div><span>HISTORY</span><h1>Resolved events</h1><p>Read-only record of completed detection cases.</p></div><button className="outline-button" onClick={() => void refreshHistory()}>Refresh</button></header><input className="search-field" placeholder="Search camera, zone, or detection type" value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} /><AlertTable alerts={history} onStatus={() => undefined} /></section>;
    if (page === "placement") return <section className="ops-page"><header className="page-title"><div><span>REPORTS</span><h1>Bin placement analysis</h1><p>Overflow frequency and people popularity are ranked independently.</p></div><button className="outline-button" onClick={() => void refreshPlacement()}>Refresh</button></header><div className="placement-grid">{placement.map((item) => <article className={`placement-tile ${item.recommended ? "recommended" : ""}`} key={item.cameraId}><div><span>{item.zone}</span><h2>{item.cameraName}</h2></div><b className={item.recommended ? "critical" : "ok"}>{item.recommended ? "RECOMMENDED" : item.status.replaceAll("_", " ")}</b><dl><div><dt>Overflow rank</dt><dd>{item.overflowRank} / {item.overflowThreshold}</dd></div><div><dt>Popularity rank</dt><dd>{item.popularityRank} / {item.popularityThreshold}</dd></div><div><dt>Observation</dt><dd>{item.validDays}/{item.requiredValidDays} days</dd></div></dl><p>{item.recommended ? `Raised by ${item.triggerReason?.replaceAll("_", " ") ?? "rank"}.` : "Continue collecting camera observations."}</p></article>)}</div></section>;
    return <section className="ops-page"><header className="page-title"><div><span>DASHBOARD</span><h1>Live camera overview</h1><p>Latest analyzed snapshots from each registered camera.</p></div><button className="outline-button" onClick={() => void refreshDashboard()}>Refresh</button></header><div className="dashboard-statline"><span><b>{dashboard?.summary.activeAlerts ?? 0}</b> Active alerts</span><span><b>{dashboard?.summary.resolvedAlerts ?? 0}</b> Resolved</span><span><b>{dashboard?.summary.configuredCameras ?? 0}/6</b> Cameras configured</span></div><div className="camera-grid-toolbar"><div className="grid-view-switcher" role="group" aria-label="Choose camera grid layout">{([['1x6', 'Single column', 1], ['2x3', 'Two columns', 2], ['3x2', 'Three columns', 6]] as const).map(([value, label, cells]) => <button className={gridView === value ? "active" : ""} aria-label={label} title={label} aria-pressed={gridView === value} key={value} onClick={() => setGridView(value)}><span className={`grid-view-icon cells-${cells}`} aria-hidden="true">{Array.from({ length: cells }, (_, index) => <i key={index} />)}</span></button>)}</div></div><section className="camera-grid camera-grid-adjustable" style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}>{dashboard.cameras.map((camera) => { const uploaded = liveVideos.find((video) => video.cameraId === camera.id); return uploaded ? <UploadedVideoCard video={uploaded} key={camera.id} /> : <CameraCard camera={camera} key={camera.id} />; })}</section><section className="dashboard-empty"><h2>Need a fresh camera frame?</h2><p>Use the pipeline playground to upload the exact camera image, plot a floor-only ROI, and create a saved evidence record.</p><button className="primary" onClick={() => { location.hash = "/pipeline"; }}>Open pipeline playground</button></section></section>;
  }, [adminProfile, alerts, allAlerts, cameras, dashboard, gridColumns, gridView, history, historyQuery, liveVideos, page, placement, severity, staff, status]);

  const go = (target: Page) => { onNavigate(target); setDrawerOpen(false); };
  return <div className={`ops-shell ${drawerOpen ? "drawer-open" : ""}`}>
    <button className="drawer-backdrop" aria-label="Close navigation" onClick={() => setDrawerOpen(false)} />
    <aside className="ops-sidebar"><div className="ops-brand"><b>♲</b><div><strong>LITTERSPOT</strong><span>AI Waste Monitor</span></div></div><nav>
      <p>MAIN</p>{(["dashboard", "alerts", "history"] as Page[]).map((item) => <button className={page === item ? "current" : ""} key={item} onClick={() => go(item)}>{item === "history" ? "History log" : item}<i>{item === "alerts" && dashboard.summary.activeAlerts ? dashboard.summary.activeAlerts : ""}</i></button>)}
      <p>CAMERA SETUP</p><button className={page === "cameras" ? "current" : ""} onClick={() => go("cameras")}>Register camera</button>
      <p>ADMINISTRATION</p><button className={page === "admin" ? "current" : ""} onClick={() => go("admin")}>Admin management</button>
      <p>REPORTS</p><button className={page === "placement" ? "current" : ""} onClick={() => go("placement")}>Bin analysis</button>
    </nav><div className="sidebar-cameras"><p>CAMERAS</p>{dashboard.cameras.map((camera) => <span key={camera.id}><i className={camera.latest ? "online" : "offline"} />{camera.name}<small>{camera.latest?.flags.length ?? 0}</small></span>)}</div><div className="sidebar-user"><b>MO</b><span>MVP operator<small>Local console</small></span></div></aside>
    <main className="ops-main"><header className="ops-topbar"><button className="mobile-nav" aria-label="Open navigation" onClick={() => setDrawerOpen(true)}>☰</button><span>{page}</span><div className="ops-topbar-actions"><button className="outline-button" onClick={() => { location.hash = "/pipeline"; }}>Analyze frame</button><button className="outline-button logout-button" onClick={onLogout}>Sign out</button></div></header>{loading ? <p className="ops-loading">Loading operations data…</p> : error ? <div className="ops-error"><p>{error}</p><button className="outline-button" onClick={() => void load()}>Try again</button></div> : content}</main>
  </div>;
}
