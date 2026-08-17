import type { NextFunction, Request, Response } from "express";

type Window = { startedAt: number; count: number; lastSeenAt: number };
type RateLimitOptions = {
  namespace: string;
  maximum: number;
  windowMilliseconds?: number;
};

const windows = new Map<string, Window>();
let lastCleanupAt = 0;

function cleanup(now: number, maximumAge: number) {
  if (now - lastCleanupAt < maximumAge) return;
  lastCleanupAt = now;
  for (const [key, value] of windows) {
    if (now - value.lastSeenAt >= maximumAge * 2) windows.delete(key);
  }
}

export function rateLimit(options: RateLimitOptions) {
  const windowMilliseconds = options.windowMilliseconds ?? 60_000;
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    cleanup(now, windowMilliseconds);
    const identity = req.authUser?.uid ?? req.supervisor?.uid ?? req.ip ?? "unknown";
    const key = `${options.namespace}:${identity}`;
    const previous = windows.get(key);
    const current = !previous || now - previous.startedAt >= windowMilliseconds
      ? { startedAt: now, count: 0, lastSeenAt: now }
      : previous;
    current.count += 1;
    current.lastSeenAt = now;
    windows.set(key, current);
    const remaining = Math.max(0, options.maximum - current.count);
    const resetSeconds = Math.max(1, Math.ceil((current.startedAt + windowMilliseconds - now) / 1_000));
    res.setHeader("RateLimit-Limit", String(options.maximum));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(resetSeconds));
    if (current.count > options.maximum) {
      res.setHeader("Retry-After", String(resetSeconds));
      return res.status(429).json({ error: "Request limit exceeded. Try again shortly.", requestId: req.requestId });
    }
    return next();
  };
}

export function clearRateLimitStateForTests() {
  windows.clear();
  lastCleanupAt = 0;
}
