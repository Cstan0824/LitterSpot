import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { SiteMapViewer } from "../components/SiteMapViewer";
import { siteMapDraftIssues, siteMapDraftSaveInput } from "../features/operations/siteMapDraft";
import { recommendedSiteMapGridInterval, siteMapGridSummary } from "../features/operations/siteMapGrid";
import { ApiError } from "../services/api/errors";
import { discardSiteMapDraft, getActiveSiteMap, getRetiredSiteMapZones, getSiteMapAuditEvents, getSiteMapDraft, publishSiteMapDraft, saveSiteMapDraft, startSiteMapDraft, uploadSiteMapBackground, validateSiteMapDraft, type ActiveSiteMap, type SiteMapAuditEvent, type SiteMapBackground, type SiteMapDraft, type SiteMapZone } from "../services/api/siteMap";
import { siteMapPolygonArea, type SiteMapPoint } from "../services/api/mapGeometry";
import "./site-administration.css";

type View = "overview" | "map" | "audit";
type Dialog = "settings" | "add-zone" | "discard" | "publish" | null;
type Settings = { widthMeters: number; heightMeters: number; gridSizeMeters: number; gridIntervalMode: "recommended" | "custom"; background: SiteMapBackground | null; backgroundX: number; backgroundY: number; backgroundWidth: number; opacity: number };

const mapActions = new Set(["site_map_draft_started", "site_map_draft_saved", "site_map_draft_validation_succeeded", "site_map_draft_validation_failed", "site_map_published", "site_map_draft_deleted", "site_background_uploaded", "site_map_request_failed", "camera_map_position_corrected", "camera_physical_move_started", "camera_physically_moved", "camera_physical_move_cancelled", "camera_created", "camera_deactivated"]);
const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const dateTime = new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const readable = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const when = (value?: string | null) => value && !Number.isNaN(new Date(value).getTime()) ? dateTime.format(new Date(value)) : "Not recorded";
const pointCopy = (point: SiteMapPoint) => `X ${number.format(point.xMeters)} m · Y ${number.format(point.yMeters)} m`;
const auditSnapshot = (value: Record<string, unknown> | null) => value && Object.keys(value).length ? JSON.stringify(value, null, 2) : "No recorded values.";

function Icon({ name }: { name: "map" | "zone" | "audit" | "upload" | "edit" | "close" | "check" | "warning" | "camera" | "undo" }) {
  if (name === "map") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Z" /><path d="M9 3v16M15 5v16" /></svg>;
  if (name === "zone") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 4 14 2-2 13-12 1-2-9Z" /><circle cx="5" cy="4" r="1.5" /><circle cx="19" cy="6" r="1.5" /><circle cx="17" cy="19" r="1.5" /></svg>;
  if (name === "audit") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4" /></svg>;
  if (name === "upload") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 15v5h16v-5" /></svg>;
  if (name === "edit") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-1 5 5-1L19 9l-4-4Z" /><path d="m13 7 4 4" /></svg>;
  if (name === "check") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>;
  if (name === "warning") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 22 20H2Z" /><path d="M12 9v5M12 17v.1" /></svg>;
  if (name === "camera") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="14" height="12" /><path d="m17 10 4-2v8l-4-2M8 6l1-2h3l1 2" /></svg>;
  if (name === "undo") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 7-5 5 5 5M5 12h8a6 6 0 0 1 6 6" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>;
}

function errorMessage(reason: unknown) {
  if (reason instanceof ApiError) {
    const details = reason.details && typeof reason.details === "object" ? reason.details as { issues?: Array<{ message?: string }> } : null;
    return details?.issues?.[0]?.message || reason.message;
  }
  return reason instanceof Error ? reason.message : "The Site Map request could not be completed.";
}

function mutableDraft(draft: SiteMapDraft, change: Partial<SiteMapDraft>): SiteMapDraft {
  return { ...draft, ...change, validationStatus: "not_validated", validationErrors: [], validationIssues: [] };
}

export function SiteAdministrationPage({ siteName, readOnly = false, quietReadOnly = false, initialMap, onNavigate, onPublished }: { siteName: string; readOnly?: boolean; quietReadOnly?: boolean; initialMap?: ActiveSiteMap; onNavigate?: (path: string, params?: Record<string, string>) => void; onPublished?: (map: ActiveSiteMap) => void | Promise<void> }) {
  const [view, setView] = useState<View>("overview");
  const [activeMap, setActiveMap] = useState<ActiveSiteMap | null>(null);
  const [draft, setDraft] = useState<SiteMapDraft | null>(null);
  const [draftBackground, setDraftBackground] = useState<SiteMapBackground | null>(null);
  const [retiredZones, setRetiredZones] = useState<SiteMapZone[]>([]);
  const [audits, setAudits] = useState<SiteMapAuditEvent[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [drawingZoneId, setDrawingZoneId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [newZoneName, setNewZoneName] = useState("");
  const [auditFilter, setAuditFilter] = useState<"all" | "succeeded" | "failed">("all");
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const zoneHistory = useRef(new Map<string, SiteMapPoint[][]>());

  const loadAudit = async (signal?: AbortSignal) => { if (!readOnly) setAudits((await getSiteMapAuditEvents(signal)).filter((event) => mapActions.has(event.action))); };
  const load = async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const map = initialMap ?? await getActiveSiteMap(signal);
      setActiveMap(map);
      setSelectedZoneId((current) => current && map.zones.some((zone) => zone.zoneId === current) ? current : map.zones[0]?.zoneId ?? null);
      if (!readOnly) {
        const [retired] = await Promise.all([getRetiredSiteMapZones(signal), loadAudit(signal)]);
        setRetiredZones(retired);
        try {
          const currentDraft = await getSiteMapDraft(signal);
          setDraft(currentDraft);
          setDraftBackground(currentDraft.background ?? (currentDraft.backgroundMediaId === map.background?.mediaId ? map.background : null));
        } catch (reason) {
          if (!(reason instanceof ApiError) || reason.status !== 404) throw reason;
          setDraft(null); setDraftBackground(null);
        }
      } else { setDraft(null); setDraftBackground(null); setRetiredZones([]); setAudits([]); }
      setDirty(false);
    } catch (reason) { if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(errorMessage(reason)); }
    finally { setLoading(false); }
  };

  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [initialMap, readOnly]);
  useEffect(() => {
    if (!draft || !activeMap) return;
    const pending = activeMap.zones.filter((zone) => !draft.zones.some((current) => current.zoneId === zone.zoneId));
    if (!pending.length) return;
    setRetiredZones((current) => [...new Map([...current, ...pending].map((zone) => [zone.zoneId, zone])).values()]);
  }, [activeMap, draft]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 3200); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { if (!dialog) return; const close = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape" && !busy) setDialog(null); }; addEventListener("keydown", close); return () => removeEventListener("keydown", close); }, [busy, dialog]);

  const working = draft ?? (activeMap ? { id: activeMap.siteId, siteId: activeMap.siteId, baseRevisionId: activeMap.activeRevisionId, widthMeters: activeMap.revision.widthMeters, heightMeters: activeMap.revision.heightMeters, gridSizeMeters: activeMap.revision.gridSizeMeters, backgroundMediaId: activeMap.revision.backgroundMediaId, backgroundTransform: activeMap.revision.backgroundTransform, coordinateOrigin: "top_left" as const, xAxisDirection: "right" as const, yAxisDirection: "down" as const, validationStatus: "valid" as const, validationErrors: [], revision: 0, zones: activeMap.zones, cameraPlacements: activeMap.cameraPlacements, cleanerStations: activeMap.cleanerStations } : null);
  const localIssues = useMemo(() => draft ? siteMapDraftIssues(draft, draftBackground) : [], [draft, draftBackground]);
  const conflictZoneIds = useMemo(() => new Set(localIssues.flatMap((issue) => issue.zoneIds ?? [])), [localIssues]);
  const selectedZoneRecord = working?.zones.find((zone) => zone.zoneId === selectedZoneId) ?? null;
  const selectedZone = selectedZoneRecord ? { ...selectedZoneRecord, areaSquareMeters: siteMapPolygonArea(selectedZoneRecord.polygon) } : null;
  const selectedIssues = localIssues.filter((issue) => issue.zoneIds?.includes(selectedZoneId ?? "") || issue.message.includes(selectedZone?.zoneNameSnapshot ?? "\0"));
  const filteredAudits = audits.filter((event) => auditFilter === "all" || event.outcome === auditFilter);
  const activeTitle = activeMap?.siteName || siteName;
  const tabs: Array<[View, string, "map" | "zone" | "audit"]> = readOnly ? [["overview", "Overview", "map"], ["map", "Map & Zones", "zone"]] : [["overview", "Overview", "map"], ["map", "Map & Zones", "zone"], ["audit", "Audit history", "audit"]];

  const changeDraft = (change: Partial<SiteMapDraft> | ((current: SiteMapDraft) => SiteMapDraft)) => {
    if (!draft) return;
    setDraft((current) => current ? typeof change === "function" ? change(current) : mutableDraft(current, change) : current);
    setDirty(true); setError("");
  };

  const rememberPolygon = (zoneId: string, polygon: SiteMapPoint[]) => {
    const history = zoneHistory.current.get(zoneId) ?? [];
    const last = history.at(-1);
    if (!last || JSON.stringify(last) !== JSON.stringify(polygon)) zoneHistory.current.set(zoneId, [...history.slice(-39), polygon]);
  };

  const updateZonePolygon = (zoneId: string, polygon: SiteMapPoint[]) => changeDraft((current) => {
    const zone = current.zones.find((item) => item.zoneId === zoneId);
    if (zone) rememberPolygon(zoneId, zone.polygon);
    return mutableDraft(current, { zones: current.zones.map((item) => item.zoneId === zoneId ? { ...item, polygon } : item) });
  });

  const undoZone = () => {
    if (!selectedZoneId) return;
    const history = zoneHistory.current.get(selectedZoneId) ?? [];
    const previous = history.at(-1);
    if (!previous) return;
    zoneHistory.current.set(selectedZoneId, history.slice(0, -1));
    changeDraft((current) => mutableDraft(current, { zones: current.zones.map((zone) => zone.zoneId === selectedZoneId ? { ...zone, polygon: previous } : zone) }));
  };

  const startDraft = async () => {
    if (readOnly) return;
    setBusy(true); setError("");
    try { const created = await startSiteMapDraft(); setDraft(created); setDraftBackground(created.background ?? activeMap?.background ?? null); setView("map"); setNotice("Site Map draft started from the active revision."); await loadAudit(); }
    catch (reason) { if (reason instanceof ApiError && reason.code === "site_map_draft_exists") { const current = await getSiteMapDraft(); setDraft(current); setDraftBackground(current.background ?? activeMap?.background ?? null); setView("map"); setNotice("The existing Site Map draft was recovered."); } else setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };

  const saveDraft = async () => {
    if (!draft || localIssues.length) return;
    setBusy(true); setError("");
    try { await saveSiteMapDraft(siteMapDraftSaveInput(draft)); const saved = await getSiteMapDraft(); setDraft(saved); setDraftBackground(saved.background ?? draftBackground); setDirty(false); setEditingZoneId(null); setDrawingZoneId(null); setNotice("Draft changes saved. Validate the map when you are ready."); await loadAudit(); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };

  const validateDraft = async () => {
    if (!draft || dirty || localIssues.length) return;
    setBusy(true); setError("");
    try { const result = await validateSiteMapDraft(); const refreshed = await getSiteMapDraft(); setDraft(refreshed); setDraftBackground(refreshed.background ?? draftBackground); setNotice(result.valid ? "Draft validation passed." : "Draft validation found problems."); await loadAudit(); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };

  const publishDraft = async () => {
    if (!draft || draft.validationStatus !== "valid" || dirty || localIssues.length) return;
    setBusy(true); setError("");
    try { const published = await publishSiteMapDraft(); setActiveMap(published); setDraft(null); setDraftBackground(null); setDialog(null); setDirty(false); setEditingZoneId(null); setDrawingZoneId(null); setSelectedZoneId(published.zones[0]?.zoneId ?? null); setRetiredZones(await getRetiredSiteMapZones()); await loadAudit(); await onPublished?.(published); setNotice(`Map Revision ${published.revision.revisionNumber} is now active.`); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };

  const discardDraft = async () => {
    setBusy(true); setError("");
    try { await discardSiteMapDraft(); setDraft(null); setDraftBackground(null); setDialog(null); setDirty(false); setEditingZoneId(null); setDrawingZoneId(null); setSelectedZoneId(activeMap?.zones[0]?.zoneId ?? null); await loadAudit(); setNotice("The draft was discarded. The active revision was not changed."); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };

  const openSettings = () => {
    if (!draft) return;
    const transform = draft.backgroundTransform;
    const recommendedInterval = recommendedSiteMapGridInterval(draft.widthMeters);
    setSettings({ widthMeters: draft.widthMeters, heightMeters: draft.heightMeters, gridSizeMeters: draft.gridSizeMeters, gridIntervalMode: recommendedInterval === draft.gridSizeMeters ? "recommended" : "custom", background: draftBackground, backgroundX: transform?.xMeters ?? 0, backgroundY: transform?.yMeters ?? 0, backgroundWidth: transform?.widthMeters ?? draft.widthMeters, opacity: transform?.opacity ?? 1 });
    setDialog("settings");
  };

  const updateSettingsDimension = (field: "widthMeters" | "heightMeters", value: number) => setSettings((current) => {
    if (!current) return current;
    const next = { ...current, [field]: value };
    const recommendedInterval = recommendedSiteMapGridInterval(next.widthMeters);
    return current.gridIntervalMode === "recommended" && recommendedInterval !== null ? { ...next, gridSizeMeters: recommendedInterval } : next;
  });
  const recommendedGridInterval = settings ? recommendedSiteMapGridInterval(settings.widthMeters) : null;
  const currentGridSummary = settings ? siteMapGridSummary(settings.widthMeters, settings.heightMeters, settings.gridSizeMeters) : null;
  const settingsDimensionsValid = settings ? [settings.widthMeters, settings.heightMeters, settings.gridSizeMeters].every((value) => Number.isFinite(value) && value > 0) : false;
  const settingsBackgroundHeight = settings?.background ? settings.backgroundWidth / (settings.background.width / settings.background.height) : 0;
  const applySettings = (event: FormEvent) => {
    event.preventDefault();
    if (!draft || !settings || !settingsDimensionsValid) return;
    const transform = settings.background ? { xMeters: settings.backgroundX, yMeters: settings.backgroundY, widthMeters: settings.backgroundWidth, heightMeters: settingsBackgroundHeight, opacity: settings.opacity } : null;
    setDraftBackground(settings.background);
    changeDraft(mutableDraft(draft, { widthMeters: settings.widthMeters, heightMeters: settings.heightMeters, gridSizeMeters: settings.gridSizeMeters, backgroundMediaId: settings.background?.mediaId ?? null, backgroundTransform: transform, background: settings.background }));
    setDialog(null); setSettings(null);
  };

  const uploadBackground = async (file: File) => {
    if (!settings) return;
    setBusy(true); setError("");
    try {
      const background = await uploadSiteMapBackground(file);
      const scale = Math.min(settings.widthMeters / background.width, settings.heightMeters / background.height);
      const width = background.width * scale;
      const height = background.height * scale;
      setSettings({ ...settings, background, backgroundWidth: width, backgroundX: (settings.widthMeters - width) / 2, backgroundY: (settings.heightMeters - height) / 2 });
      setNotice("Background uploaded. Adjust its alignment, then save the settings to the draft.");
      await loadAudit();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };

  const createZone = (event: FormEvent) => {
    event.preventDefault();
    if (!draft || !newZoneName.trim()) return;
    const zoneId = `zone-${crypto.randomUUID()}`;
    const zone: SiteMapZone = { id: zoneId, zoneId, zoneNameSnapshot: newZoneName.trim(), polygon: [] };
    changeDraft(mutableDraft(draft, { zones: [...draft.zones, zone] }));
    setSelectedZoneId(zoneId); setDrawingZoneId(zoneId); setEditingZoneId(null); setNewZoneName(""); setDialog(null); setView("map");
  };

  if (loading && !activeMap) return <section className="site-admin-state-page"><span>Loading the Site Map…</span></section>;
  if (!activeMap || !working) return <section className="site-admin-state-page error"><h1>Site Map unavailable.</h1><p>{error || "The active Site Map could not be loaded."}</p><button type="button" onClick={() => void load()}>Try again</button></section>;

  const activeZones = activeMap.zones.map((zone) => ({ id: zone.zoneId, name: zone.zoneNameSnapshot, polygon: zone.polygon }));
  const workingZones = working.zones.map((zone) => ({ id: zone.zoneId, name: zone.zoneNameSnapshot, polygon: zone.polygon }));

  return <section className="site-admin-page">
    <header className="site-admin-heading"><div><h1>{activeTitle}</h1><p>{readOnly && quietReadOnly ? "Site boundary, background, Zones, Cameras, and Station Points in the published revision." : "Control the Site boundary, background, Zones, and structural points from one revisioned map."}</p></div><div className="site-admin-state"><span><i />{readable(activeMap.siteStatus)}</span><strong>Map Revision {activeMap.revision.revisionNumber}</strong><small>Published {when(activeMap.revision.publishedAt)}</small></div></header>
    {error && <div className="site-admin-feedback error" role="alert"><Icon name="warning" /><span>{error}</span><button type="button" onClick={() => setError("")}>Dismiss</button></div>}
    <div className={`site-admin-mode ${draft ? "draft" : "published"}`}><div><strong>{readOnly && quietReadOnly ? "Published Site structure" : readOnly ? "Read-only Site structure" : draft ? `Editing draft from Revision ${activeMap.revision.revisionNumber}` : "Published Site structure"}</strong><span>{readOnly && quietReadOnly ? "Current boundary, background, Zones, Cameras, and Station Points." : readOnly ? "Regular Supervisors can inspect the active structure. Root controls map drafts and publication." : draft ? dirty ? "Local changes have not been saved to the draft yet." : draft.validationStatus === "valid" ? "The saved draft passed validation and is ready for review." : "The active revision remains operational while this draft is prepared." : "Start a draft before changing dimensions, background, or Zones."}</span></div>{!readOnly && (draft ? <div><button type="button" disabled={busy} onClick={() => setDialog("discard")}>Discard</button><button type="button" disabled={busy || !dirty || localIssues.length > 0 || Boolean(editingZoneId || drawingZoneId)} onClick={() => void saveDraft()}>Save changes</button><button type="button" disabled={busy || dirty || draft.validationStatus === "valid" || localIssues.length > 0 || Boolean(editingZoneId || drawingZoneId)} onClick={() => void validateDraft()}>Validate map</button><button className="primary" type="button" disabled={busy || dirty || draft.validationStatus !== "valid" || localIssues.length > 0 || Boolean(editingZoneId || drawingZoneId)} onClick={() => setDialog("publish")}>Review and publish</button></div> : <button className="primary" type="button" disabled={busy} onClick={() => void startDraft()}>{busy ? "Starting…" : "Start map draft"}</button>)}</div>
    <nav className="site-admin-tabs" aria-label="Site administration views">{tabs.map(([id,label,icon]) => <button type="button" aria-current={view === id ? "page" : undefined} onClick={() => setView(id)} key={id}><Icon name={icon} /><span>{label}</span>{id === "audit" && <b>{audits.length}</b>}</button>)}</nav>

    {view === "overview" && <div className="site-admin-overview"><section className="site-admin-map-panel"><header><div><span>ACTIVE SITE MAP</span><h2>The published structure every operation uses.</h2></div><button type="button" onClick={() => setView("map")}>Open map workspace</button></header><SiteMapViewer compact boundary={{ widthMeters: activeMap.revision.widthMeters, heightMeters: activeMap.revision.heightMeters }} gridSizeMeters={activeMap.revision.gridSizeMeters} background={activeMap.background} backgroundTransform={activeMap.revision.backgroundTransform} zones={activeZones} cameras={activeMap.cameraPlacements} stations={activeMap.cleanerStations} selectedZoneId={selectedZoneId} onSelectZone={(id) => { setSelectedZoneId(id); setView("map"); }} onSelectCamera={(cameraId) => { location.hash = `/cameras?cameraId=${encodeURIComponent(cameraId)}&from=site`; }} /><footer><span><b>{number.format(activeMap.revision.widthMeters)} × {number.format(activeMap.revision.heightMeters)} m</b>Real boundary</span><span><b>{activeMap.zones.length}</b>Active Zones</span><span><b>{activeMap.cameraPlacements.length}</b>Camera points</span></footer></section><aside className="site-admin-overview-side"><section className="site-admin-register"><header><span>SITE REGISTER</span><b className="active">{readable(activeMap.siteStatus)}</b></header><dl><div><dt>Site ID</dt><dd>{activeMap.siteId}</dd></div><div><dt>Timezone</dt><dd>{activeMap.timeZone}</dd></div><div><dt>Coordinate origin</dt><dd>Top-left</dd></div><div><dt>Grid interval</dt><dd>{number.format(activeMap.revision.gridSizeMeters)} m</dd></div><div><dt>Background</dt><dd>{activeMap.background ? `${activeMap.background.width} × ${activeMap.background.height}` : "Not configured"}</dd></div></dl>{draft && <button type="button" onClick={openSettings}><Icon name="edit" />Edit draft settings</button>}</section><section className="site-admin-next"><span>{draft ? "DRAFT OPEN" : "REVISION CONTROL"}</span><h2>{draft ? dirty ? "Save the map work." : draft.validationStatus === "valid" ? "Ready to publish." : "Validate the structure." : "The active map stays safe."}</h2><p>{draft ? `${draft.zones.length} active Zones and ${draft.cameraPlacements.length} Camera points are in the draft.` : "A replacement map does not affect daily operations until Root validates and publishes it."}</p><button type="button" onClick={() => setView("map")}>{draft ? "Continue editing" : "Inspect structure"}</button></section></aside></div>}

    {view === "map" && <div className="site-admin-workspace"><aside className="site-zone-list"><header><div><span>{draft ? "DRAFT STRUCTURE" : "ACTIVE STRUCTURE"}</span><h2>Zones</h2></div>{draft && <button type="button" onClick={() => setDialog("add-zone")}>+ Add Zone</button>}</header>{working.zones.map((zone) => <button className={selectedZoneId === zone.zoneId ? "selected" : ""} type="button" key={zone.zoneId} onClick={() => setSelectedZoneId(zone.zoneId)}><i className={conflictZoneIds.has(zone.zoneId) ? "conflict" : ""} /><span><strong>{zone.zoneNameSnapshot}</strong><small>{zone.polygon.length} points · {working.cameraPlacements.filter((camera) => camera.zoneId === zone.zoneId).length} Cameras</small></span>{conflictZoneIds.has(zone.zoneId) ? <b className="invalid">Invalid</b> : <b>Active</b>}</button>)}{draft && retiredZones.length > 0 && <section className="site-retired-zones"><span>INACTIVE ZONES</span>{retiredZones.filter((zone) => !draft.zones.some((active) => active.zoneId === zone.zoneId)).map((zone) => <button type="button" key={zone.zoneId} onClick={() => { changeDraft(mutableDraft(draft, { zones: [...draft.zones, zone] })); setSelectedZoneId(zone.zoneId); }}>Restore {zone.zoneNameSnapshot}</button>)}</section>}</aside><section className="site-map-workbench"><header><div><span>{draft ? `DRAFT REVISION ${draft.revision}` : `ACTIVE REVISION ${activeMap.revision.revisionNumber}`}</span><h2>{selectedZone?.zoneNameSnapshot ?? "Site Map"}</h2></div><div>{draft && <button type="button" onClick={openSettings}><Icon name="edit" />Boundary & background</button>}</div></header><SiteMapViewer boundary={{ widthMeters: working.widthMeters, heightMeters: working.heightMeters }} gridSizeMeters={working.gridSizeMeters} background={draft ? draftBackground : activeMap.background} backgroundTransform={working.backgroundTransform} zones={workingZones} cameras={working.cameraPlacements} stations={working.cleanerStations} selectedZoneId={selectedZoneId} editableZoneId={editingZoneId} drawingZoneId={drawingZoneId} conflictingZoneIds={conflictZoneIds} onSelectZone={setSelectedZoneId} onAddZonePoint={(point) => { if (!drawingZoneId) return; const zone = draft?.zones.find((item) => item.zoneId === drawingZoneId); if (zone) updateZonePolygon(drawingZoneId, [...zone.polygon, point]); }} onMoveZoneVertex={(zoneId, index, point) => { const zone = draft?.zones.find((item) => item.zoneId === zoneId); if (zone) updateZonePolygon(zoneId, zone.polygon.map((vertex, vertexIndex) => vertexIndex === index ? point : vertex)); }} onSelectCamera={(cameraId) => { location.hash = `/cameras?cameraId=${encodeURIComponent(cameraId)}&from=site`; }} /><footer>{selectedZone ? <><div className="site-zone-editor-copy"><span>Zone boundary</span><strong>{selectedZone.polygon.length} points · {number.format(selectedZone.areaSquareMeters ?? 0)} m² recorded area</strong></div>{draft && <div className="site-zone-actions"><button type="button" disabled={!zoneHistory.current.get(selectedZone.zoneId)?.length} onClick={undoZone}><Icon name="undo" />Undo</button>{drawingZoneId === selectedZone.zoneId || editingZoneId === selectedZone.zoneId ? <button type="button" disabled={selectedIssues.length > 0 || selectedZone.polygon.length < 3} onClick={() => { setDrawingZoneId(null); setEditingZoneId(null); }}>Finish boundary</button> : <button type="button" onClick={() => setEditingZoneId(selectedZone.zoneId)}>Edit boundary</button>}<button className="danger" type="button" onClick={() => { changeDraft(mutableDraft(draft, { zones: draft.zones.filter((zone) => zone.zoneId !== selectedZone.zoneId) })); setSelectedZoneId(draft.zones.find((zone) => zone.zoneId !== selectedZone.zoneId)?.zoneId ?? null); setEditingZoneId(null); setDrawingZoneId(null); }}>Deactivate</button></div>}</> : <span>Select a Zone to inspect its boundary.</span>}</footer>{selectedZone && draft && <div className="site-zone-name"><label>Zone name<input value={selectedZone.zoneNameSnapshot} maxLength={120} onChange={(event) => changeDraft(mutableDraft(draft, { zones: draft.zones.map((zone) => zone.zoneId === selectedZone.zoneId ? { ...zone, zoneNameSnapshot: event.target.value } : zone) }))} /></label></div>}{localIssues.length > 0 && <section className="site-map-issues" aria-live="polite"><header><Icon name="warning" /><div><strong>{localIssues.length} map problem{localIssues.length === 1 ? "" : "s"}</strong><span>Saving and publication stay blocked.</span></div></header><ul>{localIssues.slice(0, 8).map((issue) => <li key={`${issue.code}-${issue.message}`}>{issue.message}</li>)}</ul></section>}</section></div>}

    {view === "audit" && !readOnly && <section className="site-audit"><header><div><h2>Site audit history</h2><p>Successful and failed structural actions, attributed to the real Supervisor account.</p></div><div>{([['all','All events'],['succeeded','Succeeded'],['failed','Failed']] as const).map(([id,label]) => <button className={auditFilter === id ? "active" : ""} type="button" key={id} onClick={() => setAuditFilter(id)}>{label}</button>)}</div></header><div className="site-audit-ledger">{filteredAudits.map((event) => { const expanded = expandedAuditId === event.id; return <article key={event.id}><button className="site-audit-row" type="button" aria-expanded={expanded} onClick={() => setExpandedAuditId(expanded ? null : event.id)}><time>{when(event.occurredAt)}</time><i className={event.outcome}><Icon name={event.outcome === "succeeded" ? "check" : "warning"} /></i><span className="site-audit-main"><strong>{readable(event.action)}</strong><small>{event.reason || (event.errorCode ? readable(event.errorCode) : `${readable(event.resourceType)} ${event.resourceId ? "updated" : "recorded"}.`)}</small></span><span><b>{event.actorNameSnapshot || "System"}</b><small>{event.actorAuthority ? `${readable(event.actorAuthority)} Supervisor` : readable(event.actorRole)}</small></span><em className={event.outcome}>{event.outcome}</em></button>{expanded && <div className="site-audit-detail"><dl><div><dt>Resource</dt><dd>{readable(event.resourceType)}{event.resourceId ? ` · ${event.resourceId}` : ""}</dd></div><div><dt>Actor UID</dt><dd>{event.actorUid}</dd></div><div><dt>Outcome detail</dt><dd>{event.reason || event.errorCode || "Completed without a recorded exception."}</dd></div></dl><div className="site-audit-snapshots"><section><span>Before</span><pre>{auditSnapshot(event.before)}</pre></section><section><span>After</span><pre>{auditSnapshot(event.after)}</pre></section></div></div>}</article>; })}{!filteredAudits.length && <div className="site-audit-empty">No Site structural events match this filter.</div>}</div></section>}

    {notice && <div className="site-admin-toast" role="status"><Icon name="check" />{notice}</div>}
    {dialog && <div className="site-dialog-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setDialog(null); }}><section className="site-dialog" role="dialog" aria-modal="true" aria-labelledby="site-dialog-title"><header><div><span>SITE MAP</span><h2 id="site-dialog-title">{dialog === "settings" ? "Boundary and background" : dialog === "add-zone" ? "Name the new Zone" : dialog === "publish" ? "Publish this Site Map?" : "Discard this draft?"}</h2></div><button type="button" disabled={busy} onClick={() => setDialog(null)} aria-label="Close"><Icon name="close" /></button></header>
      {dialog === "settings" && settings && <form onSubmit={applySettings}>
        <div className="site-dialog-body">
          <p>Dimensions are real metres. Existing Zone and point coordinates do not scale when the boundary changes.</p>
          <div className="site-dimension-fields">
            <label>Width <span>metres</span><input type="number" min="1" step="0.01" value={settings.widthMeters} onChange={(event) => updateSettingsDimension("widthMeters", Number(event.target.value))} required /></label>
            <label>Height <span>metres</span><input type="number" min="1" step="0.01" value={settings.heightMeters} onChange={(event) => updateSettingsDimension("heightMeters", Number(event.target.value))} required /></label>
            <div className="site-grid-field">
              <label>Grid interval <span>metres</span><input type="number" min="0.01" step="0.01" value={settings.gridSizeMeters} aria-describedby="site-grid-guidance" onChange={(event) => setSettings({ ...settings, gridSizeMeters: Number(event.target.value), gridIntervalMode: "custom" })} required /></label>
              <div className="site-grid-guidance" id="site-grid-guidance">
                {settings.gridIntervalMode === "custom" && <span>{recommendedGridInterval === null ? "Enter a valid width to calculate a recommendation" : `Custom value · ${number.format(recommendedGridInterval)} m recommended`}</span>}
                {settings.gridIntervalMode === "custom" && recommendedGridInterval !== null && <button type="button" onClick={() => setSettings({ ...settings, gridSizeMeters: recommendedGridInterval, gridIntervalMode: "recommended" })}>Use recommended</button>}
              </div>
            </div>
          </div>
          <div className={`site-grid-summary ${currentGridSummary ? "valid" : "invalid"}`} role="status" aria-live="polite">
            {currentGridSummary ? <><span>LIVE GRID</span><strong>{number.format(currentGridSummary.columns)} × {number.format(currentGridSummary.rows)} grid</strong><small>{number.format(currentGridSummary.totalCells)} cells</small></> : <><span>GRID PREVIEW</span><strong>Enter positive dimensions and an interval.</strong></>}
          </div>
          <label className="site-upload">Site background <span>JPEG, PNG or WebP</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadBackground(file); }} /><b><Icon name="upload" />{busy ? "Uploading…" : settings.background ? "Replace background" : "Upload background"}</b></label>
          {settings.background && <section className="site-background-alignment"><header><div><strong>{settings.background.width} × {settings.background.height} px</strong><span>Aspect ratio locked</span></div><button type="button" onClick={() => setSettings({ ...settings, background: null })}>Remove</button></header><div className="site-dimension-fields"><label>X position <span>metres</span><input type="number" step="0.01" value={settings.backgroundX} onChange={(event) => setSettings({ ...settings, backgroundX: Number(event.target.value) })} /></label><label>Y position <span>metres</span><input type="number" step="0.01" value={settings.backgroundY} onChange={(event) => setSettings({ ...settings, backgroundY: Number(event.target.value) })} /></label><label>Rendered width <span>metres</span><input type="number" min="0.01" step="0.01" value={settings.backgroundWidth} onChange={(event) => setSettings({ ...settings, backgroundWidth: Number(event.target.value) })} /></label><label>Rendered height <span>locked</span><input value={number.format(settingsBackgroundHeight)} readOnly /></label><label>Opacity <span>{Math.round(settings.opacity * 100)}%</span><input type="range" min="0" max="1" step="0.05" value={settings.opacity} onChange={(event) => setSettings({ ...settings, opacity: Number(event.target.value) })} /></label></div></section>}
        </div>
        <footer><button type="button" onClick={() => setDialog(null)}>Cancel</button><button className="primary" type="submit" disabled={!settingsDimensionsValid}>Apply settings</button></footer>
      </form>}
      {dialog === "add-zone" && <form onSubmit={createZone}><div className="site-dialog-body"><p>After naming the Zone, click its boundary points on the map. It cannot touch another active Zone.</p><label>Zone name<input value={newZoneName} onChange={(event) => setNewZoneName(event.target.value)} maxLength={120} placeholder="e.g. North Entrance" autoFocus required /></label></div><footer><button type="button" onClick={() => setDialog(null)}>Cancel</button><button className="primary" type="submit">Plot boundary</button></footer></form>}
      {(dialog === "publish" || dialog === "discard") && <><div className="site-dialog-body"><p>{dialog === "publish" ? `Revision ${activeMap.revision.revisionNumber + 1} will replace the active Site Map. The complete validated structure changes together.` : "All unpublished draft changes will be removed. The active Site Map stays unchanged."}</p><div className={`site-dialog-note ${dialog === "discard" ? "danger" : ""}`}><Icon name={dialog === "publish" ? "check" : "warning"} /><span><strong>{dialog === "publish" ? "Atomic publication" : "Published operations stay safe"}</strong>{dialog === "publish" ? `${draft?.zones.length ?? 0} Zones, ${draft?.cameraPlacements.length ?? 0} Camera points, and ${draft?.cleanerStations.length ?? 0} Station Points.` : `Map Revision ${activeMap.revision.revisionNumber} remains active.`}</span></div></div><footer><button type="button" disabled={busy} onClick={() => setDialog(null)}>Go back</button><button className={dialog === "discard" ? "danger" : "primary"} type="button" disabled={busy} onClick={() => void (dialog === "publish" ? publishDraft() : discardDraft())}>{busy ? "Working…" : dialog === "publish" ? "Publish revision" : "Discard draft"}</button></footer></>}
    </section></div>}
  </section>;
}
