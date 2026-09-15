import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActiveSiteMap } from "../../services/api/siteMap";
import type { SuperadminSiteViewPage } from "../../services/api/routing";
import type { OperationsAlert, OperationsCleaner, OperationsDashboard, OperationsReadModel, OperationsWorkOrder } from "../../services/api/operations";
import {
  getSuperadminAnalytics,
  getSuperadminAlert,
  getSuperadminCamera,
  getSuperadminListPage,
  getSuperadminOperationsView,
  getSuperadminSystemRun,
  getSuperadminWork,
  superadminMediaContentUrl,
  type SuperadminOperationsView,
} from "../../services/api/superadmin";
import { adaptOperations } from "../operations/OperationsConsole";
import { GeographicOperationsDashboard } from "../operations/GeographicOperationsDashboard";
import { CameraOperationsPage } from "../operations/CameraOperationsPage";
import { AlertManagementPage } from "../operations/AlertManagementPage";
import { WorkManagementPage } from "../operations/WorkManagementPage";
import { TeamManagementPage } from "../operations/TeamManagementPage";
import { SystemPage } from "../../pages/SystemPage";
import { SiteAdministrationPage } from "../../pages/SiteAdministrationPage";
import type { SystemRun, SystemView } from "../../services/api/system";
import type { SupervisorListItem } from "../../services/api/supervisors";
import type { BinPlacementSnapshot } from "../../services/api/binPlacement";
import "./superadmin-site-view.css";

type Profile = { uid: string; email: string; displayName: string };
type Navigate = (page: SuperadminSiteViewPage, params?: Record<string, string>) => void;

const pageLabels: Record<SuperadminSiteViewPage, string> = { dashboard: "Dashboard", cameras: "Cameras", alerts: "Alerts", work: "Work", team: "Team", insights: "Insights", system: "System", site: "Site" };
const pages = Object.keys(pageLabels) as SuperadminSiteViewPage[];
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const numeric = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const errorCopy = (reason: unknown) => reason instanceof Error ? reason.message : "The Site could not be loaded.";

function Icon({ name }: { name: SuperadminSiteViewPage | "close" | "exit" }) {
  if (name === "close") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>;
  if (name === "exit") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H4v16h6M14 8l4 4-4 4M8 12h10" /></svg>;
  if (name === "dashboard") return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="2.5" width="6" height="6" /><rect x="11.5" y="2.5" width="6" height="6" /><rect x="2.5" y="11.5" width="6" height="6" /><rect x="11.5" y="11.5" width="6" height="6" /></svg>;
  if (name === "cameras") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="14" height="12" /><path d="m17 10 4-2v8l-4-2M8 6l1-2h3l1 2" /></svg>;
  if (name === "alerts") return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5 18 17H2Z" /><path d="M10 7v4.5M10 14.3v.2" /></svg>;
  if (name === "work") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="14" height="17" /><path d="M9 4V2h6v2M8 10h8M8 14h8M8 18h5" /></svg>;
  if (name === "team") return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="7" cy="7" r="3" /><circle cx="14.5" cy="8" r="2.3" /><path d="M2.5 17c.4-3.2 2-5 4.8-5s4.6 1.8 5 5M12 13c2.8-.4 4.6.9 5.2 3.8" /></svg>;
  if (name === "insights") return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 16.5h15M4.5 14V9M10 14V4M15.5 14V7" /></svg>;
  if (name === "site") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Z" /><path d="M9 3v16M15 5v16" /></svg>;
  return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3" /><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M15.7 4.3l-1.4 1.4M5.7 14.3l-1.4 1.4" /></svg>;
}

function emptyDashboard(view: SuperadminOperationsView): OperationsDashboard {
  const activeAlerts = view.alerts.filter((alert) => !["resolved", "dismissed"].includes(alert.status)).length;
  const activeWork = view.workOrders.filter((work) => !["resolved", "dismissed"].includes(work.status)).length;
  return {
    counts: { zoneCount: view.siteMap.zones.length, cameraCount: view.cameras.length, cleanerCount: view.cleaners.length, availableCleanerCount: view.cleaners.filter((cleaner) => cleaner.availability.available).length, alertCount: view.alerts.length, activeAlertCount: activeAlerts, workCount: view.workOrders.length, activeWorkCount: activeWork, onlineCameraCount: view.cameras.filter((camera) => camera.runtime?.connectionStatus === "online").length },
    topAlerts: [], busyZones: [], availableCleaners: view.cleaners.filter((cleaner) => cleaner.availability.available), assignedWork: view.workOrders.filter((work) => !["resolved", "dismissed"].includes(work.status)), generatedAt: new Date(0).toISOString(),
  };
}

export function superadminSiteViewPageFromPath(path: string): SuperadminSiteViewPage {
  const value = path.replace(/^\//, "").split("?")[0];
  return ({ "": "dashboard", dashboard: "dashboard", cameras: "cameras", alerts: "alerts", history: "work", work: "work", admin: "team", team: "team", placement: "insights", insights: "insights", status: "system", system: "system", site: "site" } as Record<string, SuperadminSiteViewPage>)[value] ?? "dashboard";
}

function SiteViewNavigation({ page, siteName, profile, alertCount, onNavigate, onExit, onLogout }: { page: SuperadminSiteViewPage; siteName: string; profile: Profile; alertCount: number; onNavigate: Navigate; onExit: () => void; onLogout: () => void }) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const accountTrigger = useRef<HTMLButtonElement>(null);
  const accountDialog = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!accountOpen && !menuOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setAccountOpen(false); setMenuOpen(false); accountTrigger.current?.focus(); return; }
      if (!accountOpen || event.key !== "Tab") return;
      const items = Array.from(accountDialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? []);
      if (!items.length) return;
      const first = items[0], last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    if (accountOpen) queueMicrotask(() => accountDialog.current?.querySelector<HTMLButtonElement>("button")?.focus());
    addEventListener("keydown", close);
    return () => removeEventListener("keydown", close);
  }, [accountOpen, menuOpen]);
  const go = (next: SuperadminSiteViewPage) => { setMenuOpen(false); onNavigate(next); };
  return <><header className={`field-nav-head site-view-nav ${menuOpen ? "field-nav-open" : ""}`}><button className="field-nav-menu" type="button" aria-label="Open navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><span /><span /><span /></button><button className="field-nav-logo" type="button" onClick={() => go("dashboard")}>LitterSpot</button><nav className="field-primary-nav" aria-label="Site navigation"><button className="field-nav-mobile-site" type="button" onClick={() => go("site")}><small>Selected Site</small><strong>{siteName}</strong></button>{pages.filter((item) => item !== "site").map((item) => <button type="button" className={page === item ? "active" : ""} aria-current={page === item ? "page" : undefined} key={item} onClick={() => go(item)}><span className="field-nav-icon"><Icon name={item} /></span><span>{pageLabels[item]}</span>{item === "alerts" && alertCount > 0 && <b>{alertCount}</b>}</button>)}</nav><button className={`field-nav-site ${page === "site" ? "active" : ""}`} type="button" onClick={() => go("site")}><small>Selected Site</small><strong>{siteName}</strong></button><button ref={accountTrigger} className="field-nav-user" type="button" aria-label={`Open account controls for ${profile.displayName}`} aria-expanded={accountOpen} onClick={() => setAccountOpen(true)}>{initials(profile.displayName)}</button></header><button className={`field-nav-scrim ${menuOpen ? "visible" : ""}`} type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />
    {accountOpen && <div className="field-account-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) { setAccountOpen(false); accountTrigger.current?.focus(); } }}><section ref={accountDialog} className="field-account-dialog site-view-account" role="dialog" aria-modal="true" aria-labelledby="site-view-account-title"><header><div><span>ACCOUNT</span><h2 id="site-view-account-title">Superadmin account</h2></div><button type="button" onClick={() => { setAccountOpen(false); accountTrigger.current?.focus(); }} aria-label="Close account controls"><Icon name="close" /></button></header><div className="field-account-person"><i>{initials(profile.displayName)}</i><div><strong>{profile.displayName}</strong><span>LitterSpot Superadmin</span></div></div><dl><div><dt>Name</dt><dd>{profile.displayName}</dd></div><div><dt>Email</dt><dd>{profile.email}</dd></div><div><dt>Current Site</dt><dd>{siteName}</dd></div></dl><footer><button className="site-view-exit" type="button" onClick={onExit}><Icon name="exit" />Exit Site</button><button type="button" onClick={onLogout}>Sign out</button></footer></section></div>}
  </>;
}

function InsightsPage({ siteId }: { siteId: string }) {
  const [data, setData] = useState<{ summaries: Array<Record<string, unknown>>; binPlacement: BinPlacementSnapshot | null }>();
  const [error, setError] = useState("");
  useEffect(() => { const controller = new AbortController(); void getSuperadminAnalytics(siteId, {}, controller.signal).then(setData).catch((reason) => { if (!controller.signal.aborted) setError(errorCopy(reason)); }); return () => controller.abort(); }, [siteId]);
  const totals = (data?.summaries ?? []).reduce<{ people: number; alerts: number; work: number }>((sum, row) => ({ people: sum.people + numeric((row.siteTotals as Record<string, unknown> | undefined)?.peopleSum), alerts: sum.alerts + numeric((row.siteTotals as Record<string, unknown> | undefined)?.litterAlertCount) + numeric((row.siteTotals as Record<string, unknown> | undefined)?.spillAlertCount) + numeric((row.siteTotals as Record<string, unknown> | undefined)?.binServiceAlertCount), work: sum.work + numeric((row.siteTotals as Record<string, unknown> | undefined)?.resolvedWorkCount) }), { people: 0, alerts: 0, work: 0 });
  return <main className="site-view-insights"><header><div><h1>Insights</h1><p>Stored Site summaries and the latest bin-placement calculation.</p></div></header>{error ? <div className="site-view-state error">{error}</div> : !data ? <div className="site-view-state">Loading Site analytics…</div> : <><section className="site-view-insight-summary"><span><b>{data.summaries.length}</b>Daily summaries</span><span><b>{totals.people}</b>People observations</span><span><b>{totals.alerts}</b>Recorded Alerts</span><span><b>{totals.work}</b>Resolved Work</span></section><section className="site-view-daily-ledger"><header><h2>Daily activity</h2><span>Most recent first</span></header>{data.summaries.slice(0, 30).map((row, index) => { const values = (row.siteTotals ?? {}) as Record<string, unknown>; return <div key={String(row.id ?? row.localDate ?? index)}><time>{String(row.localDate ?? "Date unavailable")}</time><span>{numeric(values.peopleSum)} people</span><span>{numeric(values.litterAlertCount) + numeric(values.spillAlertCount) + numeric(values.binServiceAlertCount)} Alerts</span><span>{numeric(values.resolvedWorkCount)} resolved Work</span></div>; })}{!data.summaries.length && <p>No daily summaries are stored for this Site.</p>}</section><section className="site-view-bin-snapshot"><header><div><h2>Bin placement snapshot</h2>{data.binPlacement && <p>{data.binPlacement.availableDays} of {data.binPlacement.requestedLookbackDays} requested days available</p>}</div>{data.binPlacement && <span>{data.binPlacement.status.replaceAll("_", " ")}</span>}</header>{data.binPlacement ? <div className="site-view-bin-table"><div className="labels"><span>Rank</span><span>Zone</span><span>Score</span><span>Evidence</span><span>Coverage</span></div>{data.binPlacement.zoneRankings.map((ranking) => <div key={ranking.zoneId}><b>{ranking.rank ?? "—"}</b><span><strong>{ranking.zoneNameSnapshot}</strong><small>{ranking.reasonSummary}</small></span><strong>{ranking.totalScore == null ? "—" : ranking.totalScore.toFixed(1)}</strong><span>{ranking.peopleActivity.raw.toFixed(1)} people · {ranking.cleaningFrequency.raw} Work · {ranking.binServiceFrequency.raw} bin Alerts</span><span>{ranking.coverage.availableDays}/{ranking.coverage.requestedDays} days</span></div>)}</div> : <p className="site-view-bin-empty">No bin-placement snapshot is stored for this Site.</p>}</section></>}</main>;
}

export function SuperadminSiteView({ siteId, page, profile, onNavigate, onExit, onLogout }: { siteId: string; page: SuperadminSiteViewPage; profile: Profile; onNavigate: Navigate; onExit: () => void; onLogout: () => void }) {
  const [view, setView] = useState<SuperadminOperationsView>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { setLoading(true); setError(""); try { setView(await getSuperadminOperationsView(siteId)); } catch (reason) { setError(errorCopy(reason)); } finally { setLoading(false); } }, [siteId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { window.scrollTo({ top: 0, left: 0 }); }, [page]);
  const navigatePath = useCallback((path: string, params?: Record<string, string>) => onNavigate(superadminSiteViewPageFromPath(path), params), [onNavigate]);
  const loadCamera = useCallback((cameraId: string, signal?: AbortSignal) => getSuperadminCamera(siteId, cameraId, signal), [siteId]);
  const loadWorkDetail = useCallback((workOrderId: string, signal?: AbortSignal) => getSuperadminWork(siteId, workOrderId, signal), [siteId]);
  const loadAlertPage = useCallback((input: { limit?: number; cursor?: string; status?: string; zoneId?: string; severity?: string }, signal?: AbortSignal) => getSuperadminListPage<OperationsAlert>(siteId, "alerts", input, signal), [siteId]);
  const loadAlertDetail = useCallback((alertId: string, signal?: AbortSignal) => getSuperadminAlert(siteId, alertId, signal), [siteId]);
  const loadWorkPage = useCallback(async (input: { limit?: number; cursor?: string; status?: string; zoneId?: string; origin?: string }, signal?: AbortSignal) => { const page = await getSuperadminListPage<OperationsWorkOrder>(siteId, "work-orders", input, signal); return { ...page, statusCounts: page.statusCounts ?? { assigned: 0, in_progress: 0, awaiting_review: 0, resolved: 0, dismissed: 0 } }; }, [siteId]);
  const loadMoreResource = useCallback(async (resource: "cleaners" | "supervisors", cursor: string) => { const items = resource === "cleaners" ? await getSuperadminListPage<OperationsCleaner>(siteId, resource, { cursor }) : await getSuperadminListPage<SupervisorListItem>(siteId, resource, { cursor }); setView((current) => current ? { ...current, [resource]: [...current[resource], ...items.items.filter((item) => !current[resource].some((loaded) => ("id" in loaded ? loaded.id : loaded.uid) === ("id" in item ? item.id : item.uid)))], pagination: { ...current.pagination!, [resource]: { nextCursor: items.nextCursor, hasMore: items.hasMore, totalCount: items.totalCount } } } as SuperadminOperationsView : current); }, [siteId]);
  const loadSystem = useCallback(async (_signal?: AbortSignal) => view!.system, [view]);
  const loadRun = useCallback((runId: string, signal?: AbortSignal) => getSuperadminSystemRun(siteId, runId, signal), [siteId]);
  const loadRunsPage = useCallback((cursor?: string, signal?: AbortSignal) => getSuperadminListPage<SystemRun>(siteId, "runs", { cursor, limit: 20 }, signal), [siteId]);
  const adapted = useMemo(() => view ? adaptOperations({ dashboard: view.dashboard ?? emptyDashboard(view), siteMap: view.siteMap, alerts: view.alerts, cleaners: view.cleaners, workOrders: view.workOrders, cameras: view.cameras } satisfies OperationsReadModel) : null, [view]);
  const activeMap = useMemo(() => view ? ({ ...view.siteMap, siteStatus: view.site.status, timeZone: view.site.timeZone, revision: { ...view.siteMap.revision, id: view.site.activeMap?.revisionId ?? view.siteMap.activeRevisionId, revisionNumber: view.site.activeMap?.revisionNumber ?? 0, coordinateOrigin: "top_left", xAxisDirection: "right", yAxisDirection: "down", publishedAt: view.site.activeMap?.publishedAt ?? null } } as unknown as ActiveSiteMap) : null, [view]);
  if (loading && !view) return <div className="site-view-shell"><div className="site-view-state">Loading selected Site…</div></div>;
  if (!view || !adapted || !activeMap) return <div className="site-view-shell"><div className="site-view-state error"><strong>Site View unavailable.</strong><p>{error}</p><button type="button" onClick={() => void load()}>Try again</button><button type="button" onClick={onExit}>Exit Site</button></div></div>;
  const mediaUrl = (mediaId: string) => superadminMediaContentUrl(siteId, mediaId);
  const unavailable = async () => { throw new Error("This action is unavailable in Site View."); };
  const content = page === "dashboard" ? <GeographicOperationsDashboard zones={adapted.zones} cameras={adapted.cameras} alerts={adapted.alerts} workOrders={view.workOrders} loadAlertPage={loadAlertPage} loadWorkPage={loadWorkPage} cleaners={adapted.staff} recommendations={[]} availabilityById={adapted.availabilityById} busyZones={(view.dashboard ?? emptyDashboard(view)).busyZones} siteMap={view.siteMap} siteName={view.site.name} onNavigate={navigatePath} statusLabel="Site snapshot" statusDetail={view.site.status === "active" ? "Current Site data" : "Inactive Site data"} />
    : page === "cameras" ? <CameraOperationsPage readOnly showPermissionNotice={false} canManageCameraPlacement={false} sites={adapted.sites} zones={adapted.zones} cameras={adapted.cameras} feeds={[]} liveVideos={[]} alerts={adapted.alerts} cleaners={adapted.staff} siteMap={view.siteMap} workOrders={view.workOrders} onCreateZone={unavailable} onCreateCamera={unavailable} operationsCameras={view.cameras} getCameraDetail={loadCamera} getWorkDetail={loadWorkDetail} onNavigate={navigatePath} />
    : page === "alerts" ? <AlertManagementPage readOnly showPermissionNotice={false} alerts={adapted.alerts} cameras={adapted.cameras} cleaners={adapted.staff} workOrders={view.workOrders} loadPage={loadAlertPage} loadDetail={loadAlertDetail} onStatus={() => undefined} mediaContentUrl={mediaUrl} onNavigate={navigatePath} />
    : page === "work" ? <WorkManagementPage readOnly showPermissionNotice={false} siteMap={view.siteMap} cleaners={adapted.staff} zones={adapted.zones} cameras={adapted.cameras} alerts={adapted.alerts} workOrders={view.workOrders} loadPage={loadWorkPage} availableCleanerIds={view.cleaners.filter((cleaner) => cleaner.availability.available).map((cleaner) => cleaner.id)} mediaContentUrl={mediaUrl} onNavigate={navigatePath} />
    : page === "team" ? <TeamManagementPage readOnly viewer={{ uid: profile.uid, authority: "root" }} staff={adapted.staff} zones={adapted.zones} operationsCleaners={view.cleaners} cleanerTotal={view.pagination?.cleaners.totalCount} cleanerHasMore={view.pagination?.cleaners.hasMore} onLoadMoreCleaners={() => loadMoreResource("cleaners", view.pagination!.cleaners.nextCursor!)} workOrders={view.workOrders} siteMap={view.siteMap} supervisors={view.supervisors} supervisorTotal={view.pagination?.supervisors.totalCount} supervisorHasMore={view.pagination?.supervisors.hasMore} onLoadMoreSupervisors={() => loadMoreResource("supervisors", view.pagination!.supervisors.nextCursor!)} supervisorsLoading={false} onRetrySupervisors={() => void load()} onCreateSupervisor={unavailable} onUpdateSupervisor={unavailable} onCreate={unavailable} onUpdate={unavailable} onMoveStation={unavailable} onAvailabilityOverride={unavailable} />
    : page === "insights" ? <InsightsPage siteId={siteId} />
    : page === "system" ? <SystemPage readOnly initialView={view.system as SystemView} loadView={loadSystem} loadRun={loadRun} loadRunsPage={loadRunsPage} />
    : <SiteAdministrationPage readOnly quietReadOnly initialMap={activeMap} siteName={view.site.name} onNavigate={navigatePath} />;
  return <div className="site-view-shell"><SiteViewNavigation page={page} siteName={view.site.name} profile={profile} alertCount={(view.dashboard ?? emptyDashboard(view)).counts.activeAlertCount} onNavigate={onNavigate} onExit={onExit} onLogout={onLogout} />{view.site.status === "inactive" && <div className="site-view-inactive"><strong>Site inactive</strong><span>Historical data remains available. Site users and monitoring are stopped.</span></div>}<div className="site-view-content">{content}</div></div>;
}
