import { Router } from "express";
import { createCameraSchema, statusQuerySchema, updateCameraSchema } from "../schemas/location.js";
import { createCamera, getCamera, listCameras, updateCamera } from "../services/locationService.js";

export const cameraRoutes = Router();

cameraRoutes.get("/", async (req, res) => {
  const status = statusQuerySchema.parse(req.query.status);
  const siteId = typeof req.query.siteId === "string" ? req.query.siteId : undefined;
  const zoneId = typeof req.query.zoneId === "string" ? req.query.zoneId : undefined;
  return res.json({ cameras: await listCameras({ status, siteId, zoneId }) });
});

cameraRoutes.get("/:cameraId", async (req, res) => {
  return res.json({ camera: await getCamera(req.params.cameraId) });
});

cameraRoutes.post("/", async (req, res) => {
  const camera = await createCamera(createCameraSchema.parse(req.body), req.supervisor.uid);
  return res.status(201).json({ camera });
});

cameraRoutes.patch("/:cameraId", async (req, res) => {
  const camera = await updateCamera(req.params.cameraId, updateCameraSchema.parse(req.body), req.supervisor.uid);
  return res.json({ camera });
});

cameraRoutes.delete("/:cameraId", async (req, res) => {
  const camera = await updateCamera(req.params.cameraId, { status: "inactive" }, req.supervisor.uid);
  return res.json({ camera });
});
