import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { firebaseAuth } from "../../config/firebase";
import { SiteCameraMonitoring } from "../../../../shared/cameraMonitoring";

const MonitoringContext = createContext<SiteCameraMonitoring | null>(null);
export function SiteMonitoringProvider({ children }: { children: ReactNode }) {
  const monitor = useMemo(() => new SiteCameraMonitoring(async (path, options = {}) => {
    const user = firebaseAuth.currentUser; if (!user) throw new Error("Sign in to monitor Cameras.");
    const headers = new Headers(options.headers); headers.set("Authorization", `Bearer ${await user.getIdToken()}`);
    return fetch(path, { ...options, headers });
  }), []);
  useEffect(() => { const timer = setTimeout(() => monitor.start(), 0); return () => { clearTimeout(timer); void monitor.stop(); }; }, [monitor]);
  return <MonitoringContext.Provider value={monitor}>{children}</MonitoringContext.Provider>;
}
export function useSiteMonitoring() {
  const monitor = useContext(MonitoringContext);
  if (!monitor) throw new Error("Camera views require a Supervisor monitoring provider.");
  const state = useSyncExternalStore(monitor.subscribe, monitor.snapshot);
  return { monitor, state };
}
