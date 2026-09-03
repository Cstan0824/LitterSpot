import { useEffect, useRef, useState } from "react";

type Supervisor = { displayName: string; email: string };

const navItems = [
  ["dashboard", "Dashboard", "/", "dashboard"],
  ["cameras", "Cameras", "/cameras", "cameras"],
  ["alerts", "Alerts", "/alerts", "alert"],
  ["work", "Work", "/history", "work"],
  ["admin", "Team", "/admin", "team"],
  ["placement", "Insights", "/placement", "insights"],
  ["status", "System", "/status", "system"],
] as const;

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function NavIcon({ name }: { name: string }) {
  if (name === "dashboard") return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="2.5" width="6" height="6" /><rect x="11.5" y="2.5" width="6" height="6" /><rect x="2.5" y="11.5" width="6" height="6" /><rect x="11.5" y="11.5" width="6" height="6" /></svg>;
  if (name === "cameras") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="14" height="12" /><path d="m17 10 4-2v8l-4-2M8 6l1-2h3l1 2" /></svg>;
  if (name === "alert") return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5 18 17H2Z" /><path d="M10 7v4.5M10 14.3v.2" /></svg>;
  if (name === "work") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="14" height="17" /><path d="M9 4V2h6v2M8 10h8M8 14h8M8 18h5" /></svg>;
  if (name === "team") return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="7" cy="7" r="3" /><circle cx="14.5" cy="8" r="2.3" /><path d="M2.5 17c.4-3.2 2-5 4.8-5s4.6 1.8 5 5M12 13c2.8-.4 4.6.9 5.2 3.8" /></svg>;
  if (name === "insights") return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 16.5h15M4.5 14V9M10 14V4M15.5 14V7" /></svg>;
  return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3" /><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M15.7 4.3l-1.4 1.4M5.7 14.3l-1.4 1.4" /></svg>;
}

export function FieldStationNavigation({ activeRoute, supervisor, siteName = "Active site", alertCount = 0, onLogout }: {
  activeRoute: string;
  supervisor: Supervisor;
  siteName?: string;
  alertCount?: number;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      menuRef.current?.focus();
    };
    addEventListener("keydown", close);
    return () => removeEventListener("keydown", close);
  }, [open]);

  const navigate = (target: string) => {
    location.hash = target;
    setOpen(false);
  };

  const normalizedRoute = activeRoute === "camera-registration" ? "cameras" : activeRoute === "history" ? "work" : activeRoute;

  return <>
    <header className={`field-nav-head ${open ? "field-nav-open" : ""}`}>
      <button ref={menuRef} className="field-nav-menu" type="button" aria-label="Open navigation" aria-controls="field-primary-nav" aria-expanded={open} onClick={() => setOpen(true)}><span /><span /><span /></button>
      <button className="field-nav-logo" type="button" onClick={() => navigate("/")}>LitterSpot</button>
      <nav className="field-primary-nav" id="field-primary-nav" aria-label="Primary navigation">
        <button className="field-nav-mobile-site" type="button" onClick={() => navigate("/cameras")}><small>Active site</small><strong>{siteName}</strong></button>
        {navItems.map(([id, label, target, icon]) => <button type="button" className={normalizedRoute === id ? "active" : ""} aria-current={normalizedRoute === id ? "page" : undefined} key={id} onClick={() => navigate(target)}><span className="field-nav-icon"><NavIcon name={icon} /></span><span>{label}</span>{id === "alerts" && alertCount > 0 ? <b>{alertCount}</b> : null}</button>)}
      </nav>
      <button className="field-nav-site" type="button" onClick={() => navigate("/cameras")}><small>Active site</small><strong>{siteName}</strong></button>
      <button className="field-nav-user" type="button" title={`Sign out ${supervisor.displayName}`} aria-label={`Sign out ${supervisor.displayName}`} onClick={onLogout}>{initials(supervisor.displayName)}</button>
    </header>
    <button className={`field-nav-scrim ${open ? "visible" : ""}`} type="button" aria-label="Close navigation" onClick={() => { setOpen(false); menuRef.current?.focus(); }} />
  </>;
}
