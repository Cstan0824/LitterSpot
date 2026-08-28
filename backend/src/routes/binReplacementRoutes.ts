import { Router } from "express";
import { binReplacementQuerySchema } from "../schemas/binReplacement.js";
import { evaluateZoneBinReplacement, getPreviousZoneBinReplacement } from "../services/binReplacementService.js";

export const binReplacementRoutes = Router();

// Evaluation is an explicit mutation because it advances the Firestore
// hysteresis state and writes an immutable evaluation record.
binReplacementRoutes.post("/:zoneId/evaluate", async (req, res) => {
  const query = binReplacementQuerySchema.parse(req.query);
  return res.json({ recommendation: await evaluateZoneBinReplacement(req.params.zoneId, query) });
});

binReplacementRoutes.get("/:zoneId", async (req, res) => {
  return res.json({ recommendation: await getPreviousZoneBinReplacement(req.params.zoneId) });
});
