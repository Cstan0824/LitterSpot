import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
// TypeScript may complain about missing type declarations for CSS imports.
// @ts-ignore
import "./styles.css";
import { OperationsConsole } from "./features/operations/OperationsConsole";
import { DetectionTestPage } from "./pages/DetectionTestPage";
import { DashboardPage } from "./pages/DashboardPage";
import { PipelinePage } from "./pages/PipelinePage";

type OperationsPage = "dashboard" | "alerts" | "history" | "placement";
type Route = OperationsPage | "pipeline" | "playground" | "status";

function routeFromHash(): Route {
  const route = location.hash.replace(/^#\/?/, "");
  if (["alerts", "history", "placement", "pipeline", "playground", "status"].includes(route)) return route as Route;
  return "dashboard";
}

function App() {
  const [route, setRoute] = useState<Route>(routeFromHash);
  useEffect(() => {
    const syncRoute = () => setRoute(routeFromHash());
    addEventListener("hashchange", syncRoute);
    return () => removeEventListener("hashchange", syncRoute);
  }, []);

  if (route === "playground") return <DetectionTestPage />;
  if (route === "pipeline") return <PipelinePage />;
  if (route === "status") return <DashboardPage onOpenPlayground={() => { location.hash = "/playground"; }} />;
  return <OperationsConsole page={route} onNavigate={(page) => { location.hash = page === "dashboard" ? "/" : `/${page}`; }} />;
}


createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
