import { useMemo, useState } from "react";

type Detection = { className: string; confidence: number; confirmed: boolean; confirmationFrames: number; bbox: { x1: number; y1: number; x2: number; y2: number } };
type Result = { modelVersion: string; processingTimeMs: number; image: { width: number; height: number }; detections: Detection[] };
type Settings = { confidence: number; iou: number; imgsz: number; maxDetections: number; cameraId: string; confirmationFrames: number };

const defaults: Settings = { confidence: 0.25, iou: 0.70, imgsz: 768, maxDetections: 100, cameraId: "", confirmationFrames: 3 };

export function DetectionTestPage() {
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [result, setResult] = useState<Result>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<Settings>(defaults);
  const [showSettings, setShowSettings] = useState(true);
  const [showUnconfirmed, setShowUnconfirmed] = useState(true);

  const visibleDetections = useMemo(() => result?.detections.filter((d) => showUnconfirmed || d.confirmed) ?? [], [result, showUnconfirmed]);

  function chooseFile(next?: File) {
    setFile(next); setResult(undefined); setError(undefined);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(next ? URL.createObjectURL(next) : undefined);
  }

  async function submit() {
    if (!file) return;
    setLoading(true); setError(undefined); setResult(undefined);
    try {
      const data = new FormData(); data.append("image", file);
      data.append("confidence", String(settings.confidence)); data.append("iou", String(settings.iou));
      data.append("imgsz", String(settings.imgsz)); data.append("maxDetections", String(settings.maxDetections));
      if (settings.cameraId.trim()) data.append("cameraId", settings.cameraId.trim());
      data.append("confirmationFrames", String(settings.confirmationFrames));
      const response = await fetch("/api/detections/image", { method: "POST", body: data });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Detection failed"); setResult(body);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Detection failed"); }
    finally { setLoading(false); }
  }

  function update<K extends keyof Settings>(key: K, value: Settings[K]) { setSettings((current) => ({ ...current, [key]: value })); }

  return <main className="app-shell">
    <header className="hero"><div><p className="eyebrow">LITTERSPOT / PLAYGROUND</p><h1>Bin overflow intelligence</h1><p className="lede">Tune the detector, inspect its evidence, and understand how confidence changes what reaches the application.</p></div><div className="hero-actions"><button className="quiet nav-button" onClick={() => { location.hash = "/"; }}>← Dashboard</button><span className="live-pill"><i /> MODEL ONLINE</span></div></header>
    <div className="workspace">
      <section className="card upload-card"><div className="card-heading"><div><span className="step">01</span><h2>Choose a frame</h2></div><span className="muted">JPEG · PNG · WebP / 10 MB</span></div>
        <label className="dropzone">{preview ? <img src={preview} alt="Selected CCTV frame" /> : <><span className="upload-icon">↑</span><strong>Drop a CCTV frame here</strong><span>or click to browse your local files</span></>}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => chooseFile(e.target.files?.[0])} /></label>
        <div className="action-row"><button className="primary" disabled={!file || loading} onClick={submit}>{loading ? <><span className="spinner" /> Running inference…</> : "Detect bins"}</button>{file && <button className="quiet" onClick={() => chooseFile()}>Clear frame</button>}</div>
        {error && <p role="alert" className="error">{error}</p>}
      </section>

      <aside className="card settings-card"><div className="card-heading"><div><span className="step">02</span><h2>Inference controls</h2></div><button className="icon-button" onClick={() => setShowSettings((value) => !value)}>{showSettings ? "−" : "+"}</button></div>{showSettings && <>
        <label className="control"><span>Confidence threshold <b>{settings.confidence.toFixed(2)}</b></span><input type="range" min="0.05" max="0.95" step="0.05" value={settings.confidence} onChange={(e) => update("confidence", Number(e.target.value))} /><small>Raise to reduce weak detections; lower to reveal possible misses.</small></label>
        <label className="control"><span>IoU threshold <b>{settings.iou.toFixed(2)}</b></span><input type="range" min="0.10" max="0.95" step="0.05" value={settings.iou} onChange={(e) => update("iou", Number(e.target.value))} /><small>Controls how overlapping boxes are suppressed.</small></label>
        <label className="control"><span>Inference image size <b>{settings.imgsz}px</b></span><select value={settings.imgsz} onChange={(e) => update("imgsz", Number(e.target.value))}><option value="640">640 — faster</option><option value="768">768 — balanced</option><option value="960">960 — small-bin detail</option><option value="1280">1280 — slowest</option></select></label>
        <label className="control"><span>Maximum detections <b>{settings.maxDetections}</b></span><input type="number" min="1" max="300" value={settings.maxDetections} onChange={(e) => update("maxDetections", Math.max(1, Math.min(300, Number(e.target.value))))} /></label>
        <label className="control"><span>Camera identifier</span><input value={settings.cameraId} maxLength={100} placeholder="Required for confirmation" onChange={(e) => update("cameraId", e.target.value)} /><small>Use the same ID for consecutive frames from one camera.</small></label>
        <label className="control"><span>Overflow confirmation frames <b>{settings.confirmationFrames}</b></span><input type="number" min="1" max="20" value={settings.confirmationFrames} onChange={(e) => update("confirmationFrames", Math.max(1, Math.min(20, Number(e.target.value))))} /><small>An overflow alert is confirmed only after matching this many consecutive frames.</small></label>
        <button className="reset" onClick={() => setSettings(defaults)}>Reset safe defaults</button>
      </>}</aside>
    </div>

    {result && <section className="card results-card"><div className="card-heading"><div><span className="step">03</span><h2>Detection evidence</h2></div><label className="toggle"><input type="checkbox" checked={showUnconfirmed} onChange={(e) => setShowUnconfirmed(e.target.checked)} /> Show unconfirmed</label></div><div className="result-layout"><div className="annotated"><img src={preview} alt="Detection result" />{visibleDetections.map((d, index) => <span key={index} className={`box ${d.className.includes("overflowing") ? "overflow" : d.className.includes("full") ? "full" : "normal"}`} style={{ left: `${d.bbox.x1 / result.image.width * 100}%`, top: `${d.bbox.y1 / result.image.height * 100}%`, width: `${(d.bbox.x2-d.bbox.x1) / result.image.width * 100}%`, height: `${(d.bbox.y2-d.bbox.y1) / result.image.height * 100}%` }}><b>{d.className}</b><em>{Math.round(d.confidence * 100)}%{d.className.includes("overflowing") && ` / ${d.confirmationFrames} frames${d.confirmed ? " confirmed" : ""}`}</em></span>)}</div><div className="result-side"><div className="metric"><small>DETECTIONS</small><strong>{visibleDetections.length}</strong></div><div className="metric"><small>MODEL</small><strong>{result.modelVersion}</strong></div><div className="metric"><small>LATENCY</small><strong>{Math.round(result.processingTimeMs)}<small> ms</small></strong></div><div className="legend"><span className="normal-dot" /> Normal <span className="full-dot" /> Full <span className="overflow-dot" /> Overflowing</div></div></div></section>}
    <footer><span>Private path: React → Node → FastAPI → YOLOE</span><span>Safety guard: GPU 85°C · RAM 92% · disk 10 GB</span></footer>
  </main>;
}
