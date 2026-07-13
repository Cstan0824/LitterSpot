import { z } from "zod";

export const detectionResponseSchema = z.object({
  modelVersion: z.string(),
  cameraId: z.string().nullable().optional(),
  image: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  detections: z.array(z.object({
    binId: z.string().nullable().optional(),
    className: z.enum(["normal trash bin", "full trash bin", "overflowing trash bin"]),
    confidence: z.number().min(0).max(1),
    confirmed: z.boolean(),
    confirmationFrames: z.number().int().nonnegative(),
    bbox: z.object({ x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() }),
  })),
  processingTimeMs: z.number().nonnegative(),
});

export type DetectionResponse = z.infer<typeof detectionResponseSchema>;

export const detectionOptionsSchema = z.object({
  confidence: z.coerce.number().min(0.01).max(0.99).default(0.25),
  iou: z.coerce.number().min(0.05).max(0.95).default(0.70),
  imgsz: z.coerce.number().int().min(320).max(1280).default(768),
  maxDetections: z.coerce.number().int().min(1).max(300).default(100),
  cameraId: z.string().trim().min(1).max(100).optional(),
  confirmationFrames: z.coerce.number().int().min(1).max(20).default(3),
});

export type DetectionOptions = z.infer<typeof detectionOptionsSchema>;
