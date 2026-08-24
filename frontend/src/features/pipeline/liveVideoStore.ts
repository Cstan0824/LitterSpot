import type { PipelineResult } from "./types";

export const cameraOptions = ["CAMERA-1", "CAMERA-2", "CAMERA-3", "CAMERA-4", "CAMERA-5", "CAMERA-6"] as const;

export type LiveVideo = {
  id: string;
  url: string;
  name: string;
  cameraId: string;
  uploadedAt: string;
  analysis?: PipelineResult;
};

const videos = new Map<string, LiveVideo>();
const listeners = new Set<() => void>();

export function publishLiveVideo(file: File, cameraId: string) {
  const targetCamera = cameraId.trim() || "CAMERA-1";
  const previous = videos.get(targetCamera);
  if (previous) URL.revokeObjectURL(previous.url);
  videos.set(targetCamera, {
    id: crypto.randomUUID(),
    url: URL.createObjectURL(file),
    name: file.name,
    cameraId: targetCamera,
    uploadedAt: new Date().toISOString(),
  });
  listeners.forEach((listener) => listener());
  return videos.get(targetCamera)!.id;
}

export function getLiveVideos() {
  return Array.from(videos.values());
}

export function moveLiveVideo(id: string, cameraId: string) {
  const source = Array.from(videos.entries()).find(([, video]) => video.id === id);
  if (!source || source[0] === cameraId) return;
  const [previousCamera, current] = source;
  const replaced = videos.get(cameraId);
  if (replaced) URL.revokeObjectURL(replaced.url);
  videos.delete(previousCamera);
  videos.set(cameraId, { ...current, cameraId });
  listeners.forEach((listener) => listener());
}

export function updateLiveVideoAnalysis(cameraId: string, analysis: PipelineResult) {
  const current = videos.get(cameraId);
  if (!current) return;
  videos.set(cameraId, { ...current, analysis });
  listeners.forEach((listener) => listener());
}

export function subscribeLiveVideo(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
