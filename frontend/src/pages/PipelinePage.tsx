import { useEffect, useState } from "react";
import { AnalysisResult } from "../features/pipeline/AnalysisResult";
import { FocusRegionEditor } from "../features/pipeline/FocusRegionEditor";
import { HistoryPanel } from "../features/pipeline/HistoryPanel";
import { PlacementPanel } from "../features/pipeline/PlacementPanel";
import type { PipelineHistory, PipelineResult, PlacementRecommendation, Point } from "../features/pipeline/types";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export function PipelinePage() {
  const [file, setFile] = useState<File>();
  const [cameraId, setCameraId] = useState("camera-1");
  const [result, setResult] = useState<PipelineResult>();
  const [history, setHistory] = useState<PipelineHistory[]>([]);
  const [placement, setPlacement] = useState<PlacementRecommendation>();
  const [windowDays, setWindowDays] = useState(3);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<string>();
  const [focusPoints, setFocusPoints] = useState<Point[]>([]);
  const [drawing, setDrawing] = useState(false);

  async function loadHistory() {
    try {
      const response = await fetch("/api/detections/pipeline/recent");
      const body = await response.json();
      setHistory(body.items ?? []);
    } catch { /* Optional while services start. */ }
  }

  async function loadPlacement(targetCamera = cameraId) {
    if (!targetCamera.trim()) return;
    try {
      const response = await fetch(`/api/detections/pipeline/placement/${encodeURIComponent(targetCamera)}`);
      const body = await response.json();
      if (response.ok) { setPlacement(body); setWindowDays(body.windowDays); }
    } catch { /* Optional while services start. */ }
  }

  async function saveWindow() {
    const response = await fetch(`/api/detections/pipeline/placement/${encodeURIComponent(cameraId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ windowDays }),
    });
    const body = await response.json();
    if (!response.ok) { setError(body.error ?? "Could not update observation window."); return; }
    setPlacement(body);
  }

  useEffect(() => { void loadHistory(); void loadPlacement("camera-1"); }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function selectFile(next?: File) {
    setResult(undefined);
    setError(undefined);
    setFocusPoints([]);
    setDrawing(false);
    if (!next) return;
    if (!allowedTypes.has(next.type)) { setError("Use a JPEG, PNG, or WebP image."); return; }
    setFile(next);
    setPreview(URL.createObjectURL(next));
  }

  async function analyze() {
    if (!file) return;
    if (drawing || focusPoints.length === 1 || focusPoints.length === 2) {
      setError("Finish the focus area with at least three points, or clear it.");
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const body = new FormData();
      body.append("image", file);
      body.append("cameraId", cameraId);
      body.append("confirmationFrames", "3");
      if (focusPoints.length >= 3) body.append("focusRegion", JSON.stringify(focusPoints));
      const response = await fetch("/api/detections/pipeline/frame", { method: "POST", body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Analysis failed.");
      setResult(payload);
      await loadHistory();
      await loadPlacement(cameraId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  return <main className="app-shell pipeline-page">
    <header className="hero"><div><p className="eyebrow">LITTERSPOT / UNIFIED ANALYSIS</p><h1>One frame.<br /><em>Every risk.</em></h1><p className="lede">Draw a focus area for floor hazards; bin and people detection continue using the full frame.</p></div><button className="quiet nav-button" onClick={() => { location.hash = "/"; }}>Dashboard</button></header>
    <section className="workspace">
      <article className="card">
        <div className="card-heading"><div><span className="step">01</span><h2>Analyze camera frame</h2></div></div>
        <label className="dropzone"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => selectFile(event.target.files?.[0])} />{preview ? <img src={preview} alt="Selected camera frame" /> : <><span className="upload-icon">↑</span><strong>Upload a camera image</strong><span>JPEG, PNG, or WebP · 10 MB maximum</span></>}</label>
        {preview && <FocusRegionEditor preview={preview} points={focusPoints} drawing={drawing} onPointsChange={setFocusPoints} onDrawingChange={setDrawing} />}
        <label className="control"><span>Camera ID</span><input type="text" value={cameraId} onChange={(event) => setCameraId(event.target.value)} onBlur={() => void loadPlacement(cameraId)} /></label>
        <div className="action-row"><button className="primary" disabled={!file || loading} onClick={() => void analyze()}>{loading ? "Analyzing…" : "Run unified analysis"}</button></div>
        {error && <p className="error">{error}</p>}
      </article>
      <aside className="card pipeline-summary"><p className="eyebrow">Flag policy</p><h2>Human-reviewed alerts</h2><div className="policy-row"><b className="critical">Critical</b><span>Confirmed overflow or floor spill</span></div><div className="policy-row"><b className="warning">Warning</b><span>Floor litter</span></div><div className="policy-row"><b className="clear">Context</b><span>People count</span></div></aside>
    </section>
    {result && preview && <AnalysisResult result={result} imageUrl={preview} />}
    {placement && <PlacementPanel placement={placement} windowDays={windowDays} onWindowDaysChange={setWindowDays} onSave={() => void saveWindow()} onRefresh={() => void loadPlacement()} />}
    <HistoryPanel history={history} onRefresh={() => void loadHistory()} />
  </main>;
}
