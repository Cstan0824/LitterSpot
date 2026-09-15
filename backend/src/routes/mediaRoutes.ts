import { Router } from "express";
import { getMedia, getMediaContent } from "../services/mediaService.js";
import { firestore } from "../config/firebase.js";
import { HttpError } from "../shared/httpError.js";

async function assertMediaSite(mediaId: string, siteId: string | null) {
  const media = await firestore.collection("mediaAssets").doc(mediaId).get();
  if (!media.exists || siteId && media.data()?.siteId !== siteId) throw new HttpError(404, "Media not found.");
  return media.data()!;
}

export const mediaRoutes = Router();

mediaRoutes.get("/:mediaId/content", async (req, res) => {
  await assertMediaSite(req.params.mediaId, req.authUser.siteId);
  const media = await getMediaContent(req.params.mediaId);
  res.type(media.mimeType);
  res.setHeader("Content-Length", String(media.byteSize));
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(media.originalFileName)}`);
  // MEDIA_STORAGE_ROOT may intentionally live under an ignored `.local`
  // directory. The storage service has already resolved and validated the
  // absolute path, so allow dot-directory segments when Express serves it.
  return res.sendFile(media.filePath, { dotfiles: "allow" });
});

mediaRoutes.get("/:mediaId/overlay", async (req, res) => {
  const media = await assertMediaSite(req.params.mediaId, req.authUser.siteId);
  res.json({ observation: media.evidenceObservation ?? null });
});

mediaRoutes.get("/:mediaId", async (req, res) => {
  await assertMediaSite(req.params.mediaId, req.authUser.siteId);
  return res.json({ media: await getMedia(req.params.mediaId) });
});
