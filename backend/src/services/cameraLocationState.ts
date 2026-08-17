export function cameraLatestPointerReset(currentZoneId: unknown, requestedZoneId: string | undefined) {
  if (!requestedZoneId || requestedZoneId === String(currentZoneId ?? "")) return {};
  return {
    latestAnalysisRunId: null,
    latestAnalysisAt: null,
    latestCapturedAt: null,
  };
}
