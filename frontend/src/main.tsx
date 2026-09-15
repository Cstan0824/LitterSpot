import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
// TypeScript may complain about missing type declarations for CSS imports.
// @ts-ignore
import "./styles.css";
import "./field-station.css";
import { OperationsConsole } from "./features/operations/OperationsConsole";
import { LoginPage } from "./pages/LoginPage";
import { CameraRegistrationPage } from "./pages/CameraRegistrationPage";
import { FieldStationShell } from "./components/FieldStationShell";
import { CleanerMobileApp } from "./features/cleaner/CleanerMobileApp";
import { SessionProvider, useSession } from "./session/SessionProvider";
import { supervisorRouteFromHash, type SupervisorRoute } from "./services/v2/routing";
import { deriveSupervisorCapabilities } from "./services/v2/session";
import { sessionErrorCopy } from "./services/v2/errors";
import { SiteMonitoringProvider } from "./features/operations/SiteMonitoringProvider";
import { SuperadminApp } from "./features/superadmin/SuperadminApp";

type OperationsPage = "dashboard" | "alerts" | "history" | "placement" | "cameras" | "admin" | "site" | "status";

function SessionFailure({ error, onRetry, onLogout }: { error: unknown; onRetry: () => void; onLogout: () => void }) {
  const copy = sessionErrorCopy(error);
  return <SessionRecovery title={copy.title} message={copy.message} onRetry={onRetry} onLogout={onLogout} />;
}

function SessionRecovery({ title, message, onRetry, onLogout, loading = false }: { title: string; message: string; onRetry?: () => void; onLogout?: () => void; loading?: boolean }) {
  return <main className="session-recovery-page"><header className="session-recovery-brand"><b>LS</b><div><strong>LitterSpot</strong><span>Application session</span></div></header><section className={`session-recovery-card ${loading ? "loading" : ""}`} aria-live="polite"><span>{loading ? "CONNECTING" : "SESSION STATUS"}</span><h1>{title}</h1><p>{message}</p>{loading ? <i aria-label="Loading" /> : <div className="session-recovery-actions"><button className="primary" type="button" onClick={onRetry}>Try again <span aria-hidden="true">→</span></button><button type="button" onClick={onLogout}>Sign out</button></div>}</section></main>;
}

function App() {
  const sessionState = useSession();
  const [route, setRoute] = useState<SupervisorRoute>(() => supervisorRouteFromHash(location.hash));
  useEffect(() => {
    const syncRoute = () => setRoute(supervisorRouteFromHash(location.hash));
    addEventListener("hashchange", syncRoute);
    return () => removeEventListener("hashchange", syncRoute);
  }, []);

  if (sessionState.status === "checking") return <SessionRecovery loading title="Checking your session" message="Confirming your LitterSpot account and workspace access." />;
  if (sessionState.status === "anonymous") return <LoginPage onLogin={sessionState.signIn} />;
  if (sessionState.status === "error") return <SessionFailure error={sessionState.error} onRetry={() => { void sessionState.retry(); }} onLogout={() => { void sessionState.signOut(); }} />;

  const session = sessionState.session;
  if (session.role === "cleaner") return <CleanerMobileApp session={session.cleaner} onLogout={() => { void sessionState.signOut(); }} />;
  if (session.role === "superadmin") return <SuperadminApp profile={session.superadmin} onLogout={() => { void sessionState.signOut(); }} />;

  const supervisor = session.supervisor;
  const capabilities = deriveSupervisorCapabilities(supervisor.authority);
  const content = () => {
  if (route === "camera-registration") return <FieldStationShell route={route} supervisor={supervisor} onLogout={() => { void sessionState.signOut(); }}><CameraRegistrationPage canCreateCamera={capabilities.manageCameraPlacement} canRegisterCamera={capabilities.registerCameras} /></FieldStationShell>;
  return <OperationsConsole supervisor={supervisor} capabilities={capabilities} page={route as OperationsPage} onNavigate={(page, params) => { const path = page === "dashboard" ? "/" : `/${page}`; location.hash = `${path}${params ? `?${new URLSearchParams(params)}` : ""}`; }} onLogout={() => { void sessionState.signOut(); }} />;
  };
  return <SiteMonitoringProvider key={supervisor.uid}>{content()}</SiteMonitoringProvider>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><SessionProvider><App /></SessionProvider></StrictMode>);
