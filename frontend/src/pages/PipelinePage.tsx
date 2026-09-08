import { useEffect, useMemo, useRef, useState } from "react";
import { getCameras, type CameraRecord } from "../services/locationAPI";
import {
  getProcessingJob,
  getProcessingJobResults,
  startProcessingJob,
  uploadTestMedia,
  type NormalizedBox,
  type ProcessingFrame,
  type ProcessingJob,
  type ProcessingJobResults,
} from "../services/processingAPI";

type MediaType = "image" | "video";
type RunPhase = "idle" | "uploading" | "processing" | "completed" | "failed" | "stopped";

const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const videoTypes = new Set(["video/mp4", "video/webm", "video/quicktime"]);

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function boxStyle(box: NormalizedBox) {
  return {
    left: `${box.x1 * 100}%`,
    top: `${box.y1 * 100}%`,
    width: `${(box.x2 - box.x1) * 100}%`,
    height: `${(box.y2 - box.y1) * 100}%`,
  };
}

function formatTime(seconds: number | null) {
  if (seconds == null) return "Image";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function displayedBinState(bin: ProcessingFrame["bins"][number]) {
  if (bin.state === "unknown" || bin.state === "review") return bin.state;
  if (bin.confirmed === false && bin.state === "overflow") return "review";
  return bin.stableState ?? bin.state;
}

function frameForTime(frames: ProcessingFrame[], seconds: number) {
  if (!frames.length) return undefined;
  let selected = frames[0];
  for (const frame of frames) {
    const offset = frame.videoOffsetSeconds ?? 0;
    if (offset <= seconds + 0.15) selected = frame;
    else break;
  }
  return selected;
}

function ResultOverlay({ frame, registration }: {
  frame?: ProcessingFrame;
  registration: ProcessingJobResults["registration"];
}) {
  if (!frame) return null;
  const floor = frame.walkableFloorPolygonNormalized.length
    ? frame.walkableFloorPolygonNormalized : registration?.walkableFloorPolygon ?? [];
  return <div className="model-test-overlay" aria-hidden="true">
    <svg viewBox="0 0 1 1" preserveAspectRatio="none">
      {floor.length >= 3 && <polygon className="model-test-floor" points={floor.map((point) => `${point.x},${point.y}`).join(" ")} />}
      {frame.floorHazards.map((hazard) => hazard.polygonNormalized.length >= 3
        ? <polygon className={`model-test-hazard-polygon ${hazard.className}`} points={hazard.polygonNormalized.map((point) => `${point.x},${point.y}`).join(" ")} key={`polygon-${hazard.entityId}`} />
        : null)}
    </svg>
    {frame.people.map((person, index) => <span className="model-test-box person" style={boxStyle(person.bboxNormalized)} key={`person-${index}`}><b>Person · {Math.round(person.confidence * 100)}%</b></span>)}
    {frame.bins.map((bin) => {
      const state = displayedBinState(bin);
      return <span className={`model-test-box bin ${state}`} style={boxStyle(bin.bboxNormalized)} key={bin.entityId}><b>{bin.binId ?? bin.entityId} · {state}</b></span>;
    })}
    {frame.floorHazards.map((hazard) => <span className={`model-test-box hazard ${hazard.className}`} style={boxStyle(hazard.bboxNormalized)} key={hazard.entityId}><b>{hazard.className === "floor_spill" ? "Spill" : "Litter"} · {Math.round(hazard.confidence * 100)}%</b></span>)}
  </div>;
}

export function PipelinePage() {
  const [cameras, setCameras] = useState<CameraRecord[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [mediaType, setMediaType] = useState<MediaType>("video");
  const [file, setFile] = useState<File>();
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [frameIntervalSeconds, setFrameIntervalSeconds] = useState(1);
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [job, setJob] = useState<ProcessingJob>();
  const [results, setResults] = useState<ProcessingJobResults>();
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [videoTime, setVideoTime] = useState(0);
  const [error, setError] = useState<string>();
  const runToken = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const readyCameras = useMemo(() => cameras.filter((camera) => camera.status === "active" && camera.registrationStatus === "ready"), [cameras]);
  const selectedCamera = readyCameras.find((camera) => camera.id === cameraId);
  const selectedFrame = useMemo(() => {
    if (!results?.frames.length) return undefined;
    if (selectedRunId) return results.frames.find((frame) => frame.analysisRunId === selectedRunId) ?? results.frames[0];
    return mediaType === "video" ? frameForTime(results.frames, videoTime) : results.frames[0];
  }, [mediaType, results, selectedRunId, videoTime]);
  const busy = phase === "uploading" || phase === "processing";
  const progress = job?.progress;
  const progressRatio = progress?.plannedFrames ? Math.min(1, progress.processedFrames / progress.plannedFrames) : 0;
  const stageRatio = selectedFrame?.image
    ? `${selectedFrame.image.width} / ${selectedFrame.image.height}`
    : results?.registration ? `${results.registration.sourceWidth} / ${results.registration.sourceHeight}` : "16 / 9";

  useEffect(() => {
    void getCameras().then((items) => {
      setCameras(items);
      const first = items.find((camera) => camera.status === "active" && camera.registrationStatus === "ready");
      if (first) setCameraId(first.id);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Registered cameras could not be loaded."));
  }, []);

  useEffect(() => () => {
    runToken.current += 1;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function resetRun() {
    runToken.current += 1;
    setPhase("idle");
    setJob(undefined);
    setResults(undefined);
    setSelectedRunId(undefined);
    setVideoTime(0);
    setError(undefined);
  }

  function selectType(next: MediaType) {
    if (busy || next === mediaType) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setMediaType(next);
    setFile(undefined);
    setPreviewUrl(undefined);
    resetRun();
  }

  function selectFile(next?: File) {
    resetRun();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(undefined);
    setPreviewUrl(undefined);
    if (!next) return;
    const allowed = mediaType === "image" ? imageTypes : videoTypes;
    if (!allowed.has(next.type)) {
      setError(mediaType === "image" ? "Choose a JPEG, PNG, or WebP image." : "Choose an MP4, WebM, or MOV video.");
      return;
    }
    setFile(next);
    setPreviewUrl(URL.createObjectURL(next));
  }

  async function pollJob(jobId: string, token: number) {
    for (let attempt = 0; attempt < 600; attempt += 1) {
      if (token !== runToken.current) throw new DOMException("Cancelled", "AbortError");
      const latest = await getProcessingJob(jobId);
      setJob(latest);
      if (latest.status === "completed") return latest;
      if (latest.status === "failed" || latest.status === "cancelled") {
        throw new Error(latest.error?.message ?? `Processing job ${latest.status}.`);
      }
      await delay(1_000);
    }
    throw new Error("Processing is taking longer than ten minutes. The job is still available in the backend.");
  }

  async function runTest() {
    if (!file || !cameraId || busy) return;
    const token = runToken.current + 1;
    runToken.current = token;
    setError(undefined);
    setResults(undefined);
    setSelectedRunId(undefined);
    try {
      setPhase("uploading");
      const uploaded = await uploadTestMedia({ file, cameraId, type: mediaType, frameIntervalSeconds });
      if (token !== runToken.current) return;
      setJob(uploaded.job);
      setPhase("processing");
      await startProcessingJob(uploaded.job.id);
      const completed = await pollJob(uploaded.job.id, token);
      const nextResults = await getProcessingJobResults(completed.id);
      if (token !== runToken.current) return;
      setJob(completed);
      setResults(nextResults);
      setPhase("completed");
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setPhase("failed");
      setError(reason instanceof Error ? reason.message : "The model test could not complete.");
    }
  }

  function stopWaiting() {
    runToken.current += 1;
    setPhase("stopped");
    setError(undefined);
  }

  async function resumeMonitoring() {
    if (!job || busy) return;
    const token = runToken.current + 1;
    runToken.current = token;
    setPhase("processing");
    setError(undefined);
    try {
      const completed = await pollJob(job.id, token);
      const nextResults = await getProcessingJobResults(completed.id);
      if (token !== runToken.current) return;
      setJob(completed);
      setResults(nextResults);
      setPhase("completed");
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setPhase("failed");
      setError(reason instanceof Error ? reason.message : "The processing job could not be monitored.");
    }
  }

  function selectTimelineFrame(frame: ProcessingFrame) {
    const offset = frame.videoOffsetSeconds ?? 0;
    if (videoRef.current) videoRef.current.currentTime = offset;
    setVideoTime(offset);
    setSelectedRunId(frame.analysisRunId);
  }

  return <main className="app-shell model-test-page">
    <header className="model-test-header">
      <div><h1>Registered camera test</h1><p>Upload one test image or video. Node uses the camera's published floor and bin geometry, then returns frame-aligned model results.</p></div>
      <button className="quiet nav-button" onClick={() => { location.hash = "/"; }}>Dashboard</button>
    </header>

    <section className="model-test-layout">
      <form className="model-test-controls" onSubmit={(event) => { event.preventDefault(); void (phase === "stopped" && job ? resumeMonitoring() : runTest()); }}>
        <div className="model-test-mode" role="group" aria-label="Choose test media type">
          <button type="button" aria-pressed={mediaType === "video"} className={mediaType === "video" ? "active" : ""} onClick={() => selectType("video")}>Video</button>
          <button type="button" aria-pressed={mediaType === "image"} className={mediaType === "image" ? "active" : ""} onClick={() => selectType("image")}>Image</button>
        </div>

        <label className="model-test-field">Registered camera
          <select value={cameraId} disabled={busy} onChange={(event) => { setCameraId(event.target.value); resetRun(); }}>
            <option value="">Select a camera</option>
            {readyCameras.map((camera) => <option value={camera.id} key={camera.id}>{camera.name} · {camera.zoneName} · revision {camera.registrationRevision}</option>)}
          </select>
          <small>{selectedCamera ? `${selectedCamera.code} · ${selectedCamera.siteName} · registration revision ${selectedCamera.registrationRevision}` : "Only active cameras with a published registration appear here."}</small>
        </label>

        {!readyCameras.length && <div className="model-test-no-cameras"><strong>No registered cameras</strong><span>Publish a floor and optional bin registration before processing media.</span><button type="button" className="outline-button" onClick={() => { location.hash = "/camera-registration"; }}>Open camera registration</button></div>}

        {mediaType === "video" && <label className="model-test-field">Frame interval
          <div className="model-test-interval"><input type="range" min="1" max="10" step="1" value={frameIntervalSeconds} disabled={busy} onChange={(event) => { resetRun(); setFrameIntervalSeconds(Number(event.target.value)); }} /><b>{frameIntervalSeconds}s</b></div>
          <small>Two seconds is fast enough for the current five-second bin confirmation window.</small>
        </label>}

        <label className={`model-test-file ${file ? "selected" : ""}`}>
          <input type="file" disabled={busy} accept={mediaType === "image" ? "image/jpeg,image/png,image/webp" : "video/mp4,video/webm,video/quicktime"} onChange={(event) => selectFile(event.target.files?.[0])} />
          <span>{file ? "Selected file" : `Choose ${mediaType}`}</span>
          <strong>{file?.name ?? (mediaType === "video" ? "MP4, WebM, or MOV" : "JPEG, PNG, or WebP")}</strong>
          <small>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "The media must use the same camera angle and dimensions as its registration."}</small>
        </label>

        <div className="model-test-safety"><i />Test mode is locked on. Results are stored, but they cannot create alerts or affect analytics.</div>
        <div className="model-test-actions"><button className="primary model-test-run" type="submit" disabled={!file || !cameraId || busy}>{phase === "uploading" ? "Uploading…" : phase === "processing" ? "Processing…" : phase === "stopped" && job ? "Resume monitoring" : "Run registered-camera test"}</button>{busy && <button type="button" className="quiet" onClick={stopWaiting}>Stop waiting</button>}</div>
        {phase === "stopped" && <div className="model-test-stopped" role="status">Monitoring stopped. The backend job may still be running; resume when you are ready.</div>}
        {error && <div className="model-test-error" role="alert"><strong>Test stopped</strong><span>{error}</span></div>}
      </form>

      <section className="model-test-stage-panel">
        <div className="model-test-stage" style={{ aspectRatio: stageRatio }}>
          {!previewUrl && <div className="model-test-empty"><strong>No test media yet</strong><span>Choose a registered camera and upload a file to inspect the saved floor, bin states, people and floor hazards.</span></div>}
          {previewUrl && mediaType === "image" && <img src={previewUrl} alt="Selected camera test" />}
          {previewUrl && mediaType === "video" && <video ref={videoRef} src={previewUrl} controls muted playsInline onTimeUpdate={(event) => { setVideoTime(event.currentTarget.currentTime); setSelectedRunId(undefined); }} />}
          <ResultOverlay frame={selectedFrame} registration={results?.registration ?? null} />
          {previewUrl && <span className={`model-test-status ${phase}`} role="status" aria-live="polite">{phase === "idle" ? "Ready" : phase === "completed" ? selectedFrame ? `Result · ${formatTime(selectedFrame.videoOffsetSeconds)}` : "Completed" : phase}</span>}
        </div>

        {busy && <div className="model-test-progress" aria-live="polite"><div><strong>{phase === "uploading" ? "Storing test media" : "Running registered inference"}</strong><span>{progress ? `${progress.processedFrames} of ${progress.plannedFrames} frames` : "Preparing job"}</span></div><i><b style={{ width: `${phase === "uploading" ? 8 : Math.max(8, progressRatio * 100)}%` }} /></i></div>}

        {results && selectedFrame && <>
          <div className="model-test-metrics">
            <span><b>{selectedFrame.peopleCount}</b>People</span>
            <span><b>{selectedFrame.bins.length}</b>Registered bins</span>
            <span><b>{selectedFrame.floorHazards.length}</b>Floor hazards</span>
            <span><b>{Math.round(selectedFrame.processingTimeMs)} ms</b>Inference</span>
          </div>
          {mediaType === "video" && <div className="model-test-timeline" aria-label="Analyzed video frames">
            {results.frames.map((frame) => <button type="button" aria-pressed={frame.analysisRunId === selectedFrame.analysisRunId} className={frame.analysisRunId === selectedFrame.analysisRunId ? "active" : ""} key={frame.analysisRunId} onClick={() => selectTimelineFrame(frame)}><span>{formatTime(frame.videoOffsetSeconds)}</span><b>{frame.bins.filter((bin) => displayedBinState(bin) === "overflow").length + frame.floorHazards.length} issues</b></button>)}
          </div>}
          <div className="model-test-result-footer"><span>Registration revision {results.registration?.revision ?? "unknown"}</span><span>{selectedFrame.inferenceContractVersion ?? "legacy contract"}</span><span>{selectedFrame.modelVersions.binState ?? "model version unavailable"}</span></div>
          <details className="model-test-json"><summary>View current frame JSON</summary><pre>{JSON.stringify(selectedFrame, null, 2)}</pre></details>
        </>}
      </section>
    </section>
  </main>;
}
