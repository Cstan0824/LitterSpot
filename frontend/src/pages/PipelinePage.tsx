import { useEffect, useRef, useState } from "react";
import { AnalysisResult } from "../features/pipeline/AnalysisResult";
import { FocusRegionEditor } from "../features/pipeline/FocusRegionEditor";
import { HistoryPanel } from "../features/pipeline/HistoryPanel";
import { PlacementPanel } from "../features/pipeline/PlacementPanel";
import { VideoAnalysisPanel } from "../features/pipeline/VideoAnalysisPanel";
import type { PipelineHistory, PipelineResult, PlacementRecommendation, Point } from "../features/pipeline/types";
import { cameraOptions, moveLiveVideo, publishLiveVideo, updateLiveVideoAnalysis } from "../features/pipeline/liveVideoStore";
import { apiFetch } from "../services/apiClient";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const allowedVideoTypes = new Set(["video/mp4", "video/webm", "video/ogg"]);

export function PipelinePage() {
  const [mode, setMode] = useState<"image" | "video">("image");
  const [file, setFile] = useState<File>();
  const [cameraId, setCameraId] = useState("CAMERA-1");
  const [result, setResult] = useState<PipelineResult>();
  const [history, setHistory] = useState<PipelineHistory[]>([]);
  const [placement, setPlacement] = useState<PlacementRecommendation>();
  const [windowDays, setWindowDays] = useState(3);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<string>();
  const [focusPoints, setFocusPoints] = useState<Point[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string>();
  const [streaming, setStreaming] = useState(false);
  const [sampleInterval, setSampleInterval] = useState(2);
  const [framesAnalyzed, setFramesAnalyzed] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const liveVideoIdRef = useRef<string | undefined>(undefined);
  const stopStreaming = useRef(false);

  async function loadHistory() {
    try {
      const response = await apiFetch("/api/detections/pipeline/recent");
      const body = await response.json();
      setHistory(body.items ?? []);
    } catch { /* Optional while services start. */ }
  }

  async function loadPlacement(targetCamera = cameraId) {
    if (!targetCamera.trim()) return;
    try {
      const response = await apiFetch(`/api/detections/pipeline/placement/${encodeURIComponent(targetCamera)}`);
      const body = await response.json();
      if (response.ok) { setPlacement(body); setWindowDays(body.windowDays); }
    } catch { /* Optional while services start. */ }
  }

  async function saveWindow() {
    const response = await apiFetch(`/api/detections/pipeline/placement/${encodeURIComponent(cameraId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ windowDays }),
    });
    const body = await response.json();
    if (!response.ok) { setError(body.error ?? "Could not update observation window."); return; }
    setPlacement(body);
  }

  useEffect(() => { void loadHistory(); void loadPlacement("CAMERA-1"); }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  useEffect(() => () => { stopStreaming.current = true; }, []);

  function selectFile(next?: File) {
    stopVideoAnalysis();
    setVideoUrl(undefined);
    setResult(undefined);
    setError(undefined);
    setFocusPoints([]);
    setDrawing(false);
    if (!next) return;
    if (!allowedTypes.has(next.type)) { setError("Use a JPEG, PNG, or WebP image."); return; }
    setFile(next);
    setPreview(URL.createObjectURL(next));
  }

  function selectVideo(next?: File) {
    stopVideoAnalysis();
    setResult(undefined);
    setError(undefined);
    setFramesAnalyzed(0);
    setFocusPoints([]);
    setDrawing(false);
    if (!next) return;
    if (!allowedVideoTypes.has(next.type)) { setError("Use an MP4, WebM, or Ogg video."); return; }
    setFile(undefined);
    setPreview(undefined);
    liveVideoIdRef.current = publishLiveVideo(next, cameraId);
    setVideoUrl(URL.createObjectURL(next));
  }

  async function analyzeFrame(frame: File) {
    const body = new FormData();
    body.append("image", frame);
    body.append("cameraId", cameraId);
    body.append("confirmationFrames", "3");
    if (focusPoints.length >= 3) body.append("focusRegion", JSON.stringify(focusPoints));
    const response = await apiFetch("/api/detections/pipeline/frame", { method: "POST", body });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Analysis failed.");
    setResult(payload);
    updateLiveVideoAnalysis(cameraId, payload);
  }

  async function analyze() {
    if (!file) return;
    if (focusPoints.length === 1 || focusPoints.length === 2) {
      setError("Add at least three focus-area points, or clear the area.");
      return;
    }
    if (drawing && focusPoints.length >= 3) setDrawing(false);
    setLoading(true);
    setError(undefined);
    try {
      await analyzeFrame(file);
      await loadHistory();
      await loadPlacement(cameraId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  function stopVideoAnalysis() {
    stopStreaming.current = true;
    videoRef.current?.pause();
    setStreaming(false);
  }

  async function captureVideoFrame(video: HTMLVideoElement, frameNumber: number) {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot capture video frames.");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error("Could not encode the video frame.")),
      "image/jpeg",
      0.9,
    ));
    return new File([blob], `cctv-frame-${String(frameNumber).padStart(5, "0")}.jpg`, { type: "image/jpeg" });
  }

  async function startVideoAnalysis() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) { setError("Wait for the video preview to finish loading."); return; }
    stopStreaming.current = false;
    setStreaming(true);
    setError(undefined);
    setFramesAnalyzed(0);
    try {
      video.currentTime = 0;
      await video.play();
      let frameNumber = 0;
      while (!stopStreaming.current && !video.ended) {
        const startedAt = performance.now();
        frameNumber += 1;
        const frame = await captureVideoFrame(video, frameNumber);
        setPreview((current) => {
          if (current) URL.revokeObjectURL(current);
          return URL.createObjectURL(frame);
        });
        await analyzeFrame(frame);
        setFramesAnalyzed(frameNumber);
        const remaining = sampleInterval * 1000 - (performance.now() - startedAt);
        if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
      }
      await Promise.all([loadHistory(), loadPlacement(cameraId)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Video analysis failed.");
    } finally {
      video.pause();
      setStreaming(false);
    }
  }

  return <main className="app-shell pipeline-page">
    <header className="hero"><div><p className="eyebrow">LITTERSPOT / UNIFIED ANALYSIS</p><h1>Every frame.<br /><em>Every change.</em></h1><p className="lede">Analyze a single image or monitor an uploaded video with live, one-second detection updates.</p></div><button className="quiet nav-button" onClick={() => { location.hash = "/"; }}>Dashboard</button></header>
    <div className="playground-tabs" role="tablist" aria-label="Analysis input type">
      <button role="tab" aria-selected={mode === "image"} className={mode === "image" ? "active" : ""} onClick={() => setMode("image")}>Image</button>
      <button role="tab" aria-selected={mode === "video"} className={mode === "video" ? "active" : ""} onClick={() => setMode("video")}>Video</button>
    </div>
    {mode === "video" ? <VideoAnalysisPanel cameraId={cameraId} onCameraIdChange={setCameraId} onPersisted={() => { void loadHistory(); void loadPlacement(cameraId); }} /> : <>
    <section className="workspace">
      <article className="card">
        <div className="card-heading"><div><span className="step">01</span><h2>Analyze camera frame</h2></div></div>
        <label className="dropzone"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => selectFile(event.target.files?.[0])} />{preview ? <img src={preview} alt="Selected camera frame" /> : <><span className="upload-icon">↑</span><strong>Upload a camera image</strong><span>JPEG, PNG, or WebP · 10 MB maximum</span></>}</label>
        {preview && !videoUrl && <FocusRegionEditor preview={preview} points={focusPoints} drawing={drawing} onPointsChange={setFocusPoints} onDrawingChange={setDrawing} />}
        <div className="video-ingest">
          <label><span>CCTV video</span><input type="file" accept="video/mp4,video/webm,video/ogg" disabled={streaming} onChange={(event) => selectVideo(event.target.files?.[0])} /></label>
          {videoUrl && <video ref={videoRef} src={videoUrl} controls muted playsInline onEnded={stopVideoAnalysis} />}
          {videoUrl && <label className="control"><span>Sample interval <b>{sampleInterval}s</b></span><input type="range" min="1" max="10" step="1" value={sampleInterval} disabled={streaming} onChange={(event) => setSampleInterval(Number(event.target.value))} /><small>Frames follow the clip's current playback position, with only one inference request running at a time.</small></label>}
        </div>
        <label className="control"><span>Camera ID</span><select value={cameraId} onChange={(event) => { setCameraId(event.target.value); if (liveVideoIdRef.current) moveLiveVideo(liveVideoIdRef.current, event.target.value); void loadPlacement(event.target.value); }}>{cameraOptions.map((id) => <option value={id} key={id}>{id}</option>)}</select></label>
        {videoUrl && <div className="action-row"><button className="primary" disabled={streaming} onClick={() => void startVideoAnalysis()}>{streaming ? "Analyzing stream..." : "Start CCTV simulation"}</button>{streaming && <button className="quiet" onClick={stopVideoAnalysis}>Stop</button>}<span className="frame-counter">{framesAnalyzed} frames analyzed</span></div>}
        <div className="action-row"><button className="primary" disabled={!file || loading} onClick={() => void analyze()}>{loading ? "Analyzing…" : "Run unified analysis"}</button></div>
        {error && <p className="error">{error}</p>}
      </article>
      <aside className="card pipeline-summary"><p className="eyebrow">Flag policy</p><h2>Human-reviewed alerts</h2><div className="policy-row"><b className="critical">Critical</b><span>Confirmed overflow or floor spill</span></div><div className="policy-row"><b className="warning">Warning</b><span>Floor litter</span></div><div className="policy-row"><b className="clear">Context</b><span>People count</span></div></aside>
    </section>
    {result && preview && <AnalysisResult result={result} imageUrl={preview} />}
    </>}
    {placement && <PlacementPanel placement={placement} windowDays={windowDays} onWindowDaysChange={setWindowDays} onSave={() => void saveWindow()} onRefresh={() => void loadPlacement()} />}
    <HistoryPanel history={history} onRefresh={() => void loadHistory()} />
  </main>;
}
