import { Router } from "express";
import { z } from "zod";
import { requireRootSupervisor } from "../middleware/requireRole.js";
import { deleteV2MapDraft, getV2Map, getV2MapDraft, listV2MapRevisions, publishV2CleanerStation, publishV2MapDraft, saveV2MapDraft, validateV2MapDraft } from "../services/v2MapService.js";

const point = z.object({ xMeters: z.number().finite(), yMeters: z.number().finite() });
const polygon = z.array(point).min(3);
export const siteMapRoutes = Router();

siteMapRoutes.get("/", async (req, res) => res.json({ map: await getV2Map(String(req.supervisor.siteId ?? req.query.siteId)) }));
siteMapRoutes.get("/revisions", async (req, res) => res.json({ revisions: await listV2MapRevisions(String(req.supervisor.siteId)) }));
siteMapRoutes.get("/draft", async (req, res) => {
  const map = await getV2MapDraft(String(req.supervisor.siteId));
  return res.json({ draft: { id: map.draft.id, ...map.data }, zones: map.zones.docs.map((document) => ({ id: document.id, ...document.data() })), cameraPlacements: map.cameraPlacements.docs.map((document) => ({ id: document.id, ...document.data() })), cleanerStations: map.cleanerStations.docs.map((document) => ({ id: document.id, ...document.data() })) });
});
siteMapRoutes.post("/draft", requireRootSupervisor, async (req, res) => {
  const input = z.object({ baseRevisionId: z.string().min(1), widthMeters: z.number().positive(), heightMeters: z.number().positive(), gridSizeMeters: z.number().positive(), backgroundMediaId: z.string().nullable().optional(), backgroundTransform: z.record(z.number()).nullable().optional(), zones: z.array(z.object({ zoneId: z.string().min(1), zoneNameSnapshot: z.string().min(1), polygon })), cameraPlacements: z.array(z.object({ id: z.string().min(1), point, label: z.string().optional() })).optional(), cleanerStations: z.array(z.object({ id: z.string().min(1), point, label: z.string().optional() })).optional() }).strict().parse(req.body);
  const map = await saveV2MapDraft({ ...input, siteId: String(req.supervisor.siteId), cameraPlacements: input.cameraPlacements?.map((value) => ({ ...value, label: value.label ?? `camera_${value.id}` })), cleanerStations: input.cleanerStations?.map((value) => ({ ...value, label: value.label ?? `cleaner_${value.id}` })), actorUid: req.authUser.uid });
  return res.json({ draft: map.data, zones: map.zones.docs.map((doc) => ({ id: doc.id, ...doc.data() })) });
});
siteMapRoutes.post("/draft/validate", requireRootSupervisor, async (req, res) => res.json(await validateV2MapDraft(String(req.supervisor.siteId))));
siteMapRoutes.post("/draft/publish", requireRootSupervisor, async (req, res) => res.json({ map: await publishV2MapDraft(String(req.supervisor.siteId), req.authUser.uid) }));
siteMapRoutes.delete("/draft", requireRootSupervisor, async (req, res) => {
  await deleteV2MapDraft(String(req.supervisor.siteId), req.authUser.uid);
  return res.status(204).send();
});
siteMapRoutes.put("/station-points/:cleanerId", async (req, res) => {
  const input = z.object({ point }).strict().parse(req.body);
  return res.json({ station: await publishV2CleanerStation({ siteId: String(req.supervisor.siteId), cleanerId: req.params.cleanerId, point: input.point, actorUid: req.authUser.uid, actorAuthority: req.authUser.authority!, actorName: req.authUser.displayName, requestId: req.requestId }) });
});
