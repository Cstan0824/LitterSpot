export type VideoMetadataEvent = {
  readonly currentTarget: Pick<HTMLVideoElement, "duration">;
};

export type VideoMetadataState = {
  duration: number | null;
  ready: boolean;
};

export function createVideoMetadataUpdate(event: VideoMetadataEvent) {
  // Read the primitive while React still owns the synthetic event. The
  // returned updater may run after the callback returns, when currentTarget
  // is no longer available.
  const duration = Number(event.currentTarget.duration);
  return <T extends VideoMetadataState>(current: T | undefined): T | undefined =>
    current ? { ...current, duration: Number.isFinite(duration) ? duration : null } : current;
}
