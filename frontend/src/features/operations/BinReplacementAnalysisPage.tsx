import { useMemo, useState } from "react";

type ZoneAnalysis = {
  id: string;
  zone: string;
  score: number;
  litter: number;
  overflow: number;
  visitors: "High" | "Medium" | "Low";
  persistence: string;
  coverage: number;
  days: number;
  recommendation: "Implement" | "Monitor" | "Compare" | "No change";
};

const analyses: ZoneAnalysis[] = [
  { id: "main-entrance", zone: "Main Entrance", score: 86, litter: 14, overflow: 3, visitors: "High", persistence: "4h 18m", coverage: 92, days: 14, recommendation: "Implement" },
  { id: "food-vendor", zone: "Food & Vendor", score: 74, litter: 10, overflow: 2, visitors: "High", persistence: "3h 04m", coverage: 85, days: 13, recommendation: "Monitor" },
  { id: "temple-courtyard", zone: "Temple Courtyard", score: 68, litter: 8, overflow: 1, visitors: "Medium", persistence: "2h 41m", coverage: 78, days: 11, recommendation: "Compare" },
  { id: "car-park", zone: "Car Park Walkway", score: 52, litter: 5, overflow: 0, visitors: "Low", persistence: "1h 12m", coverage: 63, days: 9, recommendation: "No change" },
];

const beforeOverflow = [2, 3, 4, 5, 6, 7, 4.5, 3.5, 3, 2, 2, 2, 1, 1];
const afterOverflow = [2, 3, 4, 5.5, 6.5, 7.5, 4, 3, 2.5, 1.5, 1.5, 1.5, .5, .5];
const beforeLitter = [5, 7, 9, 11, 13, 15, 11, 9, 7.5, 6.5, 5, 4, 3, 3];
const afterLitter = [5, 7, 9, 11, 13, 15, 10, 8.5, 7, 6, 5, 4, 3, 3];

function line(values: number[], ceiling: number) {
  return values.map((value, index) => `${(index / (values.length - 1)) * 100},${100 - value / ceiling * 100}`).join(" ");
}

function TrendChart({ title, before, after }: { title: string; before: number[]; after: number[] }) {
  return <section className="bin-trend-chart"><header><h2>{title}</h2><div><span className="before">Before bin placement</span><span className="after">After bin placement</span></div></header><div className="bin-chart-body"><span className="bin-chart-axis">Frequency</span><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`${title} comparison chart`}><g className="bin-chart-grid"><line x1="0" y1="0" x2="100" y2="0" /><line x1="0" y1="25" x2="100" y2="25" /><line x1="0" y1="50" x2="100" y2="50" /><line x1="0" y1="75" x2="100" y2="75" /><line x1="0" y1="100" x2="100" y2="100" /></g><line className="bin-chart-marker" x1="46.15" y1="0" x2="46.15" y2="100" /><polyline className="bin-chart-before" points={line(before, 18)} /><polyline className="bin-chart-after" points={line(after, 18)} /></svg><span className="bin-chart-marker-label">Bin placed</span><div className="bin-chart-days">{["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14"].map((day) => <span key={day}>{day} Jan</span>)}</div></div><p>Comparison window: 6 days before vs 8 days after bin placement on 07 Jan 2026.</p></section>;
}

export function BinReplacementAnalysisPage() {
  const [selectedId, setSelectedId] = useState(analyses[0].id);
  const [range, setRange] = useState("01–14 Jan 2026");
  const [bucket, setBucket] = useState("Hourly");
  const [message, setMessage] = useState<string>();
  const selected = useMemo(() => analyses.find((item) => item.id === selectedId) ?? analyses[0], [selectedId]);
  const sufficient = selected.coverage >= 75 && selected.days >= 10;

  return <section className="bin-analysis-page">
    <header className="bin-analysis-heading"><div><span>INSIGHTS · EXPLAINABLE ANALYTICS</span><h1>Bin replacement analysis</h1><p>Rank priority zones from deduplicated Camera observations and compare the outcome after a bin placement.</p></div><div className="bin-analysis-filters"><label>Site<select defaultValue="Batu Caves"><option>Batu Caves</option></select></label><label>Date range<select value={range} onChange={(event) => setRange(event.target.value)}><option>01–14 Jan 2026</option><option>15–28 Jan 2026</option><option>01–14 Feb 2026</option></select></label><label>Time bucket<select value={bucket} onChange={(event) => setBucket(event.target.value)}><option>Hourly</option><option>Daily</option></select></label><label>Camera coverage<select defaultValue="All camera coverage"><option>All camera coverage</option><option>Online cameras only</option></select></label></div></header>
    {message && <p className="bin-analysis-message" role="status">{message}</p>}
    <section className="bin-ranking"><header><span>PRIORITY ZONES</span><small>Selected range: {range} · {bucket.toLowerCase()} aggregation</small></header><div className="bin-ranking-scroll"><table><thead><tr><th>Rank</th><th>Zone</th><th>Priority score</th><th>Why this score</th><th>Data coverage</th><th>Recommendation</th></tr></thead><tbody>{analyses.map((item, index) => <tr key={item.id} className={selected.id === item.id ? "selected" : ""} onClick={() => { setSelectedId(item.id); setMessage(undefined); }}><td><b>{index + 1}</b></td><td><strong>{item.zone}</strong></td><td><strong className={`bin-score score-${item.recommendation.toLowerCase().replaceAll(" ", "-")}`}>{item.score}</strong></td><td>{item.litter} litter incidents · {item.overflow} overflow alerts · {item.visitors.toLowerCase()} visitor pressure</td><td><span className={item.coverage >= 75 ? "bin-coverage ready" : "bin-coverage"}>{item.coverage}% · {item.days}/14 days</span></td><td><button className={`bin-recommendation ${item.recommendation.toLowerCase().replaceAll(" ", "-")}`} type="button" onClick={(event) => { event.stopPropagation(); setSelectedId(item.id); setMessage(item.recommendation === "Implement" ? `Bin placement proposal recorded for ${item.zone}.` : `${item.zone} is selected for continued ${item.recommendation.toLowerCase()}.`); }}>{item.recommendation}</button></td></tr>)}</tbody></table></div></section>
    <section className="bin-selected-evidence"><header><span>SELECTED ZONE EVIDENCE</span><h2>{selected.zone}</h2></header><div className="bin-factor-grid"><article className="litter"><span>Litter burden</span><strong>{selected.litter} <small>incidents</small></strong><p>Weighted contribution · 35%</p></article><article className="visitors"><span>Visitor pressure</span><strong>{selected.visitors}</strong><p>Weighted contribution · 30%</p></article><article className="overflow"><span>Overflow burden</span><strong>{selected.overflow} <small>alerts</small></strong><p>Weighted contribution · 25%</p></article><article className="persistence"><span>Issue persistence</span><strong>{selected.persistence}</strong><p>Weighted contribution · 10%</p></article><article className={`bin-sufficiency ${sufficient ? "ready" : "insufficient"}`}><span>{sufficient ? "Data sufficient" : "More data needed"}</span><strong>{selected.coverage}% coverage</strong><p>Observations across {selected.days} operating days</p></article></div></section>
    <section className="bin-trend-grid"><TrendChart title="Bin overflow frequency" before={beforeOverflow} after={afterOverflow} /><TrendChart title="Litter-event frequency" before={beforeLitter} after={afterLitter} /></section>
  </section>;
}
