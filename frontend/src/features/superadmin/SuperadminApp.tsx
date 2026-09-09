import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { recommendedSiteMapGridInterval, siteMapGridSummary } from "../operations/siteMapGrid";
import { V2ApiError } from "../../services/v2/errors";
import { superadminRouteFromHash, superadminRouteHash, type SuperadminRoute } from "../../services/v2/routing";
import {
  createV2SuperadminSite,
  getV2SuperadminAuditPage,
  getV2SuperadminSite,
  getV2SuperadminSiteAuditPage,
  getV2SuperadminSitesPage,
  reconcileV2SuperadminSiteOperation,
  recoverV2SuperadminRoot,
  updateV2SuperadminSiteStatus,
  type V2SiteOperation,
  type V2SuperadminAuditEvent,
  type V2SuperadminSite,
  type V2SuperadminSiteDetail,
} from "../../services/v2/superadmin";
import "./superadmin.css";
import { SuperadminSiteView } from "./SuperadminSiteView";

type Profile = { uid: string; email: string; displayName: string };
type Dialog = "create" | "account" | null;

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const date = new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const readable = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const when = (value?: string | null) => value && !Number.isNaN(new Date(value).getTime()) ? date.format(new Date(value)) : "Not recorded";
const initials = (value: string) => value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const errorCopy = (reason: unknown) => reason instanceof V2ApiError || reason instanceof Error ? reason.message : "The request could not be completed.";

function Icon({ name }: { name: "sites" | "audit" | "plus" | "search" | "arrow" | "close" | "view" | "shield" | "refresh" }) {
  if (name === "sites") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20h18M5 20V7l7-4 7 4v13M9 20v-5h6v5M8 9h2M14 9h2M8 12h2M14 12h2" /></svg>;
  if (name === "audit") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4" /></svg>;
  if (name === "plus") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
  if (name === "search") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg>;
  if (name === "arrow") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M14 7l5 5-5 5" /></svg>;
  if (name === "view") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></svg>;
  if (name === "shield") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 6v5c0 5-3.3 8.4-8 10-4.7-1.6-8-5-8-10V6Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></svg>;
  if (name === "refresh") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 8V3l-2 2a8 8 0 1 0 2.2 8M19 3h-5" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>;
}

function Modal({ title, description, onClose, children, className = "" }: { title: string; description?: string; onClose: () => void; children: ReactNode; className?: string }) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? []).filter((element) => !element.hidden);
    queueMicrotask(() => (dialogRef.current?.querySelector<HTMLElement>("[autofocus]") ?? focusable()[0])?.focus());
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { closeRef.current(); return; }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0], last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    addEventListener("keydown", close);
    return () => { removeEventListener("keydown", close); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="sa-dialog-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialogRef} className={`sa-dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby="sa-dialog-title"><header><div><h2 id="sa-dialog-title">{title}</h2>{description && <p>{description}</p>}</div><button type="button" onClick={onClose} aria-label="Close"><Icon name="close" /></button></header>{children}</section></div>;
}

function AccountDialog({ profile, onClose, onLogout }: { profile: Profile; onClose: () => void; onLogout: () => void }) {
  return <Modal title="Superadmin account" onClose={onClose}><div className="sa-account-person"><i>{initials(profile.displayName)}</i><div><strong>{profile.displayName}</strong><span>LitterSpot Superadmin</span></div></div><dl className="sa-detail-list"><div><dt>Name</dt><dd>{profile.displayName}</dd></div><div><dt>Email</dt><dd>{profile.email}</dd></div><div><dt>Authority</dt><dd>Platform administration</dd></div></dl><footer className="sa-dialog-actions"><button className="danger-outline" type="button" onClick={onLogout}>Sign out</button></footer></Modal>;
}

function CreateSiteDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (siteId: string) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [timeZone, setTimeZone] = useState("Asia/Kuala_Lumpur");
  const [width, setWidth] = useState(600);
  const [height, setHeight] = useState(400);
  const [interval, setInterval] = useState(20);
  const [customInterval, setCustomInterval] = useState(false);
  const [rootName, setRootName] = useState("");
  const [rootEmail, setRootEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const recommendation = recommendedSiteMapGridInterval(width);
  const grid = siteMapGridSummary(width, height, interval);

  const updateWidth = (value: number) => {
    setWidth(value);
    const next = recommendedSiteMapGridInterval(value);
    if (!customInterval && next !== null) setInterval(next);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!grid) { setError("Enter positive map dimensions and a Grid interval."); return; }
    setBusy(true); setError("");
    try {
      const result = await createV2SuperadminSite({ name: name.trim(), description: description.trim() || null, timeZone: timeZone.trim(), widthMeters: width, heightMeters: height, gridSizeMeters: interval, rootDisplayName: rootName.trim(), rootEmail: rootEmail.trim(), rootPassword: password, idempotencyKey });
      onCreated(result.siteId);
    } catch (reason) { setError(errorCopy(reason)); setBusy(false); }
  };

  return <Modal className="sa-create-dialog" title="Create a new Site" description="Set the tenant boundary, first map revision, and Root Supervisor in one operation." onClose={() => { if (!busy) onClose(); }}><form onSubmit={submit}>
    <div className="sa-create-body">
      <section className="sa-create-section"><header><b>Site identity</b><span>Client and venue</span></header><div className="sa-form-grid"><label className="wide">Site name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="Sunway Theme Park" required autoFocus /></label><label>Timezone<input value={timeZone} onChange={(event) => setTimeZone(event.target.value)} placeholder="Asia/Kuala_Lumpur" required /></label><label>Description <span>Optional</span><input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} placeholder="Operational notes" /></label></div></section>
      <section className="sa-create-section"><header><b>Map boundary</b><span>Real dimensions in metres</span></header><div className="sa-form-grid three"><label>Width <div className="sa-unit-input"><input type="number" min="1" step="0.01" value={width} onChange={(event) => updateWidth(Number(event.target.value))} required /><span aria-hidden="true">metres</span></div></label><label>Height <div className="sa-unit-input"><input type="number" min="1" step="0.01" value={height} onChange={(event) => setHeight(Number(event.target.value))} required /><span aria-hidden="true">metres</span></div></label><label>Grid interval <div className="sa-unit-input"><input type="number" min="0.01" step="0.01" value={interval} onChange={(event) => { setInterval(Number(event.target.value)); setCustomInterval(true); }} required /><span aria-hidden="true">metres</span></div>{customInterval && <small>{`${recommendation ?? "No"} m recommended`}</small>}</label></div>{customInterval && recommendation !== null && <button className="sa-use-recommended" type="button" onClick={() => { setInterval(recommendation); setCustomInterval(false); }}>Use recommended {recommendation} m</button>}<div className="sa-grid-summary" aria-live="polite">{grid ? <><strong>{grid.columns} × {grid.rows} grid</strong><span>{number.format(grid.totalCells)} cells across {number.format(width)} × {number.format(height)} m</span></> : <><strong>Grid unavailable</strong><span>Enter positive dimensions and interval.</span></>}</div><p className="sa-form-note">The Root Supervisor can add and align the map image from Site administration.</p></section>
      <section className="sa-create-section"><header><b>First Root Supervisor</b><span>Initial Site authority</span></header><div className="sa-form-grid"><label>Full name<input value={rootName} onChange={(event) => setRootName(event.target.value)} minLength={2} maxLength={80} placeholder="Root Supervisor" required /></label><label>Email address<input type="email" value={rootEmail} onChange={(event) => setRootEmail(event.target.value)} placeholder="root@example.com" required /></label><label className="wide">Temporary password<div className="sa-password"><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={128} placeholder="At least 8 characters" required /><button type="button" onClick={() => setShowPassword((current) => !current)}>{showPassword ? "Hide" : "Show"}</button></div></label></div></section>
      {error && <p className="sa-form-error" role="alert">{error}</p>}
    </div><footer className="sa-dialog-actions"><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="primary" type="submit" disabled={busy || !grid}>{busy ? "Creating Site…" : "Create Site and Root account"}</button></footer>
  </form></Modal>;
}

function SitesPage({ sites, total, hasMore, loading, error, onRetry, onLoadMore, onOpen, onCreate }: { sites: V2SuperadminSite[]; total: number; hasMore: boolean; loading: boolean; error: string; onRetry: () => void; onLoadMore: () => void; onOpen: (siteId: string) => void; onCreate: () => void }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const shown = sites.filter((site) => status === "all" || site.status === status).filter((site) => `${site.name} ${site.rootSupervisor?.fullName ?? ""} ${site.rootSupervisor?.email ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const active = sites.filter((site) => site.status === "active").length;
  return <main className="sa-page"><header className="sa-page-head"><div><h1>Sites</h1><p>Client access, map structure, and Root ownership across LitterSpot.</p></div><button className="sa-primary" type="button" onClick={onCreate}><Icon name="plus" />Create Site</button></header>
    <section className="sa-register-strip"><div><strong>{sites.length}</strong><span>Registered Sites</span></div><div><strong>{active}</strong><span>Active</span></div><div><strong>{sites.length - active}</strong><span>Inactive</span></div><p>{sites.length ? `${Math.round(active / sites.length * 100)}% of registered Sites can currently operate.` : "Create the first client Site to begin."}</p></section>
    <section className="sa-ledger"><header><div className="sa-status-tabs" role="group" aria-label="Filter Sites by status">{(["all", "active", "inactive"] as const).map((value) => <button type="button" className={status === value ? "active" : ""} onClick={() => setStatus(value)} key={value}>{readable(value)} <b>{value === "all" ? sites.length : sites.filter((site) => site.status === value).length}</b></button>)}</div><label className="sa-search"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Site or Root Supervisor" /></label></header>
      <div className="sa-site-table"><div className="sa-site-row labels"><span>Site</span><span>Status</span><span>Root Supervisor</span><span>Active map</span><span>Updated</span><i /></div>{loading ? <div className="sa-empty">Loading Sites…</div> : error ? <div className="sa-empty error"><p>{error}</p><button type="button" onClick={onRetry}>Try again</button></div> : shown.map((site) => <button className="sa-site-row" type="button" key={site.id} onClick={() => onOpen(site.id)}><span className="sa-site-name"><b>{site.name}</b><small>{site.description || site.timeZone}</small></span><span><em className={`sa-state ${site.status}`}>{site.status}</em></span><span><b>{site.rootSupervisor?.fullName || "Root missing"}</b><small>{site.rootSupervisor?.email || "No account email"}</small></span><span><b>{site.activeMap ? `${number.format(site.activeMap.widthMeters)} × ${number.format(site.activeMap.heightMeters)} m` : "Map missing"}</b><small>{site.activeMap ? `${site.activeMap.zoneCount} Zones · ${site.activeMap.cameraPlacementCount} Cameras` : "Requires attention"}</small></span><span><b>{when(site.updatedAt)}</b><small>Revision {site.revision}</small></span><i><Icon name="arrow" /></i></button>)}{!loading && !error && !shown.length && <div className="sa-empty">No Sites match this filter.</div>}</div>
    </section>{hasMore && <button className="operations-load-more" type="button" onClick={onLoadMore}>Load more · {sites.length} of {total}</button>}
  </main>;
}

function ConfirmStatusDialog({ site, onClose, onDone }: { site: V2SuperadminSite; onClose: () => void; onDone: () => void }) {
  const next = site.status === "active" ? "inactive" : "active";
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(""); try { await updateV2SuperadminSiteStatus(site.id, next, reason.trim()); onDone(); } catch (cause) { setError(errorCopy(cause)); setBusy(false); } };
  return <Modal title={`${next === "inactive" ? "Deactivate" : "Reactivate"} ${site.name}?`} description={next === "inactive" ? "Site users lose access and active operations are closed by the recovery operation." : "Site users can sign in again. Closed operations do not reopen."} onClose={() => { if (!busy) onClose(); }}><form onSubmit={submit}><div className="sa-dialog-body"><label>Reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} placeholder="Record why this Site status is changing" required /></label>{error && <p className="sa-form-error" role="alert">{error}</p>}</div><footer className="sa-dialog-actions"><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button className={next === "inactive" ? "danger" : "primary"} type="submit" disabled={busy || reason.trim().length < 3}>{busy ? "Updating…" : next === "inactive" ? "Deactivate Site" : "Reactivate Site"}</button></footer></form></Modal>;
}

function RootRecoveryDialog({ site, onClose, onDone }: { site: V2SuperadminSite; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<"reset_existing" | "replace">(site.rootSupervisor ? "reset_existing" : "replace");
  const [name, setName] = useState(site.rootSupervisor?.fullName ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(""); try { await recoverV2SuperadminRoot(site.id, { mode, email: mode === "replace" ? email.trim() : undefined, password, displayName: name.trim(), reason: reason.trim(), idempotencyKey }); onDone(); } catch (cause) { setError(errorCopy(cause)); setBusy(false); } };
  return <Modal className="sa-recovery-dialog" title="Recover Root access" description={`Restore Site authority for ${site.name}.`} onClose={() => { if (!busy) onClose(); }}><form onSubmit={submit}><div className="sa-dialog-body"><div className="sa-choice" role="group" aria-label="Root recovery mode"><button type="button" className={mode === "reset_existing" ? "active" : ""} onClick={() => setMode("reset_existing")}><b>Reset existing Root</b><span>Keep the same account and assign a new password.</span></button><button type="button" className={mode === "replace" ? "active" : ""} onClick={() => setMode("replace")}><b>Replace Root account</b><span>Disable the current identity and create another.</span></button></div><div className="sa-form-stack">{mode === "replace" && <label>New Root email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="new-root@example.com" required /></label>}<label>Root Supervisor name<input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} required /></label><label>New temporary password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={128} placeholder="At least 8 characters" required /></label><label>Recovery reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} placeholder="Record the verified recovery request" required /></label></div>{error && <p className="sa-form-error" role="alert">{error}</p>}</div><footer className="sa-dialog-actions"><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="primary" type="submit" disabled={busy || reason.trim().length < 3}>{busy ? "Recovering…" : mode === "replace" ? "Replace Root account" : "Reset Root account"}</button></footer></form></Modal>;
}

function AuditLedger({ events, empty = "No Superadmin activity has been recorded." }: { events: V2SuperadminAuditEvent[]; empty?: string }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return <div className="sa-audit-ledger">{events.map((event) => <article key={event.id}><button type="button" aria-expanded={expanded === event.id} onClick={() => setExpanded(expanded === event.id ? null : event.id)}><time>{when(event.occurredAt)}</time><i className={event.outcome}><Icon name={event.outcome === "succeeded" ? "shield" : "close"} /></i><span><b>{readable(event.action)}</b><small>{event.reason || event.errorCode || `${readable(event.resourceType)} updated`}</small></span><span><b>{event.siteNameSnapshot || "Platform"}</b><small>{event.actorNameSnapshot}</small></span><em className={event.outcome}>{event.outcome}</em></button>{expanded === event.id && <div className="sa-audit-detail"><dl><div><dt>Resource</dt><dd>{readable(event.resourceType)}{event.resourceId ? ` · ${event.resourceId}` : ""}</dd></div><div><dt>Actor UID</dt><dd>{event.actorUid}</dd></div><div><dt>Site ID</dt><dd>{event.siteId || "Platform"}</dd></div></dl><section><div><span>Before</span><pre>{event.before ? JSON.stringify(event.before, null, 2) : "No recorded values."}</pre></div><div><span>After</span><pre>{event.after ? JSON.stringify(event.after, null, 2) : "No recorded values."}</pre></div></section></div>}</article>)}{!events.length && <div className="sa-empty">{empty}</div>}</div>;
}

function SiteDetailPage({ siteId, onBack, onOpenView }: { siteId: string; onBack: () => void; onOpenView: () => void }) {
  const [detail, setDetail] = useState<V2SuperadminSiteDetail | null>(null);
  const [events, setEvents] = useState<V2SuperadminAuditEvent[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [statusDialog, setStatusDialog] = useState(false);
  const [recoveryDialog, setRecoveryDialog] = useState(false);
  const [recoveringOperation, setRecoveringOperation] = useState(false);
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const [auditTotal, setAuditTotal] = useState(0);
  const load = useCallback(async () => { setLoading(true); setError(""); try { const [site, audit] = await Promise.all([getV2SuperadminSite(siteId), getV2SuperadminSiteAuditPage(siteId)]); setDetail(site); setEvents(audit.items); setAuditCursor(audit.nextCursor); setAuditTotal(audit.totalCount); } catch (reason) { setError(errorCopy(reason)); } finally { setLoading(false); } }, [siteId]);
  const loadMoreAudit = async () => { if (!auditCursor) return; setLoading(true); try { const page = await getV2SuperadminSiteAuditPage(siteId, auditCursor); setEvents((current) => [...current, ...page.items.filter((item) => !current.some((loaded) => loaded.id === item.id))]); setAuditCursor(page.nextCursor); setAuditTotal(page.totalCount); } catch (reason) { setError(errorCopy(reason)); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [load]);
  if (loading) return <main className="sa-page"><div className="sa-page-loading">Loading Site register…</div></main>;
  if (error || !detail) return <main className="sa-page"><button className="sa-back" type="button" onClick={onBack}>← Back to Sites</button><div className="sa-page-error"><p>{error || "Site not found."}</p><button onClick={() => void load()}>Try again</button></div></main>;
  const site = detail.site;
  const operation = detail.latestOperation as V2SiteOperation | null;
  const operationOpen = operation && operation.status !== "completed";
  const recoverOperation = async () => { if (!operation) return; setRecoveringOperation(true); try { await reconcileV2SuperadminSiteOperation(site.id, operation.id); await load(); } catch (reason) { setError(errorCopy(reason)); } finally { setRecoveringOperation(false); } };
  const rootNeedsAttention = !site.rootSupervisor || site.rootSupervisor.status !== "active";
  return <main className="sa-page"><button className="sa-back" type="button" onClick={onBack}>← Back to Sites</button><header className="sa-site-detail-head"><div><span className={`sa-state ${site.status}`}>{site.status}</span><h1>{site.name}</h1><p>{site.description || `${site.timeZone} · Site ${site.id}`}</p></div><div><button type="button" onClick={onOpenView}><Icon name="view" />Open Site</button><button className={rootNeedsAttention ? "sa-primary" : ""} type="button" onClick={() => setRecoveryDialog(true)}>Recover Root access</button></div></header>
    {operationOpen && <section className="sa-operation-banner"><Icon name="refresh" /><div><strong>Site operation needs attention</strong><span>{readable(operation.type)} is {operation.status}. Completed work: {Object.values(operation.counts ?? {}).reduce((sum, value) => sum + value, 0)} records.</span></div><button type="button" disabled={recoveringOperation} onClick={() => void recoverOperation()}>{recoveringOperation ? "Recovering…" : "Continue recovery"}</button></section>}
    <div className="sa-site-workbench"><section className="sa-site-register"><header><h2>Site register</h2><span>Revision {site.revision}</span></header><dl><div><dt>Status</dt><dd><em className={`sa-state ${site.status}`}>{site.status}</em></dd></div><div><dt>Site ID</dt><dd>{site.id}</dd></div><div><dt>Timezone</dt><dd>{site.timeZone}</dd></div><div><dt>Created</dt><dd>{when(site.createdAt)}</dd></div><div><dt>Last updated</dt><dd>{when(site.updatedAt)}</dd></div></dl><footer><button className={site.status === "active" ? "danger-outline" : "sa-primary"} type="button" onClick={() => setStatusDialog(true)}>{site.status === "active" ? "Deactivate Site" : "Reactivate Site"}</button></footer></section>
      <section className="sa-root-register"><header><h2>Root ownership</h2><span>{site.rootSupervisor?.status || "missing"}</span></header>{site.rootSupervisor ? <><div className="sa-root-person"><i>{initials(site.rootSupervisor.fullName || "Root")}</i><div><strong>{site.rootSupervisor.fullName || "Root Supervisor"}</strong><span>{site.rootSupervisor.email || "Email unavailable"}</span></div></div><dl><div><dt>Account UID</dt><dd>{site.rootSupervisor.uid}</dd></div><div><dt>Access</dt><dd>{readable(site.rootSupervisor.status)}</dd></div></dl></> : <div className="sa-root-missing"><strong>No Root reference</strong><p>This Site needs account recovery before a Root Supervisor can administer it.</p></div>}<footer><button type="button" onClick={() => setRecoveryDialog(true)}>Open recovery controls</button></footer></section>
      <section className="sa-map-register"><header><h2>Published map</h2><span>{site.activeMap ? `Revision ${site.activeMap.revisionNumber}` : "Missing"}</span></header>{site.activeMap ? <><strong>{number.format(site.activeMap.widthMeters)} × {number.format(site.activeMap.heightMeters)} m</strong><p>{number.format(site.activeMap.gridSizeMeters)} m grid interval</p><div><span><b>{site.activeMap.zoneCount}</b>Zones</span><span><b>{site.activeMap.cameraPlacementCount}</b>Camera points</span></div><small>Published {when(site.activeMap.publishedAt)}</small></> : <div className="sa-root-missing"><strong>No active map</strong><p>The Site record does not reference a valid published map revision.</p></div>}</section>
    </div>
    <section className="sa-resource-register"><header><div><h2>Operational records</h2><p>Current volume retained inside this Site boundary.</p></div></header><div>{Object.entries(detail.counts).map(([key, value]) => <span key={key}><b>{number.format(value)}</b>{readable(key)}</span>)}</div></section>
    <section className="sa-site-audit"><header><div><h2>Superadmin audit history</h2><p>Privileged actions against this Site, with the real actor identity retained.</p></div><span>{auditTotal} events</span></header><AuditLedger events={events} empty="No Superadmin actions are recorded for this Site." />{auditCursor && <button className="operations-load-more" type="button" disabled={loading} onClick={() => void loadMoreAudit()}>{loading ? "Loading…" : `Load more · ${events.length} of ${auditTotal}`}</button>}</section>
    {statusDialog && <ConfirmStatusDialog site={site} onClose={() => setStatusDialog(false)} onDone={() => { setStatusDialog(false); void load(); }} />}{recoveryDialog && <RootRecoveryDialog site={site} onClose={() => setRecoveryDialog(false)} onDone={() => { setRecoveryDialog(false); void load(); }} />}
  </main>;
}

function AuditPage() {
  const [events, setEvents] = useState<V2SuperadminAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<"all" | "succeeded" | "failed">("all");
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const load = useCallback(async () => { setLoading(true); setError(""); try { const page = await getV2SuperadminAuditPage(); setEvents(page.items); setCursor(page.nextCursor); setTotal(page.totalCount); } catch (reason) { setError(errorCopy(reason)); } finally { setLoading(false); } }, []);
  const loadMore = async () => { if (!cursor) return; setLoading(true); try { const page = await getV2SuperadminAuditPage(undefined, cursor); setEvents((current) => [...current, ...page.items.filter((item) => !current.some((loaded) => loaded.id === item.id))]); setCursor(page.nextCursor); setTotal(page.totalCount); } catch (reason) { setError(errorCopy(reason)); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [load]);
  const normalized = query.trim().toLowerCase();
  const shown = events.filter((event) => outcome === "all" || event.outcome === outcome).filter((event) => !normalized || `${event.action} ${event.siteNameSnapshot ?? ""} ${event.actorNameSnapshot} ${event.resourceType}`.toLowerCase().includes(normalized));
  return <main className="sa-page"><header className="sa-page-head"><div><h1>Audit history</h1><p>Every privileged platform action, attributed to the Superadmin who performed it.</p></div><button type="button" onClick={() => void load()}><Icon name="refresh" />Refresh</button></header><section className="sa-site-audit global"><header><div><h2>Platform ledger</h2><p>Reads do not create audit events. Mutations and failed privileged requests do.</p></div><span>{total} events</span></header><div className="sa-audit-controls"><div className="sa-status-tabs" role="group" aria-label="Filter audit outcome">{(["all", "succeeded", "failed"] as const).map((value) => <button type="button" className={outcome === value ? "active" : ""} onClick={() => setOutcome(value)} key={value}>{readable(value)}</button>)}</div><label className="sa-search"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search action, Site, actor, or resource" /></label></div>{loading && !events.length ? <div className="sa-empty">Loading audit history…</div> : error ? <div className="sa-empty error">{error}</div> : <><AuditLedger events={shown} empty="No audit events match this filter." />{cursor && <button className="operations-load-more" type="button" disabled={loading} onClick={() => void loadMore()}>{loading ? "Loading…" : `Load more · ${events.length} of ${total}`}</button>}</>}</section></main>;
}

export function SuperadminApp({ profile, onLogout }: { profile: Profile; onLogout: () => void }) {
  const [route, setRoute] = useState<SuperadminRoute>(() => superadminRouteFromHash(location.hash));
  const siteViewSiteId = useRef<string | null>(route.kind === "site-view" ? route.siteId : null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [sites, setSites] = useState<V2SuperadminSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [siteTotal, setSiteTotal] = useState(0);
  useEffect(() => {
    if (!location.hash.startsWith("#/superadmin")) location.hash = superadminRouteHash({ kind: "sites" });
    const sync = () => {
      if (!location.hash.startsWith("#/superadmin") && siteViewSiteId.current) {
        const [path, query] = location.hash.replace(/^#\/?/, "").split("?");
        const page = ({ "": "dashboard", dashboard: "dashboard", cameras: "cameras", alerts: "alerts", history: "work", work: "work", admin: "team", team: "team", placement: "insights", insights: "insights", status: "system", system: "system", site: "site" } as Record<string, import("../../services/v2/routing").SuperadminSiteViewPage>)[path] ?? "dashboard";
        location.hash = `${superadminRouteHash({ kind: "site-view", siteId: siteViewSiteId.current, page })}${query ? `?${query}` : ""}`;
        return;
      }
      setRoute(superadminRouteFromHash(location.hash));
    };
    addEventListener("hashchange", sync);
    return () => removeEventListener("hashchange", sync);
  }, []);
  useEffect(() => { siteViewSiteId.current = route.kind === "site-view" ? route.siteId : null; }, [route]);
  useEffect(() => { window.scrollTo({ top: 0, left: 0 }); }, [route]);
  const loadSites = useCallback(async () => { setLoading(true); setError(""); try { const page = await getV2SuperadminSitesPage(); setSites(page.items); setNextCursor(page.nextCursor); setSiteTotal(page.totalCount); } catch (reason) { setError(errorCopy(reason)); } finally { setLoading(false); } }, []);
  const loadMoreSites = useCallback(async () => { if (!nextCursor) return; setLoading(true); try { const page = await getV2SuperadminSitesPage("all", nextCursor); setSites((current) => [...current, ...page.items.filter((item) => !current.some((loaded) => loaded.id === item.id))]); setNextCursor(page.nextCursor); setSiteTotal(page.totalCount); } catch (reason) { setError(errorCopy(reason)); } finally { setLoading(false); } }, [nextCursor]);
  useEffect(() => { void loadSites(); }, [loadSites]);
  const navigate = useCallback((next: SuperadminRoute) => { location.hash = superadminRouteHash(next); setRoute(next); }, []);
  const navigateSiteView = useCallback((siteId: string, page: import("../../services/v2/routing").SuperadminSiteViewPage, params?: Record<string, string>) => { const query = params && Object.keys(params).length ? `?${new URLSearchParams(params)}` : ""; location.hash = `${superadminRouteHash({ kind: "site-view", siteId, page })}${query}`; setRoute({ kind: "site-view", siteId, page }); }, []);
  const currentSection = route.kind === "audit" ? "audit" : "sites";
  const content = useMemo(() => {
    if (route.kind === "audit") return <AuditPage />;
    if (route.kind === "site") return <SiteDetailPage siteId={route.siteId} onBack={() => navigate({ kind: "sites" })} onOpenView={() => navigate({ kind: "site-view", siteId: route.siteId, page: "dashboard" })} />;
    return <SitesPage sites={sites} total={siteTotal} hasMore={Boolean(nextCursor)} loading={loading} error={error} onRetry={() => void loadSites()} onLoadMore={() => void loadMoreSites()} onOpen={(siteId) => navigate({ kind: "site", siteId })} onCreate={() => setDialog("create")} />;
  }, [error, loading, route, sites, siteTotal, nextCursor, loadSites, loadMoreSites]);
  if (route.kind === "site-view") return <SuperadminSiteView siteId={route.siteId} page={route.page} profile={profile} onNavigate={(page, params) => navigateSiteView(route.siteId, page, params)} onExit={() => navigate({ kind: "site", siteId: route.siteId })} onLogout={onLogout} />;
  return <div className="sa-shell"><header className="sa-nav"><button className="sa-brand" type="button" onClick={() => navigate({ kind: "sites" })}><b>LS</b><span><strong>LitterSpot</strong><small>Superadmin</small></span></button><nav aria-label="Superadmin navigation"><button type="button" className={currentSection === "sites" ? "active" : ""} aria-current={currentSection === "sites" ? "page" : undefined} onClick={() => navigate({ kind: "sites" })}><Icon name="sites" />Sites</button><button type="button" className={currentSection === "audit" ? "active" : ""} aria-current={currentSection === "audit" ? "page" : undefined} onClick={() => navigate({ kind: "audit" })}><Icon name="audit" />Audit history</button></nav><button className="sa-user" type="button" onClick={() => setDialog("account")} aria-label={`Open account controls for ${profile.displayName}`}>{initials(profile.displayName)}</button></header>{content}
    {dialog === "account" && <AccountDialog profile={profile} onClose={() => setDialog(null)} onLogout={onLogout} />}{dialog === "create" && <CreateSiteDialog onClose={() => setDialog(null)} onCreated={(siteId) => { setDialog(null); void loadSites(); navigate({ kind: "site", siteId }); }} />}
  </div>;
}
