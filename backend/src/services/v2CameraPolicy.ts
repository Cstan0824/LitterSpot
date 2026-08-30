export type CameraSourceType = "laptop_camera" | "looped_video";

export function validateCameraSource(input: { existingCameraCount: number; existingLaptopCameraId?: string | null; sourceType: CameraSourceType; sourceMediaId?: string | null }) {
  const errors: string[] = [];
  if (input.existingCameraCount === 0 && input.sourceType !== "laptop_camera") errors.push("first_camera_must_use_laptop_camera");
  if (input.sourceType === "laptop_camera" && input.existingLaptopCameraId) errors.push("only_one_laptop_camera_is_allowed");
  if (input.sourceType === "looped_video" && !input.sourceMediaId) errors.push("looped_video_requires_source_media");
  if (input.sourceType === "laptop_camera" && input.sourceMediaId) errors.push("laptop_camera_cannot_use_source_media");
  return { valid: errors.length === 0, errors, monitoringEnabled: input.sourceType === "laptop_camera", isSimulation: input.sourceType === "looped_video" };
}

export function publishCameraState(input: { sourceType: CameraSourceType; previousMonitoringEnabled?: boolean; replacement: boolean }) {
  return { status: "active" as const, monitoringEnabled: input.replacement ? Boolean(input.previousMonitoringEnabled) : input.sourceType === "laptop_camera", isSimulation: input.sourceType === "looped_video" };
}

