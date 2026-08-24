import { useState } from "react";
import { apiFetch } from "../services/apiClient";

type BinState = "normal" | "full" | "overflow" | "unknown";
type BoundingBox = { x1: number; y1: number; x2: number; y2: number };
type BinAnalysis = {
  binIndex: number;
  localizerConfidence: number;
  bbox: BoundingBox;
  classificationRegion: BoundingBox;
  state: BinState;
  stableState?: BinState | null;
  stateConfidence: number;
  signals: { binPresence: number; fullness: number; overflow: number };
  confirmed: boolean;
  confirmationFrames: number;
  unknownReasons: string[];
  processingTimeMs: number;
};
type ImageAnalysis = {
  localizerVersion: string;
  stateModelVersion: string;
  decisionPolicy: string;
  image: { width: number; height: number };
  detections: BinAnalysis[];
  reason?: string | null;
  processingTimeMs: number;
};
type BatchResponse = {
  items: Array<{ index: number; fileName: string; result: ImageAnalysis }>;
};
type SelectedImage = { file: File; preview: string };
type Settings = { localizerConfidence: number; maxBins: number };

const defaults: Settings = { localizerConfidence: 0.80, maxBins: 10 };
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export function DetectionTestPage() {
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [results, setResults] = useState<BatchResponse>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<Settings>(defaults);

  function replaceImages(files: File[]) {
    setResults(undefined);
    setError(undefined);
    if (files.length > 10) {
      setError("Select no more than 10 images.");
      return;
    }
    const invalid = files.find((file) => !allowedTypes.has(file.type));
    if (invalid) {
      setError(`${invalid.name}: use JPEG, PNG, or WebP.`);
      return;
    }
    images.forEach(({ preview }) => URL.revokeObjectURL(preview));
    setImages(files.map((file) => ({ file, preview: URL.createObjectURL(file) })));
  }

  function removeImage(index: number) {
    URL.revokeObjectURL(images[index].preview);
    setImages((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setResults(undefined);
  }

  function clearImages() {
    images.forEach(({ preview }) => URL.revokeObjectURL(preview));
    setImages([]);
    setResults(undefined);
    setError(undefined);
  }

  async function submit() {
    if (images.length === 0) return;
    setLoading(true);
    setError(undefined);
    setResults(undefined);
    try {
      const data = new FormData();
      images.forEach(({ file }) => data.append("images", file));
      data.append("localizerConfidence", String(settings.localizerConfidence));
      data.append("maxBins", String(settings.maxBins));
      data.append("confirmationFrames", "1");
      const response = await apiFetch("/api/detections/bin-state/batch", { method: "POST", body: data });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Batch analysis failed");
      setResults(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Batch analysis failed");
    } finally {
      setLoading(false);
    }
  }

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  return <main className="app-shell">
    <header className="hero">
      <div>
        <p className="eyebrow">LITTERSPOT / BATCH BIN ANALYSIS</p>
        <h1>Find and classify every bin.</h1>
        <p className="lede">Import up to 10 full-frame images. The Malaysia-first localizer finds each bin, then the state model evaluates normal, full, overflow, or unknown.</p>
      </div>
      <div className="hero-actions">
        <button className="quiet nav-button" onClick={() => { location.hash = "/"; }}>← Dashboard</button>
        <span className="live-pill"><i /> PIPELINE ONLINE</span>
      </div>
    </header>

    <div className="workspace">
      <section className="card upload-card">
        <div className="card-heading">
          <div><span className="step">01</span><h2>Import images</h2></div>
          <span className="muted">{images.length} / 10 selected</span>
        </div>
        <label className="dropzone batch-dropzone">
          <span className="upload-icon">＋</span>
          <strong>Select multiple images</strong>
          <span>JPEG · PNG · WebP, up to 10 MB each</span>
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => replaceImages(Array.from(event.target.files ?? []))}
          />
        </label>
        {images.length > 0 && <div className="batch-preview-grid">
          {images.map(({ file, preview }, index) => <article className="batch-preview" key={`${file.name}-${file.lastModified}`}>
            <img src={preview} alt={file.name} />
            <div><span title={file.name}>{file.name}</span><button className="icon-button" aria-label={`Remove ${file.name}`} onClick={() => removeImage(index)}>×</button></div>
          </article>)}
        </div>}
        <div className="action-row">
          <button className="primary" disabled={images.length === 0 || loading} onClick={submit}>
            {loading ? <><span className="spinner" /> Analyzing {images.length} image{images.length === 1 ? "" : "s"}…</> : `Analyze ${images.length || ""} image${images.length === 1 ? "" : "s"}`}
          </button>
          {images.length > 0 && <button className="quiet" onClick={clearImages}>Clear all</button>}
        </div>
        {error && <p role="alert" className="error">{error}</p>}
      </section>

      <aside className="card settings-card">
        <div className="card-heading"><div><span className="step">02</span><h2>Detection settings</h2></div></div>
        <p className="card-copy">The batch path supports multiple bins per image. Lower confidence improves recall but can admit garbage bags or furniture as false positives.</p>
        <label className="control">
          <span>Localizer confidence <b>{settings.localizerConfidence.toFixed(2)}</b></span>
          <input type="range" min="0.05" max="0.95" step="0.01" value={settings.localizerConfidence} onChange={(event) => update("localizerConfidence", Number(event.target.value))} />
          <small>0.80 detects the unobstructed black-bin test while excluding its adjacent bag candidate.</small>
        </label>
        <label className="control">
          <span>Maximum bins per image <b>{settings.maxBins}</b></span>
          <input type="number" min="1" max="20" value={settings.maxBins} onChange={(event) => update("maxBins", Math.max(1, Math.min(20, Number(event.target.value))))} />
        </label>
        <button className="reset" onClick={() => setSettings(defaults)}>Reset defaults</button>
      </aside>
    </div>

    {results && <section className="batch-results">
      <div className="section-heading"><span className="step">03</span><h2>Batch results</h2><span className="muted">{results.items.reduce((count, item) => count + item.result.detections.length, 0)} bins across {results.items.length} images</span></div>
      {results.items.map((item) => {
        const selected = images[item.index];
        return <article className="card batch-result-card" key={`${item.index}-${item.fileName}`}>
          <div className="card-heading">
            <div><span className="result-index">{String(item.index + 1).padStart(2, "0")}</span><h2 title={item.fileName}>{item.fileName}</h2></div>
            <span className="muted">{item.result.detections.length} bin{item.result.detections.length === 1 ? "" : "s"} · {Math.round(item.result.processingTimeMs)} ms</span>
          </div>
          <div className="batch-result-layout">
            <div className="annotated">
              {selected && <img src={selected.preview} alt={`Analyzed ${item.fileName}`} />}
              {item.result.detections.map((detection) => <span
                className={`box ${detection.state}`}
                key={detection.binIndex}
                style={{
                  left: `${detection.bbox.x1 / item.result.image.width * 100}%`,
                  top: `${detection.bbox.y1 / item.result.image.height * 100}%`,
                  width: `${(detection.bbox.x2 - detection.bbox.x1) / item.result.image.width * 100}%`,
                  height: `${(detection.bbox.y2 - detection.bbox.y1) / item.result.image.height * 100}%`,
                }}
              ><b>#{detection.binIndex} {detection.state}</b><em>{Math.round(detection.localizerConfidence * 100)}%</em></span>)}
              {item.result.detections.length === 0 && <div className="no-detection">No bin localized at {settings.localizerConfidence.toFixed(2)}</div>}
            </div>
            <div className="detection-list">
              {item.result.detections.map((detection) => <div className={`detection-summary ${detection.state}`} key={detection.binIndex}>
                <div><strong>Bin {detection.binIndex}</strong><span className={`state-badge ${detection.state}`}>{detection.state}</span></div>
                <dl>
                  <div><dt>Localization</dt><dd>{Math.round(detection.localizerConfidence * 100)}%</dd></div>
                  <div><dt>Presence</dt><dd>{Math.round(detection.signals.binPresence * 100)}%</dd></div>
                  <div><dt>Fullness</dt><dd>{Math.round(detection.signals.fullness * 100)}%</dd></div>
                  <div><dt>Overflow</dt><dd>{Math.round(detection.signals.overflow * 100)}%</dd></div>
                </dl>
                {detection.unknownReasons.length > 0 && <small>{detection.unknownReasons.join(", ")}</small>}
              </div>)}
              {item.result.detections.length === 0 && <div className="empty-result"><strong>Bin not localized</strong><span>Try a lower confidence or add this image to the local training set.</span></div>}
            </div>
          </div>
        </article>;
      })}
    </section>}

    <footer><span>React → Node batch gateway → FastAPI → YOLO + MobileNetV3</span><span>Maximum 10 images · multiple bins supported</span></footer>
  </main>;
}
