import { useEffect, useState } from "react";

type Health = { status: "ok" | "degraded"; aiService?: { status?: string; modelReady?: boolean; modelVersion?: string; modelPath?: string; device?: string; reason?: string | null } };
type DashboardPageProps = { onOpenPlayground: () => void };

export function DashboardPage({ onOpenPlayground }: DashboardPageProps) {
  const [health, setHealth] = useState<Health>();
  const [checking, setChecking] = useState(true);
  const [checkedAt, setCheckedAt] = useState<string>();
  async function checkConnection() {
    setChecking(true);
    try { const response = await fetch("/api/health"); setHealth(await response.json()); }
    catch { setHealth({ status: "degraded", aiService: { status: "unavailable", reason: "Node API could not be reached." } }); }
    finally { setCheckedAt(new Date().toLocaleTimeString()); setChecking(false); }
  }
  useEffect(() => { void checkConnection(); }, []);
  const online = health?.status === "ok" && health.aiService?.modelReady;
  const statusText = checking ? "Checking connection" : online ? "System connected" : "Connection needs attention";
  return <main className="app-shell dashboard-shell">
    <header className="dashboard-header"><div><p className="eyebrow">LITTERSPOT / OPERATIONS</p><h1>Bin monitoring<br /><em>at a glance.</em></h1></div><button className="primary" onClick={onOpenPlayground}>Open detection playground <span>→</span></button></header>
    <section className={`connection-banner ${online ? "online" : "offline"}`}><span className="status-orb" /><div><strong>{statusText}</strong><p>{online ? "React reached Node, and Node confirmed the FastAPI model worker is ready." : "Start the services, then use Check again to verify the complete request path."}</p></div><button className="quiet" onClick={() => void checkConnection()} disabled={checking}>{checking ? "Checking…" : "Check again"}</button></section>
    <section className="dashboard-grid">
      <article className="card overview-card"><p className="eyebrow">System overview</p><h2>Connection proof</h2><p className="card-copy">This dashboard is intentionally a simple operational sample. Its health check travels from the React browser through the Node API and then to the private Python service.</p><div className="pipeline"><span>React</span><i>→</i><span>Node API</span><i>→</i><span>FastAPI</span><i>→</i><span>YOLOE</span></div><button className="text-button" onClick={onOpenPlayground}>Try a real image detection →</button></article>
      <article className="card status-card"><p className="eyebrow">Live service status</p><div className="service-row"><span>Public API</span><b className={health?.status === "ok" ? "good" : "bad"}>{health?.status ?? "unknown"}</b></div><div className="service-row"><span>Model worker</span><b className={health?.aiService?.modelReady ? "good" : "bad"}>{health?.aiService?.modelReady ? "ready" : health?.aiService?.status ?? "unknown"}</b></div><div className="service-row"><span>Compute device</span><b>{health?.aiService?.device ?? "—"}</b></div><div className="service-row"><span>Last check</span><b>{checkedAt ?? "—"}</b></div></article>
      <article className="card model-card"><p className="eyebrow">Loaded model</p><h2>{health?.aiService?.modelVersion ?? "No model reported"}</h2><p className="model-path">{health?.aiService?.modelPath ?? health?.aiService?.reason ?? "The Node API has not returned model information yet."}</p><span className={online ? "tag ready-tag" : "tag"}>{online ? "Ready for playground" : "Awaiting service"}</span></article>
    </section>
    <section className="card next-card"><div><p className="eyebrow">Next action</p><h2>Validate the end-to-end detection flow</h2><p>Open the playground, upload one CCTV frame, and inspect the returned model version, bounding boxes, confidence, and processing time.</p></div><button className="primary" onClick={onOpenPlayground}>Go to playground <span>→</span></button></section>
  </main>;
}
