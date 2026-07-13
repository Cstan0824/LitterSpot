import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { DetectionTestPage } from "./pages/DetectionTestPage";
import { DashboardPage } from "./pages/DashboardPage";

function App() {
  const [page, setPage] = useState(() => location.hash === "#/playground" ? "playground" : "dashboard");
  useEffect(() => {
    const syncPage = () => setPage(location.hash === "#/playground" ? "playground" : "dashboard");
    addEventListener("hashchange", syncPage);
    return () => removeEventListener("hashchange", syncPage);
  }, []);
  return page === "playground" ? <DetectionTestPage /> : <DashboardPage onOpenPlayground={() => { location.hash = "/playground"; }} />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
