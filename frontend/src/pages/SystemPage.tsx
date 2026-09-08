import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getV2OrchestratorRunDetail,
  getV2ServiceHealth,
  getV2SystemView,
  setV2OrchestratorStatus,
  type V2OrchestratorRunDetail,
  type V2ServiceHealth,
  type V2SystemEvent,
  type V2SystemRun,
  type V2SystemView,
} from "../services/v2/system";
import "./system-page.css";

type RunFilter = "all" | "assignment" | "review";

const dateTime = new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const clockTime = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function formatDate(value?: string | null, fallback = "Not recorded") {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : dateTime.format(date);
}

function elapsed(run: V2SystemRun) {
  if (!run.startedAt || !run.completedAt) return run.status === "running" ? "In progress" : "Not recorded";
  const milliseconds = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "Not recorded";
  return milliseconds < 1000 ? `${Math.round(milliseconds)} ms` : `${(milliseconds / 1000).toFixed(1)} sec`;
}

function readable(value?: string | null) {
  if (!value) return "Not recorded";
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function issueLabel(value?: string | null) {
  if (value === "floor_litter") return "Floor litter";
  if (value === "floor_spill") return "Floor spill";
  if (value === "bin_service") return "Bin service";
  return value ? readable(value) : "Cleaning issue";
}

function runResult(run: V2SystemRun) {
  const labels: Record<string, string> = {
    assigned: "Work assigned",
    resolved: "Work resolved",
    rework: "Rework requested",
    needs_supervisor: "Supervisor review needed",
    no_waiting_alerts: "No waiting Alerts",
    no_candidates: "No Cleaner available",
    all_candidates_conflicted: "Cleaner reservation failed",
    provider_failed: "Provider unavailable",
    lease_expired: "Run lease expired",
  };
  return run.resultCode ? labels[run.resultCode] ?? readable(run.resultCode) : readable(run.status);
}

function runState(run: V2SystemRun) {
  if (run.status === "succeeded") return run.resultCode === "rework" ? "attention" : "succeeded";
  if (run.status === "exhausted" || run.resultCode === "needs_supervisor") return "attention";
  if (run.status === "running") return "running";
  return "failed";
}

function runTitle(run: V2SystemRun) {
  return run.references?.workOrder?.title
    ?? (run.references?.alert ? `${issueLabel(run.references.alert.issueType)} Alert` : null)
    ?? (run.type === "assignment" ? "Cleaner assignment" : "Cleaning review");
}

function runLocation(run: V2SystemRun) {
  const reference = run.references?.alert;
  const parts = [reference?.zoneName, reference?.cameraName].filter((value): value is string => Boolean(value));
  return parts.length ? parts.join(" · ") : "Location not captured";
}

function runSummary(run: V2SystemRun) {
  if (run.decisionSummary) return run.decisionSummary;
  const summaries: Record<string, string> = {
    assigned: "The selected Alert and Cleaner passed Node validation, and one Work Order was created.",
    resolved: "The verification passed and Node resolved the linked Alert and Work Order.",
    rework: "Verification found that the issue still needed attention, so Work returned to the same Cleaner.",
    needs_supervisor: "The evidence was inconclusive. The Work remains available for a Supervisor decision.",
    no_waiting_alerts: "No eligible Alert was waiting when this Run checked the Site.",
    no_candidates: "No Cleaner passed the current availability checks. The Alert remains waiting.",
    provider_failed: "The provider did not return a valid decision after the configured retries. No Work was created.",
  };
  return summaries[run.resultCode ?? ""] ?? "The Run stopped with the recorded result. Open the trace for its safe technical details.";
}

function resultSummary(value: Record<string, unknown>) {
  const entries = Object.entries(value).filter(([key, item]) => !key.toLowerCase().endsWith("id") && (item == null || ["string", "number", "boolean"].includes(typeof item)));
  return entries.length ? entries.slice(0, 3).map(([key, item]) => `${readable(key)}: ${String(item ?? "none")}`).join(" · ") : "No additional result fields";
}

function SystemIcon({ name }: { name: "run" | "review" | "warning" | "worker" }) {
  if (name === "run") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v4H7zM4 14h6v6H4zM14 14h6v6h-6zM12 8v3M7 11h10M7 11v3M17 11v3" /></svg>;
  if (name === "review") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5zM8 9l2 2 5-5M8 15h8" /></svg>;
  if (name === "worker") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 22 20H2Z" /><path d="M12 9v5M12 17v.1" /></svg>;
}

function RunDetail({ run, detail, loading, error, onRetry, onClose }: { run: V2SystemRun; detail?: V2OrchestratorRunDetail; loading: boolean; error?: string; onRetry: () => void; onClose: () => void }) {
  const [showAllCandidates, setShowAllCandidates] = useState(false);
  if (loading) return <div className="system-run-detail system-run-detail-state" role="status">Loading Run details…</div>;
  if (error) return <div className="system-run-detail system-run-detail-state error"><p>{error}</p><button type="button" onClick={onRetry}>Try again</button></div>;
  if (!detail) return null;

  const snapshot = detail.run.inputSnapshot;
  const selectedAlertId = detail.run.selectedAlertId ?? detail.run.references?.alert?.id;
  const selectedCleanerId = detail.run.selectedCleanerId ?? detail.run.references?.cleaner?.id;
  const conflicted = new Set(detail.attempts.filter((attempt) => attempt.outcome === "reservation_conflict" && attempt.selectedCleanerId).map((attempt) => String(attempt.selectedCleanerId)));
  const candidates = (snapshot?.cleaners ?? []).map((cleaner) => {
    const pair = (snapshot?.eligiblePairs ?? []).find((item) => item.alertId === selectedAlertId && item.cleanerId === cleaner.cleanerId);
    return {
      id: cleaner.cleanerId,
      name: cleaner.fullName,
      stationMeters: pair?.stationDistanceMeters ?? Number.POSITIVE_INFINITY,
      station: pair ? `${Math.round(pair.stationDistanceMeters)} m` : "Not paired",
      recent: pair?.recentWorkDistanceMeters == null ? "Not recent" : `${Math.round(pair.recentWorkDistanceMeters)} m`,
      outcome: cleaner.cleanerId === selectedCleanerId ? "Selected" : conflicted.has(cleaner.cleanerId) ? "Reservation conflict" : "Available",
    };
  }).sort((left, right) => {
    const priority = (candidate: typeof left) => candidate.outcome === "Selected" ? 0 : candidate.outcome === "Reservation conflict" ? 1 : 2;
    return priority(left) - priority(right) || left.stationMeters - right.stationMeters || left.name.localeCompare(right.name);
  });
  const visibleCandidates = showAllCandidates ? candidates : candidates.slice(0, 5);
  const trace = [
    ...detail.attempts.map((attempt) => ({
      key: `attempt-${attempt.id}`,
      label: attempt.kind === "provider_request" ? "Provider request" : "Cleaner reservation",
      detail: `${readable(attempt.outcome)}${attempt.retryDelayMs ? ` · retry after ${attempt.retryDelayMs / 1000} sec` : ""}`,
      state: attempt.outcome === "selected" || attempt.outcome === "reserved" ? "done" : attempt.outcome === "reservation_conflict" ? "warning" : "rejected",
      order: Date.parse(attempt.startedAt ?? attempt.completedAt ?? "") || 10_000 + attempt.sequence,
    })),
    ...detail.actions.map((action) => ({
      key: `action-${action.id}`,
      label: readable(action.tool),
      detail: action.errorCode ? readable(action.errorCode) : resultSummary(action.resultSummary),
      state: action.outcome === "succeeded" ? "done" : action.outcome === "rejected" ? "warning" : "rejected",
      order: Date.parse(action.startedAt ?? action.completedAt ?? "") || 20_000 + action.sequence,
    })),
  ].sort((left, right) => left.order - right.order);

  return <div className="system-run-detail">
    <div className="system-run-explanation">
      <div><span>Decision summary</span><p>{runSummary(detail.run)}</p></div>
      <dl>
        <div><dt>Provider</dt><dd>{detail.run.type === "review" ? "Node verification" : detail.run.provider ?? "Not recorded"}</dd></div>
        <div><dt>Model / policy</dt><dd>{detail.run.type === "review" ? "review-v2" : detail.run.model ?? "Not recorded"}</dd></div>
        <div><dt>Retries</dt><dd>{detail.run.retryCount ?? Math.max(0, detail.run.providerRequestCount - 1)}</dd></div>
        <div><dt>Elapsed</dt><dd>{elapsed(detail.run)}</dd></div>
      </dl>
    </div>
    {candidates.length > 0 && <div className="system-candidate-table"><span>Cleaner candidates</span>{candidates.length > 5 && <div className="system-candidate-controls"><span>{showAllCandidates ? `Showing all ${candidates.length} candidates` : `Showing selected and nearest 5 of ${candidates.length}`}</span><button type="button" onClick={() => setShowAllCandidates((current) => !current)}>{showAllCandidates ? "Show fewer" : `Show all ${candidates.length}`}</button></div>}<div className="system-candidate-scroll" role="table" aria-label="Cleaner candidates used for this decision">
      <div role="row" className="head"><b role="columnheader">Cleaner</b><b role="columnheader">Station</b><b role="columnheader">Recent work</b><b role="columnheader">Outcome</b></div>
      {visibleCandidates.map((candidate) => <div role="row" key={candidate.id} className={candidate.outcome === "Selected" ? "selected" : candidate.outcome === "Reservation conflict" ? "conflict" : ""}><strong role="cell">{candidate.name}</strong><span role="cell">{candidate.station}</span><span role="cell">{candidate.recent}</span><em role="cell">{candidate.outcome}</em></div>)}
    </div></div>}
    <div className="system-tool-trace"><span>Run trace</span>{trace.length ? <ol>{trace.map((entry, index) => <li key={entry.key} className={entry.state}><i>{index + 1}</i><div><strong>{entry.label}</strong><small>{entry.detail}</small></div></li>)}</ol> : <p>No provider attempts or Node actions were recorded for this Run.</p>}</div>
    <div className="system-run-identifiers"><span>Technical reference</span><code>{detail.run.id}</code></div>
    <button type="button" className="system-run-collapse" onClick={onClose}><span>Collapse Run details</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 10 5-5 5 5" /></svg></button>
  </div>;
}

function SystemIssue({ event }: { event: V2SystemEvent }) {
  return <article className={event.status}>
    <i><SystemIcon name={event.status === "open" ? "warning" : "worker"} /></i>
    <div><span>{event.status === "open" ? readable(event.code) : "Recovered"}</span><strong>{event.message}</strong><p>{event.occurrenceCount === 1 ? "Recorded once." : `Recorded ${event.occurrenceCount} times.`}{event.derivedFromRuntime ? " This warning comes from the current Node process." : ""}</p><small>{event.status === "recovered" ? `Recovered ${formatDate(event.recoveredAt)}` : `Last occurred ${formatDate(event.lastOccurredAt ?? event.updatedAt)}`}</small></div>
  </article>;
}

function ServiceStatus({ view, health }: { view: V2SystemView; health?: V2ServiceHealth }) {
  const inference = health?.dependencies?.aiInference;
  const inferenceReady = inference === "ready";
  return <section className="system-services">
    <header><h2>Service status</h2><span>Live</span></header>
    <dl>
      <div><dt>Node API</dt><dd className="healthy"><i />Ready</dd></div>
      <div><dt>FastAPI inference</dt><dd className={inferenceReady ? "healthy" : inference ? "unhealthy" : "unknown"}><i />{inference ? readable(inference) : "Checking"}</dd></div>
      <div><dt>LLM provider</dt><dd className="unknown"><i />{readable(view.runtime.providerConnectivity)}</dd></div>
      <div><dt>Background worker</dt><dd className={view.runtime.backgroundWorkerEnabled ? "healthy" : "unhealthy"}><i />{view.runtime.backgroundWorkerEnabled ? "Enabled" : "Disabled"}</dd></div>
    </dl>
    <p>Provider connectivity is not inferred from saved configuration.</p>
  </section>;
}

export function SystemPage({ readOnly = false, initialView, loadView = getV2SystemView, loadRun = getV2OrchestratorRunDetail }: { readOnly?: boolean; initialView?: V2SystemView; loadView?: (signal?: AbortSignal) => Promise<V2SystemView>; loadRun?: (runId: string, signal?: AbortSignal) => Promise<V2OrchestratorRunDetail> } = {}) {
  const [view, setView] = useState<V2SystemView | undefined>(initialView);
  const [health, setHealth] = useState<V2ServiceHealth>();
  const [loading, setLoading] = useState(!initialView);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date>();
  const [filter, setFilter] = useState<RunFilter>("all");
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [runDetails, setRunDetails] = useState<Record<string, V2OrchestratorRunDetail>>({});
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({});
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [pauseOpen, setPauseOpen] = useState(false);
  const [pauseReason, setPauseReason] = useState("");
  const [statusPending, setStatusPending] = useState(false);
  const [statusError, setStatusError] = useState("");
  const summaryController = useRef<AbortController | undefined>(undefined);
  const detailController = useRef<AbortController | undefined>(undefined);
  const runSummaryRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const loadSystem = useCallback(async (background = false) => {
    summaryController.current?.abort();
    const controller = new AbortController();
    summaryController.current = controller;
    if (background) setRefreshing(true); else setLoading(true);
    try {
      const result = await loadView(controller.signal);
      setView(result);
      setLastUpdated(new Date());
      setLoadError("");
    } catch (error) {
      if (controller.signal.aborted) return;
      setLoadError(error instanceof Error ? error.message : "The System view could not be loaded.");
    } finally {
      if (!controller.signal.aborted) { setLoading(false); setRefreshing(false); }
    }
  }, [loadView]);

  useEffect(() => {
    void loadSystem();
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void loadSystem(true); }, 60_000);
    return () => { window.clearInterval(interval); summaryController.current?.abort(); detailController.current?.abort(); };
  }, [loadSystem]);

  useEffect(() => {
    const controller = new AbortController();
    const check = () => { void getV2ServiceHealth(controller.signal).then(setHealth).catch(() => { if (!controller.signal.aborted) setHealth({ status: "degraded", dependencies: { aiInference: "unavailable" } }); }); };
    check();
    const interval = window.setInterval(check, 30_000);
    return () => { window.clearInterval(interval); controller.abort(); };
  }, []);

  const visibleRuns = useMemo(() => (view?.recentRuns ?? []).filter((run) => filter === "all" || run.type === filter), [filter, view]);
  const successfulRuns = (view?.recentRuns ?? []).filter((run) => run.status === "succeeded").length;
  const openEvents = (view?.events ?? []).filter((event) => event.status === "open");
  const recoveredEvents = (view?.events ?? []).filter((event) => event.status === "recovered");

  const loadRunDetail = useCallback(async (runId: string) => {
    detailController.current?.abort();
    const controller = new AbortController();
    detailController.current = controller;
    setDetailLoading((current) => ({ ...current, [runId]: true }));
    setDetailErrors((current) => ({ ...current, [runId]: "" }));
    try {
      const result = await loadRun(runId, controller.signal);
      setRunDetails((current) => ({ ...current, [runId]: result }));
    } catch (error) {
      if (!controller.signal.aborted) setDetailErrors((current) => ({ ...current, [runId]: error instanceof Error ? error.message : "Run details could not be loaded." }));
    } finally {
      if (!controller.signal.aborted) setDetailLoading((current) => ({ ...current, [runId]: false }));
    }
  }, [loadRun]);

  function toggleRun(runId: string) {
    if (expandedRun === runId) { setExpandedRun(null); return; }
    setExpandedRun(runId);
    if (!runDetails[runId]) void loadRunDetail(runId);
  }

  function closeRunDetails(runId: string) {
    setExpandedRun(null);
    window.requestAnimationFrame(() => {
      const summary = runSummaryRefs.current[runId];
      if (!summary) return;
      summary.focus({ preventScroll: true });
      summary.scrollIntoView({
        block: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    });
  }

  async function changeStatus(status: "running" | "paused") {
    setStatusPending(true);
    setStatusError("");
    try {
      await setV2OrchestratorStatus(status, status === "paused" ? pauseReason : null);
      await loadSystem(true);
      setPauseReason("");
      setPauseOpen(false);
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : "The Orchestrator status could not be changed.");
    } finally {
      setStatusPending(false);
    }
  }

  return <main className="system-page">
    <header className="system-page-heading">
      <div><h1>System</h1><p>Review automated assignments, cleaning decisions, and conditions that need attention.</p></div>
      <div className="system-refresh"><span>{lastUpdated ? `Updated ${clockTime.format(lastUpdated)}` : "Waiting for data"}</span><button type="button" onClick={() => void loadSystem()} disabled={loading || refreshing}>{loading || refreshing ? "Refreshing…" : "Refresh"}</button></div>
    </header>

    {loading && !view ? <section className="system-page-state" role="status"><i><SystemIcon name="worker" /></i><h2>Loading the System view…</h2><p>Reading Orchestrator state, recent Runs, and safe operational events.</p></section> : !view ? <section className="system-page-state error" role="alert"><i><SystemIcon name="warning" /></i><h2>System data could not be loaded.</h2><p>{loadError || "Check the Node service and try again."}</p><button type="button" onClick={() => void loadSystem()}>Try again</button></section> : <>
      {loadError && <div className="system-stale-warning" role="status"><span>The latest refresh failed. Showing data from {lastUpdated ? clockTime.format(lastUpdated) : "the previous response"}.</span><button type="button" onClick={() => void loadSystem()}>Try again</button></div>}
      <section className={`system-command-panel ${view.configuration.status}`}>
        <div className="system-command-state"><i><SystemIcon name="worker" /></i><div><span>Orchestrator status</span><h2>{readable(view.configuration.status)}</h2><p>{view.configuration.status === "running" ? view.configuration.assignmentEnabled && view.configuration.reviewEnabled ? "Automatic assignment and cleaning review are enabled for this Site." : `Assignment is ${view.configuration.assignmentEnabled ? "enabled" : "disabled"}; cleaning review is ${view.configuration.reviewEnabled ? "enabled" : "disabled"}.` : `Automatic assignment and review are stopped${view.configuration.pauseReason ? `: ${view.configuration.pauseReason}` : ". Alerts continue to wait."}`}</p></div></div>
        <dl>
          <div><dt>Background worker</dt><dd className={view.runtime.backgroundWorkerEnabled ? "enabled" : "disabled"}><i />{view.runtime.backgroundWorkerEnabled ? "Enabled" : "Disabled"}</dd></div>
          <div><dt>Last successful activity</dt><dd>{formatDate(view.configuration.lastSuccessfulRunAt, "None recorded")}</dd></div>
          <div><dt>Assignment provider</dt><dd>{view.configuration.provider} · {readable(view.runtime.providerConnectivity)}</dd></div>
        </dl>
        {!readOnly && <div className="system-command-action"><small>Pause and resume changes are recorded for this Site.</small>{view.configuration.status === "running" ? <button type="button" disabled={statusPending} onClick={() => { setStatusError(""); setPauseOpen(true); }}>Pause orchestrator</button> : <button type="button" disabled={statusPending} onClick={() => void changeStatus("running")}>{statusPending ? "Resuming…" : "Resume orchestrator"}</button>}{statusError && !pauseOpen && <p role="alert">{statusError}</p>}</div>}
      </section>

      <section className="system-workload" aria-label="Current automated workflow workload">
        <div><span>Waiting Alerts</span><strong>{view.runtime.backlog.waitingAlertCount}</strong><small>Need a Cleaner</small></div>
        <div><span>Awaiting review</span><strong>{view.runtime.backlog.awaitingReviewWorkOrderCount}</strong><small>Cleaning submitted</small></div>
        <div><span>Active Run</span><strong>{view.configuration.activeRunId ? 1 : 0}</strong><small>{view.configuration.activeRunId ? "Decision in progress" : "No decision running"}</small></div>
        <div><span>Recent Runs</span><strong>{view.recentRuns.length}</strong><small>{successfulRuns} succeeded · {view.recentRuns.length - successfulRuns} stopped or active</small></div>
      </section>

      <div className={`system-page-grid ${expandedRun ? "expanded" : ""}`}>
        <section className="system-ledger">
          <header><div><h2>Decision activity</h2><p>Latest assignment and review Runs, newest first.</p></div><div role="group" aria-label="Filter decision activity"><button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All</button><button type="button" className={filter === "assignment" ? "active" : ""} onClick={() => setFilter("assignment")}>Assignments</button><button type="button" className={filter === "review" ? "active" : ""} onClick={() => setFilter("review")}>Reviews</button></div></header>
          {visibleRuns.length ? <ol>{visibleRuns.map((run) => <li key={run.id} className={`system-run ${run.type} ${runState(run)} ${expandedRun === run.id ? "expanded" : ""}`}>
            <button ref={(element) => { runSummaryRefs.current[run.id] = element; }} type="button" className="system-run-summary" aria-expanded={expandedRun === run.id} onClick={() => toggleRun(run.id)}>
              <time>{formatDate(run.completedAt ?? run.startedAt ?? run.createdAt)}</time><i className="system-run-kind"><SystemIcon name={run.type === "assignment" ? "run" : "review"} /></i><div className="system-run-copy"><span>{run.type === "assignment" ? "Assignment" : "Cleaning review"}</span><strong>{runTitle(run)}</strong><small>{runLocation(run)}</small></div><div className="system-run-result"><b>{runResult(run)}</b>{run.references?.cleaner?.name && <span>{run.references.cleaner.name}</span>}</div><i className="system-run-toggle" aria-hidden="true" />
            </button>
            {expandedRun === run.id && <RunDetail run={run} detail={runDetails[run.id]} loading={Boolean(detailLoading[run.id])} error={detailErrors[run.id]} onRetry={() => void loadRunDetail(run.id)} onClose={() => closeRunDetails(run.id)} />}
          </li>)}</ol> : <div className="system-empty"><strong>No {filter === "all" ? "Orchestrator Runs" : `${filter} Runs`} recorded.</strong><p>{filter === "all" ? "Assignment and review activity will appear here after the Orchestrator processes operational work." : "Change the filter to inspect the other Run types."}</p></div>}
          {visibleRuns.length > 0 && <div className="system-ledger-footer"><span>{visibleRuns.length === view.recentRuns.length ? `Showing ${visibleRuns.length} recent Run${visibleRuns.length === 1 ? "" : "s"}` : `Showing ${visibleRuns.length} of ${view.recentRuns.length} recent Runs`}</span><small>Most recent first</small></div>}
        </section>

        <aside className="system-side-column">
          <section className="system-issues">
            <header><h2>System issues</h2><span>{openEvents.length} open</span></header>
            {[...openEvents, ...recoveredEvents].slice(0, 6).map((event) => <SystemIssue event={event} key={event.id} />)}
            {!view.events.length && <div className="system-empty compact"><strong>No System issues recorded.</strong><p>Safe runtime and workflow problems will appear here.</p></div>}
          </section>
          <ServiceStatus view={view} health={health} />
        </aside>
      </div>

      <section className="system-control-history">
        <header><div><h2>Pause and resume history</h2><p>Recent Supervisor controls. Full administrative audit remains separate.</p></div><span>Latest 20</span></header>
        {view.controlHistory.length ? <div className="system-control-table" role="table" aria-label="Orchestrator pause and resume history">
          <div className="head" role="row"><b role="columnheader">Action</b><b role="columnheader">Supervisor</b><b role="columnheader">Reason</b><b role="columnheader">Time</b></div>
          {view.controlHistory.map((entry, index) => <div role="row" key={`${entry.occurredAt}-${entry.actorUid}-${index}`}><strong role="cell" className={entry.status}>{entry.status === "paused" ? "Paused" : "Resumed"}</strong><span role="cell"><b>{entry.actorNameSnapshot || "Supervisor"}</b><small>{entry.actorAuthority ? `${readable(entry.actorAuthority)} Supervisor` : "Supervisor"}</small></span><span role="cell">{entry.reason || "No reason provided"}</span><time role="cell">{formatDate(entry.occurredAt)}</time></div>)}
        </div> : <div className="system-empty"><strong>No pause or resume history yet.</strong><p>The next Supervisor control change will appear here and in the immutable audit record.</p></div>}
      </section>
    </>}

    {!readOnly && pauseOpen && <div className="system-dialog-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget && !statusPending) setPauseOpen(false); }}><section className="system-pause-dialog" role="dialog" aria-modal="true" aria-labelledby="system-pause-title">
      <header><div><span>Operational control</span><h2 id="system-pause-title">Pause the Orchestrator?</h2></div><button type="button" disabled={statusPending} onClick={() => setPauseOpen(false)} aria-label="Close pause dialog">×</button></header>
      <p>New Alerts will remain waiting. Automatic assignment and cleaning review will stop until a Supervisor resumes the Orchestrator.</p>
      <label>Reason <span>Optional</span><textarea value={pauseReason} disabled={statusPending} onChange={(event) => { setPauseReason(event.target.value); setStatusError(""); }} placeholder="Why are you pausing automation?" maxLength={500} /></label>
      {statusError && <p className="system-dialog-error" role="alert">{statusError}</p>}
      <footer><button type="button" disabled={statusPending} onClick={() => setPauseOpen(false)}>Keep running</button><button type="button" className="pause" disabled={statusPending} onClick={() => void changeStatus("paused")}>{statusPending ? "Pausing…" : "Pause orchestrator"}</button></footer>
    </section></div>}
  </main>;
}
