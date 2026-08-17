import { Router } from "express";
import { flagListQuerySchema } from "../schemas/alert.js";
import { getFlag, listFlags } from "../services/alertWorkflowService.js";

export const flagRoutes = Router();

flagRoutes.get("/", async (req, res) => {
  const query = flagListQuerySchema.parse(req.query);
  const page = await listFlags(query);
  return res.json({ flags: page.items, nextCursor: page.nextCursor, ...(
    page.paginationMode ? {
      paginationMode: page.paginationMode,
      resultCompleteness: page.resultCompleteness,
      scannedCount: page.scannedCount,
    } : {}
  ) });
});

flagRoutes.get("/:flagId", async (req, res) => {
  return res.json({ flag: await getFlag(req.params.flagId) });
});
