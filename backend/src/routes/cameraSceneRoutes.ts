import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { env } from "../config/env.js";
import { HttpError } from "../shared/httpError.js";
import { assertDemoScenesEnabled, sceneCamera, selectCameraScene, uploadCameraScene } from "../services/cameraScenes.js";
import { requireRootSupervisor } from "../middleware/requireRole.js";
export const cameraSceneRoutes = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.videoMaxBytes, files: 1 } });
const key = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/);
cameraSceneRoutes.use((_req, _res, next) => { assertDemoScenesEnabled(); next(); });
cameraSceneRoutes.use((req, res, next) => env.appEnvironment === "production-cloud" ? requireRootSupervisor(req, res, next) : next());
cameraSceneRoutes.get("/:cameraId/scenes", async (req, res) => {
  const camera = await sceneCamera(String(req.authUser.siteId), req.params.cameraId);
  const scenes = await camera.ref.collection("demoScenes").get();
  res.json({ scenes: scenes.docs.map(d => ({ key: d.id, ...d.data() })) });
});
cameraSceneRoutes.post("/:cameraId/scenes/:key", upload.single("video"), async (req, res) => {
  if (!req.file) throw new HttpError(400, "A scene video is required.");
  res.status(201).json(await uploadCameraScene(String(req.authUser.siteId), String(req.params.cameraId), key.parse(req.params.key), req.file, req.authUser.uid));
});
cameraSceneRoutes.post("/:cameraId/scenes/:key/select", async (req, res) => {
  res.json(await selectCameraScene(String(req.authUser.siteId), req.params.cameraId, key.parse(req.params.key), req.authUser.uid));
});
