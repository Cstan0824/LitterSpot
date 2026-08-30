import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
// TypeScript may complain about missing type declarations for CSS imports.
// @ts-ignore
import "./styles.css";
import "./field-station.css";
import { OperationsConsole } from "./features/operations/OperationsConsole";
import { DetectionTestPage } from "./pages/DetectionTestPage";
import { DashboardPage } from "./pages/DashboardPage";
import { PipelinePage } from "./pages/PipelinePage";
import { LoginPage } from "./pages/LoginPage";
import { CameraRegistrationPage } from "./pages/CameraRegistrationPage";
import { firebaseAuth } from "./config/firebase";
import { apiFetch, readApiError } from "./services/apiClient";
import { FieldStationShell } from "./components/FieldStationShell";

type OperationsPage = "dashboard" | "alerts" | "history" | "placement" | "cameras" | "admin";
type Route = OperationsPage | "pipeline" | "playground" | "status" | "camera-registration";
type Supervisor = { uid: string; email: string; displayName: string };

function routeFromHash(): Route {
  const route = location.hash.replace(/^#\/?/, "").split("?")[0];
  if (["alerts", "history", "placement", "cameras", "admin", "pipeline", "playground", "status", "camera-registration"].includes(route)) return route as Route;
  return "dashboard";
}

function App() {
  const [authReady, setAuthReady] = useState(false);
  const [supervisor, setSupervisor] = useState<Supervisor | null>(null);
  const [profileError, setProfileError] = useState<string>();
  const [route, setRoute] = useState<Route>(routeFromHash);
  useEffect(() => {
    const syncRoute = () => setRoute(routeFromHash());
    addEventListener("hashchange", syncRoute);
    return () => removeEventListener("hashchange", syncRoute);
  }, []);

  useEffect(() => onAuthStateChanged(firebaseAuth, async (user) => {
    setProfileError(undefined);
    if (!user) {
      setSupervisor(null);
      setAuthReady(true);
      return;
    }
    try {
      const response = await apiFetch("/api/me");
      if (!response.ok) throw new Error(await readApiError(response));
      const body = await response.json() as { supervisor: Supervisor };
      setSupervisor(body.supervisor);
    } catch (error) {
      setSupervisor(null);
      setProfileError(error instanceof Error ? error.message : "Supervisor profile could not be loaded.");
    } finally {
      setAuthReady(true);
    }
  }), []);

  if (!authReady) return <main className="ops-loading">Checking Supervisor session…</main>;
  if (profileError && firebaseAuth.currentUser) return <main className="ops-loading"><p>{profileError}</p><button className="outline-button" onClick={() => void signOut(firebaseAuth)}>Sign out</button></main>;
  if (!supervisor) return <LoginPage onLogin={async (email, password) => { await signInWithEmailAndPassword(firebaseAuth, email, password); }} />;
  if (route === "playground") return <FieldStationShell route={route} supervisor={supervisor} onLogout={() => { void signOut(firebaseAuth); }}><DetectionTestPage /></FieldStationShell>;
  if (route === "pipeline") return <FieldStationShell route={route} supervisor={supervisor} onLogout={() => { void signOut(firebaseAuth); }}><PipelinePage /></FieldStationShell>;
  if (route === "camera-registration") return <FieldStationShell route={route} supervisor={supervisor} onLogout={() => { void signOut(firebaseAuth); }}><CameraRegistrationPage /></FieldStationShell>;
  if (route === "status") return <FieldStationShell route={route} supervisor={supervisor} onLogout={() => { void signOut(firebaseAuth); }}><DashboardPage onOpenPlayground={() => { location.hash = "/playground"; }} /></FieldStationShell>;
  return <OperationsConsole supervisor={supervisor} page={route} onNavigate={(page) => { location.hash = page === "dashboard" ? "/" : `/${page}`; }} onLogout={() => { void signOut(firebaseAuth); }} />;
}


createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
