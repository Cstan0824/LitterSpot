import { Router } from "express";
import { issueObservationListQuerySchema } from "../schemas/alert.js";
import { getIssueObservation, listIssueObservations } from "../services/alertWorkflowService.js";

export const issueObservationRoutes = Router();

issueObservationRoutes.get("/", async (req, res) => {
  const query = issueObservationListQuerySchema.parse(req.query);
  const page = await listIssueObservations(query);
  return res.json({ issueObservations: page.items, nextCursor: page.nextCursor });
});

issueObservationRoutes.get("/:observationId", async (req, res) => {
  return res.json({ issueObservation: await getIssueObservation(req.params.observationId) });
});
