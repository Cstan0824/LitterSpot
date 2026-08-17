import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const supplied = req.header("x-request-id");
  req.requestId = supplied && requestIdPattern.test(supplied) ? supplied : randomUUID();
  res.setHeader("X-Request-ID", req.requestId);
  const startedAt = performance.now();
  res.once("finish", () => {
    const log = {
      timestamp: new Date().toISOString(),
      level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
      event: "http_request",
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl.split("?", 1)[0],
      status: res.statusCode,
      latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
      actorUid: req.authUser?.uid ?? null,
      actorRole: req.authUser?.role ?? null,
      supervisorUid: req.supervisor?.uid ?? null,
    };
    console.log(JSON.stringify(log));
  });
  next();
}
