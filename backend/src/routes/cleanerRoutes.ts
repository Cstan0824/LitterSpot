import { Router } from "express";
import { z } from "zod";
import { createCleaner, listCleanersPage, presentCleaner, updateCleaner } from "../services/cleanerService.js";
import { boundedListQueryFields } from "../schemas/pagination.js";

const range = z.object({ startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(0).max(1439) }).strict().nullable();
const schedule = z.object({ mon: range.optional(), tue: range.optional(), wed: range.optional(), thu: range.optional(), fri: range.optional(), sat: range.optional(), sun: range.optional() }).strict();
const point = z.object({ xMeters: z.number().finite().nonnegative(), yMeters: z.number().finite().nonnegative() }).strict();
const actor = (req: Express.Request) => ({ uid: req.authUser.uid, role: "supervisor" as const, authority: req.authUser.authority, displayName: req.authUser.displayName });

export const cleanerRoutes = Router();

cleanerRoutes.get("/", async (req, res) => {
  const query = z.object({ ...boundedListQueryFields, status: z.enum(["active", "inactive", "all"]).default("all") }).strict().parse(req.query);
  const page = await listCleanersPage(String(req.authUser.siteId), query);
  return res.json({ cleaners: page.items, ...page });
});

cleanerRoutes.get("/:cleanerId", async (req, res) => res.json({ cleaner: await presentCleaner(req.params.cleanerId, String(req.authUser.siteId)) }));

cleanerRoutes.post("/", async (req, res) => {
  const input = z.object({ staffCode: z.string().trim().min(2).max(30), fullName: z.string().trim().min(2).max(80), phone: z.string().trim().min(8).max(30), email: z.string().trim().email(), password: z.string().min(8).max(128), notes: z.string().trim().max(500).nullable().optional(), profileMediaId: z.string().trim().min(1).nullable().optional(), weeklySchedule: schedule, stationPoint: point, idempotencyKey: z.string().trim().min(8).max(160) }).strict().parse(req.body);
  return res.status(201).json({ cleaner: await createCleaner({ ...input, siteId: String(req.authUser.siteId) }, actor(req), req.requestId) });
});

cleanerRoutes.patch("/:cleanerId", async (req, res) => {
  const input = z.object({ expectedRevision: z.number().int().nonnegative(), fullName: z.string().trim().min(2).max(80).optional(), phone: z.string().trim().min(8).max(30).optional(), notes: z.string().trim().max(500).nullable().optional(), profileMediaId: z.string().trim().min(1).nullable().optional(), weeklySchedule: schedule.optional(), availabilityOverride: z.enum(["none", "unavailable"]).optional(), status: z.enum(["active", "inactive"]).optional() }).strict().refine((value) => Object.keys(value).some((key) => key !== "expectedRevision"), "At least one change is required.").parse(req.body);
  return res.json({ cleaner: await updateCleaner({ ...input, siteId: String(req.authUser.siteId), cleanerId: req.params.cleanerId }, actor(req), req.requestId) });
});

cleanerRoutes.put("/:cleanerId/schedule", async (req, res) => {
  const input = z.object({ expectedRevision: z.number().int().nonnegative(), weeklySchedule: schedule }).strict().parse(req.body);
  return res.json({ cleaner: await updateCleaner({ ...input, siteId: String(req.authUser.siteId), cleanerId: req.params.cleanerId }, actor(req), req.requestId) });
});

cleanerRoutes.put("/:cleanerId/availability-override", async (req, res) => {
  const input = z.object({ expectedRevision: z.number().int().nonnegative(), availabilityOverride: z.enum(["none", "unavailable"]) }).strict().parse(req.body);
  return res.json({ cleaner: await updateCleaner({ ...input, siteId: String(req.authUser.siteId), cleanerId: req.params.cleanerId }, actor(req), req.requestId) });
});

cleanerRoutes.delete("/:cleanerId", async (req, res) => {
  const input = z.object({ expectedRevision: z.number().int().nonnegative() }).strict().parse(req.body);
  return res.json({ cleaner: await updateCleaner({ ...input, status: "inactive", siteId: String(req.authUser.siteId), cleanerId: req.params.cleanerId }, actor(req), req.requestId) });
});
