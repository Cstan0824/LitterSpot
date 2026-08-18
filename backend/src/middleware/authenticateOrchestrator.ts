import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

export type AuthenticatedOrchestrator = { workerId: string };

export function authenticateOrchestrator(req: Request, res: Response, next: NextFunction) {
  const token = req.header("x-orchestrator-token");
  const workerId = req.header("x-orchestrator-worker-id");
  if (!env.orchestratorInternalToken || !token || token !== env.orchestratorInternalToken) {
    return res.status(401).json({ error: "Orchestrator service authentication required.", requestId: req.requestId });
  }
  if (!workerId || workerId.trim().length < 1 || workerId.length > 160) {
    return res.status(400).json({ error: "X-Orchestrator-Worker-ID is required.", requestId: req.requestId });
  }
  req.orchestrator = { workerId: workerId.trim() };
  return next();
}
