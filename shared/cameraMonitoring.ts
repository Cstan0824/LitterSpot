import { DelayedCameraPlayback, type DelayedPlaybackSnapshot } from "./delayedCameraPlayback";

export type Box = { x1: number; y1: number; x2: number; y2: number };
export type CameraObservation = {
  sampleId: string; cameraId: string; episodeId: string; sequence: number; capturedAtMs: number;
  image: { width: number; height: number }; processingTimeMs: number; playbackGeneration: number;
  sourceTimeSeconds?: number; peopleCount: number;
  people: Array<{ confidence: number; bbox: Box }>;
  bins: Array<{ binId: string; state: string; confidence: number; bbox: Box }>;
  issues: Array<{ issueType: string; confidence: number; geometry: { bbox?: Box } }>;
};
export type MonitoringCamera = {
  id: string; name: string; status: string; monitoringEnabled: boolean; revision: number;
  sourceType: "laptop_camera" | "looped_video"; activeSourceRevisionId: string; activeRegistrationRevisionId: string;
  playbackGeneration: number; source: { contentUrl: string | null; sampleIntervalSeconds: number };
  registration: { sourceWidth: number; sourceHeight: number }; runtime?: { connectionStatus?: string; cleanlinessState?: string };
};
export type CameraPlaybackMetrics = { droppedFrames: number; lateResults: number; latestInferenceMs: number; requestedIntervalMs?: number };
export type CameraView = { camera: MonitoringCamera; frameDataUrl?: string; observation?: CameraObservation; sourceVideo?: HTMLVideoElement; detailPlayback?: DelayedPlaybackSnapshot; analysisTimeline?: CameraObservation[]; analysisUpdating?: boolean; metrics?: CameraPlaybackMetrics; message: string; controlBusy: boolean; lastReceivedAt?: number };
export type MonitoringSnapshot = { cameras: Record<string, CameraView>; owner: boolean; error: string };
export type CameraTransport = (path: string, options?: RequestInit) => Promise<Response>;
type Lease = { sessionId: string; leaseToken: string };
type Driver = { camera: MonitoringCamera; video?: HTMLVideoElement; url?: string; stream?: MediaStream; episodeId?: string; sequence: number; busy: boolean; loading: boolean; stopped: boolean; nextAt: number; lastSampleStartedAt: number; burstUntil: number; observations: CameraObservation[]; detailPlayback?: DelayedCameraPlayback; droppedFrames: number; lateResults: number };
const message = (error: unknown) => error instanceof Error ? error.message : "Camera connection failed.";
const pause = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export function adaptiveCameraSampleInterval(input: { detail: boolean; visibleCard: boolean; positiveBurst: boolean; verification: boolean }) {
  if (input.detail) return 500;
  if (input.verification || input.positiveBurst || input.visibleCard) return 1_000;
  return 4_000;
}

/** Route-independent browser runtime shared by the sandbox and Supervisor shell. */
export class SiteCameraMonitoring {
  private state: MonitoringSnapshot = { cameras: {}, owner: false, error: "" };
  private listeners = new Set<() => void>();
  private drivers = new Map<string, Driver>();
  private localFrames = new Map<string, string>();
  private lease?: Lease;
  private active = false;
  private refreshPending?: Promise<void>;
  private refreshAgain = false;
  private claiming = false;
  private heartbeatBusy = false;
  private sampleSchedulerBusy = false;
  private lastMaintenance = 0;
  private detailCameraIds = new Set<string>();
  private visibleCardIds = new Set<string>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private abort = new AbortController();
  private pageHide = () => { void this.stop(); };
  constructor(private transport: CameraTransport) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit() { this.state = { ...this.state, cameras: { ...this.state.cameras }, owner: Boolean(this.lease) }; this.listeners.forEach(l => l()); }
  private update(id: string, values: Partial<CameraView>) { if (this.state.cameras[id]) { this.state.cameras[id] = { ...this.state.cameras[id], ...values }; this.emit(); } }
  private async json<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await this.transport(path, { ...options, signal: this.abort.signal });
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(body.error ?? "Camera request failed."), { status: response.status, code: body.code, details: body.details });
    return body;
  }
  private post<T>(path: string, body: unknown = {}, lease?: Lease) { return this.json<T>(path, { method: "POST", headers: { "Content-Type": "application/json", ...(lease ? { "x-monitoring-token": lease.leaseToken } : {}) }, body: JSON.stringify(body) }); }
  start() {
    if (this.active) return; this.active = true; if (this.abort.signal.aborted) this.abort = new AbortController();
    window.addEventListener("pagehide", this.pageHide);
    void this.refresh(); void this.events();
    this.timers.push(setInterval(() => { void this.maintain(); }, 10_000));
    this.timers.push(setInterval(() => { void this.scheduleSample(); }, 100));
  }
  async refresh() {
    if (!this.active) return;
    if (this.refreshPending) { this.refreshAgain = true; return this.refreshPending; }
    this.refreshPending = (async () => {
      try {
        const result = await this.json<{ cameras: MonitoringCamera[] }>("/api/monitoring/live/config");
        if (!this.active) return;
        const ids = new Set(result.cameras.map(c => c.id));
        for (const id of Object.keys(this.state.cameras)) if (!ids.has(id)) { this.stopDriver(id); delete this.state.cameras[id]; }
        for (const camera of result.cameras) {
          const old = this.state.cameras[camera.id];
          const changed = old && (old.camera.playbackGeneration !== camera.playbackGeneration || old.camera.activeRegistrationRevisionId !== camera.activeRegistrationRevisionId || old.camera.activeSourceRevisionId !== camera.activeSourceRevisionId);
          this.state.cameras[camera.id] = { ...old, camera, message: old?.message ?? "Waiting for frames", controlBusy: old?.controlBusy ?? false, ...(changed || !camera.monitoringEnabled ? { frameDataUrl: undefined, observation: undefined } : {}) };
          if (!camera.monitoringEnabled || camera.status !== "active") { this.stopDriver(camera.id); this.update(camera.id, { sourceVideo: undefined, message: "Disabled" }); }
        }
        this.state.error = ""; this.emit(); await this.maintain();
      } catch (error) { if (this.active) { this.state.error = message(error); this.emit(); } }
    })().finally(() => { this.refreshPending = undefined; if (this.refreshAgain && this.active) { this.refreshAgain = false; queueMicrotask(() => { void this.refresh(); }); } });
    return this.refreshPending;
  }
  private async maintain() {
    if (!this.active) return;
    const enabled = Object.values(this.state.cameras).map(v => v.camera).filter(c => c.status === "active" && c.monitoringEnabled);
    if (!enabled.length) { if (this.lease) await this.release(); return; }
    if (!this.lease && !this.claiming) {
      this.claiming = true;
      try {
        const lease = await this.post<Lease>("/api/monitoring/sessions/claim");
        if (!this.active) { await this.transport(`/api/monitoring/sessions/${lease.sessionId}/release`, { method: "POST", headers: { "x-monitoring-token": lease.leaseToken } }); return; }
        this.lease = lease; this.emit();
      } catch (error) { if ((error as { status?: number }).status !== 409) { this.state.error = message(error); this.emit(); } }
      finally { this.claiming = false; }
    }
    if (!this.lease) return;
    if (Date.now() - this.lastMaintenance >= 60000) {
      this.lastMaintenance = Date.now();
      void this.post("/api/monitoring/minute-flush").catch(() => undefined);
      void this.post("/api/monitoring/offline-sweep").catch(() => undefined);
    }
    if (!this.heartbeatBusy) {
      this.heartbeatBusy = true;
      try { await this.post(`/api/monitoring/sessions/${this.lease.sessionId}/heartbeat`, {}, this.lease); }
      catch { await this.release(); return; }
      finally { this.heartbeatBusy = false; }
    }
    for (const camera of enabled) void this.ensureDriver(camera);
  }
  private async ensureDriver(camera: MonitoringCamera) {
    if (!this.lease || !this.active) return;
    let driver = this.drivers.get(camera.id);
    if (driver && (driver.camera.activeSourceRevisionId !== camera.activeSourceRevisionId || driver.camera.activeRegistrationRevisionId !== camera.activeRegistrationRevisionId)) { this.stopDriver(camera.id, "reconfigured"); driver = undefined; }
    if (driver && driver.camera.playbackGeneration !== camera.playbackGeneration) {
      driver.detailPlayback?.stop(); driver.detailPlayback = undefined; driver.observations = []; driver.burstUntil = 0;
      this.update(camera.id, { detailPlayback: undefined, analysisTimeline: undefined, frameDataUrl: undefined, observation: undefined });
    }
    if (driver?.loading) return;
    if (driver && driver.camera.playbackGeneration === camera.playbackGeneration && driver.video) return;
    if (!driver) { driver = { camera, sequence: 1, busy: false, loading: false, stopped: false, nextAt: 0, lastSampleStartedAt: 0, burstUntil: 0, observations: [], droppedFrames: 0, lateResults: 0 }; this.drivers.set(camera.id, driver); }
    const current = driver; current.loading = true;
    try {
      const video = document.createElement("video"); video.muted = true; video.autoplay = true; video.playsInline = true; video.loop = true;
      // The capture element lives outside routed views and is never display:none.
      video.style.cssText = "position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0.001;pointer-events:none";
      video.setAttribute("aria-hidden", "true"); document.body.append(video);
      let url: string | undefined, stream: MediaStream | undefined;
      try {
        if (camera.sourceType === "laptop_camera") { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); video.srcObject = stream; }
        else { if (!camera.source.contentUrl) throw new Error("Source video is unavailable."); const response = await this.transport(camera.source.contentUrl, { signal: this.abort.signal, cache: "no-store" }); if (!response.ok) throw new Error("Source video could not be loaded."); url = URL.createObjectURL(await response.blob()); video.src = url; }
        await video.play();
        if (current.stopped || !this.active || !this.lease) throw new Error("Camera stopped.");
        current.video?.pause(); current.video?.remove(); current.stream?.getTracks().forEach(t => t.stop()); if (current.url) URL.revokeObjectURL(current.url);
        current.video = video; current.stream = stream; current.url = url; current.camera = camera;
        if (!current.episodeId) {
          const episode = await this.post<{ episodeId: string; nextSequence: number }>(`/api/monitoring/sessions/${this.lease.sessionId}/cameras/${camera.id}/start`, {}, this.lease);
          if (current.stopped) return;
          current.episodeId = episode.episodeId; current.sequence = episode.nextSequence;
        }
        this.update(camera.id, { sourceVideo: video, analysisUpdating: false, message: "Live monitoring", metrics: { droppedFrames: 0, lateResults: 0, latestInferenceMs: 0 } });
        if (this.detailCameraIds.has(camera.id)) this.startDetailPlayback(current);
      } catch (error) { video.pause(); video.remove(); stream?.getTracks().forEach(t => t.stop()); if (url) URL.revokeObjectURL(url); throw error; }
    } catch (error) { if (!current.stopped) { this.update(camera.id, { message: message(error) }); this.stopDriver(camera.id, "source_failure"); } }
    finally { current.loading = false; }
  }
  setPresentationInterest(id: string, mode: "detail" | "card", active: boolean) {
    const interests = mode === "detail" ? this.detailCameraIds : this.visibleCardIds;
    if (active) interests.add(id); else interests.delete(id);
    const driver = this.drivers.get(id);
    if (mode === "detail" && driver) {
      if (active) this.startDetailPlayback(driver);
      else {
        driver.detailPlayback?.stop();
        driver.detailPlayback = undefined;
        this.update(id, { detailPlayback: undefined, analysisTimeline: undefined });
      }
    } else if (mode === "detail" && active && this.lease && this.state.cameras[id]?.camera.monitoringEnabled) {
      this.update(id, { detailPlayback: { state: "buffering", recordingStartedAtMs: Date.now(), delayMs: null, analysisLeadMs: null, width: 1, height: 1, bufferedSeconds: 0, encodedBytes: 0, queuedBytes: 0 } });
    }
  }
  retryDetailPlayback(id: string) { this.drivers.get(id)?.detailPlayback?.retry(); }
  private startDetailPlayback(driver: Driver) {
    if (driver.detailPlayback || !driver.video || !this.lease || !this.active) return;
    try {
      const playback = new DelayedCameraPlayback(driver.video, (snapshot) => {
        if (this.drivers.get(driver.camera.id) === driver) this.update(driver.camera.id, { detailPlayback: snapshot, analysisTimeline: [...driver.observations] });
      });
      driver.detailPlayback = playback;
      playback.start();
      driver.observations.forEach((observation) => playback.addObservation(observation));
      this.update(driver.camera.id, { detailPlayback: playback.snapshot(), analysisTimeline: [...driver.observations] });
    } catch (error) {
      this.update(driver.camera.id, { detailPlayback: { state: "unavailable", recordingStartedAtMs: Date.now(), delayMs: null, analysisLeadMs: null, error: message(error), width: 1, height: 1, bufferedSeconds: 0, encodedBytes: 0, queuedBytes: 0 } });
    }
  }
  private desiredSampleInterval(driver: Driver, now = Date.now()) {
    return adaptiveCameraSampleInterval({ detail: this.detailCameraIds.has(driver.camera.id), visibleCard: this.visibleCardIds.has(driver.camera.id), positiveBurst: driver.burstUntil > now, verification: driver.camera.runtime?.cleanlinessState === "awaiting_review" });
  }
  private async scheduleSample() {
    if (this.sampleSchedulerBusy || !this.active || !this.lease) return;
    const now = Date.now();
    const candidates = [...this.drivers.values()].filter((driver) => !driver.stopped && !driver.loading && !driver.busy && driver.episodeId && driver.video?.videoWidth).map((driver) => {
      const interval = this.desiredSampleInterval(driver, now);
      const elapsed = driver.lastSampleStartedAt ? now - driver.lastSampleStartedAt : Number.POSITIVE_INFINITY;
      return { driver, interval, urgency: elapsed / interval, detail: this.detailCameraIds.has(driver.camera.id) };
    }).filter((item) => item.urgency >= 1).sort((left, right) => right.urgency - left.urgency || Number(right.detail) - Number(left.detail));
    const detail = candidates.find((item) => item.detail);
    const starvedBackground = candidates.find((item) => !item.detail && item.driver.lastSampleStartedAt > 0 && now - item.driver.lastSampleStartedAt >= 4_000);
    const selected = starvedBackground ?? detail ?? candidates[0];
    if (!selected) return;
    selected.driver.lastSampleStartedAt = now;
    selected.driver.nextAt = now + selected.interval;
    this.sampleSchedulerBusy = true;
    try { await this.sample(selected.driver, selected.interval); }
    finally { this.sampleSchedulerBusy = false; }
  }
  private async sample(driver: Driver, requestedIntervalMs = Math.max(1_000, driver.camera.source.sampleIntervalSeconds * 1_000)) {
    if (!this.active || !this.lease || driver.stopped || driver.loading || driver.busy || !driver.episodeId || !driver.video?.videoWidth) return;
    driver.busy = true; const lease = this.lease; const camera = driver.camera; const capturedAt = new Date();
    driver.nextAt = Date.now() + requestedIntervalMs;
    try {
      const canvas = document.createElement("canvas"); canvas.width = driver.video.videoWidth; canvas.height = driver.video.videoHeight;
      const sourceTime = driver.video.currentTime; canvas.getContext("2d")!.drawImage(driver.video, 0, 0);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", .82));
      if (!blob || driver.stopped) return;
      const body = new FormData(); body.set("frame", blob, "frame.jpg"); body.set("episodeId", driver.episodeId); body.set("sequence", String(driver.sequence)); body.set("capturedAt", capturedAt.toISOString()); body.set("sourceTimeSeconds", String(sourceTime)); body.set("playbackGeneration", String(camera.playbackGeneration));
      const result = await this.json<{ observation: CameraObservation; nextSequence: number }>(`/api/monitoring/sessions/${lease.sessionId}/cameras/${camera.id}/samples`, { method: "POST", headers: { "x-monitoring-token": lease.leaseToken }, body });
      driver.sequence = result.nextSequence;
      if (!driver.stopped && driver.camera.playbackGeneration === camera.playbackGeneration && this.state.cameras[camera.id]?.camera.monitoringEnabled && this.state.cameras[camera.id]?.camera.activeRegistrationRevisionId === camera.activeRegistrationRevisionId) {
        driver.observations ??= []; driver.observations.push(result.observation); driver.observations = driver.observations.filter((item) => Date.now() - item.capturedAtMs <= 90_000);
        if (result.observation.issues.length) driver.burstUntil = Date.now() + 10_000;
        driver.detailPlayback?.addObservation(result.observation);
        if (Date.now() - result.observation.capturedAtMs > Math.max(3_000, camera.source.sampleIntervalSeconds * 2_500)) driver.lateResults += 1;
        const previous = this.localFrames.get(camera.id); const frameDataUrl = URL.createObjectURL(blob); this.localFrames.set(camera.id, frameDataUrl);
        this.update(camera.id, { frameDataUrl, observation: result.observation, analysisTimeline: driver.detailPlayback ? [...driver.observations] : undefined, analysisUpdating: false, message: "Live monitoring", lastReceivedAt: Date.now(), metrics: { droppedFrames: driver.droppedFrames, lateResults: driver.lateResults, latestInferenceMs: result.observation.processingTimeMs, requestedIntervalMs } }); if (previous) URL.revokeObjectURL(previous);
      }
    } catch (error) {
      if (!driver.stopped) {
        this.update(camera.id, { message: message(error) });
        if ((error as { status?: number }).status === 503) { driver.nextAt = Date.now() + ((error as { code?: string }).code === "firestore_quota_exceeded" ? 600000 : 15000); return; }
        if ((error as { status?: number }).status !== 429) {
          // An ambiguous response may already have consumed sequence. Resume recovers it.
          try { const resume = await this.post<{ episodeId: string; nextSequence: number }>(`/api/monitoring/sessions/${lease.sessionId}/cameras/${camera.id}/start`, {}, lease); driver.sequence = resume.nextSequence; driver.episodeId = resume.episodeId; }
          catch { this.stopDriver(camera.id, "source_failure"); }
        }
        driver.nextAt = Date.now() + 2000;
      }
    } finally { driver.busy = false; }
  }
  private stopDriver(id: string, reason = "disabled") {
    const driver = this.drivers.get(id); if (!driver) return;
    driver.stopped = true; this.drivers.delete(id);
    driver.detailPlayback?.stop(); driver.detailPlayback = undefined;
    driver.video?.pause(); driver.video?.remove(); driver.stream?.getTracks().forEach(t => t.stop()); if (driver.url) URL.revokeObjectURL(driver.url);
    const frame = this.localFrames.get(id); if (frame) { URL.revokeObjectURL(frame); this.localFrames.delete(id); }
    if (driver.episodeId && this.lease) void this.post(`/api/monitoring/sessions/${this.lease.sessionId}/cameras/${id}/stop`, { episodeId: driver.episodeId, reason }, this.lease).catch(() => undefined);
    this.update(id, { sourceVideo: undefined, detailPlayback: undefined, analysisTimeline: undefined, analysisUpdating: false, observation: undefined, frameDataUrl: undefined, lastReceivedAt: undefined });
  }
  async toggle(id: string) {
    const view = this.state.cameras[id]; if (!view || view.controlBusy) return;
    this.update(id, { controlBusy: true });
    try {
      const result = await this.json<{ monitoringEnabled: boolean; revision: number }>(`/api/camera-creation/cameras/${id}/monitoring`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ monitoringEnabled: !view.camera.monitoringEnabled, expectedRevision: view.camera.revision }) });
      this.update(id, { camera: { ...view.camera, monitoringEnabled: result.monitoringEnabled, revision: result.revision }, ...(result.monitoringEnabled ? {} : { frameDataUrl: undefined, observation: undefined, lastReceivedAt: undefined }) });
      if (!result.monitoringEnabled) this.stopDriver(id);
      await this.refresh();
    } catch (error) { await this.refresh(); this.update(id, { message: message(error) }); }
    finally { this.update(id, { controlBusy: false }); }
  }
  private async events() {
    while (this.active) {
      const connection = new AbortController();
      const cancel = () => connection.abort();
      this.abort.signal.addEventListener("abort", cancel, { once: true });
      // A hung intermediary must not leave the receiver awaiting bytes forever.
      const timeout = setTimeout(cancel, 55000);
      try {
        const response = await this.transport("/api/monitoring/live/events", { signal: connection.signal });
        if (response.status === 401 || response.status === 403) {
          this.state.error = "Camera monitoring session is no longer authorized."; this.emit(); return;
        }
        if (!response.ok || !response.body) throw new Error("Live connection unavailable.");
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
        while (this.active) {
          const { done, value } = await reader.read(); if (done) break;
          buffer += decoder.decode(value, { stream: true }); let split;
          while ((split = buffer.indexOf("\n\n")) >= 0) {
            const event = buffer.slice(0, split); buffer = buffer.slice(split + 2);
            if (!event.startsWith("data: ")) continue;
            const data = JSON.parse(event.slice(6));
            if (data.type === "workflow") { window.dispatchEvent(new CustomEvent("litterspot:camera-workflow", { detail: { cameraId: data.cameraId } })); continue; }
            if (data.type === "control") { void this.refresh(); continue; }
            const view = this.state.cameras[data.cameraId];
            if (view?.camera.monitoringEnabled && data.observation?.playbackGeneration === view.camera.playbackGeneration && data.observation?.registrationRevisionId === view.camera.activeRegistrationRevisionId) this.update(data.cameraId, { frameDataUrl: data.frameDataUrl, observation: data.observation, lastReceivedAt: Date.now(), message: "Online" });
          }
        }
      } catch { /* Reconnect; the owner still renders directly from sample responses. */ }
      finally { clearTimeout(timeout); this.abort.signal.removeEventListener("abort", cancel); connection.abort(); }
      if (this.active) await pause(1500);
    }
  }
  private async release() {
    const lease = this.lease; this.lease = undefined;
    for (const id of this.drivers.keys()) this.stopDriver(id);
    this.emit();
    if (lease) await this.transport(`/api/monitoring/sessions/${lease.sessionId}/release`, { method: "POST", headers: { "x-monitoring-token": lease.leaseToken }, keepalive: true }).catch(() => undefined);
  }
  async stop() { this.active = false; window.removeEventListener("pagehide", this.pageHide); this.abort.abort(); this.timers.forEach(clearInterval); this.timers = []; await this.release(); if (!this.active) { for (const url of this.localFrames.values()) URL.revokeObjectURL(url); this.localFrames.clear(); this.state = { cameras: {}, owner: false, error: "" }; this.emit(); } }
}
