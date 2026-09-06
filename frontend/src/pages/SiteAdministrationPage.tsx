import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import "./site-administration.css";

type View = "overview" | "map" | "cameras" | "audit";
type Zone = { id: string; name: string; status: "active" | "inactive"; cameras: number; points: string; tone: "cyan" | "amber" | "jade" };
type Camera = { id: string; name: string; zoneId: string; source: string; status: "active" | "inactive"; registration: string; x: number; y: number };
type Audit = { id: number; action: string; detail: string; actor: string; authority: string; outcome: "Succeeded" | "Failed"; time: string };
type Dialog = "site" | "zone" | "camera" | "discard" | "publish" | null;

const initialZones: Zone[] = [
  { id: "food-court", name: "Food Court", status: "active", cameras: 1, points: "8 boundary points", tone: "amber" },
  { id: "main-walkway", name: "Main Walkway", status: "active", cameras: 1, points: "7 boundary points", tone: "cyan" },
  { id: "service-corridor", name: "Service Corridor", status: "inactive", cameras: 0, points: "6 boundary points", tone: "jade" },
];

const initialCameras: Camera[] = [
  { id: "LOCAL-CA", name: "Camera 1", zoneId: "food-court", source: "Looped video", status: "active", registration: "Floor + 1 bin", x: 31, y: 38 },
  { id: "LOCAL-CB", name: "Camera 2", zoneId: "main-walkway", source: "Looped video", status: "active", registration: "Floor + 1 bin", x: 68, y: 55 },
];

const initialAudit: Audit[] = [
  { id: 1, action: "Camera reconfigured", detail: "Camera 2 retained its placement in Main Walkway.", actor: "Ganesh Raj", authority: "Root Supervisor", outcome: "Succeeded", time: "07 Sep, 5:31 PM" },
  { id: 2, action: "Site Map published", detail: "Revision 12 became the active Site Map.", actor: "Ganesh Raj", authority: "Root Supervisor", outcome: "Succeeded", time: "07 Sep, 4:48 PM" },
  { id: 3, action: "Zone updated", detail: "Food Court boundary was reshaped.", actor: "Ganesh Raj", authority: "Root Supervisor", outcome: "Succeeded", time: "06 Sep, 11:20 PM" },
  { id: 4, action: "Camera placement rejected", detail: "The point was outside every active Zone.", actor: "Ganesh Raj", authority: "Root Supervisor", outcome: "Failed", time: "06 Sep, 10:54 PM" },
  { id: 5, action: "Site background replaced", detail: "The new background was published with revision 11.", actor: "Ganesh Raj", authority: "Root Supervisor", outcome: "Succeeded", time: "06 Sep, 9:12 PM" },
];

function Icon({ name }: { name: "map" | "zone" | "camera" | "audit" | "upload" | "edit" | "close" | "check" }) {
  if (name === "map") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Z" /><path d="M9 3v16M15 5v16" /></svg>;
  if (name === "zone") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 4 14 2-2 13-12 1-2-9Z" /><circle cx="5" cy="4" r="1.5" /><circle cx="19" cy="6" r="1.5" /><circle cx="17" cy="19" r="1.5" /></svg>;
  if (name === "camera") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="14" height="12" /><path d="m17 10 4-2v8l-4-2M8 6l1-2h3l1 2" /></svg>;
  if (name === "audit") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4" /></svg>;
  if (name === "upload") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 15v5h16v-5" /></svg>;
  if (name === "edit") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-1 5 5-1L19 9l-4-4Z" /><path d="m13 7 4 4" /></svg>;
  if (name === "check") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>;
}

function SiteMap({ zones, cameras, selectedZoneId, onZone, onCamera, backgroundUrl, editing }: { zones: Zone[]; cameras: Camera[]; selectedZoneId: string; onZone: (id: string) => void; onCamera: (camera: Camera) => void; backgroundUrl?: string; editing: boolean }) {
  return <div className={`site-map-canvas ${editing ? "editing" : ""}`} style={backgroundUrl ? { backgroundImage: `linear-gradient(rgba(8, 30, 45, .48), rgba(8, 30, 45, .48)), url(${backgroundUrl})` } : undefined}>
    <svg className="site-map-geometry" viewBox="0 0 100 70" preserveAspectRatio="none" aria-label="Hardcoded Site Map preview">
      {zones[0]?.status === "active" && <polygon className={`zone-shape amber ${selectedZoneId === zones[0].id ? "selected" : ""}`} points="7,8 46,6 48,30 35,42 8,38" onClick={() => onZone(zones[0].id)} />}
      {zones[1]?.status === "active" && <polygon className={`zone-shape cyan ${selectedZoneId === zones[1].id ? "selected" : ""}`} points="52,10 91,12 94,57 62,64 48,43" onClick={() => onZone(zones[1].id)} />}
      {editing && <g className="map-vertices">{[[7,8],[46,6],[48,30],[35,42],[8,38],[52,10],[91,12],[94,57],[62,64],[48,43]].map(([x,y], index) => <circle key={index} cx={x} cy={y} r="1" />)}</g>}
    </svg>
    <span className="site-map-scale">20 m</span>
    <span className="site-map-north">N</span>
    {cameras.filter((camera) => camera.status === "active").map((camera) => <button type="button" className="site-map-camera" style={{ left: `${camera.x}%`, top: `${camera.y}%` }} key={camera.id} onClick={() => onCamera(camera)} aria-label={`Open ${camera.name}`}><Icon name="camera" /><span>{camera.name}</span></button>)}
    {!backgroundUrl && <div className="site-map-background-label"><strong>Site background</strong><span>Upload a plan or image from Edit map settings</span></div>}
  </div>;
}

export function SiteAdministrationPage({ siteName, readOnly = false }: { siteName: string; readOnly?: boolean }) {
  const [view, setView] = useState<View>("overview");
  const [zones, setZones] = useState(initialZones);
  const [cameras, setCameras] = useState(initialCameras);
  const [audit, setAudit] = useState(initialAudit);
  const [selectedZoneId, setSelectedZoneId] = useState("food-court");
  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [draft, setDraft] = useState(false);
  const [toast, setToast] = useState("");
  const [backgroundUrl, setBackgroundUrl] = useState<string>();
  const [dimensions, setDimensions] = useState({ width: 120, height: 80 });
  const [auditFilter, setAuditFilter] = useState<"all" | "success" | "failed">("all");
  const closeRef = useRef<HTMLButtonElement>(null);
  const resolvedSiteName = siteName === "Active site" ? "Sunway Theme Park" : siteName;
  const selectedZone = zones.find((zone) => zone.id === selectedZoneId) ?? zones[0];
  const filteredAudit = useMemo(() => audit.filter((entry) => auditFilter === "all" || (auditFilter === "success" ? entry.outcome === "Succeeded" : entry.outcome === "Failed")), [audit, auditFilter]);

  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 2600); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { if (!dialog) return; const close = (event: KeyboardEvent) => { if (event.key === "Escape") setDialog(null); }; addEventListener("keydown", close); return () => removeEventListener("keydown", close); }, [dialog]);

  const record = (action: string, detail: string) => setAudit((current) => [{ id: Date.now(), action, detail, actor: "Ganesh Raj", authority: "Root Supervisor", outcome: "Succeeded", time: "Preview just now" }, ...current]);
  const startDraft = () => { if (readOnly) return; setDraft(true); setToast("Map Draft 13 started in this UI preview."); };
  const publishDraft = () => { setDraft(false); setDialog(null); record("Site Map published", "Preview revision 13 became active."); setToast("Preview revision published."); };
  const discardDraft = () => { setDraft(false); setDialog(null); setToast("Preview draft discarded."); };

  function saveSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setDimensions({ width: Number(form.get("width")), height: Number(form.get("height")) });
    setDialog(null); if (!draft) setDraft(true); record("Site Map settings changed", "Dimensions or background changed in the UI preview."); setToast("Map settings saved to Preview Draft 13.");
  }

  function addZone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get("name") || "New Zone"); const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
    setZones((current) => [...current, { id, name, status: "active", cameras: 0, points: "Plotting required", tone: "jade" }]); setSelectedZoneId(id); setDraft(true); setDialog(null); record("Zone added to draft", `${name} was added to Preview Draft 13.`); setToast(`${name} added to the draft.`);
  }

  function saveCamera(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedCamera) return; const form = new FormData(event.currentTarget); const zoneId = String(form.get("zoneId"));
    setCameras((current) => current.map((camera) => camera.id === selectedCamera.id ? { ...camera, zoneId } : camera)); setDraft(true); setDialog(null); record("Camera moved in draft", `${selectedCamera.name} was placed in ${zones.find((zone) => zone.id === zoneId)?.name}.`); setToast(`${selectedCamera.name} moved in the preview draft.`);
  }

  const map = <SiteMap zones={zones} cameras={cameras} selectedZoneId={selectedZoneId} backgroundUrl={backgroundUrl} editing={draft} onZone={(id) => { setSelectedZoneId(id); setView("map"); }} onCamera={(camera) => { setSelectedCamera(camera); setView("cameras"); }} />;

  return <section className="site-admin-page">
    <header className="site-admin-heading">
      <div><h1>{resolvedSiteName}</h1><p>Control the Site Map, structural Zones, Camera placements, and the audit record for this Site.</p></div>
      <div className="site-admin-state"><span><i />Site active</span><strong>{draft ? "Preview Draft 13" : "Map Revision 12"}</strong><small>{draft ? "Unpublished local changes" : "Published 07 Sep, 4:48 PM"}</small></div>
    </header>
    <div className="site-admin-mode"><div><strong>{readOnly ? "Read-only Site view" : draft ? "Editing Preview Draft 13" : "Published Site structure"}</strong><span>{readOnly ? "Regular Supervisors can inspect structure but cannot change it." : draft ? "Operational pages still use Revision 12 until this draft is published." : "Start a draft before changing dimensions, Zones, or Camera placements."}</span></div>{!readOnly && (draft ? <div><button type="button" onClick={() => setDialog("discard")}>Discard draft</button><button className="primary" type="button" onClick={() => setDialog("publish")}>Review and publish</button></div> : <button className="primary" type="button" onClick={startDraft}>Start map draft</button>)}</div>
    <nav className="site-admin-tabs" aria-label="Site administration views">{([['overview','Overview','map'],['map','Map & Zones','zone'],['cameras','Cameras','camera'],['audit','Audit history','audit']] as const).map(([id,label,icon]) => <button type="button" aria-current={view === id ? "page" : undefined} onClick={() => setView(id)} key={id}><Icon name={icon} /><span>{label}</span>{id === "audit" && <b>{audit.length}</b>}</button>)}</nav>

    {view === "overview" && <div className="site-admin-overview">
      <section className="site-admin-map-panel"><header><div><span>ACTIVE SITE MAP</span><h2>One published structure for every operation.</h2></div><button type="button" onClick={() => setView("map")}>Open map workspace</button></header>{map}<footer><span><b>{dimensions.width} × {dimensions.height} m</b> Map boundary</span><span><b>{zones.filter((zone) => zone.status === "active").length}</b> Active Zones</span><span><b>{cameras.filter((camera) => camera.status === "active").length}</b> Active Cameras</span></footer></section>
      <aside className="site-admin-overview-side">
        <section className="site-admin-register"><header><span>SITE REGISTER</span><b className="active">Active</b></header><dl><div><dt>Site ID</dt><dd>LS-SITE-001</dd></div><div><dt>Timezone</dt><dd>Asia/Kuala_Lumpur</dd></div><div><dt>Map revision</dt><dd>12</dd></div><div><dt>Background</dt><dd>{backgroundUrl ? "Preview uploaded" : "Not configured"}</dd></div></dl>{!readOnly && <button type="button" onClick={() => setDialog("site")}><Icon name="edit" /> Edit map settings</button>}</section>
        <section className="site-admin-next"><span>STRUCTURAL WORK</span><h2>{draft ? "Finish the draft." : "Change the Site safely."}</h2><p>{draft ? "Check every changed Zone and Camera placement before publication." : "Published operations stay untouched while a new map revision is prepared."}</p><div><button type="button" onClick={() => setView("map")}>Manage Zones</button><button type="button" onClick={() => setView("cameras")}>Manage Cameras</button></div></section>
      </aside>
    </div>}

    {view === "map" && <div className="site-admin-workspace">
      <aside className="site-zone-list"><header><div><span>MAP STRUCTURE</span><h2>Zones</h2></div>{!readOnly && <button type="button" onClick={() => setDialog("zone")}>+ Add Zone</button>}</header>{zones.map((zone) => <button className={selectedZoneId === zone.id ? "selected" : ""} type="button" key={zone.id} onClick={() => setSelectedZoneId(zone.id)}><i className={zone.tone} /><span><strong>{zone.name}</strong><small>{zone.points} · {zone.cameras} Camera{zone.cameras === 1 ? "" : "s"}</small></span><b className={zone.status}>{zone.status}</b></button>)}</aside>
      <section className="site-map-workbench"><header><div><span>{draft ? "PREVIEW DRAFT 13" : "ACTIVE REVISION 12"}</span><h2>{selectedZone?.name}</h2></div><div>{!readOnly && <button type="button" onClick={() => setDialog("site")}><Icon name="upload" /> Background & size</button>}</div></header>{map}<footer><div><span>Zone boundary</span><strong>{selectedZone?.points}</strong></div><div><span>Camera placements</span><strong>{cameras.filter((camera) => camera.zoneId === selectedZoneId && camera.status === "active").length}</strong></div>{!readOnly && <button type="button" onClick={() => { if (!draft) startDraft(); setZones((current) => current.map((zone) => zone.id === selectedZoneId ? { ...zone, status: zone.status === "active" ? "inactive" : "active" } : zone)); setToast(`${selectedZone?.name} status changed in the preview.`); }}>{selectedZone?.status === "active" ? "Deactivate Zone" : "Reactivate Zone"}</button>}</footer></section>
    </div>}

    {view === "cameras" && <section className="site-camera-register"><header><div><h2>Camera placements</h2><p>Camera monitoring controls stay on Cameras. This register owns structural placement and lifecycle.</p></div>{!readOnly && <button className="primary" type="button" onClick={() => { setToast("The Add Camera workflow would open here."); }}>+ Add Camera</button>}</header><div className="site-camera-table" role="table"><div className="head" role="row"><span>Camera</span><span>Zone placement</span><span>Source</span><span>Registration</span><span>Status</span><span /></div>{cameras.map((camera) => <div role="row" key={camera.id}><span><Icon name="camera" /><b>{camera.name}</b><small>{camera.id}</small></span><span><b>{zones.find((zone) => zone.id === camera.zoneId)?.name ?? "Unplaced"}</b><small>X {Math.round(camera.x)} m · Y {Math.round(camera.y)} m</small></span><span>{camera.source}</span><span>{camera.registration}</span><span><b className={camera.status}>{camera.status}</b></span><span>{!readOnly && <button type="button" onClick={() => { setSelectedCamera(camera); setDialog("camera"); }}>Manage</button>}</span></div>)}</div></section>}

    {view === "audit" && <section className="site-audit"><header><div><h2>Site audit history</h2><p>Structural Site changes, successful or failed, are kept in one Site-level record.</p></div><div>{([['all','All events'],['success','Succeeded'],['failed','Failed']] as const).map(([id,label]) => <button className={auditFilter === id ? "active" : ""} type="button" key={id} onClick={() => setAuditFilter(id)}>{label}</button>)}</div></header><div className="site-audit-ledger">{filteredAudit.map((entry) => <article key={entry.id}><time>{entry.time}</time><i className={entry.outcome.toLowerCase()}>{entry.outcome === "Succeeded" ? <Icon name="check" /> : <Icon name="close" />}</i><div><strong>{entry.action}</strong><p>{entry.detail}</p></div><span><b>{entry.actor}</b><small>{entry.authority}</small></span><em className={entry.outcome.toLowerCase()}>{entry.outcome}</em></article>)}</div></section>}

    {toast && <div className="site-admin-toast" role="status"><Icon name="check" />{toast}</div>}
    {dialog && <div className="site-dialog-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}><section className="site-dialog" role="dialog" aria-modal="true" aria-labelledby="site-dialog-title">
      <header><div><span>UI PROTOTYPE</span><h2 id="site-dialog-title">{dialog === "site" ? "Edit map settings" : dialog === "zone" ? "Add a Zone" : dialog === "camera" ? `Manage ${selectedCamera?.name}` : dialog === "publish" ? "Publish Preview Draft 13?" : "Discard Preview Draft 13?"}</h2></div><button ref={closeRef} type="button" onClick={() => setDialog(null)} aria-label="Close"><Icon name="close" /></button></header>
      {dialog === "site" && <form onSubmit={saveSite}><div className="site-dialog-body"><p>These changes stay inside the hardcoded preview until backend wiring begins.</p><div className="site-dimension-fields"><label>Width <span>metres</span><input name="width" type="number" defaultValue={dimensions.width} min="10" required /></label><label>Height <span>metres</span><input name="height" type="number" defaultValue={dimensions.height} min="10" required /></label></div><label className="site-upload">Site background <span>PNG or JPEG</span><input type="file" accept="image/png,image/jpeg" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) setBackgroundUrl(URL.createObjectURL(file)); }} /><b><Icon name="upload" />{backgroundUrl ? "Replace preview image" : "Choose background image"}</b></label></div><footer><button type="button" onClick={() => setDialog(null)}>Cancel</button><button className="primary" type="submit">Save to draft</button></footer></form>}
      {dialog === "zone" && <form onSubmit={addZone}><div className="site-dialog-body"><p>Create the record first, then plot its non-overlapping boundary in the map draft.</p><label>Zone name<input name="name" placeholder="e.g. North Entrance" required autoFocus /></label><div className="site-dialog-note"><Icon name="zone" /><span><strong>Boundary plotting follows next</strong>The final Zone must sit inside the Site Map and cannot overlap another Zone.</span></div></div><footer><button type="button" onClick={() => setDialog(null)}>Cancel</button><button className="primary" type="submit">Add Zone</button></footer></form>}
      {dialog === "camera" && selectedCamera && <form onSubmit={saveCamera}><div className="site-dialog-body"><p>Move the Camera’s Site Map point. Its source and floor/bin Registration remain unchanged.</p><label>Zone placement<select name="zoneId" defaultValue={selectedCamera.zoneId}>{zones.filter((zone) => zone.status === "active").map((zone) => <option value={zone.id} key={zone.id}>{zone.name}</option>)}</select></label><div className="site-dialog-note"><Icon name="camera" /><span><strong>{selectedCamera.registration}</strong>{selectedCamera.source} · {selectedCamera.id}</span></div><button className="site-danger-button" type="button" onClick={() => { setCameras((current) => current.map((camera) => camera.id === selectedCamera.id ? { ...camera, status: camera.status === "active" ? "inactive" : "active" } : camera)); setDraft(true); setDialog(null); setToast(`${selectedCamera.name} lifecycle changed in the preview.`); }}>{selectedCamera.status === "active" ? "Deactivate Camera" : "Reactivate Camera"}</button></div><footer><button type="button" onClick={() => setDialog(null)}>Cancel</button><button className="primary" type="submit">Save placement</button></footer></form>}
      {(dialog === "publish" || dialog === "discard") && <><div className="site-dialog-body"><p>{dialog === "publish" ? "The new dimensions, Zones, and Camera placements will become operational together. This cannot be partially published." : "Every unpublished change in Preview Draft 13 will be removed. Revision 12 stays operational."}</p><div className={`site-dialog-note ${dialog === "discard" ? "danger" : ""}`}><Icon name={dialog === "publish" ? "check" : "close"} /><span><strong>{dialog === "publish" ? "Atomic Site Map publication" : "Published structure stays safe"}</strong>{dialog === "publish" ? "One new immutable revision will replace the active map." : "Only the hardcoded preview draft is discarded."}</span></div></div><footer><button type="button" onClick={() => setDialog(null)}>Go back</button><button className={dialog === "discard" ? "danger" : "primary"} type="button" onClick={dialog === "publish" ? publishDraft : discardDraft}>{dialog === "publish" ? "Publish revision" : "Discard draft"}</button></footer></>}
    </section></div>}
  </section>;
}
