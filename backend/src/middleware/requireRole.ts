import type { NextFunction, Request, Response } from "express";

export function requireSupervisor(req: Request, res: Response, next: NextFunction) {
  if (req.authUser.role !== "supervisor" || !req.supervisor) {
    return res.status(403).json({ error: "Supervisor access is required.", requestId: req.requestId });
  }
  return next();
}

export function requireCleaner(req: Request, res: Response, next: NextFunction) {
  if (req.authUser.role !== "cleaner" || !req.cleaner) {
    return res.status(403).json({ error: "Cleaner access is required.", requestId: req.requestId });
  }
  return next();
}
