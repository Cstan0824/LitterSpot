import { Router } from "express";
import { z } from "zod";
import { createCleanerSchema, provisionCleanerAccountSchema, updateCleanerSchema } from "../schemas/cleaner.js";
import {
  createCleaner,
  getCleaner,
  listCleaners,
  updateCleaner,
} from "../services/cleanerService.js";
import {
  changeCleanerStatus,
  provisionCleanerAccount,
  reconcileCleanerAccount,
} from "../services/cleanerAccountService.js";
import { locationHistoryQuerySchema } from "../schemas/cleanerOperations.js";
import { getCleanerPresence, listCleanerLocationHistory } from "../services/cleanerPresenceService.js";

export const cleanerRoutes = Router();

cleanerRoutes.get("/", async (req, res) => {
  const status = z.enum(["active", "inactive", "all"]).default("all").parse(req.query.status);
  return res.json({ cleaners: await listCleaners(status) });
});

cleanerRoutes.get("/:cleanerId", async (req, res) => {
  return res.json({ cleaner: await getCleaner(req.params.cleanerId) });
});

cleanerRoutes.post("/", async (req, res) => {
  const input = createCleanerSchema.parse(req.body);
  const cleaner = await createCleaner(input, req.supervisor.uid);
  return res.status(201).json({ cleaner });
});

cleanerRoutes.patch("/:cleanerId", async (req, res) => {
  const input = updateCleanerSchema.parse(req.body);
  const { status, ...remaining } = input;
  const cleaner = status
    ? await changeCleanerStatus(req.params.cleanerId, status, req.supervisor.uid, remaining)
    : await updateCleaner(req.params.cleanerId, remaining, req.supervisor.uid);
  return res.json({ cleaner });
});

cleanerRoutes.delete("/:cleanerId", async (req, res) => {
  const cleaner = await changeCleanerStatus(req.params.cleanerId, "inactive", req.supervisor.uid);
  return res.json({ cleaner });
});

cleanerRoutes.post("/:cleanerId/account", async (req, res) => {
  const input = provisionCleanerAccountSchema.parse(req.body);
  const result = await provisionCleanerAccount(req.params.cleanerId, input.email, req.supervisor.uid);
  return res.status(result.idempotent ? 200 : 201).json(result);
});

cleanerRoutes.post("/:cleanerId/account/reconcile", async (req, res) => {
  return res.json(await reconcileCleanerAccount(req.params.cleanerId, req.supervisor.uid));
});

cleanerRoutes.get("/:cleanerId/presence", async (req, res) => {
  return res.json({ presence: await getCleanerPresence(req.params.cleanerId) });
});

cleanerRoutes.get("/:cleanerId/locations", async (req, res) => {
  const page = await listCleanerLocationHistory(req.params.cleanerId, locationHistoryQuerySchema.parse(req.query));
  return res.json({ locations: page.items, nextCursor: page.nextCursor });
});
