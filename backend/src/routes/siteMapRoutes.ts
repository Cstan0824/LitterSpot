import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requireRootSupervisor } from "../middleware/requireRole.js";
import { deleteV2MapDraft, getV2Map, getV2MapDraft, listV2MapRevisions, listV2RetiredZones, publishV2CleanerStation, publishV2MapDraft, saveV2MapDraft, startV2MapDraft, validateV2MapDraft } from "../services/v2MapService.js";
import { cameraPlacementChangeSchema, mapPointSchema, siteMapDraftInputSchema } from "../schemas/siteMap.js";
import { uploadV2SiteBackground } from "../services/v2SiteBackgroundService.js";
import { changeV2CameraPlacement } from "../services/v2CameraPlacementService.js";
import { HttpError } from "../shared/httpError.js";

export const siteMapRoutes = Router();
const auditActor = (req: Express.Request) => ({ uid: req.authUser.uid, role: "supervisor" as const, authority: req.authUser.authority, displayName: req.authUser.displayName });
const backgroundUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

siteMapRoutes.get("/", async (req, res) => res.json({ map: await getV2Map(String(req.supervisor.siteId ?? req.query.siteId)) }));
siteMapRoutes.get("/revisions", async (req, res) => res.json({ revisions: await listV2MapRevisions(String(req.supervisor.siteId)) }));
siteMapRoutes.get("/retired-zones", requireRootSupervisor, async (req, res) => res.json({ zones: await listV2RetiredZones(String(req.supervisor.siteId)) }));
siteMapRoutes.get("/draft", requireRootSupervisor, async (req, res) => {
  const map = await getV2MapDraft(String(req.supervisor.siteId));
  return res.json({ draft: { id: map.draft.id, ...map.data }, background: map.background, zones: map.zones.docs.map((document) => ({ id: document.id, ...document.data() })), cameraPlacements: map.cameraPlacements.docs.map((document) => ({ id: document.id, ...document.data() })), cleanerStations: map.cleanerStations.docs.map((document) => ({ id: document.id, ...document.data() })) });
});
siteMapRoutes.post("/draft/start", requireRootSupervisor, async (req, res) => res.status(201).json({ draft: await startV2MapDraft(String(req.supervisor.siteId), auditActor(req), req.requestId) }));
siteMapRoutes.post("/draft", requireRootSupervisor, async (req, res) => {
  const input = siteMapDraftInputSchema.parse(req.body);
  const map = await saveV2MapDraft({ ...input, siteId: String(req.supervisor.siteId), cameraPlacements: input.cameraPlacements?.map((value) => ({ ...value, label: value.label ?? `camera_${value.id}` })), cleanerStations: input.cleanerStations?.map((value) => ({ ...value, label: value.label ?? `cleaner_${value.id}` })), actor: auditActor(req), requestId: req.requestId });
  return res.json({ draft: map.data, zones: map.zones.docs.map((doc) => ({ id: doc.id, ...doc.data() })) });
});
siteMapRoutes.post("/draft/validate", requireRootSupervisor, async (req, res) => res.json(await validateV2MapDraft(String(req.supervisor.siteId), auditActor(req), req.requestId)));
siteMapRoutes.post("/draft/publish", requireRootSupervisor, async (req, res) => res.json({ map: await publishV2MapDraft(String(req.supervisor.siteId), auditActor(req), req.requestId) }));
siteMapRoutes.delete("/draft", requireRootSupervisor, async (req, res) => {
  await deleteV2MapDraft(String(req.supervisor.siteId), auditActor(req), req.requestId);
  return res.status(204).send();
});
siteMapRoutes.post("/background", requireRootSupervisor, backgroundUpload.single("image"), async (req, res) => {
  if (!req.file) throw new HttpError(400, "A Site background image is required.");
  return res.status(201).json({ background: await uploadV2SiteBackground({ siteId: String(req.supervisor.siteId), file: req.file, actor: auditActor(req), requestId: req.requestId }) });
});
siteMapRoutes.post("/camera-placements/:cameraId", requireRootSupervisor, async (req, res) => {
  const input = cameraPlacementChangeSchema.parse(req.body);
  return res.json({ placement: await changeV2CameraPlacement({ ...input, siteId: String(req.supervisor.siteId), cameraId: String(req.params.cameraId), actor: auditActor(req), requestId: req.requestId }) });
});
siteMapRoutes.put("/station-points/:cleanerId", async (req, res) => {
  const input = z.object({ point: mapPointSchema }).strict().parse(req.body);
  return res.json({ station: await publishV2CleanerStation({ siteId: String(req.supervisor.siteId), cleanerId: req.params.cleanerId, point: input.point, actorUid: req.authUser.uid, actorAuthority: req.authUser.authority!, actorName: req.authUser.displayName, requestId: req.requestId }) });
});
