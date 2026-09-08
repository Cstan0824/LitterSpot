import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { SiteCameraMonitoring } from "../../shared/cameraMonitoring";
import type { ApiSettings } from "./api";

export function CameraRuntimeSandbox({ settings, visible }: { settings: ApiSettings; visible: boolean }) {
  const monitor = useMemo(() => new SiteCameraMonitoring((path, options = {}) => {
    const headers = new Headers(options.headers); headers.set("Authorization", `Bearer ${settings.token}`);
    return fetch(`${settings.baseUrl}${path}`, { ...options, headers });
  }), [settings.baseUrl, settings.token]);
  const [started, setStarted] = useState(false);
  const state = useSyncExternalStore(monitor.subscribe, monitor.snapshot);
  useEffect(() => () => { void monitor.stop(); }, [monitor]);
  return <section hidden={!visible}>
    <h2>Site Camera runtime</h2>
    <p>This runtime continues when you select another sandbox tab. It uses the same coordinator as the Supervisor app.</p>
    {!started && <button onClick={() => { monitor.start(); setStarted(true); }}>Connect Supervisor monitoring session</button>}
    <p>{state.owner ? "This browser owns monitoring" : "Viewer / waiting for owner"} {state.error}</p>
    {Object.values(state.cameras).map(view => <article key={view.camera.id}>
      <h3>{view.camera.name}</h3><button disabled={view.controlBusy} onClick={() => void monitor.toggle(view.camera.id)}>{view.camera.monitoringEnabled ? "Disable" : "Enable"}</button>
      <p>{view.message}</p>
      {view.frameDataUrl && <div style={{ position: "relative", width: "min(100%, 640px)" }}>
        <img src={view.frameDataUrl} alt="Analyzed Camera frame" style={{ width: "100%", display: "block" }} />
        <svg viewBox={`0 0 ${view.observation?.image.width} ${view.observation?.image.height}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
          {[...(view.observation?.people ?? []), ...(view.observation?.bins ?? []), ...(view.observation?.issues ?? []).map(i => ({ bbox: i.geometry?.bbox }))].map((d, i) => d.bbox && <rect key={i} x={d.bbox.x1} y={d.bbox.y1} width={d.bbox.x2 - d.bbox.x1} height={d.bbox.y2 - d.bbox.y1} fill="none" stroke="lime" strokeWidth="2" />)}
        </svg>
      </div>}
      <details><summary>Observation contract</summary><pre>{JSON.stringify(view.observation ?? {}, null, 2)}</pre></details>
    </article>)}
  </section>;
}
