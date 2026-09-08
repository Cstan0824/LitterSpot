import type { ReactNode } from "react";
import { FieldStationNavigation } from "./FieldStationNavigation";

type ToolRoute = "pipeline" | "playground" | "status" | "camera-registration";
type Supervisor = { displayName: string; email: string; authority: "root" | "regular" };

export function FieldStationShell({ route, supervisor, onLogout, children }: {
  route: ToolRoute;
  supervisor: Supervisor;
  onLogout: () => void;
  children: ReactNode;
}) {
  return <div className="ops-shell tool-shell">
    <FieldStationNavigation activeRoute={route} supervisor={supervisor} onLogout={onLogout} />
    <div className="ops-main"><div className="tool-content">{children}</div></div>
  </div>;
}
