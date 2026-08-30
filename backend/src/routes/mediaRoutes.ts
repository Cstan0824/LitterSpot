import { Router } from "express";
import multer from "multer";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { imageUploadSchema, mediaListQuerySchema, videoUploadSchema } from "../schemas/media.js";
import { createImageUpload, getMedia, getMediaContent, listMedia } from "../services/mediaService.js";
import { discardTemporaryMedia } from "../services/localMediaStorage.js";
import { createVideoUpload } from "../services/videoMediaService.js";
import { rateLimit } from "../middleware/rateLimit.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      void mkdir(env.videoUploadTempRoot, { recursive: true })
        .then(() => callback(null, env.videoUploadTempRoot))
        .catch((error: Error) => callback(error, env.videoUploadTempRoot));
    },
    filename: (_req, _file, callback) => callback(null, `${randomUUID()}.upload`),
  }),
  limits: { fileSize: env.videoMaxBytes, files: 1 },
});
const uploadRateLimit = rateLimit({ namespace: "media-upload", maximum: env.uploadRateLimitPerMinute });

export const mediaRoutes = Router();

mediaRoutes.get("/", async (req, res) => {
  const query = mediaListQuerySchema.parse(req.query);
  const page = await listMedia({
    cameraId: query.cameraId,
    isTest: query.isTest === undefined ? undefined : query.isTest === "true",
    limit: query.limit,
    cursor: query.cursor,
  });
  return res.json({
    mediaAssets: page.items,
    nextCursor: page.nextCursor,
  });
});

mediaRoutes.post("/images", uploadRateLimit, upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "An image file is required.", requestId: req.requestId });
  const result = await createImageUpload(req.file, imageUploadSchema.parse(req.body), req.supervisor.uid);
  return res.status(result.idempotent ? 200 : 201).json(result);
});

mediaRoutes.post("/videos", uploadRateLimit, videoUpload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "A video file is required.", requestId: req.requestId });
  let handedToVideoService = false;
  try {
    const input = videoUploadSchema.parse(req.body);
    handedToVideoService = true;
    const result = await createVideoUpload(req.file, input, req.supervisor.uid);
    return res.status(result.idempotent ? 200 : 201).json(result);
  } finally {
    // createVideoUpload owns cleanup after it is called, including preserving a
    // Firestore-accepted staging file for startup recovery.
    if (!handedToVideoService) await discardTemporaryMedia(req.file.path).catch(() => undefined);
  }
});

mediaRoutes.get("/:mediaId/content", async (req, res) => {
  const media = await getMediaContent(req.params.mediaId);
  res.type(media.mimeType);
  res.setHeader("Content-Length", String(media.byteSize));
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(media.originalFileName)}`);
  // MEDIA_STORAGE_ROOT may intentionally live under an ignored `.local`
  // directory. The storage service has already resolved and validated the
  // absolute path, so allow dot-directory segments when Express serves it.
  return res.sendFile(media.filePath, { dotfiles: "allow" });
});

mediaRoutes.get("/:mediaId", async (req, res) => {
  return res.json({ media: await getMedia(req.params.mediaId) });
});
