import { useEffect, useState } from "react";
import { loadAuthenticatedMedia, releaseAuthenticatedMedia } from "../../services/api/media";

export function CleanerCompletionEvidence({ workOrderId }: { workOrderId: string }) {
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const key = `cleaner-completion:${workOrderId}`;
    const controller = new AbortController();
    setUrl(undefined);
    setFailed(false);
    void loadAuthenticatedMedia(key, `/api/cleaner/work-orders/${encodeURIComponent(workOrderId)}/completion-evidence`, controller.signal)
      .then(setUrl)
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); releaseAuthenticatedMedia(key); };
  }, [attempt, workOrderId]);

  if (failed) return <div className="cleaner-evidence-error"><p>Your submitted photo could not be loaded.</p><button type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></div>;
  return url ? <img className="cleaner-submitted-photo" src={url} alt="Your submitted completion photo" /> : <p className="cleaner-evidence-loading">Loading your submitted photo…</p>;
}
