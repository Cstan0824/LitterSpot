import type { RequestHandler } from "express";
import { writeV2AuditEvent } from "../services/v2AuditService.js";

/** Request-level supplement to domain transaction audits. No bodies or credentials. */
export const auditV2Mutation: RequestHandler = (req, res, next) => {
  if (!req.authUser?.siteId || !["POST", "PUT", "PATCH", "DELETE"].includes(req.method)
    || /\/(samples|heartbeat|validate|minute-flush|age)$/.test(req.path)) return next();
  const siteId = req.authUser.siteId;
  const actor = { uid: req.authUser.uid, role: "supervisor" as const, authority: req.authUser.authority, displayName: req.authUser.displayName };
  const originalJson = res.json.bind(res), originalSend = res.send.bind(res);
  const restore = () => { res.json = originalJson; res.send = originalSend; };
  const audit = () => writeV2AuditEvent({
    actor, siteId, action: "api_control_changed", resourceType: "ApiControl", resourceId: `${req.baseUrl}${req.route?.path ?? req.path}`,
    outcome: "succeeded", after: { method: req.method, statusCode: res.statusCode }, requestId: req.requestId,
  });
  res.json = (body: any) => {
    restore();
    if (res.statusCode < 200 || res.statusCode >= 300) return originalJson(body);
    void audit().then(() => originalJson(body)).catch(next);
    return res;
  };
  res.send = (body?: any) => {
    restore();
    if (res.statusCode !== 204) return originalSend(body);
    void audit().then(() => originalSend(body)).catch(next);
    return res;
  };
  next();
};
