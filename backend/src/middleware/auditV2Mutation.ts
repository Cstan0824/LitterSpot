import type { RequestHandler } from "express";
import { writeV2AuditEvent } from "../services/v2AuditService.js";

/** Request-level supplement to domain transaction audits. No bodies or credentials. */
export const auditV2Mutation: RequestHandler = (req, res, next) => {
  if (!req.authUser?.siteId || !["POST", "PUT", "PATCH", "DELETE"].includes(req.method)
    || /\/(samples|heartbeat|minute-flush|age)$/.test(req.path)) return next();
  const siteId = req.authUser.siteId;
  const actor = { uid: req.authUser.uid, role: "supervisor" as const, authority: req.authUser.authority, displayName: req.authUser.displayName };
  const auditedBaseUrl = req.baseUrl;
  const auditedResourceId = req.originalUrl.split("?")[0];
  const siteMapMutation = auditedBaseUrl === "/api/site-map";
  const originalJson = res.json.bind(res), originalSend = res.send.bind(res);
  const restore = () => { res.json = originalJson; res.send = originalSend; };
  const audit = (outcome: "succeeded" | "failed", body?: unknown) => {
    const response = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const details = response.details && typeof response.details === "object" ? response.details as Record<string, unknown> : {};
    return writeV2AuditEvent({
      actor,
      siteId,
      action: outcome === "failed" ? siteMapMutation ? "site_map_request_failed" : "api_control_failed" : "api_control_changed",
      resourceType: siteMapMutation ? "SiteMapControl" : "ApiControl",
      resourceId: auditedResourceId,
      outcome,
      reason: outcome === "failed" && typeof response.error === "string" ? response.error : null,
      errorCode: outcome === "failed" ? typeof response.code === "string" ? response.code : typeof details.code === "string" ? details.code : `http_${res.statusCode}` : null,
      after: { method: req.method, statusCode: res.statusCode },
      requestId: req.requestId,
    });
  };
  res.json = (body: any) => {
    restore();
    const outcome = res.statusCode >= 200 && res.statusCode < 300 ? "succeeded" : "failed";
    void audit(outcome, body).then(() => originalJson(body)).catch(() => originalJson(body));
    return res;
  };
  res.send = (body?: any) => {
    restore();
    if (res.statusCode !== 204) return originalSend(body);
    void audit("succeeded", body).then(() => originalSend(body)).catch(() => originalSend(body));
    return res;
  };
  next();
};
