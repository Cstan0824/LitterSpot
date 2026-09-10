import { z } from "zod";

export const mapPointSchema = z.object({ xMeters: z.number().finite(), yMeters: z.number().finite() }).strict();
export const mapPolygonSchema = z.array(mapPointSchema).min(3).max(128);

export const siteBackgroundTransformSchema = z.object({
  xMeters: z.number().finite(),
  yMeters: z.number().finite(),
  widthMeters: z.number().positive().finite(),
  heightMeters: z.number().positive().finite(),
  opacity: z.number().min(0).max(1),
}).strict();

export const siteMapDraftInputSchema = z.object({
  baseRevisionId: z.string().trim().min(1).max(160),
  expectedRevision: z.number().int().positive().optional(),
  widthMeters: z.number().positive().finite(),
  heightMeters: z.number().positive().finite(),
  gridSizeMeters: z.number().positive().finite(),
  backgroundMediaId: z.string().trim().min(1).max(160).nullable().optional(),
  backgroundTransform: siteBackgroundTransformSchema.nullable().optional(),
  zones: z.array(z.object({
    zoneId: z.string().trim().min(1).max(160),
    zoneNameSnapshot: z.string().trim().min(1).max(120),
    polygon: mapPolygonSchema,
  }).strict()).max(500),
  cameraPlacements: z.array(z.object({ id: z.string().trim().min(1).max(160), point: mapPointSchema, label: z.string().trim().max(160).optional() }).strict()).max(1_000).optional(),
  cameraPlacementChanges: z.array(z.object({ cameraId: z.string().trim().min(1).max(160), mode: z.literal("map_position_correction"), reason: z.string().trim().min(3).max(500), confirmation: z.literal(true) }).strict()).max(100).optional(),
  cleanerStations: z.array(z.object({ id: z.string().trim().min(1).max(160), point: mapPointSchema, label: z.string().trim().max(160).optional() }).strict()).max(10_000).optional(),
}).strict().superRefine((value, context) => {
  if (value.backgroundMediaId && !value.backgroundTransform) context.addIssue({ code: z.ZodIssueCode.custom, path: ["backgroundTransform"], message: "Background alignment is required when a Site background is selected." });
  if (!value.backgroundMediaId && value.backgroundTransform) context.addIssue({ code: z.ZodIssueCode.custom, path: ["backgroundTransform"], message: "Background alignment requires a Site background image." });
  if (value.gridSizeMeters > Math.max(value.widthMeters, value.heightMeters)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["gridSizeMeters"], message: "Grid size cannot exceed the Site Map boundary." });
  const structuralCount = value.zones.length + (value.cameraPlacements?.length ?? 0) + (value.cleanerStations?.length ?? 0);
  if (structuralCount > 100) context.addIssue({ code: z.ZodIssueCode.custom, message: "A Site Map draft supports up to 100 combined Zones, Camera Placements, and Cleaner Station Points." });
});

export const cameraPlacementChangeSchema = z.object({
  point: mapPointSchema,
  mode: z.enum(["map_position_correction", "physical_camera_move"]),
  provisionalZone: z.object({
    zoneId: z.string().trim().min(1).max(160),
    zoneNameSnapshot: z.string().trim().min(1).max(120),
    polygon: mapPolygonSchema,
  }).strict().nullable().optional(),
  reason: z.string().trim().min(3).max(500),
  expectedCameraRevision: z.number().int().nonnegative(),
  expectedMapRevisionId: z.string().trim().min(1).max(160),
  confirmation: z.literal(true),
}).strict().superRefine((value, context) => {
  if (value.provisionalZone && value.mode !== "physical_camera_move") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["provisionalZone"], message: "A provisional Zone is only supported for a Physical Camera Move." });
  }
});

export type SiteBackgroundTransform = z.infer<typeof siteBackgroundTransformSchema>;
export type SiteMapDraftInput = z.infer<typeof siteMapDraftInputSchema>;
export type CameraPlacementChange = z.infer<typeof cameraPlacementChangeSchema>;
