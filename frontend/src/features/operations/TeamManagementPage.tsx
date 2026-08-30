import { useMemo, useState, type CSSProperties, type FormEvent, type PointerEvent } from "react";
import type { Cleaner } from "../../services/cleanerAPI";
import type { Zone } from "../../services/locationAPI";
import "./team-cleaner-wizard.css";
import "./team-cleaner-review.css";

type Point = { x: number; y: number };
type TeamCleaner = Cleaner & { station: Point; scheduleSummary: "Mon–Fri · 09:00–18:00" | "Tue–Sat · 12:00–20:00" | "No regular schedule" };
type Draft = Pick<TeamCleaner, "staffCode" | "fullName" | "phone" | "assignedZoneId" | "status" | "station" | "scheduleSummary">;
type RosterDay = { day: string; onDuty: boolean; start: string; end: string };

const anchors: Point[] = [{ x: 13, y: 18 }, { x: 8, y: 72 }, { x: 64, y: 16 }, { x: 40, y: 44 }, { x: 60, y: 70 }, { x: 82, y: 72 }];
const weekdayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const anchorFor = (zone: Zone, index: number) => {
  const name = zone.name.toLowerCase();
  if (name.includes("entrance") || name.includes("main")) return anchors[0];
  if (name.includes("lower")) return anchors[1];
  if (name.includes("upper")) return anchors[2];
  if (name.includes("temple")) return anchors[3];
  if (name.includes("food") || name.includes("vendor")) return anchors[4];
  if (name.includes("park")) return anchors[5];
  return anchors[index % anchors.length];
};
const nearestZoneFor = (point: Point, zones: Zone[]) => zones.map((zone, index) => ({ zone, point: anchorFor(zone, index) })).sort((left, right) => Math.hypot(point.x - left.point.x, point.y - left.point.y) - Math.hypot(point.x - right.point.x, point.y - right.point.y))[0]?.zone;
const rosterFor = (summary: TeamCleaner["scheduleSummary"]): RosterDay[] => weekdayNames.map((day, index) => {
  const tueSat = summary === "Tue–Sat · 12:00–20:00";
  const weekday = summary === "Mon–Fri · 09:00–18:00";
  const onDuty = tueSat ? index >= 1 && index <= 5 : weekday ? index <= 4 : false;
  return { day, onDuty, start: tueSat ? "12:00" : "09:00", end: tueSat ? "20:00" : "18:00" };
});
const scheduleFromRoster = (roster: RosterDay[]): TeamCleaner["scheduleSummary"] => {
  const monFri = roster.every((item, index) => item.onDuty === (index <= 4) && (!item.onDuty || item.start === "09:00" && item.end === "18:00"));
  const tueSat = roster.every((item, index) => item.onDuty === (index >= 1 && index <= 5) && (!item.onDuty || item.start === "12:00" && item.end === "20:00"));
  return monFri ? "Mon–Fri · 09:00–18:00" : tueSat ? "Tue–Sat · 12:00–20:00" : "No regular schedule";
};

function pointFromEvent(event: PointerEvent<HTMLDivElement>): Point {
  const bounds = event.currentTarget.getBoundingClientRect();
  return { x: Math.max(3, Math.min(97, ((event.clientX - bounds.left) / bounds.width) * 100)), y: Math.max(3, Math.min(97, ((event.clientY - bounds.top) / bounds.height) * 100)) };
}

function CleanerStationMap({ point, zones, onChange }: { point: Point; zones: Zone[]; onChange: (point: Point) => void }) {
  const activeZones = zones.filter((zone) => zone.status === "active");
  return <div className="team-station-map" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); onChange(pointFromEvent(event)); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) onChange(pointFromEvent(event)); }} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} role="application" tabIndex={0} aria-label="Interactive Batu Caves site map. Click or drag to set the cleaner working station.">
    <div className="team-station-map-art" />
    {activeZones.map((zone, index) => { const anchor = anchorFor(zone, index); return <span className="team-station-zone" style={{ left: `${anchor.x}%`, top: `${anchor.y}%` } as CSSProperties} key={zone.id}><b>{String(index + 1).padStart(2, "0")}</b><i>{zone.name}</i></span>; })}
    <span className="team-station-pin" style={{ left: `${point.x}%`, top: `${point.y}%` } as CSSProperties}><i /><b>Station Point</b></span>
    <p>Click or drag to position the Cleaner</p>
  </div>;
}

function CleanerModal({ cleaner, zones, nextNumber, onClose, onSave }: { cleaner?: TeamCleaner; zones: Zone[]; nextNumber: number; onClose: () => void; onSave: (draft: Draft) => void }) {
  const activeZones = zones.filter((zone) => zone.status === "active");
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<Draft>(() => cleaner ? { staffCode: cleaner.staffCode, fullName: cleaner.fullName, phone: cleaner.phone, assignedZoneId: cleaner.assignedZoneId, status: cleaner.status, station: cleaner.station, scheduleSummary: cleaner.scheduleSummary } : { staffCode: `CLN-${String(nextNumber).padStart(3, "0")}`, fullName: "", phone: "", assignedZoneId: activeZones[0]?.id ?? "", status: "active", station: activeZones[0] ? anchorFor(activeZones[0], 0) : { x: 50, y: 50 }, scheduleSummary: "Mon–Fri · 09:00–18:00" });
  const [roster, setRoster] = useState<RosterDay[]>(() => rosterFor(cleaner?.scheduleSummary ?? "Mon–Fri · 09:00–18:00"));
  const [message, setMessage] = useState("");
  const currentZone = nearestZoneFor(draft.station, activeZones);
  const latitude = (3.23846 - draft.station.y * .000016).toFixed(5);
  const longitude = (101.68292 + draft.station.x * .000019).toFixed(5);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const updateRoster = (index: number, change: Partial<RosterDay>) => setRoster((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...change } : item));
  const setStepSafely = (next: number) => {
    if (next > step && step === 1 && (!draft.fullName.trim() || !draft.phone.trim())) { setMessage("Add the cleaner name and contact number before continuing."); return; }
    if (next > step && step === 2 && !currentZone) { setMessage("Choose a Station Point on the site map before continuing."); return; }
    setMessage(""); setStep(next);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (step < 4) { setStepSafely(step + 1); return; }
    if (!currentZone) { setMessage("Choose a Station Point before creating this Cleaner."); setStep(2); return; }
    onSave({ ...draft, assignedZoneId: currentZone.id, fullName: draft.fullName.trim(), phone: draft.phone.trim(), scheduleSummary: scheduleFromRoster(roster) });
  };
  const completed = (number: number) => number < step;
  const reviewRoster = roster.filter((item) => item.onDuty);

  return <div className="team-modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="team-cleaner-modal team-cleaner-wizard" onSubmit={submit}>
    <header><div><span>{cleaner ? "CLEANER PROFILE" : "NEW CLEANER · BATU CAVES"}</span><h2>{cleaner ? "Edit Cleaner" : "Create Cleaner"}</h2></div><button type="button" onClick={onClose} aria-label="Close cleaner form">×</button></header>
    <ol className="team-wizard-steps" aria-label="Create Cleaner steps">{[["Cleaner details", "Name and contact"], ["Station point", currentZone?.name ?? "Choose on map"], ["Duty roster", "Set weekly working time"], ["Review & confirm", "Confirm and create"]].map(([label, hint], index) => { const number = index + 1; return <li className={step === number ? "active" : completed(number) ? "complete" : ""} key={label}><button type="button" onClick={() => (completed(number) || number < step) && setStep(number)} disabled={number > step}><b>{completed(number) ? "✓" : String(number).padStart(2, "0")}</b><span>{label}<small>{hint}</small></span></button></li>; })}</ol>
    <main className="team-wizard-content">
      {step === 1 && <section className="team-wizard-panel team-wizard-details"><span>01 · CLEANER DETAILS</span><h3>Start with the person.</h3><p>Register the Cleaner’s core details. Their working location and duty roster are set in the next steps.</p><div className="team-wizard-field-grid"><label>Full name<input value={draft.fullName} onChange={(event) => set("fullName", event.target.value)} placeholder="Cleaner name" required autoFocus /></label><label>Staff ID<input value={draft.staffCode} onChange={(event) => set("staffCode", event.target.value.toUpperCase())} required /></label><label className="wide">Contact number<input value={draft.phone} onChange={(event) => set("phone", event.target.value)} placeholder="+60 12-345 6789" required /></label></div></section>}
      {step === 2 && <section className="team-wizard-panel team-wizard-location"><header><div><span>02 · STATION POINT</span><h3>Pin the default working location.</h3><p>Click anywhere on the site plan. The nearest Station Zone is shown automatically.</p></div><div className="team-station-zone-readout"><span>STATION ZONE</span><strong>{currentZone?.name ?? "Choose a Station Point"}</strong><small>{latitude}° N · {longitude}° E</small></div></header><CleanerStationMap point={draft.station} zones={activeZones} onChange={(point) => set("station", point)} /></section>}
      {step === 3 && <section className="team-wizard-panel team-wizard-roster"><header><div><span>03 · DUTY ROSTER</span><h3>Set weekly working time.</h3><p>Turn on the days the Cleaner is on duty, then set their start and end times.</p></div><button type="button" onClick={() => setRoster((items) => items.map((item, index) => index < 5 ? { ...item, onDuty: true, start: "09:00", end: "18:00" } : { ...item, onDuty: false }))}>Copy Monday to weekdays</button></header><div className="team-roster-editor"><div className="team-roster-editor-label"><span>DAY</span><span>ON DUTY</span><span>START</span><span>END</span></div>{roster.map((item, index) => <div className="team-roster-editor-row" key={item.day}><strong>{item.day}</strong><label className="team-duty-toggle"><input type="checkbox" checked={item.onDuty} onChange={(event) => updateRoster(index, { onDuty: event.target.checked })} /><i /><span>{item.onDuty ? "On duty" : "Off duty"}</span></label><input aria-label={`${item.day} start time`} type="time" value={item.start} disabled={!item.onDuty} onChange={(event) => updateRoster(index, { start: event.target.value })} /><input aria-label={`${item.day} end time`} type="time" value={item.end} disabled={!item.onDuty} onChange={(event) => updateRoster(index, { end: event.target.value })} /></div>)}</div></section>}
      {step === 4 && <section className="team-wizard-panel team-wizard-review"><header><span>04 · REVIEW & CONFIRM</span><h3>Check the setup before creating.</h3><p>Review the Cleaner details, Station Point, and duty roster. You can edit any section before confirming.</p></header><div className="team-review-card"><header><h4>Cleaner details</h4><button type="button" onClick={() => setStep(1)}>Edit</button></header><dl><div><dt>Name</dt><dd>{draft.fullName || "—"}</dd></div><div><dt>Staff ID</dt><dd>{draft.staffCode}</dd></div><div><dt>Contact</dt><dd>{draft.phone || "—"}</dd></div></dl></div><div className="team-review-card team-review-station"><header><h4>Station point</h4><button type="button" onClick={() => setStep(2)}>Edit</button></header><div className="team-review-map"><CleanerStationMap point={draft.station} zones={activeZones} onChange={() => undefined} /></div><p><b>{currentZone?.name ?? "—"}</b><span>{latitude}° N · {longitude}° E</span></p></div><div className="team-review-card"><header><h4>Weekly duty roster</h4><button type="button" onClick={() => setStep(3)}>Edit</button></header><div className="team-review-roster team-review-roster-table">{roster.map((item) => <p key={item.day}><b>{item.day}</b><span>{item.onDuty ? "On duty" : "Off duty"}</span><span>{item.onDuty ? item.start : "—"}</span><i>—</i><span>{item.onDuty ? item.end : "—"}</span></p>)}</div></div></section>}
    </main>
    {message && <p className="team-cleaner-error" role="alert">{message}</p>}
    <footer><p>{step === 4 ? "Creating this Cleaner adds the confirmed details, Station Point, and duty roster to the local frontend prototype." : "You can return to any completed step before creating the Cleaner."}</p><div><button type="button" onClick={onClose}>Cancel</button>{step > 1 && <button type="button" onClick={() => { setMessage(""); setStep(step - 1); }}>Back</button>}<button type="submit">{step === 4 ? cleaner ? "Save Cleaner" : "Create Cleaner" : "Continue"}</button></div></footer>
  </form></div>;
}

export function TeamManagementPage({ staff, zones }: { staff: Cleaner[]; zones: Zone[] }) {
  const [roster, setRoster] = useState<TeamCleaner[]>(() => staff.map((cleaner, index) => ({ ...cleaner, station: anchorFor(zones.find((zone) => zone.id === cleaner.assignedZoneId) ?? zones[index % Math.max(1, zones.length)] ?? { name: "" } as Zone, index), scheduleSummary: index % 3 === 0 ? "Tue–Sat · 12:00–20:00" : "Mon–Fri · 09:00–18:00" })));
  const [status, setStatus] = useState<"all" | Cleaner["status"]>("all");
  const [zoneFilter, setZoneFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<TeamCleaner>();
  const [creating, setCreating] = useState(false);
  const activeZones = zones.filter((zone) => zone.status === "active");
  const nextNumber = Math.max(0, ...roster.map((cleaner) => Number(cleaner.staffCode.match(/\d+$/)?.[0] ?? 0))) + 1;
  const shown = useMemo(() => roster.filter((cleaner) => (status === "all" || cleaner.status === status) && (zoneFilter === "all" || cleaner.assignedZoneId === zoneFilter) && `${cleaner.fullName} ${cleaner.staffCode}`.toLowerCase().includes(query.toLowerCase())), [query, roster, status, zoneFilter]);
  const saveNew = (draft: Draft) => { const zone = activeZones.find((item) => item.id === draft.assignedZoneId); setRoster((items) => [...items, { id: `frontend-${Date.now()}`, ...draft, assignedSiteId: zone?.siteId ?? "frontend-site", assignedZoneName: zone?.name ?? "Unassigned zone", notes: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deactivatedAt: null }].sort((left, right) => left.fullName.localeCompare(right.fullName))); setCreating(false); };
  const saveEdit = (draft: Draft) => { const zone = activeZones.find((item) => item.id === draft.assignedZoneId); setRoster((items) => items.map((item) => item.id === editing?.id ? { ...item, ...draft, assignedZoneName: zone?.name ?? item.assignedZoneName, updatedAt: new Date().toISOString(), deactivatedAt: draft.status === "inactive" ? new Date().toISOString() : null } : item)); setEditing(undefined); };
  const activeCount = roster.filter((cleaner) => cleaner.status === "active").length;

  return <section className="team-management-page"><header className="team-page-heading"><div><span>CLEANER MANAGEMENT · BATU CAVES</span><h1>Keep every zone covered.</h1><p>Create registered Cleaners, set their Station Point on the site map, and update their details whenever responsibilities change.</p></div><button type="button" onClick={() => setCreating(true)}><i>+</i>Create cleaner</button></header><section className="team-metric-grid"><article><span>REGISTERED CLEANERS</span><strong>{roster.length}</strong><small>Across the active site</small></article><article><span>AVAILABLE NOW</span><strong>{activeCount}</strong><small>Ready for assignment</small></article><article><span>UNAVAILABLE</span><strong>{roster.length - activeCount}</strong><small>Not eligible for new work</small></article></section><section className="team-filters"><div role="group" aria-label="Filter Cleaners by availability"><button className={status === "all" ? "active" : ""} onClick={() => setStatus("all")}>All <b>{roster.length}</b></button><button className={status === "active" ? "active" : ""} onClick={() => setStatus("active")}>Available <b>{activeCount}</b></button><button className={status === "inactive" ? "active" : ""} onClick={() => setStatus("inactive")}>Unavailable <b>{roster.length - activeCount}</b></button></div><label>STATION ZONE<select value={zoneFilter} onChange={(event) => setZoneFilter(event.target.value)}><option value="all">All zones</option>{activeZones.map((zone) => <option value={zone.id} key={zone.id}>{zone.name}</option>)}</select></label><label className="team-search">FIND CLEANER<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or staff ID" /></label></section><section className="team-roster"><header><div><span>REGISTERED CLEANERS</span><h2>Cleaner roster</h2></div><p>Click a Cleaner to edit their profile or Station Point.</p></header><div className="team-roster-table"><div className="team-roster-row team-roster-label"><span>Cleaner</span><span>Station Zone</span><span>Station Point</span><span>Schedule</span><span>Availability</span></div>{shown.map((cleaner) => <button className="team-roster-row" type="button" key={cleaner.id} onClick={() => setEditing(cleaner)}><span className="team-person"><i>{initials(cleaner.fullName)}</i><b>{cleaner.fullName}<small>{cleaner.staffCode} · {cleaner.phone}</small></b></span><span>{cleaner.assignedZoneName}</span><span className="team-station-cell"><i /> X {cleaner.station.x.toFixed(0)} · Y {cleaner.station.y.toFixed(0)}</span><span>{cleaner.scheduleSummary}</span><span><b className={`team-status ${cleaner.status}`}>{cleaner.status === "active" ? "Available" : "Unavailable"}</b></span></button>)}{!shown.length && <p className="team-empty">No registered Cleaners match this filter.</p>}</div></section>{creating && <CleanerModal zones={zones} nextNumber={nextNumber} onClose={() => setCreating(false)} onSave={saveNew} />}{editing && <CleanerModal cleaner={editing} zones={zones} nextNumber={nextNumber} onClose={() => setEditing(undefined)} onSave={saveEdit} />}</section>;
}
