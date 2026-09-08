import type { ApplicationSession } from "./session";

export type SupervisorRoute = "dashboard" | "alerts" | "history" | "placement" | "cameras" | "admin" | "site" | "pipeline" | "playground" | "status" | "camera-registration";
export type SuperadminSiteViewPage = "dashboard" | "cameras" | "alerts" | "work" | "team" | "insights" | "system" | "site";
export type SuperadminRoute = { kind: "sites" } | { kind: "audit" } | { kind: "site"; siteId: string } | { kind: "site-view"; siteId: string; page: SuperadminSiteViewPage };
export type RoleDestination = "supervisor" | "cleaner-integration-pending" | "superadmin";

const supervisorRoutes = new Set<SupervisorRoute>(["alerts", "history", "placement", "cameras", "admin", "site", "pipeline", "playground", "status", "camera-registration"]);
const superadminSiteViewPages = new Set<SuperadminSiteViewPage>(["dashboard", "cameras", "alerts", "work", "team", "insights", "system", "site"]);

export function supervisorRouteFromHash(hash: string): SupervisorRoute {
  const route = hash.replace(/^#\/?/, "").split("?")[0] as SupervisorRoute;
  return supervisorRoutes.has(route) ? route : "dashboard";
}

export function roleDestination(session: ApplicationSession): RoleDestination {
  if (session.role === "supervisor") return "supervisor";
  if (session.role === "cleaner") return "cleaner-integration-pending";
  return "superadmin";
}

export function superadminRouteFromHash(hash: string): SuperadminRoute {
  const path = hash.replace(/^#\/?/, "").split("?")[0];
  const segments = path.split("/").filter(Boolean);
  if (segments[0] !== "superadmin") return { kind: "sites" };
  if (segments.length === 2 && segments[1] === "audit") return { kind: "audit" };
  if (segments[1] !== "sites") return { kind: "sites" };
  if (segments.length === 2) return { kind: "sites" };
  let siteId: string;
  try { siteId = decodeURIComponent(segments[2]); } catch { return { kind: "sites" }; }
  if (!siteId) return { kind: "sites" };
  if (segments.length === 3) return { kind: "site", siteId };
  if (segments[3] === "view") {
    const page = (segments[4] || "dashboard") as SuperadminSiteViewPage;
    return superadminSiteViewPages.has(page) ? { kind: "site-view", siteId, page } : { kind: "site-view", siteId, page: "dashboard" };
  }
  return { kind: "site", siteId };
}

export function superadminRouteHash(route: SuperadminRoute) {
  if (route.kind === "sites") return "#/superadmin/sites";
  if (route.kind === "audit") return "#/superadmin/audit";
  const site = encodeURIComponent(route.siteId);
  return route.kind === "site" ? `#/superadmin/sites/${site}` : `#/superadmin/sites/${site}/view/${route.page}`;
}
