import { useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from "react";
import { apiFetch } from "../../../services/apiClient";
import {
  getCameraRegistrationWorkspace,
  previewCameraRegistration,
  publishCameraRegistration,
  saveCameraRegistrationDraft,
  uploadCameraRegistrationReference,
  uploadCameraRegistrationVideoSource,
  validateCameraRegistration,
  type CameraRecord,
  type CameraRegistrationBin,
  type CameraRegistrationDraft,
  type CameraRegistrationPreview,
  type CameraRegistrationPreviewTemporalState,
  type CameraRegistrationWorkspace,
} from "../../../services/locationAPI";
import { createVideoMetadataUpdate } from "./videoReferenceState";
import { restorableVideoSource } from "./referenceSourcePersistence";
import {
  buildVideoValidationSamples,
  canPlayValidationFrame,
  displayedVideoBinState,
  runSequentialVideoValidation,
  sampleForPlaybackTime,
  VIDEO_PLAYBACK_DELAY_MS,
  type VideoValidationSample,
} from "./videoValidation";

type Point = { x: number; y: number };
type Polygon = Point[];
type StepId = "reference" | "floor" | "bins" | "review";

type ReferencePreview = {
  objectUrl: string;
  fileName: string;
  width: number;
  height: number;
  capturedAt: string | null;
};

type VideoReferenceSource = {
  objectUrl: string;
  file: File;
  mediaId?: string;
  fileName: string;
  duration: number | null;
  ready: boolean;
  capturedFrameTime: number | null;
};

type VideoValidationFrame = VideoValidationSample & {
  phase: "queued" | "running" | "complete" | "failed";
  preview?: CameraRegistrationPreview;
  error?: string;
};

type VideoValidationSession = {
  objectUrl: string;
  fileName: string;
  duration: number;
  playbackStartsAt: number;
  frames: VideoValidationFrame[];
};

type EditorDraft = CameraRegistrationDraft & {
  reference: ReferencePreview | null;
};

type Props = {
  camera: CameraRecord;
  onClose: () => void;
  onPublished?: (registrationRevision: number) => void;
};

type StructuralValidation = Awaited<ReturnType<typeof validateCameraRegistration>>;

type ValidationState = {
  phase: "running" | "failed" | "complete";
  structural?: StructuralValidation;
  preview?: CameraRegistrationPreview;
  error?: string;
};

const STEPS: Array<{ id: StepId; number: string; label: string; description: string }> = [
  { id: "reference", number: "01", label: "Reference frame", description: "Choose the clean view used as the camera baseline." },
  { id: "floor", number: "02", label: "Walkable floor", description: "Mark the floor the detector is allowed to inspect." },
  { id: "bins", number: "03", label: "Physical bins", description: "Optional: outline bins only when this view contains them." },
  { id: "review", number: "04", label: "Review", description: "Run the complete pipeline before publishing." },
];

const DEFAULT_QUALITY = {
  minAlignmentScore: 0.82,
  minRimVisibility: 0.75,
  maxFrameAgeSeconds: 300,
};

function emptyDraft(): EditorDraft {
  return {
    schemaVersion: 2,
    referenceMediaId: "",
    referenceSource: { type: "image" },
    sourceWidth: 0,
    sourceHeight: 0,
    walkableFloorPolygon: [],
    bins: [],
    quality: DEFAULT_QUALITY,
    reference: null,
  };
}

function validPolygon(points: Polygon | null | undefined) {
  if (!points || points.length < 3) return false;
  const area = Math.abs(points.reduce((sum, current, index) => {
    const next = points[(index + 1) % points.length];
    return sum + current.x * next.y - next.x * current.y;
  }, 0) / 2);
  return area > 0.00001;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function apiDraft(draft: EditorDraft): CameraRegistrationDraft {
  if (!draft.reference || !draft.referenceMediaId.trim()) {
    throw new Error("Upload a reference frame before continuing.");
  }
  return {
    schemaVersion: 2,
    referenceMediaId: draft.referenceMediaId.trim(),
    referenceSource: draft.referenceSource,
    sourceWidth: draft.sourceWidth || draft.reference.width,
    sourceHeight: draft.sourceHeight || draft.reference.height,
    walkableFloorPolygon: draft.walkableFloorPolygon,
    bins: draft.bins,
    quality: draft.quality,
  };
}

function draftFingerprint(draft: EditorDraft) {
  try {
    return JSON.stringify(apiDraft(draft));
  } catch {
    return "";
  }
}

function boxStyle(box: { x1: number; y1: number; x2: number; y2: number }, image: { width: number; height: number }) {
  const left = Math.max(0, Math.min(100, box.x1 / image.width * 100));
  const top = Math.max(0, Math.min(100, box.y1 / image.height * 100));
  const right = Math.max(left, Math.min(100, box.x2 / image.width * 100));
  const bottom = Math.max(top, Math.min(100, box.y2 / image.height * 100));
  return { left: `${left}%`, top: `${top}%`, width: `${right - left}%`, height: `${bottom - top}%` };
}

function polygonPoints(points: Polygon) {
  return points.map((item) => `${item.x * 100},${item.y * 100}`).join(" ");
}

function formatVideoTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00.0";
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remaining.toFixed(1).padStart(4, "0")}`;
}

function videoAbortError() {
  return new DOMException("Video validation was cancelled.", "AbortError");
}

function waitForVideoEvent(video: HTMLVideoElement, eventName: "loadeddata" | "seeked", signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(videoAbortError());
      return;
    }
    const cleanup = () => {
      video.removeEventListener(eventName, onReady);
      video.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const onReady = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("The selected video could not be decoded for validation.")); };
    const onAbort = () => { cleanup(); reject(videoAbortError()); };
    video.addEventListener(eventName, onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function prepareVideoExtractor(objectUrl: string, signal: AbortSignal) {
  if (signal.aborted) throw videoAbortError();
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = objectUrl;
  video.load();
  if (video.readyState < 2) await waitForVideoEvent(video, "loadeddata", signal);
  return video;
}

async function extractValidationFrame(video: HTMLVideoElement, sample: VideoValidationSample, fileName: string, signal: AbortSignal) {
  if (signal.aborted) throw videoAbortError();
  if (Math.abs(video.currentTime - sample.timestamp) > 0.01) {
    const seeked = waitForVideoEvent(video, "seeked", signal);
    video.currentTime = sample.timestamp;
    await seeked;
  }
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  if (!context || !canvas.width || !canvas.height) throw new Error("The browser could not prepare a video frame for validation.");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (value) => value ? resolve(value) : reject(new Error("The video frame could not be encoded for validation.")),
    "image/jpeg",
    0.88,
  ));
  const stem = fileName.replace(/\.[^.]+$/, "") || "camera-video";
  return new File([blob], `${stem}-validation-${sample.second}s.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}

function RegistrationCanvas({
  draft,
  pending,
  mode,
  onClick,
}: {
  draft: EditorDraft;
  pending: Point[];
  mode: "floor" | "bin";
  onClick: (event: MouseEvent<HTMLDivElement>) => void;
}) {
  if (!draft.reference) {
    return <div className="registration-canvas-v2 registration-canvas-empty"><span>REFERENCE FRAME REQUIRED</span><small>Upload an image or capture a video frame in step 01 to start plotting.</small></div>;
  }
  const dimensions = draft.sourceWidth && draft.sourceHeight
    ? `${draft.sourceWidth} / ${draft.sourceHeight}`
    : `${draft.reference.width} / ${draft.reference.height}`;
  return <div className="registration-canvas-v2" style={{ aspectRatio: dimensions }} onClick={onClick} role="application" aria-label={`Registration canvas for ${mode === "floor" ? "walkable floor" : "physical bin"}`}>
    <img src={draft.reference.objectUrl} alt="Camera reference frame" />
    <svg className="registration-geometry-v2" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {validPolygon(draft.walkableFloorPolygon) && <polygon className="geometry-floor-v2" points={polygonPoints(draft.walkableFloorPolygon)} />}
      {draft.bins.map((bin) => validPolygon(bin.binPolygon) && <g key={bin.binId}>
        <polygon className="geometry-bin-v2" points={polygonPoints(bin.binPolygon)} />
        <text className="geometry-label-v2" x={bin.binPolygon[0].x * 100} y={Math.max(3, bin.binPolygon[0].y * 100 - 1)}>{bin.binId}</text>
      </g>)}
      {pending.length > 0 && <polyline className={`geometry-pending-v2 ${mode}`} points={polygonPoints(pending)} />}
      {pending.map((item, index) => <circle className={`geometry-pending-point-v2 ${mode}`} cx={item.x * 100} cy={item.y * 100} r="0.9" key={`${item.x}-${item.y}-${index}`} />)}
    </svg>
    <div className="registration-canvas-legend-v2" aria-label="Plot legend"><span className="floor"><i />Walkable floor</span><span className="bin"><i />Physical bin</span></div>
    <span className="registration-canvas-hint-v2">{mode === "floor" ? "Click around the walkable floor, then finish the polygon." : "Click around the complete bin and lid, then finish the polygon."}</span>
  </div>;
}

function StepNavigation({ current, draft, referenceReady, onChange }: { current: StepId; draft: EditorDraft; referenceReady: boolean; onChange: (step: StepId) => void }) {
  const floorReady = validPolygon(draft.walkableFloorPolygon);
  const binsReady = draft.bins.every((bin) => validPolygon(bin.binPolygon));
  const ready: Record<StepId, boolean> = { reference: referenceReady, floor: referenceReady && floorReady, bins: referenceReady && floorReady && binsReady, review: referenceReady && floorReady && binsReady };
  return <nav className="registration-step-nav-v2" aria-label="Registration steps">
    {STEPS.map((step) => <button key={step.id} type="button" className={`${current === step.id ? "current" : ""} ${ready[step.id] ? "complete" : ""}`} onClick={() => onChange(step.id)} aria-current={current === step.id ? "step" : undefined}>
      <span>{step.number}</span><strong>{step.label}</strong><small>{ready[step.id] ? "Complete" : step.description}</small>
    </button>)}
  </nav>;
}

function ValidationModal({
  draft,
  state,
  videoSession,
  busy,
  onClose,
  onRerun,
}: {
  draft: EditorDraft;
  state: ValidationState;
  videoSession?: VideoValidationSession;
  busy: boolean;
  onClose: () => void;
  onRerun: () => void;
}) {
  const playbackVideo = useRef<HTMLVideoElement | null>(null);
  const [videoTime, setVideoTime] = useState(0);
  const [playbackReleased, setPlaybackReleased] = useState(false);
  const [waitingForResult, setWaitingForResult] = useState(Boolean(videoSession));
  const activeFrame = videoSession ? sampleForPlaybackTime(videoSession.frames, videoTime) : undefined;
  const preview = videoSession ? activeFrame?.preview : state.preview;
  const flags = preview ? preview.bins.filter((bin) => {
    const state = videoSession ? displayedVideoBinState(bin) : bin.state;
    return state === "overflow" || state === "full";
  }).length + preview.floorHazards.length : 0;
  const completedFrames = videoSession?.frames.filter((frame) => frame.phase === "complete").length ?? 0;

  useEffect(() => {
    setVideoTime(0);
    setPlaybackReleased(false);
    setWaitingForResult(Boolean(videoSession));
    if (!videoSession) return;
    const delay = Math.max(0, videoSession.playbackStartsAt - Date.now());
    const timer = window.setTimeout(() => setPlaybackReleased(true), delay);
    return () => window.clearTimeout(timer);
  }, [videoSession?.objectUrl, videoSession?.playbackStartsAt]);

  useEffect(() => {
    if (!videoSession || !playbackReleased) return;
    const video = playbackVideo.current;
    if (!video) return;
    if (canPlayValidationFrame(playbackReleased, activeFrame?.phase)) {
      if (waitingForResult && video.paused && !video.ended) void video.play().catch(() => undefined);
      setWaitingForResult(false);
      return;
    }
    if (!video.paused) video.pause();
    setWaitingForResult(true);
  }, [activeFrame?.phase, activeFrame?.second, playbackReleased, videoSession?.objectUrl, waitingForResult]);

  const resultFrame = preview?.image ?? { width: draft.sourceWidth, height: draft.sourceHeight };
  return <div className="registration-modal-backdrop-v2" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="registration-modal-v2" role="dialog" aria-modal="true" aria-labelledby="registration-validation-title">
      <header><div><span className="eyebrow">VALIDATION PREVIEW</span><h2 id="registration-validation-title">Complete detection result</h2><p>Read-only benchmark for the current unsaved plots. Publishing is still a separate action.</p></div><button className="registration-modal-close" type="button" onClick={onClose} aria-label="Close validation preview">×</button></header>
      {state.phase === "running" && !videoSession && <div className="registration-validation-loading"><span className="registration-spinner" />Running bin, people, litter, and spill detection…</div>}
      {state.phase === "failed" && <div className="registration-validation-error" role="alert"><strong>Validation could not complete.</strong><p>{state.error ?? state.structural?.errors.map((item) => item.message).join(" ") ?? "Fix the registration geometry and try again."}</p>{state.structural?.checks.map((check) => <span className={check.passed ? "pass" : "fail"} key={check.code}>{check.passed ? "✓" : "!"} {check.message}</span>)}</div>}
      {videoSession && draft.reference && <>
        <div className="registration-result-frame-v2 registration-result-video-v2" style={{ aspectRatio: `${resultFrame.width} / ${resultFrame.height}` }}>
          <video ref={playbackVideo} src={videoSession.objectUrl} muted controls playsInline preload="auto" onPlay={(event) => { if (!canPlayValidationFrame(playbackReleased, activeFrame?.phase)) { event.currentTarget.pause(); setWaitingForResult(true); } }} onTimeUpdate={(event) => setVideoTime(event.currentTarget.currentTime)} onSeeked={(event) => setVideoTime(event.currentTarget.currentTime)} />
          {preview?.bins.map((bin) => { const state = displayedVideoBinState(bin); return <span className={`registration-result-box-v2 bin ${state}`} style={boxStyle(bin.bbox, preview.image)} key={`${activeFrame?.second ?? 0}-${bin.binId ?? "bin"}-${bin.binIndex}`}><i>{`Bin · ${state}`}</i></span>; })}
          {preview?.people.map((person, index) => <span className="registration-result-box-v2 person" style={boxStyle(person.bbox, preview.image)} key={`${activeFrame?.second ?? 0}-person-${index}`}><i>People</i></span>)}
          {preview?.floorHazards.map((hazard, index) => <span className={`registration-result-box-v2 ${hazard.className}`} style={boxStyle(hazard.bbox, preview.image)} key={`${activeFrame?.second ?? 0}-${hazard.className}-${index}`}><i>{hazard.className === "floor_spill" ? "spill" : "litter"}</i></span>)}
          <span className={`registration-video-sync-v2 ${activeFrame?.phase ?? "queued"}`}>{!playbackReleased ? "Buffering 2-second delay" : activeFrame?.phase === "complete" ? `Synced · second ${activeFrame.second}` : activeFrame?.phase === "failed" ? `Second ${activeFrame.second} failed` : `Analyzing second ${activeFrame?.second ?? 0}`}</span>
        </div>
        <div className="registration-video-progress-v2"><span><b>{completedFrames}/{videoSession.frames.length}</b> seconds analyzed</span><span><b>{formatVideoTime(videoTime)}</b> displayed frame</span><span><b>2.0 s</b> minimum playback delay</span></div>
      </>}
      {!videoSession && preview && draft.reference && <>
        <div className="registration-result-frame-v2" style={{ aspectRatio: `${preview.image.width} / ${preview.image.height}` }}>
          <img src={draft.reference.objectUrl} alt="Validation frame with detection results" />
          {preview.bins.map((bin) => <span className={`registration-result-box-v2 bin ${bin.state}`} style={boxStyle(bin.bbox, preview.image)} key={`${bin.binId ?? "bin"}-${bin.binIndex}`}><i>{`Bin · ${bin.state}`}</i></span>)}
          {preview.people.map((person, index) => <span className="registration-result-box-v2 person" style={boxStyle(person.bbox, preview.image)} key={`person-${index}`}><i>People</i></span>)}
          {preview.floorHazards.map((hazard, index) => <span className={`registration-result-box-v2 ${hazard.className}`} style={boxStyle(hazard.bbox, preview.image)} key={`${hazard.className}-${index}`}><i>{hazard.className === "floor_spill" ? "spill" : "litter"}</i></span>)}
        </div>
      </>}
      {preview && <>
        <div className="registration-result-metrics-v2"><span><b>{flags}</b> flagged areas</span><span><b>{preview.peopleCount}</b> people</span><span><b>{preview.bins.length}</b> bins</span><span><b>{preview.floorHazards.length}</b> floor hazards</span><span><b>{Math.round(preview.processingTimeMs)} ms</b> latency</span></div>
      </>}
      <footer><span>{state.phase === "complete" ? "If a box is wrong, close this preview and adjust the relevant plot." : "The model never publishes or creates an alert from this preview."}</span><div><button type="button" className="outline-button" onClick={onClose}>Close and edit</button><button type="button" className="primary" disabled={busy} onClick={onRerun}>{busy ? "Running…" : "Run again"}</button></div></footer>
    </section>
  </div>;
}

export function CameraRegistrationPrototype({ camera, onClose, onPublished }: Props) {
  const [draft, setDraft] = useState<EditorDraft>(emptyDraft);
  const [workspace, setWorkspace] = useState<CameraRegistrationWorkspace>();
  const [currentStep, setCurrentStep] = useState<StepId>("reference");
  const [pending, setPending] = useState<Point[]>([]);
  const [selectedBinId, setSelectedBinId] = useState("");
  const [referenceFile, setReferenceFile] = useState<File>();
  const [videoSource, setVideoSource] = useState<VideoReferenceSource>();
  const [videoTime, setVideoTime] = useState(0);
  const [capturingVideo, setCapturingVideo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState("Start with the reference frame. Existing saved geometry will appear here automatically.");
  const [validation, setValidation] = useState<ValidationState>();
  const [videoValidation, setVideoValidation] = useState<VideoValidationSession>();
  const [validationOpen, setValidationOpen] = useState(false);
  const [validatedFingerprint, setValidatedFingerprint] = useState("");
  const [publishedRevision, setPublishedRevision] = useState(camera.registrationRevision);
  const objectUrl = useRef<string | undefined>(undefined);
  const videoObjectUrl = useRef<string | undefined>(undefined);
  const videoElement = useRef<HTMLVideoElement | null>(null);
  const validationAbortController = useRef<AbortController | undefined>(undefined);

  const videoFramePending = Boolean(videoSource && videoSource.capturedFrameTime == null);
  const referenceReady = Boolean(draft.reference && draft.referenceMediaId && draft.sourceWidth && draft.sourceHeight && !videoFramePending);
  const floorReady = validPolygon(draft.walkableFloorPolygon);
  const binsReady = draft.bins.every((bin) => validPolygon(bin.binPolygon));
  const draftReady = referenceReady && floorReady && binsReady;
  const currentFingerprint = draftFingerprint(draft);
  const publishReady = draftReady && Boolean(validation?.preview) && validatedFingerprint === currentFingerprint;
  const mode = currentStep === "floor" ? "floor" : "bin";

  function replaceObjectUrl(next: string) {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = next;
  }

  function replaceVideoObjectUrl(next?: string) {
    if (videoObjectUrl.current) URL.revokeObjectURL(videoObjectUrl.current);
    videoObjectUrl.current = next;
  }

  useEffect(() => () => {
    validationAbortController.current?.abort();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    if (videoObjectUrl.current) URL.revokeObjectURL(videoObjectUrl.current);
  }, []);

  useEffect(() => {
    let active = true;
    validationAbortController.current?.abort();
    setLoading(true);
    setError(undefined);
    setVideoValidation(undefined);
    replaceVideoObjectUrl();
    setVideoSource(undefined);
    setVideoTime(0);
    void getCameraRegistrationWorkspace(camera.id).then(async (nextWorkspace) => {
      if (!active) return;
      setWorkspace(nextWorkspace);
      setPublishedRevision(nextWorkspace.publishedRevision);
      if (!nextWorkspace.registration) {
        setNote("No registration exists yet. Upload an image or choose a frame from a video to create the first revision.");
        return;
      }
      const registration = nextWorkspace.registration;
      let reference: ReferencePreview | null = null;
      let referenceUnavailable = Boolean(nextWorkspace.registration && (!nextWorkspace.reference || !nextWorkspace.reference.available));
      let videoUnavailable = false;
      if (nextWorkspace.reference?.available) {
        try {
          const response = await apiFetch(nextWorkspace.reference.contentUrl);
          if (!response.ok) throw new Error("reference-unavailable");
          const blob = await response.blob();
          const nextUrl = URL.createObjectURL(blob);
          replaceObjectUrl(nextUrl);
          reference = {
            objectUrl: nextUrl,
            fileName: nextWorkspace.reference.originalFileName,
            width: registration.sourceWidth,
            height: registration.sourceHeight,
            capturedAt: nextWorkspace.draftUpdatedAt,
          };
          setReferenceFile(new File([blob], nextWorkspace.reference.originalFileName, { type: blob.type || nextWorkspace.reference.mimeType }));
        } catch {
          referenceUnavailable = true;
        }
      }
      const persistedVideo = restorableVideoSource(nextWorkspace);
      if (registration.referenceSource.type === "video") {
        if (!persistedVideo) {
          videoUnavailable = true;
        } else {
          try {
            const response = await apiFetch(persistedVideo.contentUrl);
            if (!response.ok) throw new Error("video-unavailable");
            const blob = await response.blob();
            const nextVideoUrl = URL.createObjectURL(blob);
            replaceVideoObjectUrl(nextVideoUrl);
            setVideoSource({
              objectUrl: nextVideoUrl,
              file: new File([blob], persistedVideo.fileName, { type: blob.type || persistedVideo.mimeType }),
              mediaId: persistedVideo.mediaId,
              fileName: persistedVideo.fileName,
              duration: persistedVideo.duration,
              ready: false,
              capturedFrameTime: persistedVideo.capturedFrameTime,
            });
            setVideoTime(persistedVideo.capturedFrameTime);
          } catch {
            videoUnavailable = true;
          }
        }
      }
      setDraft({ ...registration, quality: registration.quality ?? DEFAULT_QUALITY, reference });
      setSelectedBinId(registration.bins[0]?.binId ?? "");
      setCurrentStep(reference ? "review" : "reference");
      setNote(referenceUnavailable
        ? "Saved geometry loaded, but its reference frame is unavailable. Upload a replacement before validating."
        : videoUnavailable
          ? "The saved reference frame loaded, but its original video is unavailable. Upload the video again to restore continuous validation."
        : persistedVideo
          ? "Saved video registration restored. You can replay continuous validation or adjust the plotted regions."
        : nextWorkspace.source === "draft"
        ? "Saved draft restored. Review the geometry, validate it, then publish when the benchmark looks correct."
        : reference
          ? `Published revision ${nextWorkspace.publishedRevision} loaded. Adjust a plot if the camera view has changed.`
          : "The saved geometry has no readable reference frame. Upload a replacement before validating.");
    }).catch((reason) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : "Registration data could not be loaded.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [camera.id]);

  function mutateDraft(updater: (current: EditorDraft) => EditorDraft) {
    validationAbortController.current?.abort();
    setDraft((current) => updater(current));
    setValidation(undefined);
    setVideoValidation(undefined);
    setValidatedFingerprint("");
  }

  function navigateStep(step: StepId) {
    if (step !== "reference" && !referenceReady) {
      setNote("Upload an image or capture and store a video frame before plotting regions.");
      setCurrentStep("reference");
      return;
    }
    if ((step === "bins" || step === "review") && !floorReady) {
      setNote("Finish the walkable-floor polygon before moving to physical bins.");
      setCurrentStep("floor");
      return;
    }
    if (step === "review" && !binsReady) {
      setNote("Finish or remove each incomplete bin plot before reviewing the complete pipeline result.");
      setCurrentStep("bins");
      return;
    }
    setPending([]);
    setCurrentStep(step);
  }

  async function storeReferenceImage(
    file: File,
    dimensions: { width: number; height: number },
    nextUrl = URL.createObjectURL(file),
    referenceSource: CameraRegistrationDraft["referenceSource"] = { type: "image" },
  ) {
    replaceObjectUrl(nextUrl);
    setReferenceFile(file);
    mutateDraft((current) => ({
      ...current,
      referenceMediaId: "",
      referenceSource,
      sourceWidth: dimensions.width,
      sourceHeight: dimensions.height,
      reference: { objectUrl: nextUrl, fileName: file.name, width: dimensions.width, height: dimensions.height, capturedAt: new Date().toISOString() },
    }));
    setNote(`Uploading ${file.name} as the clean reference frame…`);
    try {
      const media = await uploadCameraRegistrationReference(camera.id, file);
      setDraft((current) => ({ ...current, referenceMediaId: media.id }));
      setNote("Reference stored. Continue to the walkable-floor step.");
      return true;
    } catch (reason) {
      setNote(reason instanceof Error ? reason.message : "The reference frame could not be stored.");
      return false;
    }
  }

  async function setReferenceSource(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const lowerName = file.name.toLowerCase();
    const isVideo = file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/.test(lowerName);
    const isImage = file.type.startsWith("image/") || /\.(jpe?g|png|webp)$/.test(lowerName);
    if (isVideo) {
      const nextUrl = URL.createObjectURL(file);
      replaceVideoObjectUrl(nextUrl);
      setVideoSource({ objectUrl: nextUrl, file, fileName: file.name, duration: null, ready: false, capturedFrameTime: null });
      setVideoTime(0);
      validationAbortController.current?.abort();
      setValidation(undefined);
      setVideoValidation(undefined);
      setValidatedFingerprint("");
      setNote("Play or seek the video, pause on a clean view, then choose Use current frame.");
      return;
    }
    if (!isImage) {
      setNote("Choose a JPEG, PNG, WebP, MP4, MOV, or WebM file.");
      return;
    }
    replaceVideoObjectUrl();
    setVideoSource(undefined);
    setVideoTime(0);
    setVideoValidation(undefined);
    const nextUrl = URL.createObjectURL(file);
    const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error("The reference image could not be read."));
      image.src = nextUrl;
    }).catch(() => undefined);
    if (!dimensions) {
      URL.revokeObjectURL(nextUrl);
      setNote("The reference image could not be read. Choose another file.");
      return;
    }
    await storeReferenceImage(file, dimensions, nextUrl);
  }

  async function captureVideoFrame() {
    const video = videoElement.current;
    if (!videoSource || !video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      setNote("Wait for the video to load, then pause on the frame you want to use.");
      return;
    }
    try {
      setCapturingVideo(true);
      video.pause();
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The browser could not prepare the selected video frame.");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("The selected frame could not be encoded.")), "image/jpeg", 0.92));
      const stem = videoSource.fileName.replace(/\.[^.]+$/, "") || "camera-video";
      const capturedFrameTime = video.currentTime;
      const frameName = `${stem}-frame-${Math.round(capturedFrameTime * 1000)}ms.jpg`;
      const frame = new File([blob], frameName, { type: "image/jpeg", lastModified: Date.now() });
      const sourceMedia = videoSource.mediaId
        ? { id: videoSource.mediaId }
        : await uploadCameraRegistrationVideoSource(camera.id, videoSource.file);
      const referenceSource: CameraRegistrationDraft["referenceSource"] = {
        type: "video",
        mediaId: sourceMedia.id,
        capturedFrameTimeSeconds: capturedFrameTime,
        ...(videoSource.duration != null && videoSource.duration > 0 ? { durationSeconds: videoSource.duration } : {}),
      };
      const stored = await storeReferenceImage(frame, { width: canvas.width, height: canvas.height }, undefined, referenceSource);
      if (stored) {
        setVideoSource((current) => current ? { ...current, mediaId: sourceMedia.id, capturedFrameTime } : current);
        setNote("Video reference frame stored. Validation will analyze one frame per video second with synchronized playback.");
      }
    } catch (reason) {
      setNote(reason instanceof Error ? reason.message : "The selected video frame could not be captured.");
    } finally {
      setCapturingVideo(false);
    }
  }

  function onCanvasClick(event: MouseEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const nextPoint = {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
    if (mode === "bin" && !selectedBinId) {
      const nextNumber = Math.max(0, ...draft.bins.map((bin) => Number(bin.binId.match(/\d+$/)?.[0] ?? 0))) + 1;
      const nextBin: CameraRegistrationBin = { binId: `bin-${nextNumber}`, displayName: `Physical bin ${nextNumber}`, binType: "unknown", binPolygon: [] };
      mutateDraft((current) => ({ ...current, bins: [...current.bins, nextBin] }));
      setSelectedBinId(nextBin.binId);
      setNote(`${nextBin.binId} created. Keep clicking around the complete bin, including the lid.`);
    }
    setPending((current) => [...current, nextPoint]);
  }

  function finishShape() {
    if (pending.length < 3) {
      setNote("A polygon needs at least three points. Add more points before finishing.");
      return;
    }
    if (mode === "floor") {
      mutateDraft((current) => ({ ...current, walkableFloorPolygon: pending }));
      setNote("Walkable floor saved. Continue to physical bins.");
    } else {
      const binId = selectedBinId;
      if (!binId) return;
      mutateDraft((current) => ({ ...current, bins: current.bins.map((bin) => bin.binId === binId ? { ...bin, binPolygon: pending } : bin) }));
      setNote(`${binId} saved. Add another bin or review the complete pipeline result.`);
    }
    setPending([]);
  }

  function undoPoint() {
    setPending((points) => points.length ? points.slice(0, -1) : points);
  }

  function clearCurrentShape() {
    setPending([]);
    if (mode === "floor") mutateDraft((current) => ({ ...current, walkableFloorPolygon: [] }));
    else if (selectedBinId) mutateDraft((current) => ({ ...current, bins: current.bins.map((bin) => bin.binId === selectedBinId ? { ...bin, binPolygon: [] } : bin) }));
    setNote(mode === "floor" ? "Walkable-floor plot cleared." : `${selectedBinId || "Bin"} plot cleared.`);
  }

  function resetGeometry() {
    setPending([]);
    mutateDraft((current) => ({ ...current, walkableFloorPolygon: [], bins: [] }));
    setSelectedBinId("");
    setCurrentStep("floor");
    setNote("Geometry reset. The stored reference frame is unchanged.");
  }

  function addBin() {
    const nextNumber = Math.max(0, ...draft.bins.map((bin) => Number(bin.binId.match(/\d+$/)?.[0] ?? 0))) + 1;
    const nextBin: CameraRegistrationBin = { binId: `bin-${nextNumber}`, displayName: `Physical bin ${nextNumber}`, binType: "unknown", binPolygon: [] };
    mutateDraft((current) => ({ ...current, bins: [...current.bins, nextBin] }));
    setSelectedBinId(nextBin.binId);
    setCurrentStep("bins");
    setNote(`${nextBin.binId} added. Outline the complete physical bin, including its lid.`);
  }

  function removeBin(binId: string) {
    mutateDraft((current) => ({ ...current, bins: current.bins.filter((bin) => bin.binId !== binId) }));
    setSelectedBinId((current) => current === binId ? "" : current);
    setPending([]);
  }

  function updateBin(binId: string, patch: Partial<CameraRegistrationBin>) {
    mutateDraft((current) => ({ ...current, bins: current.bins.map((bin) => bin.binId === binId ? { ...bin, ...patch } : bin) }));
  }

  function updateVideoValidationFrame(second: number, patch: Partial<VideoValidationFrame>) {
    setVideoValidation((current) => current ? {
      ...current,
      frames: current.frames.map((frame) => frame.second === second ? { ...frame, ...patch } : frame),
    } : current);
  }

  function closeValidation() {
    validationAbortController.current?.abort();
    setValidationOpen(false);
    setVideoValidation(undefined);
  }

  async function runValidation() {
    validationAbortController.current?.abort();
    const controller = new AbortController();
    validationAbortController.current = controller;
    setValidationOpen(true);
    setValidation({ phase: "running" });
    setVideoValidation(undefined);
    if (!draftReady) {
      setValidation({ phase: "failed", error: "Complete the reference frame and walkable floor, then finish or remove any optional bin plot before validating." });
      validationAbortController.current = undefined;
      return;
    }
    let extractor: HTMLVideoElement | undefined;
    try {
      setBusy(true);
      const payload = apiDraft(draft);
      const structural = await validateCameraRegistration(camera.id, payload);
      if (controller.signal.aborted) throw videoAbortError();
      if (!structural.ready) {
        setValidation({ phase: "failed", structural, error: structural.errors.map((item) => item.message).join(" ") });
        return;
      }
      await saveCameraRegistrationDraft(camera.id, payload);
      if (controller.signal.aborted) throw videoAbortError();
      if (!referenceFile) throw new Error("The reference image is not available in this session. Upload it again before validating.");
      if (videoSource?.capturedFrameTime != null) {
        const samples = buildVideoValidationSamples(videoSource.duration ?? 0);
        if (!samples.length) throw new Error("The video duration is unavailable. Return to the reference step and load the video again.");
        setVideoValidation({
          objectUrl: videoSource.objectUrl,
          fileName: videoSource.fileName,
          duration: videoSource.duration ?? 0,
          playbackStartsAt: Date.now() + VIDEO_PLAYBACK_DELAY_MS,
          frames: samples.map((sample) => ({ ...sample, phase: "queued" })),
        });
        extractor = await prepareVideoExtractor(videoSource.objectUrl, controller.signal);
        const videoExtractor = extractor;
        let temporalState: CameraRegistrationPreviewTemporalState | undefined;
        const latestPreview = await runSequentialVideoValidation(samples, async (sample) => {
          if (controller.signal.aborted) throw videoAbortError();
          const frame = await extractValidationFrame(videoExtractor, sample, videoSource.fileName, controller.signal);
          const result = await previewCameraRegistration(camera.id, frame, payload, "video", controller.signal, {
            state: temporalState,
            capturedAtMs: Math.round(sample.timestamp * 1_000),
            registrationRevision: workspace?.publishedRevision ?? 0,
          });
          temporalState = result.temporalState;
          return result.preview;
        }, (sample, phase, preview, reason) => {
          const message = reason instanceof Error ? reason.message : reason ? `Second ${sample.second} could not be analyzed.` : undefined;
          if (preview) {
            updateVideoValidationFrame(sample.second, { phase, preview, error: message });
          } else {
            updateVideoValidationFrame(sample.second, { phase, error: message });
          }
        });
        setValidation({ phase: "complete", structural, preview: latestPreview });
      } else {
        const result = await previewCameraRegistration(camera.id, referenceFile, payload, "image", controller.signal);
        setValidation({ phase: "complete", structural, preview: result.preview });
      }
      setValidatedFingerprint(draftFingerprint(draft));
      setNote(videoSource?.capturedFrameTime != null
        ? "Video validation complete. Review the synchronized second-by-second results, then save the registration."
        : "Validation complete. Review every plotted box, then choose Save registration to publish this revision.");
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setValidation({ phase: "failed", error: reason instanceof Error ? reason.message : "The complete detection pipeline could not run." });
      setNote(reason instanceof Error ? reason.message : "The complete detection pipeline could not run.");
    } finally {
      if (extractor) {
        extractor.pause();
        extractor.removeAttribute("src");
        extractor.load();
      }
      if (validationAbortController.current === controller) {
        validationAbortController.current = undefined;
        setBusy(false);
      }
    }
  }

  async function publish() {
    if (!publishReady) {
      setNote("Run Validate after the last geometry change before saving a registration revision.");
      setValidationOpen(true);
      return;
    }
    try {
      setBusy(true);
      const registration = await publishCameraRegistration(camera.id, apiDraft(draft), publishedRevision);
      setPublishedRevision(registration.revision);
      setWorkspace((current) => current ? { ...current, source: "published", publishedRevision: registration.revision, registration } : current);
      setNote(`Registration revision ${registration.revision} published. Runtime detection now uses the enrolled floor and bin geometry.`);
      onPublished?.(registration.revision);
      setValidationOpen(false);
    } catch (reason) {
      setNote(reason instanceof Error ? reason.message : "Registration could not be published.");
    } finally {
      setBusy(false);
    }
  }

  const sourceLabel = workspace?.source === "draft" ? "Saved draft" : workspace?.source === "published" ? `Published revision ${publishedRevision}` : "New registration";
  const selectedBin = useMemo(() => draft.bins.find((bin) => bin.binId === selectedBinId), [draft.bins, selectedBinId]);

  if (loading) return <section className="registration-workspace-v2"><div className="registration-loading-v2"><span className="registration-spinner" />Loading the camera registration workspace…</div></section>;
  return <section className="registration-workspace-v2" aria-label="Camera registration workspace">
    <div className="registration-workspace-topline-v2"><span><i className="status-dot active" />{sourceLabel}</span><button type="button" className="registration-close-v2" onClick={onClose}>Back to cameras</button></div>
    {error && <div className="registration-error-v2" role="alert"><strong>Could not load this camera.</strong><span>{error}</span><button type="button" className="outline-button" onClick={() => window.location.reload()}>Reload</button></div>}
    {!error && <>
      <StepNavigation current={currentStep} draft={draft} referenceReady={referenceReady} onChange={navigateStep} />
      <div className="registration-workspace-body-v2">
        {currentStep === "reference" && <section className="registration-step-panel-v2">
          <div className="registration-step-heading-v2"><div><span className="step">01</span><div><span className="eyebrow">REFERENCE FRAME</span><h2>Set the camera baseline</h2><p>Upload a clean image, or pause a camera video on a representative frame. The saved still frame is used for plotting, while the video remains available for continuous validation.</p></div></div><span className="registration-status-chip-v2">{videoSource ? videoSource.capturedFrameTime == null ? "Select frame" : "Frame stored" : referenceReady ? "Stored" : "Required"}</span></div>
          <div className="registration-reference-layout-v2"><div className={`registration-reference-drop-v2 ${videoSource ? "has-video" : ""}`}>{videoSource ? <div className="registration-reference-video-v2">
            <video ref={videoElement} src={videoSource.objectUrl} controls playsInline preload="metadata" onLoadedMetadata={(event) => setVideoSource(createVideoMetadataUpdate(event))} onLoadedData={(event) => setVideoSource((current) => { if (current?.capturedFrameTime != null) event.currentTarget.currentTime = current.capturedFrameTime; return current ? { ...current, ready: true } : current; })} onTimeUpdate={(event) => setVideoTime(event.currentTarget.currentTime)} onError={() => { setVideoSource((current) => current ? { ...current, ready: false } : current); setNote("This video codec cannot be decoded by the browser. Try an MP4 using H.264 video."); }} />
            <div className="registration-video-frame-controls-v2"><div><strong>{videoSource.fileName}</strong><small>Current frame {formatVideoTime(videoTime)}{videoSource.duration == null ? "" : ` / ${formatVideoTime(videoSource.duration)}`}{videoSource.capturedFrameTime == null ? "" : ` · reference @ ${formatVideoTime(videoSource.capturedFrameTime)}`}</small></div><button type="button" className="primary" disabled={capturingVideo || !videoSource.ready} onClick={() => void captureVideoFrame()}>{capturingVideo ? "Capturing…" : videoSource.ready ? videoSource.capturedFrameTime == null ? "Use current frame" : "Update current frame" : "Loading video…"}</button></div>
          </div> : draft.reference ? <img src={draft.reference.objectUrl} alt="Selected camera reference" /> : <div><span>NO REFERENCE FRAME</span><small>Choose a clean image, or select a video and capture the best frame.</small></div>}<label className="registration-upload-button-v2">{videoSource ? "Choose another file" : draft.reference ? "Replace source" : "Choose image or video"}<input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" onChange={(event) => void setReferenceSource(event)} /></label></div><aside className="registration-info-card-v2"><span className="eyebrow">CAMERA</span><strong>{camera.name}</strong><dl><div><dt>Camera ID</dt><dd>{camera.code}</dd></div><div><dt>Zone</dt><dd>{camera.zoneName}</dd></div><div><dt>Source</dt><dd>{camera.sourceMode}</dd></div><div><dt>Frame</dt><dd>{videoSource ? `Video · ${formatVideoTime(videoTime)}` : draft.reference ? `${draft.sourceWidth} × ${draft.sourceHeight}` : "—"}</dd></div></dl><p>{note}</p></aside></div>
          <div className="registration-step-footer-v2"><span>Images validate once. Videos are sampled once per second and displayed with a two-second result buffer.</span><button type="button" className="primary" disabled={!referenceReady} onClick={() => navigateStep("floor")}>Continue to walkable floor <span>→</span></button></div>
        </section>}
        {currentStep === "floor" && <section className="registration-step-panel-v2"><div className="registration-step-heading-v2"><div><span className="step">02</span><div><span className="eyebrow">WALKABLE FLOOR</span><h2>Plot the inspection floor</h2><p>Only detections inside this polygon can create a litter or spill signal. Keep walls, tables, and displays outside the shape.</p></div></div><span className={`registration-status-chip-v2 ${floorReady ? "ready" : ""}`}>{floorReady ? "Complete" : "Required"}</span></div><div className="registration-editor-layout-v2"><div><RegistrationCanvas draft={draft} pending={pending} mode="floor" onClick={onCanvasClick} /><div className="registration-canvas-actions-v2"><span>{pending.length} points pending</span><button type="button" className="outline-button" onClick={undoPoint} disabled={!pending.length}>Undo point</button><button type="button" className="outline-button" onClick={clearCurrentShape}>{floorReady ? "Redraw floor" : "Clear"}</button><button type="button" className="primary" onClick={finishShape} disabled={pending.length < 3}>Finish floor shape</button></div></div><aside className="registration-side-card-v2"><span className="eyebrow">FLOOR CONTRACT</span><h3>One polygon</h3><p>Make the polygon generous enough to cover the cleaner's reach, but exclude reflective glass and furniture.</p><div className={`registration-check-v2 ${referenceReady ? "pass" : ""}`}><i>{referenceReady ? "✓" : "!"}</i><span>Reference frame</span><small>{referenceReady ? "Ready" : "Missing"}</small></div><div className={`registration-check-v2 ${floorReady ? "pass" : ""}`}><i>{floorReady ? "✓" : "!"}</i><span>Walkable floor</span><small>{floorReady ? `${draft.walkableFloorPolygon.length} points` : "Draw 3+ points"}</small></div></aside></div><div className="registration-step-footer-v2"><button type="button" className="quiet" onClick={() => navigateStep("reference")}>← Reference frame</button><button type="button" className="primary" disabled={!floorReady} onClick={() => navigateStep("bins")}>Continue to physical bins <span>→</span></button></div></section>}
        {currentStep === "bins" && <section className="registration-step-panel-v2">
          <div className="registration-step-heading-v2"><div><span className="step">03</span><div><span className="eyebrow">PHYSICAL BINS · OPTIONAL</span><h2>Outline bins only when present</h2><p>A camera view may contain no bin. Add one whole polygon per visible physical bin; otherwise continue directly to validation.</p></div></div><span className={`registration-status-chip-v2 ${binsReady ? "ready" : ""}`}>{!draft.bins.length ? "No bins · valid" : binsReady ? `${draft.bins.length} complete` : "Finish plots"}</span></div>
          <div className="registration-editor-layout-v2"><div><RegistrationCanvas draft={draft} pending={pending} mode="bin" onClick={onCanvasClick} /><div className="registration-canvas-actions-v2"><span>{pending.length} points pending</span><button type="button" className="outline-button" onClick={undoPoint} disabled={!pending.length}>Undo point</button><button type="button" className="outline-button" onClick={clearCurrentShape} disabled={!selectedBin}>Redraw bin</button><button type="button" className="primary" onClick={finishShape} disabled={pending.length < 3 || !selectedBin}>Finish bin shape</button></div></div><aside className="registration-side-card-v2"><div className="registration-bin-panel-heading"><div><span className="eyebrow">ENROLLED BINS</span><h3>{draft.bins.length ? `${draft.bins.length} bin${draft.bins.length === 1 ? "" : "s"}` : "None in this view"}</h3></div><button type="button" className="quiet" onClick={addBin}>+ Add bin</button></div><p>Only add a bin that is physically visible. Empty enrollment disables bin-state monitoring for this camera while people and floor-hazard detection continue.</p><div className="registration-bin-list-v2">{draft.bins.map((bin) => <div className={`registration-bin-row-v2 ${bin.binId === selectedBinId ? "selected" : ""}`} key={bin.binId}><button type="button" onClick={() => { setSelectedBinId(bin.binId); setPending([]); }}><span>{bin.binId}</span><small>{validPolygon(bin.binPolygon) ? "Plotted" : "Needs plot"}</small></button><input aria-label={`${bin.binId} display name`} value={bin.displayName} onChange={(event) => updateBin(bin.binId, { displayName: event.target.value })} /><select aria-label={`${bin.binId} type`} value={bin.binType} onChange={(event) => updateBin(bin.binId, { binType: event.target.value as CameraRegistrationBin["binType"] })}><option value="unknown">Type unknown</option><option value="open_top">Open top</option><option value="lidded">Lidded</option></select><button type="button" className="registration-bin-remove-v2" onClick={() => removeBin(bin.binId)} aria-label={`Remove ${bin.binId}`}>×</button></div>)}</div>{selectedBin && <div className="registration-selected-bin-v2"><span>Editing</span><strong>{selectedBin.binId}</strong><small>{selectedBin.displayName}</small></div>}</aside></div>
          <div className="registration-step-footer-v2"><button type="button" className="quiet" onClick={() => navigateStep("floor")}>← Walkable floor</button><button type="button" className="primary" disabled={!binsReady} onClick={() => navigateStep("review")}>{draft.bins.length ? "Review and validate" : "Continue without bins"} <span>→</span></button></div>
        </section>}
        {currentStep === "review" && <section className="registration-step-panel-v2">
          <div className="registration-step-heading-v2"><div><span className="step">04</span><div><span className="eyebrow">REVIEW</span><h2>Check the complete pipeline</h2><p>Validation always runs people and floor litter/spill detection. Bin localization and state detection run only for bins enrolled in this view.</p></div></div><span className="registration-status-chip-v2 ready">Ready to validate</span></div>
          <div className="registration-review-grid-v2"><div className="registration-review-frame-v2"><RegistrationCanvas draft={draft} pending={[]} mode="floor" onClick={() => undefined} /><div className="registration-review-legend-v2"><span><i className="floor" />Walkable floor · {draft.walkableFloorPolygon.length} points</span><span><i className="bin" />{draft.bins.length ? `${draft.bins.length} physical bin${draft.bins.length === 1 ? "" : "s"}` : "No physical bins in this view"}</span></div></div><aside className="registration-review-summary-v2"><div className="registration-review-summary-heading"><div><span className="eyebrow">REGISTRATION READINESS</span><h3>{draftReady ? "All required geometry is present" : "Action needed"}</h3></div><b>{draft.bins.length} bins</b></div><div className="registration-check-v2 pass"><i>✓</i><span>Reference frame</span><small>{draft.reference?.fileName ?? "Stored"}</small></div><div className="registration-check-v2 pass"><i>✓</i><span>Walkable floor</span><small>{draft.walkableFloorPolygon.length} points</small></div>{!draft.bins.length && <div className="registration-check-v2 pass"><i>✓</i><span>Physical bins</span><small>Optional · none enrolled</small></div>}{draft.bins.map((bin) => <div className={`registration-check-v2 ${validPolygon(bin.binPolygon) ? "pass" : ""}`} key={bin.binId}><i>{validPolygon(bin.binPolygon) ? "✓" : "!"}</i><span>{bin.binId}</span><small>{validPolygon(bin.binPolygon) ? bin.displayName : "Needs plot"}</small></div>)}<p>{note}</p></aside></div>
          <div className="registration-step-footer-v2"><button type="button" className="quiet" onClick={() => navigateStep("bins")}>← Edit optional bins</button><span>{videoSource?.capturedFrameTime != null ? "Validate samples one frame per second and starts synchronized playback after a two-second buffer." : "Validate opens the result in a modal. Saving publishes only after a successful benchmark."}</span><button type="button" className="primary" disabled={!draftReady || busy} onClick={() => void runValidation()}>{busy ? "Validating…" : videoSource?.capturedFrameTime != null ? "Validate video" : "Validate image"}<span>→</span></button></div>
        </section>}
      </div>
      <div className="registration-action-bar-v2"><div><span className="eyebrow">REGISTRATION ACTIONS</span><strong>{publishReady ? "Validation is current" : "Changes are still a draft"}</strong><small>{note}</small></div><div><button type="button" className="outline-button" onClick={resetGeometry} disabled={busy}>Reset geometry</button><button type="button" className="outline-button" onClick={() => void runValidation()} disabled={!draftReady || busy}>{busy ? "Validating…" : "Validate"}</button><button type="button" className="primary" onClick={() => void publish()} disabled={!publishReady || busy}>{busy ? "Saving…" : "Save registration"}<span>→</span></button></div></div>
    </>}
    {validationOpen && validation && <ValidationModal draft={draft} state={validation} videoSession={videoValidation} busy={busy} onClose={closeValidation} onRerun={() => void runValidation()} />}
  </section>;
}
