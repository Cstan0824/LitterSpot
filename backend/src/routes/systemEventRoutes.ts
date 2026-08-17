import { Router } from "express";
import { systemEventListQuerySchema } from "../schemas/systemEvent.js";
import { getSystemEvent, listSystemEvents } from "../services/systemEventService.js";

export const systemEventRoutes = Router();

systemEventRoutes.get("/", async (req, res) => {
  return res.json(await listSystemEvents(systemEventListQuerySchema.parse(req.query)));
});

systemEventRoutes.get("/:eventKey", async (req, res) => {
  return res.json({ systemEvent: await getSystemEvent(String(req.params.eventKey)) });
});
