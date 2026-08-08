import type { PipelineHistory } from "./types";

function videoTime(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

export function HistoryPanel({ history, onRefresh }: { history: PipelineHistory[]; onRefresh: () => void }) {
  return <section className="card history-card">
    <div className="card-heading">
      <div><span className="step">05</span><h2>Recent flagging results</h2></div>
      <button className="quiet" onClick={onRefresh}>Refresh</button>
    </div>
    {history.length ? <div className="history-list">{history.map((item) =>
      <div className="history-row" key={item.id}>
        <span className={`state-badge ${item.flags.some((flag) => flag.severity === "critical") ? "critical" : item.flags.length ? "warning" : "clear"}`}>{item.flags.length ? item.flags[0].severity : "clear"}</span>
        <strong>{item.imageName}</strong>
        <span>{item.peopleCount} people · {item.bins.length} bins · {item.floorHazards.length} hazards</span>
        <time>{item.sourceType === "video" && item.videoTimestampSeconds != null ? `Video ${videoTime(item.videoTimestampSeconds)}` : new Date(`${item.createdAt}Z`).toLocaleString()}</time>
      </div>)}</div> : <p className="card-copy">No saved analyses yet.</p>}
  </section>;
}
