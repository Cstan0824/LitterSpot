import { Router } from "express";
import { createSiteSchema, statusQuerySchema, updateSiteSchema } from "../schemas/location.js";
import { createSite, getSite, listSites, updateSite } from "../services/locationService.js";

export const siteRoutes = Router();

siteRoutes.get("/", async (req, res) => {
  const status = statusQuerySchema.parse(req.query.status);
  return res.json({ sites: await listSites(status) });
});

siteRoutes.get("/:siteId", async (req, res) => {
  return res.json({ site: await getSite(req.params.siteId) });
});

siteRoutes.post("/", async (req, res) => {
  const site = await createSite(createSiteSchema.parse(req.body), req.supervisor.uid);
  return res.status(201).json({ site });
});

siteRoutes.patch("/:siteId", async (req, res) => {
  const site = await updateSite(req.params.siteId, updateSiteSchema.parse(req.body), req.supervisor.uid);
  return res.json({ site });
});

siteRoutes.delete("/:siteId", async (req, res) => {
  const site = await updateSite(req.params.siteId, { status: "inactive" }, req.supervisor.uid);
  return res.json({ site });
});
