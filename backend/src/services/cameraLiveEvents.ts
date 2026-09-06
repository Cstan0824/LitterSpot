import { EventEmitter } from "node:events";
import { invalidateSiteCameraConfiguration } from "./cameraConfigurationCache.js";

type LiveEntry = { siteId: string; cameraId: string; at: number; bytes: number; payload: Record<string, unknown> };
const events = new EventEmitter(); events.setMaxListeners(100);
const latest = new Map<string, LiveEntry>();
const MAX_BYTES = 32 * 1024 * 1024;
function prune() {
  for (const [key, entry] of latest) if (Date.now() - entry.at > 15_000) latest.delete(key);
  let bytes = [...latest.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  for (const [key, entry] of latest) { if (bytes <= MAX_BYTES) break; latest.delete(key); bytes -= entry.bytes; }
}
export function publishCameraFrame(siteId: string, cameraId: string, observation: Record<string, unknown>, frame: Buffer, mimeType: string) {
  const payload = { type: "observation", cameraId, observation, frameDataUrl: `data:${mimeType};base64,${frame.toString("base64")}` };
  latest.delete(`${siteId}:${cameraId}`);
  latest.set(`${siteId}:${cameraId}`, { siteId, cameraId, at: Date.now(), bytes: Math.ceil(frame.length * 4 / 3), payload });
  prune(); events.emit(siteId, payload);
}
export function publishCameraControl(siteId: string, cameraId: string, options: { configurationChanged?: boolean } = {}) {
  if (options.configurationChanged !== false) invalidateSiteCameraConfiguration(siteId);
  latest.delete(`${siteId}:${cameraId}`);
  events.emit(siteId, { type: "control", cameraId });
}
export function publishSiteCameraControl(siteId: string) {
  invalidateSiteCameraConfiguration(siteId);
  for (const [key, entry] of latest) if (entry.siteId === siteId) latest.delete(key);
  events.emit(siteId, { type: "control", cameraId: null });
}
export function publishCameraWorkflow(siteId: string, cameraId: string) { events.emit(siteId, { type: "workflow", cameraId }); }
export function cameraFramesForSite(siteId: string) { prune(); return [...latest.values()].filter(entry => entry.siteId === siteId).map(entry => entry.payload); }
export function subscribeCameraEvents(siteId: string, listener: (event: Record<string, unknown>) => void) { events.on(siteId, listener); return () => { events.off(siteId, listener); }; }
