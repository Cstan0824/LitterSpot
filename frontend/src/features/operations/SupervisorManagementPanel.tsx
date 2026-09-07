import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { CreateV2RegularSupervisorInput, V2SupervisorListItem, V2SupervisorManagementItem } from "../../services/v2/supervisors";
import { isV2SupervisorManagementItem } from "../../services/v2/supervisors";
import { activeSupervisorDirectory, canManageSupervisor, filterManagedSupervisors, supervisorAuthorityLabel, supervisorStatusLabel } from "./supervisorPresentation";
import "./team-supervisors.css";

type Viewer = { uid: string; authority: "root" | "regular" };
type UpdateInput = { fullName?: string; phone?: string | null; status?: "active" | "inactive" };

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

function CreateSupervisorModal({ onClose, onCreate }: { onClose: () => void; onCreate: (input: CreateV2RegularSupervisorInput) => Promise<void> }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); }; addEventListener("keydown", close); return () => removeEventListener("keydown", close); }, [busy, onClose]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (fullName.trim().length < 2) return setError("Enter the Supervisor's full name.");
    if (password.length < 8) return setError("The temporary password must contain at least 8 characters.");
    setBusy(true); setError("");
    try { await onCreate({ fullName: fullName.trim(), email: email.trim().toLowerCase(), phone: phone.trim() || null, password }); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The Supervisor account could not be created."); }
    finally { setBusy(false); }
  };
  return <div className="team-modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><form className="team-supervisor-modal" role="dialog" aria-modal="true" aria-labelledby="create-supervisor-title" onSubmit={(event) => void submit(event)}>
    <header><div><span>NEW SUPERVISOR</span><h2 id="create-supervisor-title">Create Regular Supervisor</h2><p>Provision an account for daily Site operations.</p></div><button type="button" onClick={onClose} disabled={busy} aria-label="Close Supervisor form">×</button></header>
    <main><section className="team-supervisor-form"><label>Full name<input value={fullName} onChange={(event) => { setFullName(event.target.value); setError(""); }} minLength={2} maxLength={80} autoFocus required placeholder="Supervisor name" /></label><label>Email address<input type="email" value={email} onChange={(event) => { setEmail(event.target.value); setError(""); }} required placeholder="supervisor@example.com" /></label><label><span className="team-supervisor-label-row"><span>Contact number</span><small>Optional</small></span><input value={phone} onChange={(event) => { setPhone(event.target.value); setError(""); }} maxLength={30} placeholder="+60 12-345 6789" /></label><label>Temporary password<span className="team-password-field"><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} minLength={8} maxLength={128} required placeholder="At least 8 characters" /><button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide" : "Show"}</button></span></label></section><aside className="team-supervisor-authority"><span>ACCOUNT AUTHORITY</span><strong>Regular Supervisor</strong><p>Can run daily operations, manage Cleaners, control monitoring, and reconfigure Camera views. Site structure and Supervisor accounts remain Root-only.</p></aside></main>
    {error && <p className="team-supervisor-error" role="alert">{error}</p>}
    <footer><p>The account can sign in immediately after creation.</p><div><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="primary" type="submit" disabled={busy}>{busy ? "Creating…" : "Create Supervisor"}</button></div></footer>
  </form></div>;
}

function SupervisorDetailModal({ supervisor, onClose, onUpdate }: { supervisor: V2SupervisorManagementItem; onClose: () => void; onUpdate: (supervisor: V2SupervisorManagementItem, input: UpdateInput) => Promise<void> }) {
  const [fullName, setFullName] = useState(supervisor.fullName);
  const [phone, setPhone] = useState(supervisor.phone ?? "");
  const [confirmation, setConfirmation] = useState<"disable" | "reactivate" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changed = fullName.trim() !== supervisor.fullName || phone.trim() !== (supervisor.phone ?? "");
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) confirmation ? setConfirmation(null) : onClose(); }; addEventListener("keydown", close); return () => removeEventListener("keydown", close); }, [busy, confirmation, onClose]);
  const save = async (event: FormEvent) => { event.preventDefault(); if (!changed) return; setBusy(true); setError(""); try { await onUpdate(supervisor, { fullName: fullName.trim(), phone: phone.trim() || null }); onClose(); } catch (reason) { setError(reason instanceof Error ? reason.message : "The Supervisor profile could not be saved."); } finally { setBusy(false); } };
  const changeStatus = async () => { const status = confirmation === "disable" ? "inactive" : "active"; setBusy(true); setError(""); try { await onUpdate(supervisor, { status }); onClose(); } catch (reason) { setError(reason instanceof Error ? reason.message : "The Supervisor account status could not be changed."); setConfirmation(null); } finally { setBusy(false); } };
  return <div className="team-modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><form className="team-supervisor-modal team-supervisor-detail" role="dialog" aria-modal="true" aria-labelledby="supervisor-detail-title" onSubmit={(event) => void save(event)}>
    <header><div><span>SUPERVISOR ACCOUNT</span><h2 id="supervisor-detail-title">{supervisor.fullName}</h2><p>{supervisorAuthorityLabel(supervisor.authority)}</p></div><button type="button" onClick={onClose} disabled={busy} aria-label="Close Supervisor account">×</button></header>
    {confirmation ? <main className="team-supervisor-confirm"><span>{confirmation === "disable" ? "DISABLE ACCESS" : "RESTORE ACCESS"}</span><h3>{confirmation === "disable" ? `Disable ${supervisor.fullName}?` : `Reactivate ${supervisor.fullName}?`}</h3><p>{confirmation === "disable" ? "This Supervisor will lose access to LitterSpot immediately. Their account history remains available and Root can reactivate the account later." : "This Supervisor will regain access to the Site using their existing sign-in credentials."}</p><div><button type="button" onClick={() => setConfirmation(null)} disabled={busy}>Keep current status</button><button type="button" className={confirmation === "disable" ? "danger" : "primary"} onClick={() => void changeStatus()} disabled={busy}>{busy ? "Updating…" : confirmation === "disable" ? "Confirm disable" : "Confirm reactivation"}</button></div></main> : <main><section className="team-supervisor-form"><label>Full name<input value={fullName} onChange={(event) => { setFullName(event.target.value); setError(""); }} minLength={2} maxLength={80} required /></label><label>Email address<input value={supervisor.email} readOnly aria-readonly="true" /><small className="team-field-note">The sign-in email cannot be changed here.</small></label><label><span className="team-supervisor-label-row"><span>Contact number</span><small>Optional</small></span><input value={phone} onChange={(event) => { setPhone(event.target.value); setError(""); }} maxLength={30} placeholder="Not provided" /></label></section><aside className="team-supervisor-account-state"><span>ACCOUNT STATUS</span><strong className={supervisor.status}>{supervisorStatusLabel(supervisor.status)}</strong><dl><div><dt>Authority</dt><dd>{supervisorAuthorityLabel(supervisor.authority)}</dd></div><div><dt>Access</dt><dd>{supervisor.status === "active" ? "Site operations" : "Sign-in blocked"}</dd></div></dl><button type="button" className={supervisor.status === "active" ? "danger" : "reactivate"} onClick={() => setConfirmation(supervisor.status === "active" ? "disable" : "reactivate")}>{supervisor.status === "active" ? "Disable account" : "Reactivate account"}</button></aside></main>}
    {error && <p className="team-supervisor-error" role="alert">{error}</p>}
    {!confirmation && <footer><p>Authority and sign-in email remain fixed.</p><div><button type="button" onClick={onClose} disabled={busy}>Close</button><button className="primary" type="submit" disabled={busy || !changed}>{busy ? "Saving…" : "Save changes"}</button></div></footer>}
  </form></div>;
}

export function SupervisorManagementPanel({ viewer, supervisors, loading, error, createRequest, onRetry, onCreate, onUpdate }: { viewer: Viewer; supervisors: V2SupervisorListItem[]; loading: boolean; error?: string; createRequest: number; onRetry: () => void; onCreate: (input: CreateV2RegularSupervisorInput) => Promise<void>; onUpdate: (supervisor: V2SupervisorManagementItem, input: UpdateInput) => Promise<void> }) {
  const root = viewer.authority === "root";
  const managed = useMemo(() => supervisors.filter(isV2SupervisorManagementItem), [supervisors]);
  const directory = useMemo(() => activeSupervisorDirectory(supervisors), [supervisors]);
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [selectedUid, setSelectedUid] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => { if (root && createRequest > 0) setCreating(true); }, [createRequest, root]);
  const shown = useMemo(() => root ? filterManagedSupervisors(managed, status, query) : directory, [directory, managed, query, root, status]);
  const selected = managed.find((supervisor) => supervisor.uid === selectedUid && supervisor.authority === "regular");
  const active = managed.filter((supervisor) => supervisor.status === "active").length;
  const create = async (input: CreateV2RegularSupervisorInput) => { await onCreate(input); setMessage(`${input.fullName} can now sign in as a Regular Supervisor.`); };
  const update = async (supervisor: V2SupervisorManagementItem, input: UpdateInput) => { await onUpdate(supervisor, input); setMessage(input.status === "inactive" ? `${supervisor.fullName}'s access is disabled.` : input.status === "active" ? `${supervisor.fullName}'s access is active again.` : `${input.fullName ?? supervisor.fullName}'s profile was updated.`); };

  if (loading) return <section className="team-supervisor-state" aria-live="polite"><strong>Loading Supervisors…</strong><p>Reading the active Site's account directory.</p></section>;
  if (error) return <section className="team-supervisor-state error" role="alert"><strong>Supervisor accounts could not be loaded.</strong><p>{error}</p><button type="button" onClick={onRetry}>Try again</button></section>;

  return <div className="team-supervisor-panel">
    {message && <div className="team-supervisor-message" role="status"><span>{message}</span><button type="button" onClick={() => setMessage("")}>Dismiss</button></div>}
    {root ? <><section className="team-metric-grid team-supervisor-metrics"><article><span>REGISTERED SUPERVISORS</span><strong>{managed.length}</strong><small>Root and Regular accounts</small></article><article><span>ACTIVE ACCOUNTS</span><strong>{active}</strong><small>Can access this Site</small></article><article><span>DISABLED ACCOUNTS</span><strong>{managed.length - active}</strong><small>Sign-in access blocked</small></article></section><section className="team-filters team-supervisor-filters"><div role="group" aria-label="Filter Supervisors by account status"><button className={status === "all" ? "active" : ""} onClick={() => setStatus("all")}>All <b>{managed.length}</b></button><button className={status === "active" ? "active" : ""} onClick={() => setStatus("active")}>Active <b>{active}</b></button><button className={status === "inactive" ? "active" : ""} onClick={() => setStatus("inactive")}>Disabled <b>{managed.length - active}</b></button></div><label className="team-search">FIND SUPERVISOR<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or email" /></label></section></> : <section className="team-supervisor-directory-intro"><div><strong>{directory.length}</strong><span>ACTIVE SUPERVISORS</span></div><p>This directory shows who can operate the Site. Account details and controls remain with the Root Supervisor.</p></section>}
    <section className="team-roster team-supervisor-roster"><header><div><span>{root ? "SUPERVISOR ACCOUNTS" : "ACTIVE SITE TEAM"}</span><h2>{root ? "Supervisor directory" : "Site Supervisors"}</h2></div><p>{root ? "Select a Regular Supervisor to edit their profile or account access." : "Names and authority are visible for coordination. Private account details are hidden."}</p></header><div className="team-supervisor-table"><div className={`team-supervisor-row label ${root ? "root-view" : "regular-view"}`}><span>Supervisor</span>{root && <span>Email</span>}<span>Authority</span>{root && <span>Account status</span>}</div>{shown.map((supervisor) => { const own = supervisor.uid === viewer.uid; const manageable = canManageSupervisor(viewer.authority, supervisor); const content = <><span className="team-person"><i>{initials(supervisor.fullName)}</i><b>{supervisor.fullName}<small>{own ? "You" : supervisor.authority === "root" ? "Site Root account" : "Site operations"}</small></b></span>{root && <span className="team-supervisor-email">{isV2SupervisorManagementItem(supervisor) ? supervisor.email || "Email unavailable" : "Hidden"}</span>}<span className={`team-authority ${supervisor.authority}`}>{supervisorAuthorityLabel(supervisor.authority)}</span>{root && <span><b className={`team-status ${isV2SupervisorManagementItem(supervisor) && supervisor.status === "active" ? "active" : "inactive"}`}>{isV2SupervisorManagementItem(supervisor) ? supervisorStatusLabel(supervisor.status) : "Unknown"}</b></span>}</>; return manageable ? <button className="team-supervisor-row root-view" type="button" key={supervisor.uid} onClick={() => setSelectedUid(supervisor.uid)}>{content}<em aria-hidden="true">→</em></button> : <div className={`team-supervisor-row ${root ? "root-view" : "regular-view"}`} key={supervisor.uid}>{content}</div>; })}{!shown.length && <p className="team-empty">{query ? "No Supervisors match this search." : "No Supervisor accounts match this filter."}</p>}</div></section>
    {creating && <CreateSupervisorModal onClose={() => setCreating(false)} onCreate={create} />}
    {selected && <SupervisorDetailModal supervisor={selected} onClose={() => setSelectedUid("")} onUpdate={update} />}
  </div>;
}
