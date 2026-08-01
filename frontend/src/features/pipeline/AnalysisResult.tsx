import type { Box, PipelineResult } from "./types";

const percentBox = (box: Box, image: PipelineResult["image"]) => ({
  left: `${box.x1 / image.width * 100}%`,
  top: `${box.y1 / image.height * 100}%`,
  width: `${(box.x2 - box.x1) / image.width * 100}%`,
  height: `${(box.y2 - box.y1) / image.height * 100}%`,
});

export function AnalysisResult({ result, imageUrl }: { result: PipelineResult; imageUrl: string }) {
  const status = result.flags.some((item) => item.severity === "critical") ? "critical" : result.flags.length ? "warning" : "clear";
  return <section className={`card result-panel ${status}`}>
    <div className="result-heading"><div><p className="eyebrow">Latest result</p><h2>{status === "clear" ? "No flags raised" : `${status} flags raised`}</h2></div><span className={`state-badge ${status}`}>{status}</span></div>
    <div className="annotated pipeline-annotated">
      <img src={imageUrl} alt="Annotated analysis result" />
      {result.people.map((person, index) => <span className="box person" key={`person-${index}`} style={percentBox(person.bbox, result.image)}><b>Person</b></span>)}
      {result.bins.map((bin) => <span className="box bin" key={`bin-${bin.binIndex}`} style={percentBox(bin.bbox, result.image)}><b>Bin {bin.binIndex}</b></span>)}
      {result.floorHazards.map((hazard, index) => <span className={`box hazard ${hazard.className}`} key={`hazard-${index}`} style={percentBox(hazard.bbox, result.image)}><b>{hazard.className === "floor_spill" ? "Spill" : "Litter"}</b></span>)}
      <svg className="spill-masks" viewBox={`0 0 ${result.image.width} ${result.image.height}`} preserveAspectRatio="none">
        {result.floorHazards.filter((hazard) => hazard.className === "floor_spill").map((hazard, index) => <polygon key={index} points={hazard.polygon.map((point) => `${point.x},${point.y}`).join(" ")} />)}
      </svg>
    </div>
    <div className="signal-grid">
      <div className="signal-card people"><small>People in frame</small><strong>{result.peopleCount}</strong></div>
      <div className="signal-card bins"><small>Bins localized</small><strong>{result.bins.length}</strong></div>
      <div className="signal-card hazards"><small>Floor hazards</small><strong>{result.floorHazards.length}</strong></div>
      <div className="signal-card latency"><small>Pipeline latency</small><strong>{Math.round(result.processingTimeMs)} ms</strong></div>
    </div>
    <div className="flag-list">{result.flags.map((flag, index) => <div className={flag.severity} key={`${flag.kind}-${index}`}><b>{flag.severity}</b><span>{flag.message}</span></div>)}</div>
  </section>;
}
