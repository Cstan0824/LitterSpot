import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
// TypeScript may complain about missing type declarations for CSS imports.
// @ts-ignore
import "./styles.css";

import { AlertsPage } from "./pages/AlertsPage";
import { DetectionTestPage } from "./pages/DetectionTestPage";
import { DashboardPage } from "./pages/DashboardPage";

type Page = "dashboard" | "alerts" | "playground";


function getCurrentPage(): Page {
  switch (location.hash) {
    case "#/alerts":
      return "alerts";

    case "#/playground":
      return "playground";

    default:
      return "dashboard";
  }
}

function App() {
  const [page, setPage] = useState<Page>(getCurrentPage());
  useEffect(() => {
    const syncPage = () => setPage(getCurrentPage());
    addEventListener("hashchange", syncPage);
    return () => removeEventListener("hashchange", syncPage);
  }, []);
  
  if (page === "alerts") {
    return <AlertsPage />;
  }

  if (page === "playground") {
    return <DetectionTestPage />;
  }

  return (
    <DashboardPage
      onOpenPlayground={() => {
        location.hash = "/playground";
      }}
    />
  );
}


createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
