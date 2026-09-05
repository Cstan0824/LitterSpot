import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getBinPlacementComparison,
  getBinPlacementInterventions,
  getBinPlacementRecommendations,
  implementBinPlacement,
  refreshBinPlacementRecommendations,
  type BinPlacementComparison,
  type BinPlacementComparisonSide,
  type BinPlacementIntervention,
  type BinPlacementSnapshot,
  type BinPlacementZoneRanking,
} from "../../services/v2/binPlacement";

type Metric = "cleaningFrequency" | "binOverflowFrequency";

const wholeDays = (value: string) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 2 && parsed <= 3660 ? parsed : null;
};

const number = (value: number, maximumFractionDigits = 1) => new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value);
const date = (value?: string | null) => value ? new Date(value).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" }) : "Not available";
const dateTime = (value?: string | null) => value ? new Date(value).toLocaleString([], { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Not available";
const statusLabel = (value: string) => value.replaceAll("_", " ");

function seriesSlots(side: BinPlacementComparisonSide, metric: Metric) {
  const rowByDate = new Map(side.series.map((row) => [row.localDate, row]));
  return [...new Set([...side.series.map((row) => row.localDate), ...side.missingDates])]
    .sort()
    .map((localDate) => ({ localDate, value: rowByDate.get(localDate)?.[metric] ?? null }));
}

function plot(values: Array<number | null>, startX: number, endX: number, ceiling: number) {
  const coordinate = (value: number, index: number) => {
    const x = values.length <= 1 ? (startX + endX) / 2 : startX + index / (values.length - 1) * (endX - startX);
    const y = 95 - value / ceiling * 88;
    return { x, y };
  };
  const segments: string[] = [];
  const points: Array<{ x: number; y: number }> = [];
  let active: string[] = [];
  values.forEach((value, index) => {
    if (value == null) {
      if (active.length > 1) segments.push(active.join(" "));
      active = [];
      return;
    }
    const point = coordinate(value, index);
    points.push(point);
    active.push(`${point.x},${point.y}`);
  });
  if (active.length > 1) segments.push(active.join(" "));
  return { segments, points };
}

function TrendChart({ title, comparison, metric }: { title: string; comparison: BinPlacementComparison; metric: Metric }) {
  const beforeSlots = seriesSlots(comparison.before, metric);
  const afterSlots = seriesSlots(comparison.after, metric);
  const observed = [...beforeSlots, ...afterSlots].flatMap((slot) => slot.value == null ? [] : [slot.value]);
  const ceiling = Math.max(1, ...observed);
  const before = plot(beforeSlots.map((slot) => slot.value), 0, 47, ceiling);
  const after = plot(afterSlots.map((slot) => slot.value), 53, 100, ceiling);
  const missing = comparison.before.missingDates.length + comparison.after.missingDates.length;

  return <section className="bin-trend-chart">
    <header><h2>{title}</h2><div><span className="before">Before placement</span><span className="after">After placement</span></div></header>
    <div className="bin-chart-body">
      <span className="bin-chart-axis">Frequency</span>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`${title} before and after bin placement`}>
        <g className="bin-chart-grid"><line x1="0" y1="7" x2="100" y2="7" /><line x1="0" y1="29" x2="100" y2="29" /><line x1="0" y1="51" x2="100" y2="51" /><line x1="0" y1="73" x2="100" y2="73" /><line x1="0" y1="95" x2="100" y2="95" /></g>
        <line className="bin-chart-marker" x1="50" y1="0" x2="50" y2="100" />
        {before.segments.map((points, index) => <polyline className="bin-chart-before" points={points} key={`before-${index}`} />)}
        {after.segments.map((points, index) => <polyline className="bin-chart-after" points={points} key={`after-${index}`} />)}
        {before.points.map((point, index) => <circle className="bin-chart-before-point" cx={point.x} cy={point.y} r="1.25" key={`before-point-${index}`} />)}
        {after.points.map((point, index) => <circle className="bin-chart-after-point" cx={point.x} cy={point.y} r="1.25" key={`after-point-${index}`} />)}
      </svg>
      <span className="bin-chart-marker-label">Bin placed</span>
      <div className="bin-chart-range-labels"><span>{date(comparison.before.requestedStart)}</span><strong>{date(comparison.implementedAt)}</strong><span>{date(comparison.after.requestedEnd)}</span></div>
      {!observed.length && <div className="bin-chart-empty">No observed data in this comparison window.</div>}
    </div>
    <p>{number(comparison.before.availableDays, 2)} of {comparison.requestedDays} before-days and {number(comparison.after.availableDays, 2)} of {comparison.requestedDays} after-days available{missing ? `; ${missing} calendar date${missing === 1 ? " is" : "s are"} missing.` : "."}</p>
  </section>;
}

function factorValue(ranking: BinPlacementZoneRanking, factor: "peopleActivity" | "cleaningFrequency" | "binServiceFrequency") {
  const value = ranking[factor];
  const raw = factor === "peopleActivity" ? number(value.raw, 1) : number(value.raw, 0);
  return { raw, normalized: number(value.normalized, 1), contribution: number(value.contribution, 1) };
}

export function BinPlacementAnalysisPage({ siteName }: { siteName: string }) {
  const [lookbackInput, setLookbackInput] = useState("30");
  const [appliedLookback, setAppliedLookback] = useState(30);
  const [comparisonInput, setComparisonInput] = useState("7");
  const [appliedComparisonDays, setAppliedComparisonDays] = useState(7);
  const [snapshot, setSnapshot] = useState<BinPlacementSnapshot>();
  const [interventions, setInterventions] = useState<BinPlacementIntervention[]>([]);
  const [comparison, setComparison] = useState<BinPlacementComparison>();
  const [selectedZoneId, setSelectedZoneId] = useState("");
  const [selectedInterventionId, setSelectedInterventionId] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [implementingZoneId, setImplementingZoneId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const acceptSnapshot = useCallback((next: BinPlacementSnapshot) => {
    setSnapshot(next);
    setSelectedZoneId((current) => next.zoneRankings.some((ranking) => ranking.zoneId === current) ? current : next.zoneRankings[0]?.zoneId ?? "");
  }, []);

  const acceptInterventions = useCallback((next: BinPlacementIntervention[], preferredId?: string) => {
    setInterventions(next);
    setSelectedInterventionId((current) => preferredId && next.some((item) => item.id === preferredId) ? preferredId : next.some((item) => item.id === current) ? current : next[0]?.id ?? "");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    void Promise.all([getBinPlacementRecommendations(appliedLookback, controller.signal), getBinPlacementInterventions(controller.signal)])
      .then(([recommendations, history]) => { acceptSnapshot(recommendations.snapshot); acceptInterventions(history.interventions); })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Bin Placement data could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [acceptInterventions, acceptSnapshot, appliedLookback]);

  useEffect(() => {
    if (!selectedInterventionId) { setComparison(undefined); return; }
    const controller = new AbortController();
    setComparisonLoading(true); setError("");
    void getBinPlacementComparison(selectedInterventionId, appliedComparisonDays, controller.signal)
      .then((result) => setComparison(result.comparison))
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "The Intervention comparison could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setComparisonLoading(false); });
    return () => controller.abort();
  }, [appliedComparisonDays, selectedInterventionId]);

  const selected = useMemo(() => snapshot?.zoneRankings.find((ranking) => ranking.zoneId === selectedZoneId) ?? snapshot?.zoneRankings[0], [selectedZoneId, snapshot]);
  const selectedIntervention = useMemo(() => interventions.find((item) => item.id === selectedInterventionId), [interventions, selectedInterventionId]);

  const refresh = async () => {
    const days = wholeDays(lookbackInput);
    if (!days) { setError("Lookback days must be a whole number from 2 to 3660."); return; }
    setRefreshing(true); setError(""); setMessage("");
    try {
      const [recommendations, history] = await Promise.all([refreshBinPlacementRecommendations(days), getBinPlacementInterventions()]);
      setAppliedLookback(days); acceptSnapshot(recommendations.snapshot); acceptInterventions(history.interventions);
      setMessage(`Recommendations refreshed using ${days} completed local days.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Recommendations could not be refreshed."); }
    finally { setRefreshing(false); }
  };

  const implement = async (ranking: BinPlacementZoneRanking) => {
    if (!snapshot || ranking.totalScore == null) return;
    setImplementingZoneId(ranking.zoneId); setError(""); setMessage("");
    try {
      const result = await implementBinPlacement(ranking.zoneId, snapshot.calculatedAt);
      const [recommendations, history] = await Promise.all([getBinPlacementRecommendations(appliedLookback), getBinPlacementInterventions()]);
      acceptSnapshot(recommendations.snapshot); acceptInterventions(history.interventions, result.intervention.id);
      setMessage(`${ranking.zoneNameSnapshot} was recorded as implemented at ${dateTime(result.intervention.implementedAt)}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The bin placement could not be recorded."); }
    finally { setImplementingZoneId(""); }
  };

  const applyComparisonDays = () => {
    const days = wholeDays(comparisonInput);
    if (!days) { setError("Comparison days must be a whole number from 2 to 3660."); return; }
    setError(""); setAppliedComparisonDays(days);
  };

  const coveragePercent = selected ? Math.min(100, selected.coverage.availableDays / selected.coverage.requestedDays * 100) : 0;
  const people = selected ? factorValue(selected, "peopleActivity") : null;
  const cleaning = selected ? factorValue(selected, "cleaningFrequency") : null;
  const binService = selected ? factorValue(selected, "binServiceFrequency") : null;

  return <section className="bin-analysis-page">
    <header className="bin-analysis-heading">
      <div><span>INSIGHTS · EXPLAINABLE ANALYTICS</span><h1>Bin placement analysis</h1><p>Rank Zones using people activity, completed cleaning work, and bin-service Alerts. Each factor contributes one third.</p></div>
      <div className="bin-analysis-filters">
        <label>Active site<input value={siteName} readOnly /></label>
        <label>Lookback days<input type="number" min="2" max="3660" step="1" value={lookbackInput} onChange={(event) => setLookbackInput(event.target.value)} /></label>
        <div className="bin-analysis-refresh"><span>Last calculated</span><strong>{dateTime(snapshot?.calculatedAt)}</strong><button type="button" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh recommendations"}</button></div>
      </div>
    </header>

    {error && <p className="bin-analysis-message error" role="alert">{error}</p>}
    {message && <p className="bin-analysis-message" role="status">{message}</p>}

    <section className="bin-ranking">
      <header><span>PRIORITY ZONES</span><small>{snapshot ? `${statusLabel(snapshot.status)} · ${snapshot.availableDays} of ${snapshot.requestedLookbackDays} requested days available · ${date(snapshot.requestedStart)} to ${date(snapshot.requestedEnd)}` : "Loading recommendation coverage"}</small></header>
      <div className="bin-ranking-scroll"><table><thead><tr><th>Rank</th><th>Zone</th><th>Priority score</th><th>Why this score</th><th>Data coverage</th><th>Action</th></tr></thead><tbody>
        {snapshot?.zoneRankings.map((ranking) => <tr key={ranking.zoneId} className={selected?.zoneId === ranking.zoneId ? "selected" : ""} onClick={() => setSelectedZoneId(ranking.zoneId)}><td><b>{ranking.rank ?? "—"}</b></td><td><strong>{ranking.zoneNameSnapshot}</strong><small>{statusLabel(ranking.status)}</small></td><td><strong className={`bin-score ${ranking.totalScore == null ? "score-unavailable" : "score-implement"}`}>{ranking.totalScore == null ? "—" : number(ranking.totalScore, 1)}</strong></td><td>{number(ranking.peopleActivity.raw, 1)} people activity · {number(ranking.cleaningFrequency.raw, 0)} resolved Work · {number(ranking.binServiceFrequency.raw, 0)} bin-service Alerts</td><td><span className={ranking.coverage.partial ? "bin-coverage" : "bin-coverage ready"}>{number(ranking.coverage.availableDays, 0)}/{ranking.coverage.requestedDays} days</span><small>{ranking.reasonSummary}</small></td><td>{ranking.totalScore == null ? <span className="bin-recommendation unavailable">More data needed</span> : <button className="bin-recommendation implement" type="button" disabled={Boolean(implementingZoneId)} onClick={(event) => { event.stopPropagation(); setSelectedZoneId(ranking.zoneId); void implement(ranking); }}>{implementingZoneId === ranking.zoneId ? "Recording…" : "Implement"}</button>}</td></tr>)}
        {!loading && !snapshot?.zoneRankings.length && <tr><td colSpan={6}><div className="bin-table-empty"><strong>No eligible Zones are currently ranked.</strong><span>Recently implemented Zones remain excluded for two complete Site-local days.</span></div></td></tr>}
      </tbody></table>{loading && <div className="bin-table-empty"><strong>Loading Zone recommendations…</strong><span>Using the current V2 analytics snapshot.</span></div>}</div>
    </section>

    {selected && people && cleaning && binService && <section className="bin-selected-evidence"><header><span>SELECTED ZONE EVIDENCE</span><h2>{selected.zoneNameSnapshot}</h2></header><div className="bin-factor-grid v2">
      <article className="visitors"><span>People activity</span><strong>{people.raw} <small>average</small></strong><p>{people.normalized}% normalized · {people.contribution} points · 33.33% weight</p></article>
      <article className="cleaning"><span>Cleaning frequency</span><strong>{cleaning.raw} <small>resolved Work</small></strong><p>{cleaning.normalized}% normalized · {cleaning.contribution} points · 33.33% weight</p></article>
      <article className="overflow"><span>Bin-service frequency</span><strong>{binService.raw} <small>Alerts</small></strong><p>{binService.normalized}% normalized · {binService.contribution} points · 33.33% weight</p></article>
      <article className={`bin-sufficiency ${selected.status === "insufficient_data" ? "insufficient" : "ready"}`}><span>{selected.status === "insufficient_data" ? "More data needed" : selected.status === "partial_data" ? "Partial data" : "Data ready"}</span><strong>{number(coveragePercent, 0)}% coverage</strong><p>{selected.coverage.availableDays} of {selected.coverage.requestedDays} completed local days</p></article>
    </div></section>}

    <section className="bin-comparison-control">
      <header><div><span>INTERVENTION COMPARISON</span><h2>{selectedIntervention?.zoneNameSnapshot ?? "No implemented placement yet"}</h2></div>{selectedIntervention && <p>Implemented {dateTime(selectedIntervention.implementedAt)}<br />{selectedIntervention.note || "No implementation note"}</p>}</header>
      <div><label>Intervention<select value={selectedInterventionId} onChange={(event) => setSelectedInterventionId(event.target.value)} disabled={!interventions.length}>{interventions.length ? interventions.map((item) => <option value={item.id} key={item.id}>{item.zoneNameSnapshot} · {dateTime(item.implementedAt)}</option>) : <option value="">No Intervention history</option>}</select></label><label>Comparison days<input type="number" min="2" max="3660" step="1" value={comparisonInput} onChange={(event) => setComparisonInput(event.target.value)} /></label><button type="button" onClick={applyComparisonDays} disabled={!selectedInterventionId || comparisonLoading}>{comparisonLoading ? "Loading…" : "Update comparison"}</button></div>
    </section>

    {comparison ? <section className="bin-trend-grid"><TrendChart title="Cleaning frequency" comparison={comparison} metric="cleaningFrequency" /><TrendChart title="Bin-overflow frequency" comparison={comparison} metric="binOverflowFrequency" /></section> : <section className="bin-comparison-empty"><strong>{comparisonLoading ? "Loading comparison…" : "No before-and-after comparison yet."}</strong><p>{interventions.length ? "Choose an Intervention and comparison range." : "Press Implement after a physical bin placement. The comparison will build as daily data becomes available."}</p></section>}
  </section>;
}
