import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requireRootSupervisor } from "../middleware/requireRole.js";
import { deleteMapDraft, getMap, getMapDraft, listMapRevisions, listRetiredZones, publishCleanerStation, publishMapDraft, saveMapDraft, startMapDraft, validateMapDraft } from "../services/mapService.js";
import { cameraPlacementChangeSchema, mapPointSchema, siteMapDraftInputSchema } from "../schemas/siteMap.js";
import { uploadSiteBackground } from "../services/siteBackgroundService.js";
import { changeCameraPlacement } from "../services/cameraPlacementService.js";
import { HttpError } from "../shared/httpError.js";

export const siteMapRoutes = Router();
const auditActor = (req: Express.Request) => ({ uid: req.authUser.uid, role: "supervisor" as const, authority: req.authUser.authority, displayName: req.authUser.displayName });
const backgroundUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

siteMapRoutes.get("/", async (req, res) => res.json({ map: await getMap(String(req.supervisor.siteId ?? req.query.siteId)) }));
siteMapRoutes.get("/revisions", async (req, res) => res.json({ revisions: await listMapRevisions(String(req.supervisor.siteId)) }));
siteMapRoutes.get("/retired-zones", requireRootSupervisor, async (req, res) => res.json({ zones: await listRetiredZones(String(req.supervisor.siteId)) }));
siteMapRoutes.get("/draft", requireRootSupervisor, async (req, res) => {
  const map = await getMapDraft(String(req.supervisor.siteId));
  return res.json({ draft: { id: map.draft.id, ...map.data }, background: map.background, zones: map.zones.docs.map((document) => ({ id: document.id, ...document.data() })), cameraPlacements: map.cameraPlacements.docs.map((document) => ({ id: document.id, ...document.data() })), cleanerStations: map.cleanerStations.docs.map((document) => ({ id: document.id, ...document.data() })) });
});
siteMapRoutes.post("/draft/start", requireRootSupervisor, async (req, res) => res.status(201).json({ draft: await startMapDraft(String(req.supervisor.siteId), auditActor(req), req.requestId) }));
siteMapRoutes.post("/draft", requireRootSupervisor, async (req, res) => {
  const input = siteMapDraftInputSchema.parse(req.body);
  const map = await saveMapDraft({ ...input, siteId: String(req.supervisor.siteId), cameraPlacements: input.cameraPlacements?.map((value) => ({ ...value, label: value.label ?? `camera_${value.id}` })), cleanerStations: input.cleanerStations?.map((value) => ({ ...value, label: value.label ?? `cleaner_${value.id}` })), actor: auditActor(req), requestId: req.requestId });
  return res.json({ draft: map.data, zones: map.zones.docs.map((doc) => ({ id: doc.id, ...doc.data() })) });
});
siteMapRoutes.post("/draft/validate", requireRootSupervisor, async (req, res) => res.json(await validateMapDraft(String(req.supervisor.siteId), auditActor(req), req.requestId)));
siteMapRoutes.post("/draft/publish", requireRootSupervisor, async (req, res) => res.json({ map: await publishMapDraft(String(req.supervisor.siteId), auditActor(req), req.requestId) }));
siteMapRoutes.delete("/draft", requireRootSupervisor, async (req, res) => {
  await deleteMapDraft(String(req.supervisor.siteId), auditActor(req), req.requestId);
  return res.status(204).send();
});
siteMapRoutes.post("/background", requireRootSupervisor, backgroundUpload.single("image"), async (req, res) => {
  if (!req.file) throw new HttpError(400, "A Site background image is required.");
  return res.status(201).json({ background: await uploadSiteBackground({ siteId: String(req.supervisor.siteId), file: req.file, actor: auditActor(req), requestId: req.requestId }) });
});
siteMapRoutes.post("/camera-placements/:cameraId", requireRootSupervisor, async (req, res) => {
  const input = cameraPlacementChangeSchema.parse(req.body);
  return res.json({ placement: await changeCameraPlacement({ ...input, siteId: String(req.supervisor.siteId), cameraId: String(req.params.cameraId), actor: auditActor(req), requestId: req.requestId }) });
});
siteMapRoutes.put("/station-points/:cleanerId", async (req, res) => {
  const input = z.object({ point: mapPointSchema }).strict().parse(req.body);
  return res.json({ station: await publishCleanerStation({ siteId: String(req.supervisor.siteId), cleanerId: req.params.cleanerId, point: input.point, actorUid: req.authUser.uid, actorAuthority: req.authUser.authority!, actorName: req.authUser.displayName, requestId: req.requestId }) });
});
