import { Router } from "express";
import { serializeFirestore } from "../services/presentation.js";
import { cameraFramesForSite, subscribeCameraEvents } from "../services/cameraLiveEvents.js";
import { getLiveCameraConfiguration } from "../services/cameraConfigurationCache.js";

export const cameraLiveRoutes = Router();
cameraLiveRoutes.get("/config", async (req, res) => {
  const siteId = String(req.authUser.siteId);
  res.set("Cache-Control", "no-store").json(serializeFirestore(await getLiveCameraConfiguration(siteId)));
});

cameraLiveRoutes.get("/events", (req, res) => {
  const siteId = String(req.authUser.siteId);
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive" });
  res.flushHeaders();
  const send = (payload: Record<string, unknown>) => {
    // A slow viewer reconnects to the latest frame instead of buffering video indefinitely.
    if (res.writableLength > 2 * 1024 * 1024) { res.end(); return; }
    if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  const unsubscribe = subscribeCameraEvents(siteId, send);
  for (const entry of cameraFramesForSite(siteId)) send(entry);
  const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(": heartbeat\n\n"); }, 10_000);
  // Reconnect periodically to refresh authentication and recheck Site/account access.
  const expiry = setTimeout(() => res.end(), 50_000);
  res.on("close", () => { clearInterval(heartbeat); clearTimeout(expiry); unsubscribe(); });
});
