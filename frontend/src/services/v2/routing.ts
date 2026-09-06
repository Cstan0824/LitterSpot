import type { ApplicationSession } from "./session";

export type SupervisorRoute = "dashboard" | "alerts" | "history" | "placement" | "cameras" | "admin" | "site" | "pipeline" | "playground" | "status" | "camera-registration";
export type RoleDestination = "supervisor" | "cleaner-integration-pending" | "superadmin-integration-pending";

const supervisorRoutes = new Set<SupervisorRoute>(["alerts", "history", "placement", "cameras", "admin", "site", "pipeline", "playground", "status", "camera-registration"]);

export function supervisorRouteFromHash(hash: string): SupervisorRoute {
  const route = hash.replace(/^#\/?/, "").split("?")[0] as SupervisorRoute;
  return supervisorRoutes.has(route) ? route : "dashboard";
}

export function roleDestination(session: ApplicationSession): RoleDestination {
  if (session.role === "supervisor") return "supervisor";
  if (session.role === "cleaner") return "cleaner-integration-pending";
  return "superadmin-integration-pending";
}
