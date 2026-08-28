import type { CameraRegistrationWorkspace } from "../../../services/locationAPI";

export type RestorableVideoSource = {
  mediaId: string;
  contentUrl: string;
  fileName: string;
  mimeType: string;
  duration: number | null;
  capturedFrameTime: number;
};

export function restorableVideoSource(workspace: CameraRegistrationWorkspace): RestorableVideoSource | undefined {
  const source = workspace.registration?.referenceSource;
  const media = workspace.sourceMedia;
  if (!source || source.type !== "video" || !media?.available || media.id !== source.mediaId || !media.mimeType.startsWith("video/")) {
    return undefined;
  }
  return {
    mediaId: media.id,
    contentUrl: media.contentUrl,
    fileName: media.originalFileName,
    mimeType: media.mimeType,
    duration: media.durationSeconds ?? source.durationSeconds ?? null,
    capturedFrameTime: source.capturedFrameTimeSeconds,
  };
}
