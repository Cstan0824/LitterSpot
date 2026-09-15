import { useEffect, useState } from "react";
import { apiRequest } from "../services/api/http";
import { ObservationOverlay } from "../features/operations/CameraLiveView";
import type { CameraObservation } from "../../../shared/cameraMonitoring";

export function RetainedCameraEvidence({ mediaId, url, alt }: { mediaId: string; url: string; alt: string }) {
  const [observation, setObservation] = useState<CameraObservation>();
  useEffect(() => {
    setObservation(undefined); const controller = new AbortController();
    void apiRequest<{ observation: CameraObservation | null }>(`/api/media/${encodeURIComponent(mediaId)}/overlay`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setObservation(result.observation ?? undefined); }).catch(() => undefined);
    return () => controller.abort();
  }, [mediaId]);
  return <div className="camera-retained-frame"><img src={url} alt={alt} />{observation?.image && <ObservationOverlay observation={observation} compact />}</div>;
}
