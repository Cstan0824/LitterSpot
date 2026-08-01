import type { PlacementRecommendation } from "./types";

type Props = {
  placement: PlacementRecommendation;
  windowDays: number;
  onWindowDaysChange: (days: number) => void;
  onSave: () => void;
  onRefresh: () => void;
};

export function PlacementPanel({ placement, windowDays, onWindowDaysChange, onSave, onRefresh }: Props) {
  return <section className={`card placement-card ${placement.recommended ? "recommended" : ""}`}>
    <div className="card-heading"><div><span className="step">04</span><h2>Bin placement analysis</h2></div><span className={`state-badge ${placement.recommended ? "critical" : placement.coverageReady ? "clear" : "warning"}`}>{placement.recommended ? "recommended" : placement.coverageReady ? "not recommended" : "observing"}</span></div>
    <div className="placement-controls"><label>Observation window<input type="number" min="1" max="30" value={windowDays} onChange={(event) => onWindowDaysChange(Math.max(1, Math.min(30, Number(event.target.value))))} /></label><button className="quiet" onClick={onSave}>Apply days</button><button className="quiet" onClick={onRefresh}>Refresh ranking</button></div>
    <div className="placement-ranks">
      <div><span>Overflow rank</span><strong>{placement.overflowRank}</strong><meter min="0" max="100" value={placement.overflowRank} /><small>{placement.overflowEpisodes} distinct episodes · threshold {placement.overflowThreshold}</small></div>
      <div><span>Popularity rank</span><strong>{placement.popularityRank}</strong><meter min="0" max="100" value={placement.popularityRank} /><small>{placement.averagePeoplePerFrame.toFixed(1)} average people · {Math.round(placement.peoplePresentFrameRatio * 100)}% occupied · threshold {placement.popularityThreshold}</small></div>
    </div>
    <p className="placement-copy">{placement.recommended ? `Recommendation raised by ${placement.triggerReason?.replace("_", " ") ?? "ranking"}.` : placement.coverageReady ? "Neither ranking has completed the stability rule yet." : `Collecting evidence: ${placement.validDays}/${placement.requiredValidDays} valid days and ${placement.observedSamples} one-minute samples.`}</p>
  </section>;
}
