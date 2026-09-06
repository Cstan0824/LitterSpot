import { useEffect, useRef, useState } from "react";
import { useSiteMonitoring } from "./SiteMonitoringProvider";
import type { Box, CameraObservation } from "../../../../shared/cameraMonitoring";
import "./camera-live-view.css";

export function ObservationOverlay({ observation, compact = false }: { observation: CameraObservation; compact?: boolean }) {
  const boxes: Array<{ box?: Box; label: string; confidence: number; color: string }> = [
    ...observation.people.map(p => ({ box: p.bbox, label: "Person", confidence: p.confidence, color: "#ade04a" })),
    ...observation.bins.map(b => ({ box: b.bbox, label: `${b.binId} · ${b.state}`, confidence: b.confidence, color: b.state === "overflow" ? "#ff7669" : "#67d3ed" })),
    ...observation.issues.map(i => ({ box: i.geometry?.bbox, label: i.issueType.replaceAll("_", " "), confidence: i.confidence, color: "#ffd26b" })),
  ];
  return <svg className="camera-live-overlay" viewBox={`0 0 ${observation.image.width} ${observation.image.height}`} aria-label="Detection overlays">
    {boxes.map(({ box, label, confidence, color }, index) => box && <g key={index}>
      <rect x={box.x1} y={box.y1} width={Math.max(0, box.x2 - box.x1)} height={Math.max(0, box.y2 - box.y1)} fill="none" stroke={color} strokeWidth={compact ? 1 : 2} vectorEffect="non-scaling-stroke" />
      <text x={Math.max(2, box.x1 + 3)} y={Math.max(14, box.y1 + 16)} fill={color} stroke="#102438" strokeWidth="2" paintOrder="stroke" fontSize={Math.max(12, observation.image.width / (compact ? 60 : 75))}>{label}{!compact && ` ${Math.round(confidence * 100)}%`}</text>
    </g>)}
  </svg>;
}

export function cameraMonitoringStatus(input: { available: boolean; enabled: boolean; busy: boolean; stale: boolean; error?: string; message?: string; lastReceivedAt?: number; peopleCount?: number; processingTimeMs?: number; now: number }) {
  if (!input.available) return { tone: "offline", title: "Camera unavailable", detail: "Camera controls could not be loaded." };
  if (input.busy) return { tone: "pending", title: input.enabled ? "Stopping monitoring" : "Starting monitoring", detail: "Applying the Camera setting." };
  if (!input.enabled) return { tone: "disabled", title: "Monitoring stopped", detail: "Enable this Camera to resume detection." };
  if (input.error) return { tone: "offline", title: "Monitoring needs attention", detail: input.error };
  if (input.stale) return { tone: "offline", title: "Camera offline", detail: input.message || "Enabled, but no fresh frame has arrived." };
  const ageSeconds = Math.max(0, Math.round((input.now - (input.lastReceivedAt ?? input.now)) / 1000));
  const freshness = ageSeconds < 1 ? "Latest frame just now" : `Latest frame ${ageSeconds} ${ageSeconds === 1 ? "second" : "seconds"} ago`;
  return { tone: "online", title: "Monitoring active", detail: `${freshness} · ${input.peopleCount ?? 0} people · ${Math.round(input.processingTimeMs ?? 0)} ms` };
}

export function CameraLiveView({ cameraId, compact = false }: { cameraId: string; compact?: boolean }) {
  const { state, monitor } = useSiteMonitoring(); const view = state.cameras[cameraId];
  const [raw, setRaw] = useState(false); const canvas = useRef<HTMLCanvasElement>(null); const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!raw || !view?.sourceVideo || !canvas.current) return;
    const target = canvas.current; const video = view.sourceVideo; let frame = 0;
    const draw = () => { if (video.videoWidth && !video.paused) { if (target.width !== video.videoWidth) target.width = video.videoWidth; if (target.height !== video.videoHeight) target.height = video.videoHeight; target.getContext("2d")?.drawImage(video, 0, 0); } frame = requestAnimationFrame(draw); };
    draw(); return () => cancelAnimationFrame(frame);
  }, [raw, view?.sourceVideo]);
  const enabled = view?.camera.monitoringEnabled;
  const stale = !view?.frameDataUrl || !view?.observation || !view?.lastReceivedAt || now - view.lastReceivedAt > 10_000;
  const dimensions = view?.observation?.image ?? { width: view?.camera.registration?.sourceWidth || 16, height: view?.camera.registration?.sourceHeight || 9 };
  const operationalStatus = cameraMonitoringStatus({ available: Boolean(view), enabled: Boolean(enabled), busy: Boolean(view?.controlBusy), stale, error: state.error, message: view?.message, lastReceivedAt: view?.lastReceivedAt, peopleCount: view?.observation?.peopleCount, processingTimeMs: view?.observation?.processingTimeMs, now });
  return <div className={`camera-live-view ${compact ? "compact" : "detail"}`}>
    <div className="camera-live-stage" style={{ aspectRatio: `${dimensions.width} / ${dimensions.height}` }}>
      {raw && view?.sourceVideo ? <canvas ref={canvas} /> : enabled && view?.frameDataUrl && view.observation ? <><img src={view.frameDataUrl} alt={`${view.camera.name} analyzed frame`} /><ObservationOverlay observation={view.observation} compact={compact} /></> : <div className="camera-live-empty"><strong>{enabled ? "Waiting for a fresh frame" : "Camera is disabled"}</strong>{!compact && <span>{enabled ? view?.message || "The Camera is enabled and connecting to its source." : "Enable it to resume monitoring and detection."}</span>}</div>}
      <span className={`camera-live-badge ${!enabled ? "disabled" : stale ? "offline" : "online"}`}>{!enabled ? "Disabled" : stale ? "Offline" : "Online"}</span>
    </div>
    {!compact && <div className="camera-live-controls">
      <div className={`camera-monitoring-state ${operationalStatus.tone}`}><i aria-hidden="true" /><div><strong>{operationalStatus.title}</strong><p role="status">{operationalStatus.detail}</p></div></div>
      <div>{state.owner && view?.sourceVideo && <button type="button" aria-pressed={raw} onClick={() => setRaw(!raw)}>{raw ? "Show detections" : "Watch live video"}</button>}<button type="button" disabled={!view || view.controlBusy} onClick={() => void monitor.toggle(cameraId)}>{view?.controlBusy ? "Updating…" : enabled ? "Disable" : "Enable"}</button></div>
    </div>}
  </div>;
}
