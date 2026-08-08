import { useEffect, useRef, useState } from "react";
import { FocusRegionEditor } from "./FocusRegionEditor";
import type { Box, PipelineResult, Point, VideoChange, VideoFrameResponse } from "./types";

const allowedVideoTypes = new Set(["video/mp4", "video/webm"]);
const maxVideoBytes = 500 * 1024 * 1024;
const maxDurationSeconds = 10 * 60;

type TimelineItem = VideoChange | { kind: "baseline"; entityId: "session"; videoTimestampSeconds: number };
type Props = { cameraId: string; onCameraIdChange: (value: string) => void; onPersisted: () => void };

const percentBox = (box: Box, image: PipelineResult["image"]) => ({
  left: `${box.x1 / image.width * 100}%`,
  top: `${box.y1 / image.height * 100}%`,
  width: `${(box.x2 - box.x1) / image.width * 100}%`,
  height: `${(box.y2 - box.y1) / image.height * 100}%`,
});

function formatTimestamp(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

function changeLabel(item: TimelineItem) {
  if (item.kind === "baseline") return "Baseline saved";
  const labels: Record<VideoChange["kind"], string> = {
    bin_state: `${item.entityId}: ${item.previous} → ${item.current}`,
    bin_appeared: `${item.entityId} appeared (${item.current})`,
    bin_disappeared: `${item.entityId} disappeared (${item.previous})`,
    floor_hazard_appeared: `${item.entityId.replaceAll("_", " ")} appeared`,
    floor_hazard_disappeared: `${item.entityId.replaceAll("_", " ")} cleared`,
    people_count: `People: ${item.previous} → ${item.current}`,
  };
  return labels[item.kind];
}

export function VideoAnalysisPanel({ cameraId, onCameraIdChange, onPersisted }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef("");
  const analyzingRef = useRef(false);
  const lastSampleSecondRef = useRef(-1);
  const startedRef = useRef(false);
  const fileRef = useRef<File | undefined>(undefined);
  const focusPointsRef = useRef<Point[]>([]);
  const cameraIdRef = useRef(cameraId);
  const onPersistedRef = useRef(onPersisted);
  const [file, setFile] = useState<File>();
  const [videoUrl, setVideoUrl] = useState<string>();
  const [poster, setPoster] = useState<string>();
  const [duration, setDuration] = useState(0);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(0.7);
  const [result, setResult] = useState<PipelineResult>();
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [focusPoints, setFocusPoints] = useState<Point[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [confirmationProgress, setConfirmationProgress] = useState(0);
  const [flagConfirmationProgress, setFlagConfirmationProgress] = useState(0);
  const [lastAnalyzedSecond, setLastAnalyzedSecond] = useState<number>();
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState<string>();

  useEffect(() => { startedRef.current = started; }, [started]);
  useEffect(() => { fileRef.current = file; }, [file]);
  useEffect(() => { focusPointsRef.current = focusPoints; }, [focusPoints]);
  useEffect(() => { cameraIdRef.current = cameraId; }, [cameraId]);
  useEffect(() => { onPersistedRef.current = onPersisted; }, [onPersisted]);
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  useEffect(() => () => { startedRef.current = false; videoRef.current?.pause(); }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (video) setCurrentTime(video.currentTime);
      if (!startedRef.current || !video || video.paused || video.ended || analyzingRef.current) return;
      const second = Math.floor(video.currentTime);
      if (second <= lastSampleSecondRef.current) return;
      void analyzeCurrentFrame();
    }, 200);
    return () => window.clearInterval(timer);
  }, []);

  function resetSessionState() {
    sessionRef.current = crypto.randomUUID();
    lastSampleSecondRef.current = -1;
    analyzingRef.current = false;
    setResult(undefined);
    setTimeline([]);
    setConfirmationProgress(0);
    setFlagConfirmationProgress(0);
    setLastAnalyzedSecond(undefined);
    setError(undefined);
  }

  function selectVideo(next?: File) {
    setError(undefined);
    if (!next) return;
    if (!allowedVideoTypes.has(next.type)) { setError("Use an MP4 or WebM video."); return; }
    if (next.size > maxVideoBytes) { setError("Video must be 500 MB or smaller."); return; }
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    const url = URL.createObjectURL(next);
    setFile(next);
    setVideoUrl(url);
    setPoster(undefined);
    setDuration(0);
    setStarted(false);
    setPlaying(false);
    setEnded(false);
    setFocusPoints([]);
    setDrawing(false);
    resetSessionState();
  }

  function prepareVideo() {
    const video = videoRef.current;
    if (!video) return;
    if (video.duration > maxDurationSeconds) {
      setError("Video must be 10 minutes or shorter.");
      setDuration(video.duration);
      return;
    }
    setDuration(video.duration);
    video.currentTime = Math.min(0.1, video.duration / 2);
  }

  function capturePoster() {
    const video = videoRef.current;
    if (!video || startedRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    setPoster(canvas.toDataURL("image/jpeg", 0.86));
  }

  async function frameBlob(video: HTMLVideoElement) {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
  }

  async function analyzeCurrentFrame() {
    const video = videoRef.current;
    const selected = fileRef.current;
    if (!video || !selected || !sessionRef.current || analyzingRef.current) return;
    const timestamp = video.currentTime;
    const wasPlaying = !video.paused && !video.ended;
    let succeeded = false;
    if (wasPlaying) video.pause();
    lastSampleSecondRef.current = Math.floor(timestamp);
    analyzingRef.current = true;
    setAnalyzing(true);
    try {
      const blob = await frameBlob(video);
      if (!blob) throw new Error("Could not capture the current video frame.");
      const body = new FormData();
      body.append("image", blob, `${selected.name}-${formatTimestamp(timestamp).replace(":", "-")}.jpg`);
      body.append("sessionId", sessionRef.current);
      body.append("cameraId", cameraIdRef.current.trim());
      body.append("videoTimestampSeconds", String(timestamp));
      if (focusPointsRef.current.length >= 3) body.append("focusRegion", JSON.stringify(focusPointsRef.current));
      const response = await fetch("/api/detections/pipeline/video-frame", { method: "POST", body });
      const payload = await response.json() as VideoFrameResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Video-frame analysis failed.");
      setResult(payload.result);
      setConfirmationProgress(payload.confirmationProgress);
      setFlagConfirmationProgress(payload.flagConfirmationProgress);
      setLastAnalyzedSecond(Math.floor(payload.videoTimestampSeconds));
      if (payload.baseline) setTimeline((items) => [...items, { kind: "baseline", entityId: "session", videoTimestampSeconds: payload.videoTimestampSeconds }]);
      if (payload.changes.length) setTimeline((items) => [...items, ...payload.changes]);
      if (payload.persisted) onPersistedRef.current();
      succeeded = true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Video-frame analysis failed.");
      video.pause();
      setPlaying(false);
    } finally {
      analyzingRef.current = false;
      setAnalyzing(false);
      if (succeeded && wasPlaying && startedRef.current && !video.ended) {
        try { await video.play(); }
        catch { setError("Playback could not resume after frame analysis."); }
      }
    }
  }

  async function start() {
    const video = videoRef.current;
    if (!video || !file) return;
    if (!cameraId.trim()) { setError("Camera ID is required."); return; }
    if (drawing || focusPoints.length === 1 || focusPoints.length === 2) {
      setError("Finish the focus area with at least three points, or clear it.");
      return;
    }
    if (duration > maxDurationSeconds) { setError("Video must be 10 minutes or shorter."); return; }
    resetSessionState();
    setStarted(true);
    setEnded(false);
    startedRef.current = true;
    video.currentTime = 0;
    setCurrentTime(0);
    video.muted = muted;
    video.volume = volume;
    await video.play();
    setPlaying(true);
    await analyzeCurrentFrame();
  }

  async function togglePlayback() {
    const video = videoRef.current;
    if (!video || ended) return;
    if (video.paused) { await video.play(); setPlaying(true); }
    else { video.pause(); setPlaying(false); }
  }

  async function restart() {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = 0;
    setCurrentTime(0);
    resetSessionState();
    setStarted(true);
    setEnded(false);
    startedRef.current = true;
    await video.play();
    setPlaying(true);
    await analyzeCurrentFrame();
  }

  return <section className="video-workspace">
    <div className="workspace">
      <article className="card video-card">
        <div className="card-heading"><div><span className="step">01</span><h2>Import video</h2></div>{file && <span className="muted">{file.name}</span>}</div>
        {!file && <label className="dropzone video-dropzone"><input type="file" accept="video/mp4,video/webm" onChange={(event) => selectVideo(event.target.files?.[0])} /><span className="upload-icon">▶</span><strong>Select MP4 or WebM</strong><span>Up to 10 minutes · 500 MB maximum</span></label>}
        {videoUrl && <div className={started ? "video-live-stage" : "video-engine"}>
          <video ref={videoRef} className="video-player" src={videoUrl} playsInline muted={muted} onLoadedMetadata={prepareVideo} onSeeked={capturePoster} onPlay={() => { setPlaying(true); setEnded(false); }} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setEnded(true); }} />
          {started && result?.people.map((person, index) => <span className="box person" key={`person-${index}`} style={percentBox(person.bbox, result.image)}><b>Person</b></span>)}
          {started && result?.bins.map((bin) => <span className={`box bin ${bin.state} ${bin.stale ? "stale" : !bin.confirmed ? "candidate" : "confirmed"}`} key={bin.trackingId ?? bin.binIndex} style={percentBox(bin.bbox, result.image)}><b>{bin.trackingId ?? `Bin ${bin.binIndex}`} · {bin.stale ? "stale" : !bin.confirmed ? "candidate" : bin.state}</b></span>)}
          {started && result?.floorHazards.map((hazard, index) => <span className={`box hazard ${hazard.className}`} key={`${hazard.className}-${index}`} style={percentBox(hazard.bbox, result.image)}><b>{hazard.className.replace("floor_", "")}</b></span>)}
        </div>}
        {!started && poster && <FocusRegionEditor preview={poster} points={focusPoints} drawing={drawing} onPointsChange={setFocusPoints} onDrawingChange={setDrawing} />}
        {started && <div className="video-controls">
          <button className="quiet" disabled={ended || analyzing} onClick={() => void togglePlayback()}>{ended ? "Ended" : analyzing ? "Analyzing" : playing ? "Pause" : "Play"}</button>
          <button className="quiet" onClick={() => void restart()}>Restart</button>
          <button className="quiet" onClick={() => { const next = !muted; setMuted(next); if (videoRef.current) videoRef.current.muted = next; }}>{muted ? "Unmute" : "Mute"}</button>
          <label>Volume <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(event) => { const next = Number(event.target.value); setVolume(next); if (videoRef.current) videoRef.current.volume = next; }} /></label>
          <span>{formatTimestamp(currentTime)} / {formatTimestamp(duration)}</span>
        </div>}
        {error && <p role="alert" className="error">{error}</p>}
      </article>
      <aside className="card settings-card">
        <div className="card-heading"><div><span className="step">02</span><h2>Video analysis</h2></div></div>
        <label className="control"><span>Camera ID <b>Required</b></span><input type="text" value={cameraId} disabled={started} onChange={(event) => onCameraIdChange(event.target.value)} /></label>
        <div className="video-status"><span className={playing ? "active" : ""} /><div><strong>{analyzing ? "Analyzing frame…" : playing ? "Live analysis" : started ? "Paused" : "Ready to configure"}</strong><small>{lastAnalyzedSecond === undefined ? "Every video second is processed" : `Last result ${formatTimestamp(lastAnalyzedSecond)} · every video second is processed`}</small></div></div>
        {confirmationProgress === 1 && <p className="confirmation-note">Change detected · confirming next sample</p>}
        {flagConfirmationProgress > 0 && flagConfirmationProgress < 4 && <p className="confirmation-note">Detection frequency · {flagConfirmationProgress}/4 occurrences within 10 seconds</p>}
        {flagConfirmationProgress === 4 && <p className="confirmation-note">Flag threshold reached · more than 3 occurrences within 10 seconds</p>}
        {!started && <button className="primary video-start" disabled={!file || !poster || duration > maxDurationSeconds} onClick={() => void start()}>Start analysis</button>}
        <p className="card-copy">Seeking is disabled. Restart creates a new baseline and begins again from 00:00.</p>
      </aside>
    </div>
    {started && <section className="card video-results">
      <div className="card-heading"><div><span className="step">03</span><h2>Live detections</h2></div><span className="muted">{result ? `${result.bins.length} bins · ${result.peopleCount} people · ${result.floorHazards.length} hazards` : "Awaiting first result"}</span></div>
      <div className="video-result-grid">
        <div className="signal-grid">
          <div className="signal-card people"><small>People</small><strong>{result?.peopleCount ?? "—"}</strong></div>
          <div className="signal-card bins"><small>Bins</small><strong>{result?.bins.length ?? "—"}</strong></div>
          <div className="signal-card hazards"><small>Hazards</small><strong>{result?.floorHazards.length ?? "—"}</strong></div>
          <div className="signal-card latency"><small>Latency</small><strong>{result ? `${Math.round(result.processingTimeMs)} ms` : "—"}</strong></div>
        </div>
        {result?.flags.length ? <div className="flag-list video-flag-list">{result.flags.map((flag, index) => <div className={flag.severity} key={`${flag.kind}-${index}`}><b>{flag.severity}</b><span>{flag.message}</span></div>)}</div> : null}
        <div className="change-timeline"><h3>Confirmed change timeline</h3>{timeline.length === 0 ? <p>No confirmed events yet.</p> : timeline.map((item, index) => <div key={`${item.kind}-${item.videoTimestampSeconds}-${index}`}><time>{formatTimestamp(item.videoTimestampSeconds)}</time><span>{changeLabel(item)}</span><b>Saved</b></div>)}</div>
      </div>
    </section>}
  </section>;
}
