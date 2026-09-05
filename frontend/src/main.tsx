import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
// TypeScript may complain about missing type declarations for CSS imports.
// @ts-ignore
import "./styles.css";
import "./field-station.css";
import { OperationsConsole } from "./features/operations/OperationsConsole";
import { DetectionTestPage } from "./pages/DetectionTestPage";
import { SystemPage } from "./pages/SystemPage";
import { PipelinePage } from "./pages/PipelinePage";
import { LoginPage } from "./pages/LoginPage";
import { CameraRegistrationPage } from "./pages/CameraRegistrationPage";
import { FieldStationShell } from "./components/FieldStationShell";
import { RoleIntegrationPendingPage } from "./components/RoleIntegrationPendingPage";
import { CleanerMobileApp } from "./features/cleaner/CleanerMobileApp";
import { SessionProvider, useSession } from "./session/SessionProvider";
import { supervisorRouteFromHash, type SupervisorRoute } from "./services/v2/routing";
import { deriveSupervisorCapabilities } from "./services/v2/session";
import { sessionErrorCopy } from "./services/v2/errors";

type OperationsPage = "dashboard" | "alerts" | "history" | "placement" | "cameras" | "admin";

function SessionFailure({ error, onRetry, onLogout }: { error: unknown; onRetry: () => void; onLogout: () => void }) {
  const copy = sessionErrorCopy(error);
  return <main className="role-pending-page"><section className="role-pending-panel error">
    <div className="login-brand"><b>LS</b><div><strong>LitterSpot</strong><span>Application session</span></div></div>
    <h1>{copy.title}</h1><p>{copy.message}</p>
    <div className="role-pending-actions"><button className="primary" type="button" onClick={onRetry}>Try again</button><button className="outline-button" type="button" onClick={onLogout}>Sign out</button></div>
  </section></main>;
}

function App() {
  const sessionState = useSession();
  const [route, setRoute] = useState<SupervisorRoute>(() => supervisorRouteFromHash(location.hash));
  useEffect(() => {
    const syncRoute = () => setRoute(supervisorRouteFromHash(location.hash));
    addEventListener("hashchange", syncRoute);
    return () => removeEventListener("hashchange", syncRoute);
  }, []);

  if (sessionState.status === "checking") return <main className="ops-loading">Checking application session…</main>;
  if (sessionState.status === "anonymous") return <LoginPage onLogin={sessionState.signIn} />;
  if (sessionState.status === "error") return <SessionFailure error={sessionState.error} onRetry={() => { void sessionState.retry(); }} onLogout={() => { void sessionState.signOut(); }} />;

  const session = sessionState.session;
  if (session.role === "cleaner") return <CleanerMobileApp session={session.cleaner} onLogout={() => { void sessionState.signOut(); }} />;
  if (session.role !== "supervisor") return <RoleIntegrationPendingPage session={session} onLogout={() => { void sessionState.signOut(); }} />;

  const supervisor = session.supervisor;
  const capabilities = deriveSupervisorCapabilities(supervisor.authority);
  if (route === "playground") return <FieldStationShell route={route} supervisor={supervisor} onLogout={() => { void sessionState.signOut(); }}><DetectionTestPage /></FieldStationShell>;
  if (route === "pipeline") return <FieldStationShell route={route} supervisor={supervisor} onLogout={() => { void sessionState.signOut(); }}><PipelinePage /></FieldStationShell>;
  if (route === "camera-registration") return <FieldStationShell route={route} supervisor={supervisor} onLogout={() => { void sessionState.signOut(); }}><CameraRegistrationPage canCreateCamera={capabilities.manageCameraPlacement} canRegisterCamera={capabilities.registerCameras} /></FieldStationShell>;
  if (route === "status") return <FieldStationShell route={route} supervisor={supervisor} onLogout={() => { void sessionState.signOut(); }}><SystemPage /></FieldStationShell>;
  return <OperationsConsole supervisor={supervisor} capabilities={capabilities} page={route as OperationsPage} onNavigate={(page) => { location.hash = page === "dashboard" ? "/" : `/${page}`; }} onLogout={() => { void sessionState.signOut(); }} />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><SessionProvider><App /></SessionProvider></StrictMode>);
