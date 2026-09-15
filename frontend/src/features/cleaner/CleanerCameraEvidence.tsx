import { useEffect, useState } from "react";
import { apiRequest } from "../../services/api/http";
import type { CameraObservation } from "../../../../shared/cameraMonitoring";
import { ObservationOverlay } from "../operations/CameraLiveView";

export function CleanerCameraEvidence({ workOrderId }: { workOrderId: string }) {
  const [url, setUrl] = useState<string>(); const [observation, setObservation] = useState<CameraObservation>(); const [loading, setLoading] = useState(true); const [failed, setFailed] = useState(false); const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let objectUrl: string | undefined;
    setUrl(undefined); setObservation(undefined); setLoading(true); setFailed(false);
    const path = `/api/cleaner/work-orders/${encodeURIComponent(workOrderId)}/camera-evidence`;
    void Promise.all([apiRequest<{ evidence: { observation?: CameraObservation } }>(path, { signal: controller.signal }), apiRequest<Blob>(`${path}?content=true`, { signal: controller.signal, responseType: "blob" })]).then(([result, blob]) => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); setObservation(result.evidence.observation);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attempt, workOrderId]);
  if (loading) return <p className="cleaner-evidence-loading">Loading Camera evidence…</p>;
  if (failed || !url) return <div className="cleaner-evidence-error"><p>Camera evidence could not be loaded.</p><button type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></div>;
  return <div className="camera-retained-frame"><img src={url} alt="Camera evidence for your cleaning task" />{observation?.image && <ObservationOverlay observation={observation} compact />}</div>;
}
