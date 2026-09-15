import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { SiteMapViewer } from "../../components/SiteMapViewer";
import type { Cleaner } from "../../services/cleanerAPI";
import type { CameraRecord, Zone } from "../../services/locationAPI";
import type { Alert } from "./types";
import { fetchWorkDetail, getWorkOrdersPage, type OperationsReadModel, type OperationsPoint, type OperationsWorkOrder, type OperationsWorkOrderPage, type OperationsWorkStatusCounts } from "../../services/api/operations";
import { loadAuthenticatedMedia, releaseAuthenticatedMedia } from "../../services/api/media";
import { workZoneAtPoint, workZoneCentroid } from "./workTargetMap";
import "./work-create-map.css";
import "./work-detail-modal.css";

type Point = { x: number; y: number };
type WorkStatus = "Assigned" | "In Progress" | "Awaiting Review" | "Resolved" | "Dismissed";
type WorkOrigin = "ai" | "manual";
export type WorkAction = "reassign" | "takeover" | "dismiss" | "verify" | "override";
type ManualWorkTarget = { type: "camera"; cameraId: string } | { type: "coordinate"; point: OperationsPoint };
type ManualWorkInput = { title: string; instructions: string; severity: "warning" | "critical"; assignedCleanerId: string; target: ManualWorkTarget };
type WorkSiteMap = OperationsReadModel["siteMap"];
type WorkCameraOption = { id: string; name: string; point: OperationsPoint; zoneId: string; zoneName: string };
export type WorkItem = {
  id: string; origin: WorkOrigin; issue: string; description: string; zoneId?: string; zoneName: string;
  cleanerId?: string; status: WorkStatus; priority: "Low" | "Medium" | "High"; createdAt: string; updatedAt: string;
  point?: Point; cameraId?: string; cameraName?: string; alertId?: string; managementMode?: string; verificationOutcome?: string | null; evidenceAvailable?: boolean; evidenceMediaId?: string; detectionTime?: string;
};

export function workItemFromOperations(work: OperationsWorkOrder, alerts: Array<Alert | import("../../services/api/operations").OperationsAlert> = []): WorkItem {
  const alert = work.alertId ? alerts.find((item) => item.id === work.alertId) : undefined;
  const alertCameraName = alert ? "cameraName" in alert ? alert.cameraName : alert.cameraNameSnapshot : undefined;
  const alertMediaId = alert ? "cameraNameSnapshot" in alert ? alert.evidence?.mediaId : alert.evidenceMediaId : undefined;
  return { id: work.id, origin: work.origin === "alert" ? "ai" : "manual", issue: title(work.issueType), description: work.instructions, zoneId: work.zoneId ?? undefined, zoneName: work.target.zoneNameSnapshot, cleanerId: work.assignedCleanerId, status: ({ assigned: "Assigned", in_progress: "In Progress", awaiting_review: "Awaiting Review", resolved: "Resolved", dismissed: "Dismissed" }[work.status] ?? "Assigned") as WorkStatus, priority: work.severity === "critical" ? "High" : "Medium", createdAt: work.createdAt ?? "", updatedAt: work.updatedAt ?? "", point: work.target.point ? { x: work.target.point.xMeters, y: work.target.point.yMeters } : undefined, cameraId: work.cameraId ?? undefined, cameraName: work.target.cameraNameSnapshot ?? alertCameraName, alertId: work.alertId ?? undefined, managementMode: work.managementMode, verificationOutcome: work.latestVerificationOutcome, evidenceAvailable: work.origin === "alert" ? Boolean(alertMediaId) : Boolean(work.completionEvidenceMediaId), evidenceMediaId: work.origin === "alert" ? alertMediaId ?? undefined : work.completionEvidenceMediaId ?? undefined, detectionTime: alert?.createdAt ?? work.createdAt ?? undefined };
}

const anchors = [{ x: 13, y: 18 }, { x: 8, y: 72 }, { x: 64, y: 16 }, { x: 40, y: 44 }, { x: 60, y: 70 }, { x: 82, y: 72 }, { x: 23, y: 40 }, { x: 83, y: 40 }];
const statusOptions: WorkStatus[] = ["Assigned", "In Progress", "Awaiting Review", "Resolved", "Dismissed"];

function anchorFor(zone: Zone, index: number): Point {
  const name = zone.name.toLowerCase();
  if (name.includes("main") || name.includes("entrance")) return anchors[0];
  if (name.includes("lower") && name.includes("stair")) return anchors[1];
  if (name.includes("upper") && name.includes("stair")) return anchors[2];
  if (name.includes("temple") || name.includes("courtyard")) return anchors[3];
  if (name.includes("food") || name.includes("vendor")) return anchors[4];
  if (name.includes("car") || name.includes("park")) return anchors[5];
  return anchors[index % anchors.length];
}

function title(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function clock(value: string) { return new Date(value).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
function statusClass(value: WorkStatus) { return value.toLowerCase().replaceAll(" ", "-"); }
function scenarioLabel(work: Pick<WorkItem, "origin" | "cameraId">) { return work.origin === "ai" ? "Camera alert" : work.cameraId ? "Manual · Camera" : "Manual · Map point"; }
function nextAction(work: Pick<WorkItem, "status" | "managementMode">) {
  if (work.status === "Assigned") return "Cleaner to start";
  if (work.status === "In Progress") return "Cleaner working";
  if (work.status === "Awaiting Review") return "Review in progress";
  if (work.status === "Resolved") return "Completed";
  return "No further action";
}
function relativeActivity(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return "Updated just now";
  if (elapsed < 3_600_000) return `Updated ${Math.floor(elapsed / 60_000)} min ago`;
  if (elapsed < 86_400_000) return `Updated ${Math.floor(elapsed / 3_600_000)} hr ago`;
  return `Updated ${clock(value)}`;
}
function WorkTargetMap({ siteMap, point, cameras, selectedCameraId, mode, onPoint, onCamera, readOnly = false }: { siteMap: WorkSiteMap; point: OperationsPoint | null; cameras: WorkCameraOption[]; selectedCameraId: string; mode: "coordinate" | "camera"; onPoint: (point: OperationsPoint) => void; onCamera: (cameraId: string) => void; readOnly?: boolean }) {
  const zones = siteMap.zones.map((zone) => ({ id: zone.zoneId, name: zone.zoneNameSnapshot, polygon: zone.polygon }));
  const cameraMarkers = cameras.map((camera) => ({ id: camera.id, cameraId: camera.id, cameraNameSnapshot: camera.name, point: camera.point, zoneId: camera.zoneId }));
  const backgroundContentUrl = siteMap.background?.contentUrl ?? (siteMap.revision.backgroundMediaId ? `/api/media/${encodeURIComponent(siteMap.revision.backgroundMediaId)}/content` : null);
  return <div className={`work-target-map-current shared ${mode} ${readOnly ? "read-only" : ""}`}>
    <SiteMapViewer compact boundary={siteMap.revision} gridSizeMeters={siteMap.revision.gridSizeMeters} background={siteMap.background ?? null} backgroundContentUrl={backgroundContentUrl} backgroundTransform={siteMap.revision.backgroundTransform ?? null} zones={zones} cameras={cameraMarkers} selectedZoneId={point ? workZoneAtPoint(point, siteMap.zones)?.id : null} onSelectCamera={mode === "camera" && !readOnly ? onCamera : undefined} pointMarker={point ? { point, label: mode === "camera" ? cameras.find((camera) => camera.id === selectedCameraId)?.name ?? "Camera" : "Work point", tone: mode === "camera" ? "camera" : "work" } : null} onPlacePoint={mode === "coordinate" && !readOnly ? onPoint : undefined} />
    <p className="work-target-map-shared-hint">{readOnly ? "Saved Work location" : mode === "coordinate" ? "Place mode is active. Zoom or pan with the controls, then click the map to set the Work point." : "Pan or zoom freely, then select a registered Camera marker."}</p>
  </div>;
}

function ProtectedWorkEvidence({ mediaId, alt, mediaContentUrl = (id) => `/api/media/${encodeURIComponent(id)}/content` }: { mediaId?: string; alt: string; mediaContentUrl?: (mediaId: string) => string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!mediaId) { setUrl(undefined); return; }
    const key = `work-evidence:${mediaId}`;
    const controller = new AbortController();
    void loadAuthenticatedMedia(key, mediaContentUrl(mediaId), controller.signal).then(setUrl).catch(() => {
      if (!controller.signal.aborted) setUrl(undefined);
    });
    return () => { controller.abort(); releaseAuthenticatedMedia(key); };
  }, [mediaContentUrl, mediaId]);
  return url ? <img src={url} alt={alt} /> : <div className="work-evidence-waiting"><strong>Loading protected evidence…</strong><small>The retained image is being retrieved.</small></div>;
}

function WorkCreateModal({ siteMap, cleaners, cameras, availableCleanerIds, onClose, onCreate }: { siteMap: WorkSiteMap; cleaners: Cleaner[]; cameras: WorkCameraOption[]; availableCleanerIds: Set<string>; onClose: () => void; onCreate: (input: ManualWorkInput) => Promise<void> }) {
  const activeCleaners = cleaners.filter((cleaner) => availableCleanerIds.has(cleaner.id));
  const [issue, setIssue] = useState("General clean-up");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<"warning" | "critical">("warning");
  const [targetMode, setTargetMode] = useState<"coordinate" | "camera">("coordinate");
  const [coordinatePoint, setCoordinatePoint] = useState<OperationsPoint | null>(null);
  const [cleanerId, setCleanerId] = useState("");
  const [cameraId, setCameraId] = useState("");
  const [cleanerQuery, setCleanerQuery] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const selectedCamera = cameras.find((camera) => camera.id === cameraId);
  const point = targetMode === "camera" ? selectedCamera?.point ?? null : coordinatePoint;
  const selectedZone = point ? workZoneAtPoint(point, siteMap.zones) : null;
  const locationName = targetMode === "camera" ? selectedCamera?.zoneName ?? "Choose a Camera" : point ? selectedZone?.zoneNameSnapshot ?? "Unzoned area" : "Place the Work point";
  const visibleCleaners = activeCleaners.filter((cleaner) => cleaner.fullName.toLowerCase().includes(cleanerQuery.toLowerCase()) || cleaner.staffCode.toLowerCase().includes(cleanerQuery.toLowerCase()));

  useEffect(() => {
    const close = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape" && !pending) onClose(); };
    addEventListener("keydown", close);
    return () => removeEventListener("keydown", close);
  }, [onClose, pending]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!description.trim()) { setError("Add instructions before creating the Manual Work Order."); return; }
    if (!cleanerId) { setError("Select one available Cleaner for this Manual Work Order."); return; }
    if (targetMode === "coordinate" && !coordinatePoint) { setError("Place the Work point on the Site Map."); return; }
    if (targetMode === "camera" && !selectedCamera) { setError("Select one registered Camera as the Work point."); return; }
    const target: ManualWorkTarget = targetMode === "camera" ? { type: "camera", cameraId: selectedCamera!.id } : { type: "coordinate", point: coordinatePoint! };
    setPending(true); setError("");
    try { await onCreate({ title: issue, instructions: description.trim(), severity, assignedCleanerId: cleanerId, target }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The Work Order could not be created."); }
    finally { setPending(false); }
  }

  return <div className="work-modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}><form className="work-create-modal" onSubmit={submit} aria-busy={pending}>
    <header><div><span>MANUAL WORK</span><h2>Create a Work Order.</h2><p>Choose a free map point or tie the Work to a registered Camera.</p></div><button type="button" onClick={onClose} aria-label="Close Manual Work Order" disabled={pending}>×</button></header>
    <div className="work-create-body">
      <section className="work-create-fields"><label>Work / issue type<select value={issue} disabled={pending} onChange={(event) => setIssue(event.target.value)}><option>General clean-up</option><option>Floor litter</option><option>Floor spill</option><option>Bin service</option><option>Inspection</option></select></label><label>Severity<select value={severity} disabled={pending} onChange={(event) => setSeverity(event.target.value as "warning" | "critical")}><option value="warning">Warning</option><option value="critical">Critical</option></select></label><label className="wide">Description / instruction<textarea value={description} disabled={pending} maxLength={1000} onChange={(event) => { setDescription(event.target.value); setError(""); }} placeholder="Describe the work the Cleaner needs to complete" /></label><div className="work-evidence-rule wide"><span>COMPLETION EVIDENCE</span><strong>1 Cleaner photo required</strong><small>The Supervisor reviews the submitted photo for both target types.</small></div></section>
      <section className="work-create-location"><header><div><span>WORK TARGET</span><strong>{locationName}</strong></div><div className="work-target-mode" role="group" aria-label="Choose Manual Work target type"><button type="button" className={targetMode === "coordinate" ? "active" : ""} aria-pressed={targetMode === "coordinate"} disabled={pending} onClick={() => { setTargetMode("coordinate"); setError(""); }}>Map point</button><button type="button" className={targetMode === "camera" ? "active" : ""} aria-pressed={targetMode === "camera"} disabled={pending || !cameras.length} onClick={() => { setTargetMode("camera"); setError(""); }}>Camera</button></div></header>
        {targetMode === "camera" && <label className="work-target-camera-select">Registered Camera<select value={cameraId} disabled={pending} onChange={(event) => { setCameraId(event.target.value); setError(""); }}><option value="">Select a Camera</option>{cameras.map((camera) => <option value={camera.id} key={camera.id}>{camera.name} · {camera.zoneName}</option>)}</select></label>}
        <WorkTargetMap siteMap={siteMap} point={point} cameras={cameras} selectedCameraId={cameraId} mode={targetMode} onPoint={(next) => { setCoordinatePoint(next); setError(""); }} onCamera={(nextId) => { setCameraId(nextId); setError(""); }} />
        <div className="work-target-readout"><div><span>LOCATION</span><strong>{locationName}</strong><small>{targetMode === "camera" ? selectedCamera?.name ?? "No Camera selected" : selectedZone ? "Inside active Zone" : point ? "Outside active Zones" : "Waiting for map point"}</small></div><div><span>COORDINATES</span><strong>{point ? `X ${point.xMeters.toFixed(1)} m` : "Not selected"}</strong><small>{point ? `Y ${point.yMeters.toFixed(1)} m` : `Map ${siteMap.revision.widthMeters} × ${siteMap.revision.heightMeters} m`}</small></div></div>
      </section>
      <section className="work-create-cleaner"><header><div><span>ASSIGN CLEANER</span><strong>{cleanerId ? activeCleaners.find((cleaner) => cleaner.id === cleanerId)?.fullName ?? "Cleaner selected" : "Required at creation"}</strong></div><input value={cleanerQuery} disabled={pending} onChange={(event) => setCleanerQuery(event.target.value)} placeholder="Search available Cleaners" /></header><div>{visibleCleaners.map((cleaner) => <button type="button" disabled={pending} key={cleaner.id} className={cleanerId === cleaner.id ? "selected" : ""} onClick={() => { setCleanerId(cleanerId === cleaner.id ? "" : cleaner.id); setError(""); }}><i>{initials(cleaner.fullName)}</i><span><b>{cleaner.fullName}</b><small>{cleaner.staffCode} · {cleaner.assignedZoneName}</small></span>{cleanerId === cleaner.id && <em>✓</em>}</button>)}{!visibleCleaners.length && <p>{activeCleaners.length ? "No available Cleaners match this search." : "No Cleaner is currently available for assignment."}</p>}</div></section>
    </div>
    {error && <p className="work-create-error" role="alert">{error}</p>}<footer><p>The selected Cleaner receives this Work immediately and must submit one completion photo for Supervisor review.</p><div><button type="button" onClick={onClose} disabled={pending}>Cancel</button><button type="submit" disabled={pending}>{pending ? "Creating…" : "Create Work Order →"}</button></div></footer>
  </form></div>;
}

export function WorkDetailModal({ work, siteMap, cleaners, availableCleanerIds, onClose, onAction, readOnly = false, mediaContentUrl, onNavigate }: { work: WorkItem; siteMap: WorkSiteMap; cleaners: Cleaner[]; availableCleanerIds: Set<string>; onClose: () => void; onAction?: (action: WorkAction, options: { cleanerId?: string; reason: string; outcome?: "passed" | "failed" | "inconclusive" }) => Promise<void>; readOnly?: boolean; mediaContentUrl?: (mediaId: string) => string; onNavigate?: (path: string, params?: Record<string, string>) => void }) {
  const [query, setQuery] = useState("");
  const [selectedCleanerId, setSelectedCleanerId] = useState("");
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState<"passed" | "failed" | "inconclusive">("passed");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [reassignOpen, setReassignOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<{ action: WorkAction; outcome?: "passed" | "failed" | "inconclusive" }>();
  const dialogRef = useRef<HTMLElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const closeRef = useRef(onClose);
  const pendingRef = useRef(pending);
  const confirmationRef = useRef(confirmation);
  closeRef.current = onClose; pendingRef.current = pending; confirmationRef.current = confirmation;
  const activeCleaners = cleaners.filter((cleaner) => availableCleanerIds.has(cleaner.id) && `${cleaner.fullName} ${cleaner.staffCode}`.toLowerCase().includes(query.toLowerCase()));
  const cleaner = cleaners.find((item) => item.id === work.cleanerId);
  const mapZone = siteMap.zones.find((item) => item.id === work.zoneId);
  const fallbackPoint = mapZone ? workZoneCentroid(mapZone) : { xMeters: siteMap.revision.widthMeters / 2, yMeters: siteMap.revision.heightMeters / 2 };
  const mapPoint = work.point ? { xMeters: work.point.x, yMeters: work.point.y } : fallbackPoint;
  const point = { x: mapPoint.xMeters, y: mapPoint.yMeters };
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector<HTMLElement>("button, [href], input, textarea, select")?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pendingRef.current && !confirmationRef.current) { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0], last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    addEventListener("keydown", handleKey);
    return () => { removeEventListener("keydown", handleKey); document.body.style.overflow = originalOverflow; previous?.focus(); };
  }, []);
  const requestAction = (action: WorkAction, actionOutcome?: "passed" | "failed" | "inconclusive") => {
    if (!reason.trim()) { setReasonError("Enter a reason to continue"); reasonRef.current?.focus(); return; }
    setReasonError(""); setConfirmation({ action, outcome: actionOutcome });
  };
  const runAction = () => {
    if (!onAction || !confirmation) return;
    const action = confirmation.action;
    setPending(true);
    setMessage("");
    void onAction(action, { cleanerId: action === "reassign" ? selectedCleanerId : undefined, reason: reason.trim(), outcome: confirmation.outcome }).then(() => {
      setConfirmation(undefined); setReason("");
      if (action === "takeover") { setMessage("Management Mode is now manual. Review the assigned Cleaner and reassign if needed."); setReassignOpen(true); }
      else setMessage("Work updated.");
    }).catch((error) => setMessage(error instanceof Error ? error.message : "The Work action failed.")).finally(() => setPending(false));
  };
  const distanceFor = (cleanerId: string) => { const station = siteMap.cleanerStations.find((item) => item.cleanerId === cleanerId)?.point; return station ? Math.hypot(station.xMeters - mapPoint.xMeters, station.yMeters - mapPoint.yMeters) : null; };
  const confirmationCopy = confirmation ? ({ reassign: `Assign this Work to ${cleaners.find((item) => item.id === selectedCleanerId)?.fullName ?? "the selected Cleaner"}?`, takeover: "Take manual control of this automated Work?", dismiss: `Dismiss this Work${work.alertId ? " and its linked Alert" : ""}?`, verify: confirmation.outcome === "failed" ? "Return this Work to the Cleaner for rework?" : confirmation.outcome === "passed" ? "Resolve this Work as complete?" : "Record an inconclusive review?", override: "Override the current verification result?" }[confirmation.action]) : "";
  return <div className="work-detail-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending && !confirmation) onClose(); }}><aside ref={dialogRef} className="work-detail-modal" role="dialog" aria-modal="true" aria-labelledby="work-detail-title" aria-busy={pending}>
    <header className="work-detail-modal-header"><div><span>{work.origin === "ai" ? "AUTOMATED CAMERA ALERT" : "MANUAL WORK"}</span><h2 id="work-detail-title">{work.issue}</h2><p>Created {clock(work.createdAt)} · updated {clock(work.updatedAt)}</p></div><div><span className={`work-record-status ${statusClass(work.status)}`}>{work.status}</span><button type="button" onClick={onClose} disabled={pending} aria-label="Close Work detail">×</button></div></header>
    <div className="work-detail-columns">
      <section className="work-detail-column work-detail-facts"><header><span>WORK DETAILS</span><div><span className={`work-origin ${work.origin}`}>{work.origin === "ai" ? "Automated Camera Alert" : "Manual Work"}</span><span className={`work-priority ${work.priority.toLowerCase()}`}>{work.priority} priority</span></div></header><p className="work-instructions">{work.description}</p><dl><div><dt>Zone</dt><dd>{work.zoneName}</dd></div><div><dt>{work.cameraId ? "Camera" : "Map point"}</dt><dd>{work.cameraName ?? `X ${point.x.toFixed(1)}, Y ${point.y.toFixed(1)} m`}</dd></div><div><dt>{work.origin === "ai" ? "Detected" : "Created"}</dt><dd>{clock(work.detectionTime ?? work.createdAt)}</dd></div><div><dt>Management Mode</dt><dd>{work.managementMode === "orchestrated" ? "Automated" : "Manual"}</dd></div></dl>{work.cameraId && !["Resolved", "Dismissed"].includes(work.status) && <button className="work-monitor-camera" type="button" onClick={() => onNavigate ? onNavigate("/cameras", { cameraId: work.cameraId!, zoneId: work.zoneId ?? "all", from: "work" }) : location.hash = `/cameras?${new URLSearchParams({ cameraId: work.cameraId!, zoneId: work.zoneId ?? "all", from: "work" })}`}>Monitor Camera →</button>}<div className={`work-detail-evidence ${work.evidenceAvailable ? "available" : "empty"}`}>{work.evidenceAvailable && work.evidenceMediaId ? <ProtectedWorkEvidence mediaId={work.evidenceMediaId} alt={work.origin === "ai" ? `Alert evidence for ${work.issue}` : `Completion evidence for ${work.issue}`} mediaContentUrl={mediaContentUrl} /> : <div><strong>{work.origin === "ai" ? "No Alert image available" : "No completion evidence yet"}</strong><small>{work.origin === "ai" ? "This Alert did not retain an evidence image." : "The Cleaner has not submitted a completion photo."}</small></div>}<span>{work.origin === "ai" ? "ALERT EVIDENCE" : "COMPLETION EVIDENCE"}</span></div></section>
      <section className="work-detail-column work-detail-assignee"><header><span>ASSIGNED CLEANER</span><h3>{cleaner?.fullName ?? "No Cleaner assigned"}</h3><p>{cleaner ? `${cleaner.staffCode} · ${work.status}` : "Choose an eligible Cleaner."}</p></header>{!readOnly && !["Resolved", "Dismissed"].includes(work.status) && <button className="work-reassign-trigger" type="button" aria-expanded={reassignOpen} onClick={() => setReassignOpen((current) => !current)}>{reassignOpen ? "Hide Cleaner choices" : "Reassign Cleaner"}</button>}{reassignOpen && <div className="work-reassign-panel"><label>Find an available Cleaner<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or staff code" /></label><div>{activeCleaners.slice(0, 8).map((person) => { const distance = distanceFor(person.id); return <button type="button" className={selectedCleanerId === person.id ? "selected" : ""} key={person.id} onClick={() => { setSelectedCleanerId(person.id); setMessage(""); }}><i>{initials(person.fullName)}</i><span><b>{person.fullName}</b><small>Available · {distance === null ? "distance unavailable" : `${distance.toFixed(1)} m from Work`}</small></span>{person.id === work.cleanerId ? <em>Current</em> : selectedCleanerId === person.id ? <em>Selected</em> : null}</button>; })}{!activeCleaners.length && <p>No eligible available Cleaners match this search.</p>}</div>{selectedCleanerId && selectedCleanerId !== work.cleanerId && <button className="work-reassign-confirm" type="button" disabled={pending} onClick={() => requestAction("reassign")}>Continue with reassignment</button>}</div>}</section>
      <section className="work-detail-column work-detail-actions"><header><span>SUPERVISOR ACTION</span><h3>{["Resolved", "Dismissed"].includes(work.status) ? "No further action" : "Choose the next decision."}</h3><p>Each decision is recorded in Work history.</p></header>{!readOnly && !["Resolved", "Dismissed"].includes(work.status) && <><label className={reasonError ? "invalid" : ""}>Reason<textarea ref={reasonRef} value={reason} maxLength={500} aria-invalid={Boolean(reasonError)} aria-describedby={reasonError ? "work-reason-error" : undefined} onChange={(event) => { setReason(event.target.value); setReasonError(""); setMessage(""); }} placeholder="Explain this operational decision" />{reasonError && <small id="work-reason-error" role="alert">{reasonError}</small>}</label>{work.status === "Awaiting Review" && <div className="work-review-outcomes" role="group" aria-label="Verification outcome">{(["passed", "failed", "inconclusive"] as const).map((value) => <button type="button" className={outcome === value ? "selected" : ""} key={value} onClick={() => setOutcome(value)}>{value === "passed" ? "Pass review" : value === "failed" ? "Request rework" : "Inconclusive"}</button>)}</div>}<div className="work-action-buttons">{work.managementMode === "orchestrated" && <button type="button" className="outline-button" disabled={pending} onClick={() => requestAction("takeover")}>Take over</button>}{work.status === "Awaiting Review" && <button type="button" disabled={pending} onClick={() => requestAction("verify", outcome)}>{outcome === "passed" ? "Resolve Work" : outcome === "failed" ? "Request rework" : "Record review"}</button>}{work.status === "Awaiting Review" && work.verificationOutcome && <button type="button" className="outline-button" disabled={pending} onClick={() => requestAction("override", outcome)}>Override review</button>}<button type="button" className="danger" disabled={pending} onClick={() => requestAction("dismiss")}>Dismiss Work</button></div></>}{confirmation && <div className="work-action-confirmation" role="alertdialog" aria-modal="true" aria-label="Confirm Work action"><strong>{confirmationCopy}</strong><p>This uses the reason you entered and cannot be undone from this dialog.</p><div><button type="button" disabled={pending} onClick={() => setConfirmation(undefined)}>Go back</button><button type="button" disabled={pending} onClick={runAction}>{pending ? "Saving…" : "Confirm action"}</button></div></div>}{message && <p className="work-action-message" role="status">{message}</p>}</section>
    </div>
  </aside></div>;
}

export function WorkManagementPage({ siteMap, cleaners, zones, cameras, alerts, workOrders, loadPage = getWorkOrdersPage, availableCleanerIds = [], onCreateWork, onWorkAction, readOnly = false, showPermissionNotice = true, mediaContentUrl, onNavigate }: { siteMap: WorkSiteMap; cleaners: Cleaner[]; zones: Zone[]; cameras: CameraRecord[]; alerts: Alert[]; workOrders?: OperationsWorkOrder[]; loadPage?: (input: { limit?: number; cursor?: string; status?: string; zoneId?: string; cameraId?: string; cleanerId?: string; origin?: string }, signal?: AbortSignal) => Promise<OperationsWorkOrderPage>; availableCleanerIds?: string[]; onCreateWork?: (input: ManualWorkInput) => Promise<void>; onWorkAction?: (workId: string, action: WorkAction, options: { cleanerId?: string; reason: string; outcome?: "passed" | "failed" | "inconclusive" }) => Promise<void>; readOnly?: boolean; showPermissionNotice?: boolean; mediaContentUrl?: (mediaId: string) => string; onNavigate?: (path: string, params?: Record<string, string>) => void }) {
  const activeZones = useMemo(() => zones.filter((zone) => zone.status === "active"), [zones]);
  const [manualWork, setManualWork] = useState<WorkItem[]>([]);
  const [changes, setChanges] = useState<Record<string, Partial<WorkItem>>>({});
  const [statusFilter, setStatusFilter] = useState<"All" | WorkStatus>("All");
  const [zoneFilter, setZoneFilter] = useState("all");
  const [cameraFilter, setCameraFilter] = useState(() => new URLSearchParams(location.hash.split("?")[1] ?? "").get("camera") ?? "all");
  const [originFilter, setOriginFilter] = useState<"all" | WorkOrigin>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [pagedWorkOrders, setPagedWorkOrders] = useState<OperationsWorkOrder[]>(workOrders ?? []);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState((workOrders ?? []).length);
  const [statusCounts, setStatusCounts] = useState<OperationsWorkStatusCounts>(() => ({ assigned: 0, in_progress: 0, awaiting_review: 0, resolved: 0, dismissed: 0 }));
  const [pageLoading, setPageLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>(() => new URLSearchParams(location.hash.split("?")[1] ?? "").get("workId") ?? undefined);
  const [deepLinkedWork, setDeepLinkedWork] = useState<WorkItem>();
  const [detailError, setDetailError] = useState("");
  const [listError, setListError] = useState("");
  const [reloadGeneration, setReloadGeneration] = useState(0);
  const nextManual = useRef(1);
  const availableCleanerSet = useMemo(() => new Set(availableCleanerIds), [availableCleanerIds]);

  const backendWork = useMemo<WorkItem[]>(() => pagedWorkOrders.map((work) => workItemFromOperations(work, alerts)), [alerts, pagedWorkOrders]);

  const aiWork = useMemo<WorkItem[]>(() => alerts.filter((alert) => Boolean(alert.cameraId)).slice(0, 1).map((alert, index) => {
    const linkedCamera = cameras.find((camera) => camera.status === "active" && (camera.id === alert.cameraId || camera.code === alert.cameraId || camera.name === alert.cameraName || camera.zoneName === alert.zone));
    const zone = activeZones.find((item) => item.id === linkedCamera?.zoneId || item.name.toLowerCase() === alert.zone.toLowerCase());
    const activeCleaners = cleaners.filter((person) => person.status === "active");
    const assigned = activeCleaners[index % Math.max(1, activeCleaners.length)];
    const status: WorkStatus = alert.status === "dismissed" ? "Dismissed" : alert.status !== "active" ? "Resolved" : index % 3 === 0 ? "Assigned" : index % 3 === 1 ? "In Progress" : "Awaiting Review";
    return { id: `WO-${String(alert.id).padStart(4, "0")}`, origin: "ai", issue: title(alert.kind), description: `Automated Camera Work created by the Orchestrator from ${linkedCamera?.name ?? alert.cameraName}. Review and clear the reported condition.`, zoneId: zone?.id, zoneName: zone?.name ?? alert.zone, cleanerId: assigned?.id, status, priority: alert.severity === "critical" ? "High" : "Medium", createdAt: alert.createdAt, updatedAt: alert.updatedAt, point: zone ? anchorFor(zone, activeZones.findIndex((item) => item.id === zone.id)) : undefined, cameraId: linkedCamera?.id ?? alert.cameraId, cameraName: linkedCamera?.name ?? alert.cameraName, alertId: alert.id, evidenceAvailable: alert.evidenceAvailable, detectionTime: alert.createdAt };
  }), [activeZones, alerts, cameras, cleaners]);
  const allWork = useMemo(() => (workOrders ? backendWork : [...manualWork, ...aiWork.map((item) => ({ ...item, ...changes[item.id] }))]).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)), [aiWork, backendWork, changes, manualWork, workOrders]);
  const selected = allWork.find((item) => item.id === selectedId) ?? (deepLinkedWork?.id === selectedId ? deepLinkedWork : undefined);
  const selectedInList = Boolean(selectedId && allWork.some((item) => item.id === selectedId));
  const filtered = allWork.filter((item) => (statusFilter === "All" || item.status === statusFilter) && (zoneFilter === "all" || (zoneFilter === "unzoned" ? !item.zoneId : item.zoneId === zoneFilter)) && (cameraFilter === "all" || item.cameraId === cameraFilter) && (originFilter === "all" || item.origin === originFilter));
  const metrics: Record<WorkStatus, number> = { Assigned: statusCounts.assigned, "In Progress": statusCounts.in_progress, "Awaiting Review": statusCounts.awaiting_review, Resolved: statusCounts.resolved, Dismissed: statusCounts.dismissed };
  const aggregateTotal = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);
  const cameraOptions = useMemo<WorkCameraOption[]>(() => { const placements = new Map(siteMap.cameraPlacements.map((placement) => [placement.cameraId, placement])); const zoneNames = new Map(siteMap.zones.map((zone) => [zone.id, zone.zoneNameSnapshot])); return cameras.filter((camera) => camera.status === "active").flatMap((camera) => { const placement = placements.get(camera.id); return placement ? [{ id: camera.id, name: `${camera.name} · ${camera.code}`, point: placement.point, zoneId: placement.zoneId, zoneName: zoneNames.get(placement.zoneId) ?? camera.zoneName }] : []; }); }, [cameras, siteMap.cameraPlacements, siteMap.zones]);

  const backendFilters = useMemo(() => ({ status: statusFilter === "All" ? "all" : statusFilter.toLowerCase().replaceAll(" ", "_"), ...(zoneFilter !== "all" && zoneFilter !== "unzoned" ? { zoneId: zoneFilter } : {}), ...(cameraFilter !== "all" ? { cameraId: cameraFilter } : {}), ...(originFilter !== "all" ? { origin: originFilter === "ai" ? "alert" : "manual" } : {}) }), [cameraFilter, originFilter, statusFilter, zoneFilter]);
  useEffect(() => {
    if (!workOrders) return;
    const controller = new AbortController(); setPageLoading(true); setListError("");
    void loadPage({ ...backendFilters, limit: 25 }, controller.signal).then((page) => { setPagedWorkOrders(page.items); setNextCursor(page.nextCursor); setTotalCount(page.totalCount); setStatusCounts(page.statusCounts); }).catch((error) => { if (!controller.signal.aborted) setListError(error instanceof Error ? error.message : "Work Orders could not be loaded."); }).finally(() => { if (!controller.signal.aborted) setPageLoading(false); });
    return () => controller.abort();
  }, [backendFilters, loadPage, reloadGeneration, workOrders]);
  const loadMore = async () => { if (!nextCursor || pageLoading) return; setPageLoading(true); setListError(""); try { const page = await loadPage({ ...backendFilters, limit: 25, cursor: nextCursor }); setPagedWorkOrders((current) => [...current, ...page.items.filter((item) => !current.some((loaded) => loaded.id === item.id))]); setNextCursor(page.nextCursor); setTotalCount(page.totalCount); setStatusCounts(page.statusCounts); } catch (error) { setListError(error instanceof Error ? error.message : "More Work Orders could not be loaded."); } finally { setPageLoading(false); } };

  useEffect(() => {
    const syncQuery = () => { const query = new URLSearchParams(location.hash.split("?")[1] ?? ""); setSelectedId(query.get("workId") ?? undefined); setZoneFilter(query.get("zoneId") ?? "all"); setCameraFilter(query.get("camera") ?? "all"); };
    syncQuery(); addEventListener("hashchange", syncQuery); return () => removeEventListener("hashchange", syncQuery);
  }, []);
  useEffect(() => {
    if (!selectedId || selectedInList) { setDeepLinkedWork(undefined); setDetailError(""); return; }
    const controller = new AbortController(); setDetailError("");
    void fetchWorkDetail(selectedId, controller.signal).then((detail) => setDeepLinkedWork(workItemFromOperations(detail.workOrder, detail.alert ? [detail.alert] : alerts))).catch((error) => { if (!controller.signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) setDetailError(error instanceof Error ? error.message : "Work detail could not be loaded."); });
    return () => controller.abort();
  }, [alerts, selectedId, selectedInList]);

  function updateWork(id: string, patch: Partial<WorkItem>) {
    if (readOnly) return;
    if (id.startsWith("WO-")) setChanges((current) => ({ ...current, [id]: { ...current[id], ...patch, updatedAt: new Date().toISOString() } }));
    else setManualWork((current) => current.map((item) => item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item));
  }
  function createWork(input: Omit<WorkItem, "id" | "origin" | "createdAt" | "updatedAt">) {
    if (readOnly) return;
    const now = new Date().toISOString();
    const item = { ...input, id: `MAN-${String(nextManual.current++).padStart(3, "0")}`, origin: "manual" as const, createdAt: now, updatedAt: now };
    setManualWork((current) => [item, ...current]); setShowCreate(false); setSelectedId(item.id);
  }
  function openWork(work: WorkItem) {
    const params: Record<string, string> = { workId: work.id }; if (zoneFilter !== "all") params.zoneId = zoneFilter; if (cameraFilter !== "all") params.camera = cameraFilter;
    if (onNavigate) onNavigate("/history", params); else location.hash = `/history?${new URLSearchParams(params)}`;
  }
  function closeWork() { setDetailError(""); const params: Record<string, string> = {}; if (zoneFilter !== "all") params.zoneId = zoneFilter; if (cameraFilter !== "all") params.camera = cameraFilter; if (onNavigate) onNavigate("/history", params); else location.hash = `/history${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ""}`; }

  return <section className="work-management-page work-list-page">
    <header className="work-list-heading"><div><span>WORK ORDER MANAGEMENT</span><h1>Keep every response moving.</h1><p>Review automated Camera Work and supervisor-created Manual Work Orders from one operational queue.</p></div>{!readOnly && <button type="button" onClick={() => setShowCreate(true)}><b>+</b>Create Work Order</button>}</header>{readOnly && showPermissionNotice && <p className="profile-feedback">Work actions are unavailable for this account.</p>}
    <section className="work-metric-grid"><article><span>WORK ORDERS</span><b>{aggregateTotal}</b></article><article className="assigned"><span>Assigned</span><b>{metrics.Assigned}</b></article><article className="progress"><span>In progress</span><b>{metrics["In Progress"]}</b></article><article className="review"><span>Awaiting review</span><b>{metrics["Awaiting Review"]}</b></article><article className="complete"><span>Resolved</span><b>{metrics.Resolved}</b></article></section>
    <section className="work-list-controls"><div className="work-status-filter" role="group" aria-label="Filter work by status"><button className={statusFilter === "All" ? "active" : ""} onClick={() => setStatusFilter("All")}>All</button>{statusOptions.slice(0, 4).map((status) => <button className={statusFilter === status ? "active" : ""} key={status} onClick={() => setStatusFilter(status)}>{status}</button>)}</div><div className="work-select-filters"><label>Camera<select value={cameraFilter} onChange={(event) => setCameraFilter(event.target.value)}><option value="all">All cameras</option>{cameras.map((camera) => <option value={camera.id} key={camera.id}>{camera.name} · {camera.code}</option>)}</select></label><label>Zone<select value={zoneFilter} onChange={(event) => setZoneFilter(event.target.value)}><option value="all">All zones</option>{activeZones.map((zone) => <option value={zone.id} key={zone.id}>{zone.name}</option>)}<option value="unzoned">Unzoned area</option></select></label><label>Origin<select value={originFilter} onChange={(event) => setOriginFilter(event.target.value as "all" | WorkOrigin)}><option value="all">Automated + Manual</option><option value="ai">Automated</option><option value="manual">Manual</option></select></label></div></section>
    {listError && <div className="work-list-error" role="alert"><span><strong>Work queue could not refresh.</strong>{listError}</span><button type="button" onClick={() => setReloadGeneration((generation) => generation + 1)}>Try again</button></div>}
    <section className="work-records"><header><div><span>WORK ORDER QUEUE</span><h2>{totalCount} Work Orders</h2></div><small>Open a row to inspect Work without leaving this queue.</small></header><div className="work-records-scroll"><table><thead><tr><th>Work</th><th>Scenario</th><th>Zone / location</th><th>Cleaner</th><th>Status</th><th>Next action</th><th>Priority</th><th>Created</th></tr></thead><tbody>{filtered.map((work) => { const cleaner = cleaners.find((item) => item.id === work.cleanerId); return <tr key={work.id} tabIndex={0} onClick={() => openWork(work)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openWork(work); }}><td><strong>{work.issue}</strong><small>{work.description}</small></td><td><span className={`work-origin ${work.origin}`}>{scenarioLabel(work)}</span></td><td><strong>{work.zoneName}</strong><small>{work.cameraId ? work.cameraName ?? "Camera linked" : work.point ? "Map point" : "Location not set"}</small></td><td>{cleaner ? <span className="work-cleaner-cell"><i>{initials(cleaner.fullName)}</i><b>{cleaner.fullName}</b></span> : <span className="work-unassigned">No Cleaner available</span>}</td><td><span className={`work-record-status ${statusClass(work.status)}`}>{work.status}</span></td><td><span className={`work-next-action ${statusClass(work.status)}`}><b>{nextAction(work)}</b><small>{relativeActivity(work.updatedAt)}</small></span></td><td><span className={`work-priority ${work.priority.toLowerCase()}`}>{work.priority}</span></td><td>{clock(work.createdAt)}</td></tr>; })}</tbody></table>{!filtered.length && !pageLoading && <div className="work-empty-state"><b>No Work Orders found.</b><span>{readOnly ? "No Work Orders are stored for this Site and filter." : "Try changing the filters or create a Manual Work Order."}</span></div>}{nextCursor && <button className="operations-load-more" type="button" disabled={pageLoading} onClick={() => void loadMore()}>{pageLoading ? "Loading…" : `Load more · ${filtered.length} of ${totalCount}`}</button>}</div></section>
    {!readOnly && showCreate && <WorkCreateModal siteMap={siteMap} cleaners={cleaners} cameras={cameraOptions} availableCleanerIds={availableCleanerSet} onClose={() => setShowCreate(false)} onCreate={async (input) => { if (onCreateWork) await onCreateWork(input); else { const cameraId = input.target.type === "camera" ? input.target.cameraId : undefined; const camera = cameraId ? cameraOptions.find((item) => item.id === cameraId) : undefined; const zone = input.target.type === "coordinate" ? workZoneAtPoint(input.target.point, siteMap.zones) : undefined; createWork({ issue: input.title, description: input.instructions, priority: input.severity === "critical" ? "High" : "Medium", zoneId: camera?.zoneId ?? zone?.id, zoneName: camera?.zoneName ?? zone?.zoneNameSnapshot ?? "Unzoned area", point: input.target.type === "coordinate" ? { x: input.target.point.xMeters, y: input.target.point.yMeters } : camera ? { x: camera.point.xMeters, y: camera.point.yMeters } : undefined, cleanerId: input.assignedCleanerId, status: "Assigned", cameraId: camera?.id, cameraName: camera?.name }); } setShowCreate(false); }} />}
    {selectedId && !selected && !detailError && <div className="work-detail-scrim"><div className="work-detail-loading" role="status">Loading Work detail…</div></div>}
    {selectedId && detailError && <div className="work-detail-error" role="alert"><span><strong>Work detail unavailable.</strong>{detailError}</span><button type="button" onClick={closeWork}>Close</button></div>}
    {selected && <WorkDetailModal readOnly={readOnly} work={selected} siteMap={siteMap} cleaners={cleaners} availableCleanerIds={availableCleanerSet} onClose={closeWork} onAction={onWorkAction ? (action, options) => onWorkAction(selected.id, action, options) : undefined} mediaContentUrl={mediaContentUrl} onNavigate={onNavigate} />}
  </section>;
}
