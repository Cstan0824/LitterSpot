import { Router } from "express";
import { createZoneSchema, statusQuerySchema, updateZoneSchema } from "../schemas/location.js";
import { createZone, getZone, listZones, updateZone } from "../services/locationService.js";

export const zoneRoutes = Router();

zoneRoutes.get("/", async (req, res) => {
  const status = statusQuerySchema.parse(req.query.status ?? "active");
  const siteId = typeof req.query.siteId === "string" ? req.query.siteId : undefined;
  return res.json({ zones: await listZones({ status, siteId }) });
});

zoneRoutes.get("/:zoneId", async (req, res) => {
  return res.json({ zone: await getZone(req.params.zoneId) });
});

zoneRoutes.post("/", async (req, res) => {
  const zone = await createZone(createZoneSchema.parse(req.body), req.supervisor.uid);
  return res.status(201).json({ zone });
});

zoneRoutes.patch("/:zoneId", async (req, res) => {
  const zone = await updateZone(req.params.zoneId, updateZoneSchema.parse(req.body), req.supervisor.uid);
  return res.json({ zone });
});

zoneRoutes.delete("/:zoneId", async (req, res) => {
  const zone = await updateZone(req.params.zoneId, { status: "inactive" }, req.supervisor.uid);
  return res.json({ zone });
});
