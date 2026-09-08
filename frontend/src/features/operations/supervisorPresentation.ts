import type { V2SupervisorListItem, V2SupervisorManagementItem } from "../../services/v2/supervisors";

export function supervisorAuthorityLabel(authority: "root" | "regular") {
  return authority === "root" ? "Root Supervisor" : "Regular Supervisor";
}

export function supervisorStatusLabel(status: "active" | "inactive") {
  return status === "active" ? "Active" : "Disabled";
}

export function filterManagedSupervisors(supervisors: V2SupervisorManagementItem[], status: "all" | "active" | "inactive", query: string) {
  const needle = query.trim().toLowerCase();
  return supervisors.filter((supervisor) => (status === "all" || supervisor.status === status)
    && (!needle || `${supervisor.fullName} ${supervisor.email}`.toLowerCase().includes(needle)));
}

export function activeSupervisorDirectory(supervisors: V2SupervisorListItem[]) {
  return supervisors.filter((supervisor) => !("status" in supervisor) || supervisor.status === "active");
}

export function canManageSupervisor(viewerAuthority: "root" | "regular", supervisor: V2SupervisorListItem) {
  return viewerAuthority === "root" && supervisor.authority === "regular" && "status" in supervisor;
}
