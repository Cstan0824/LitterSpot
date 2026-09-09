import type { CameraObservation } from "./cameraMonitoring";

export type DelayedPlaybackState = "buffering" | "playing" | "rebuffering" | "unavailable";

export type DelayedPlaybackSnapshot = {
  state: DelayedPlaybackState;
  video?: HTMLVideoElement;
  recordingStartedAtMs: number;
  delayMs: number | null;
  analysisLeadMs: number | null;
  error?: string;
  width: number;
  height: number;
  bufferedSeconds: number;
  encodedBytes: number;
  queuedBytes: number;
};

type DelayedPlaybackOptions = {
  minimumBufferMs?: number;
  minimumAnalysisLeadMs?: number;
  rebufferLeadMs?: number;
  shortCatchUpMs?: number;
  failureMs?: number;
  maximumWidth?: number;
  maximumHeight?: number;
  frameRate?: number;
  videoBitsPerSecond?: number;
  now?: () => number;
};

export const DETAIL_PLAYBACK_DEFAULTS = {
  minimumBufferMs: 5_000,
  minimumAnalysisLeadMs: 2_000,
  rebufferLeadMs: 750,
  shortCatchUpMs: 2_000,
  failureMs: 30_000,
  maximumWidth: 1_280,
  maximumHeight: 720,
  frameRate: 30,
  videoBitsPerSecond: 4_000_000,
} as const;

export function delayedPlaybackDimensions(sourceWidth: number, sourceHeight: number, maximumWidth = 1_280, maximumHeight = 720) {
  const scale = Math.min(1, maximumWidth / sourceWidth, maximumHeight / sourceHeight);
  return { width: Math.max(1, Math.round(sourceWidth * scale)), height: Math.max(1, Math.round(sourceHeight * scale)) };
}

export function delayedPlaybackMimeType() {
  if (typeof MediaRecorder === "undefined" || typeof MediaSource === "undefined") return null;
  return ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
    .find((candidate) => MediaRecorder.isTypeSupported(candidate) && MediaSource.isTypeSupported(candidate)) ?? null;
}

export function overlayForDelayedPlayback(observations: CameraObservation[], displayedCapturedAtMs: number) {
  const observation = [...observations].reverse().find((item) => item.capturedAtMs <= displayedCapturedAtMs);
  if (!observation) return undefined;
  const age = displayedCapturedAtMs - observation.capturedAtMs;
  if (age > 1_000) return undefined;
  return {
    ...observation,
    people: age <= 350 ? observation.people : [],
    issues: age <= 700 ? observation.issues : [],
    bins: age <= 1_000 ? observation.bins : [],
  };
}

export class DelayedCameraPlayback {
  private readonly options: Required<DelayedPlaybackOptions>;
  private readonly canvas = document.createElement("canvas");
  private readonly video = document.createElement("video");
  private readonly mediaSource = new MediaSource();
  private readonly mediaUrl = URL.createObjectURL(this.mediaSource);
  private readonly mimeType: string;
  private readonly recordingStartedAtMs: number;
  private readonly queuedChunks: Blob[] = [];
  private readonly observations: CameraObservation[] = [];
  private recorder?: MediaRecorder;
  private recordingStream?: MediaStream;
  private sourceBuffer?: SourceBuffer;
  private drawFrame = 0;
  private checkTimer?: ReturnType<typeof setInterval>;
  private appending = false;
  private stopped = false;
  private state: DelayedPlaybackState = "buffering";
  private stateStartedAtMs: number;
  private delayMs: number | null = null;
  private analysisLeadMs: number | null = null;
  private encodedBytes = 0;
  private error?: string;
  private width = 1;
  private height = 1;

  constructor(
    private readonly source: HTMLVideoElement,
    private readonly onChange: (snapshot: DelayedPlaybackSnapshot) => void,
    options: DelayedPlaybackOptions = {},
  ) {
    this.options = { ...DETAIL_PLAYBACK_DEFAULTS, now: Date.now, ...options };
    const mimeType = delayedPlaybackMimeType();
    if (!mimeType) throw new Error("This browser cannot create delayed Camera playback.");
    this.mimeType = mimeType;
    this.recordingStartedAtMs = this.options.now();
    this.stateStartedAtMs = this.recordingStartedAtMs;
    this.video.muted = true;
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.preload = "auto";
    this.video.src = this.mediaUrl;
    this.video.style.cssText = "position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0.001;pointer-events:none";
    this.video.setAttribute("aria-hidden", "true");
    this.video.dataset.delayedCameraPlayback = "true";
    document.body.append(this.video);
  }

  start() {
    if (this.stopped) return;
    const dimensions = delayedPlaybackDimensions(this.source.videoWidth, this.source.videoHeight, this.options.maximumWidth, this.options.maximumHeight);
    this.width = dimensions.width;
    this.height = dimensions.height;
    this.canvas.width = dimensions.width;
    this.canvas.height = dimensions.height;
    const stream = this.canvas.captureStream(this.options.frameRate);
    this.recordingStream = stream;
    this.recorder = new MediaRecorder(stream, { mimeType: this.mimeType, videoBitsPerSecond: this.options.videoBitsPerSecond });
    this.recorder.addEventListener("dataavailable", (event) => {
      if (this.stopped || !event.data.size) return;
      this.encodedBytes += event.data.size;
      this.queuedChunks.push(event.data);
      this.updateTelemetry();
      void this.pump();
    });
    this.recorder.addEventListener("error", () => this.fail("The delayed Camera buffer could not be recorded."));
    const initializeSourceBuffer = () => {
      if (this.stopped || this.sourceBuffer) return;
      try {
        this.sourceBuffer = this.mediaSource.addSourceBuffer(this.mimeType);
        this.sourceBuffer.mode = "sequence";
        this.sourceBuffer.addEventListener("updateend", () => { this.appending = false; this.prune(); void this.pump(); });
        this.sourceBuffer.addEventListener("error", () => this.fail("The delayed Camera buffer could not be decoded."));
        void this.pump();
      } catch {
        this.fail("The delayed Camera buffer could not be initialized.");
      }
    };
    if (this.mediaSource.readyState === "open") initializeSourceBuffer();
    else this.mediaSource.addEventListener("sourceopen", initializeSourceBuffer, { once: true });
    const draw = () => {
      if (!this.stopped && this.source.videoWidth && this.source.readyState >= 2) this.canvas.getContext("2d", { alpha: false })?.drawImage(this.source, 0, 0, this.width, this.height);
      if (!this.stopped) this.drawFrame = requestAnimationFrame(draw);
    };
    draw();
    this.recorder.start(250);
    this.checkTimer = setInterval(() => this.check(), 100);
    this.emit();
  }

  addObservation(observation: CameraObservation) {
    if (this.stopped || observation.capturedAtMs < this.recordingStartedAtMs) return;
    this.observations.push(observation);
    const cutoff = this.options.now() - 90_000;
    while (this.observations[0]?.capturedAtMs < cutoff) this.observations.shift();
    this.check();
  }

  timeline() { return [...this.observations]; }

  retry() {
    if (this.state !== "unavailable") return;
    this.error = undefined;
    if (this.recorder?.state === "inactive") {
      try { this.recorder.start(250); } catch { /* The readiness timeout will return a stable error. */ }
    }
    this.state = this.bufferedEnd() * 1_000 >= this.options.minimumBufferMs ? "rebuffering" : "buffering";
    this.stateStartedAtMs = this.options.now();
    this.emit();
  }

  snapshot(): DelayedPlaybackSnapshot {
    return {
      state: this.state,
      video: this.video,
      recordingStartedAtMs: this.recordingStartedAtMs,
      delayMs: this.delayMs,
      analysisLeadMs: this.analysisLeadMs,
      error: this.error,
      width: this.width,
      height: this.height,
      bufferedSeconds: this.bufferedEnd(),
      encodedBytes: this.encodedBytes,
      queuedBytes: this.queuedChunks.reduce((sum, chunk) => sum + chunk.size, 0),
    };
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.checkTimer) clearInterval(this.checkTimer);
    cancelAnimationFrame(this.drawFrame);
    if (this.recorder?.state !== "inactive") this.recorder?.stop();
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.video.remove();
    this.recordingStream?.getTracks().forEach((track) => track.stop());
    URL.revokeObjectURL(this.mediaUrl);
    this.queuedChunks.length = 0;
    this.observations.length = 0;
  }

  private bufferedEnd() {
    const buffer = this.sourceBuffer?.buffered;
    return buffer?.length ? buffer.end(buffer.length - 1) : 0;
  }

  private async pump() {
    if (this.stopped || this.appending || !this.sourceBuffer || this.sourceBuffer.updating || !this.queuedChunks.length) return;
    const chunk = this.queuedChunks.shift()!;
    this.updateTelemetry();
    this.appending = true;
    try {
      const contents = await chunk.arrayBuffer();
      if (this.stopped || !this.sourceBuffer) return;
      this.sourceBuffer.appendBuffer(contents);
    } catch {
      this.appending = false;
      this.fail("The delayed Camera buffer could not be appended.");
    }
  }

  private prune() {
    if (!this.sourceBuffer || this.sourceBuffer.updating || this.video.currentTime < 15) return;
    const removeBefore = this.video.currentTime - 10;
    if (this.sourceBuffer.buffered.length && this.sourceBuffer.buffered.start(0) < removeBefore) {
      try { this.sourceBuffer.remove(0, removeBefore); } catch { /* A later update will retry pruning. */ }
    }
  }

  private hasContinuousAnalysis() {
    const recent = this.observations.filter((item) => item.capturedAtMs >= this.recordingStartedAtMs);
    if (recent.length < 3) return false;
    let start = recent.length - 1;
    while (start > 0 && recent[start].capturedAtMs - recent[start - 1].capturedAtMs <= 2_000) start -= 1;
    const continuous = recent.slice(start);
    return continuous.length >= 3 && continuous.at(-1)!.capturedAtMs - continuous[0].capturedAtMs >= Math.min(1_000, this.options.minimumAnalysisLeadMs);
  }

  private displayedCapturedAtMs() {
    return this.recordingStartedAtMs + this.video.currentTime * 1_000;
  }

  private check() {
    if (this.stopped || this.state === "unavailable") return;
    const now = this.options.now();
    const latest = this.observations.at(-1)?.capturedAtMs;
    this.analysisLeadMs = latest === undefined ? null : latest - this.displayedCapturedAtMs();

    if (this.state === "buffering") {
      const ready = this.bufferedEnd() * 1_000 >= this.options.minimumBufferMs && this.hasContinuousAnalysis();
      if (ready) {
        this.delayMs = now - this.displayedCapturedAtMs();
        this.state = "playing";
        this.stateStartedAtMs = now;
        void this.video.play().catch(() => this.fail("The delayed Camera playback could not start."));
        this.emit();
      } else if (now - this.stateStartedAtMs >= this.options.failureMs) this.fail("Camera analysis could not build enough playback coverage.");
      return;
    }

    if (this.state === "playing") {
      if (this.analysisLeadMs === null || this.analysisLeadMs < this.options.rebufferLeadMs) {
        this.video.pause();
        this.state = "rebuffering";
        this.stateStartedAtMs = now;
        this.emit();
      }
      return;
    }

    if (this.state === "rebuffering") {
      if (now - this.stateStartedAtMs >= this.options.failureMs) { this.fail("Camera analysis did not recover in time."); return; }
      if (this.analysisLeadMs === null || this.analysisLeadMs < this.options.minimumAnalysisLeadMs || !this.hasContinuousAnalysis()) return;
      const frozenCapturedAt = this.displayedCapturedAtMs();
      const intendedCapturedAt = now - (this.delayMs ?? this.options.minimumBufferMs);
      if (intendedCapturedAt - frozenCapturedAt > this.options.shortCatchUpMs) {
        const safeCapturedAt = Math.min(intendedCapturedAt, latest! - this.options.minimumAnalysisLeadMs);
        const nextTime = Math.max(0, (safeCapturedAt - this.recordingStartedAtMs) / 1_000);
        if (nextTime <= this.bufferedEnd()) this.video.currentTime = nextTime;
      } else {
        this.delayMs = now - frozenCapturedAt;
      }
      this.state = "playing";
      this.stateStartedAtMs = now;
      void this.video.play().catch(() => this.fail("The delayed Camera playback could not resume."));
      this.emit();
    }
  }

  private fail(error: string) {
    if (this.stopped || this.state === "unavailable") return;
    this.video.pause();
    if (this.recorder?.state === "recording") this.recorder.stop();
    this.queuedChunks.length = 0;
    this.error = error;
    this.state = "unavailable";
    this.stateStartedAtMs = this.options.now();
    this.emit();
  }

  private emit() {
    const snapshot = this.snapshot();
    this.updateTelemetry(snapshot);
    this.onChange(snapshot);
  }
  private updateTelemetry(snapshot = this.snapshot()) {
    this.video.dataset.encodedBytes = String(snapshot.encodedBytes);
    this.video.dataset.queuedBytes = String(snapshot.queuedBytes);
  }
}
