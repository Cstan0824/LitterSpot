import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { PipelinePage } from "./pages/PipelinePage";
import { OperationsConsole } from "./features/operations/OperationsConsole";

const operationsPages = new Set(["dashboard", "alerts", "history", "placement"]);

function App() {
  const getPage = () => location.hash.replace(/^#\//, "").split("?")[0] || "dashboard";
  const [page, setPage] = useState(getPage);
  useEffect(() => {
    const syncPage = () => setPage(getPage());
    addEventListener("hashchange", syncPage);
    return () => removeEventListener("hashchange", syncPage);
  }, []);
  if (page === "pipeline" || page === "playground") return <PipelinePage />;
  const operationsPage = operationsPages.has(page) ? page as "dashboard" | "alerts" | "history" | "placement" : "dashboard";
  return <OperationsConsole page={operationsPage} onNavigate={(next) => { location.hash = `/${next}`; }} />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
