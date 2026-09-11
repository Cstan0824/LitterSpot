import { useEffect, useRef, useState } from "react";
import { useSiteMonitoring } from "./SiteMonitoringProvider";
import type { Box, CameraObservation } from "../../../../shared/cameraMonitoring";
import { overlayForDelayedPlayback, type DelayedPlaybackState } from "../../../../shared/delayedCameraPlayback";
import "./camera-live-view.css";

export const CAMERA_VIEW_ASPECT_RATIO = "16 / 9";

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

export function cameraMonitoringStatus(input: { available: boolean; enabled: boolean; busy: boolean; stale: boolean; error?: string; message?: string; playbackState?: DelayedPlaybackState; analysisUpdating?: boolean; lastReceivedAt?: number; peopleCount?: number; processingTimeMs?: number; now: number }) {
  if (!input.available) return { tone: "offline", title: "Camera unavailable", detail: "Camera controls could not be loaded." };
  if (input.busy) return { tone: "pending", title: input.enabled ? "Stopping monitoring" : "Starting monitoring", detail: "Applying the Camera setting." };
  if (!input.enabled) return { tone: "disabled", title: "Monitoring stopped", detail: "Enable this Camera to resume detection." };
  if (input.error) return { tone: "offline", title: "Monitoring needs attention", detail: input.error };
  if (input.playbackState === "unavailable") return { tone: "offline", title: "Camera analysis unavailable", detail: input.message || "Retry to rebuild analyzed playback." };
  if (input.playbackState === "buffering") return { tone: "pending", title: "Connecting to Camera...", detail: "Building footage and analysis coverage." };
  if (input.playbackState === "rebuffering") return { tone: "pending", title: "Rebuffering analysis", detail: "Playback will resume when analyzed coverage is ready." };
  if (input.stale && input.message?.startsWith("Connecting")) return { tone: "pending", title: "Connecting to Camera...", detail: "Capture and analysis are starting." };
  if (input.stale) return { tone: "offline", title: "Camera offline", detail: input.message || "Enabled, but no fresh frame has arrived." };
  const ageSeconds = Math.max(0, Math.round((input.now - (input.lastReceivedAt ?? input.now)) / 1000));
  const freshness = ageSeconds < 1 ? "Latest frame just now" : `Latest frame ${ageSeconds} ${ageSeconds === 1 ? "second" : "seconds"} ago`;
  return { tone: "online", title: "Live monitoring", detail: input.analysisUpdating ? `${freshness} · Analysis is catching up` : `${freshness} · ${input.peopleCount ?? 0} people · ${Math.round(input.processingTimeMs ?? 0)} ms` };
}

export function CameraLiveView({ cameraId, compact = false, onReconfigure, onMove }: { cameraId: string; compact?: boolean; onReconfigure?: () => void; onMove?: () => void }) {
  const { state, monitor } = useSiteMonitoring(); const view = state.cameras[cameraId];
  const [original, setOriginal] = useState(false); const [canvasNode, setCanvasNode] = useState<HTMLCanvasElement | null>(null); const root = useRef<HTMLDivElement>(null); const [visible, setVisible] = useState(true); const [now, setNow] = useState(Date.now()); const [displayObservation, setDisplayObservation] = useState<CameraObservation>();
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!compact || !root.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "160px" }); observer.observe(root.current); return () => observer.disconnect();
  }, [compact]);
  useEffect(() => {
    monitor.setPresentationInterest(cameraId, compact ? "card" : "detail", compact ? visible : true);
    return () => monitor.setPresentationInterest(cameraId, compact ? "card" : "detail", false);
  }, [cameraId, compact, monitor, visible]);
  useEffect(() => {
    setDisplayObservation(undefined);
    const playback = view?.detailPlayback;
    if (compact || !visible || !playback?.video || !canvasNode || !["playing", "rebuffering"].includes(playback.state)) return;
    const target = canvasNode; const source = playback.video; let frame = 0; let displayedSampleId: string | undefined;
    const draw = () => {
      if (source.videoWidth && source.videoHeight && source.readyState >= 2) {
        const width = playback.width; const height = playback.height;
        if (target.width !== width) target.width = width; if (target.height !== height) target.height = height;
        target.getContext("2d", { alpha: false })?.drawImage(source, 0, 0, width, height);
        const displayedCapturedAtMs = playback.recordingStartedAtMs + source.currentTime * 1_000;
        const matching = playback.state === "playing" ? overlayForDelayedPlayback(view?.analysisTimeline ?? [], displayedCapturedAtMs) : undefined;
        if (matching?.sampleId !== displayedSampleId) { displayedSampleId = matching?.sampleId; setDisplayObservation(matching); }
      }
      frame = requestAnimationFrame(draw);
    };
    draw(); return () => cancelAnimationFrame(frame);
  }, [canvasNode, compact, state.owner, view?.analysisTimeline, view?.detailPlayback, visible]);
  const enabled = view?.camera.monitoringEnabled;
  const detailPlayback = !compact && state.owner ? view?.detailPlayback : undefined;
  const snapshotAvailable = Boolean(enabled && view?.frameDataUrl && view.observation);
  const stale = detailPlayback ? false : !snapshotAvailable || !view?.lastReceivedAt || now - view.lastReceivedAt > 10_000;
  const operationalStatus = cameraMonitoringStatus({ available: Boolean(view), enabled: Boolean(enabled), busy: Boolean(view?.controlBusy), stale, error: state.error, message: detailPlayback?.error ?? view?.message, playbackState: detailPlayback?.state, lastReceivedAt: view?.lastReceivedAt, peopleCount: view?.observation?.peopleCount, processingTimeMs: view?.observation?.processingTimeMs, now });
  const delayedCanvas = Boolean(detailPlayback?.video && ["playing", "rebuffering"].includes(detailPlayback.state));
  return <div ref={root} className={`camera-live-view ${compact ? "compact" : "detail"}`}>
    <div className="camera-live-stage" style={{ aspectRatio: CAMERA_VIEW_ASPECT_RATIO }}>
      {delayedCanvas ? <><canvas ref={setCanvasNode} aria-label={`${view?.camera.name ?? "Camera"} delayed analyzed video`} />{!original && displayObservation && <ObservationOverlay observation={displayObservation} />}{detailPlayback?.state === "rebuffering" && <div className="camera-live-buffering" role="status"><i aria-hidden="true" /><strong>Rebuffering analysis</strong><span>Building enough analyzed coverage to continue.</span></div>}</> : detailPlayback?.state === "unavailable" ? <div className="camera-live-empty error"><strong>Camera analysis unavailable</strong><span>{detailPlayback.error ?? "Analyzed playback could not be prepared."}</span><button type="button" onClick={() => monitor.retryDetailPlayback(cameraId)}>Retry</button></div> : detailPlayback?.state === "buffering" ? <div className="camera-live-empty buffering" role="status"><i aria-hidden="true" /><strong>Connecting to Camera...</strong><span>Preparing smooth analyzed playback.</span></div> : snapshotAvailable ? <><img src={view!.frameDataUrl} alt={`${view!.camera.name} analyzed frame`} />{!original && <ObservationOverlay observation={view!.observation!} compact={compact} />}</> : <div className="camera-live-empty"><strong>{enabled ? "Waiting for a fresh analyzed frame" : "Camera is disabled"}</strong>{!compact && <span>{enabled ? view?.message || "Capture and analysis are starting." : "Enable it to resume monitoring and detection."}</span>}</div>}
      <span className={`camera-live-badge ${!enabled ? "disabled" : stale ? "offline" : "online"}`}>{!enabled ? "Disabled" : stale ? "Offline" : "Online"}</span>
    </div>
    {!compact && <div className="camera-live-controls">
      <div className={`camera-monitoring-state ${operationalStatus.tone}`}><i aria-hidden="true" /><div><strong>{operationalStatus.title}</strong><p role="status">{operationalStatus.detail}</p></div></div>
      <div>{(delayedCanvas || !state.owner && view?.frameDataUrl) && <button type="button" aria-pressed={original} onClick={() => setOriginal(!original)}>{original ? "Show analysis" : "Original video"}</button>}{onMove && <button type="button" onClick={onMove}>Move Camera</button>}{onReconfigure && <button type="button" onClick={onReconfigure}>Reconfigure Camera</button>}<button type="button" disabled={!view || view.controlBusy} onClick={() => void monitor.toggle(cameraId)}>{view?.controlBusy ? "Updating…" : enabled ? "Disable" : "Enable"}</button></div>
    </div>}
  </div>;
}
