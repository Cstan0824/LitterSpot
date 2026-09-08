export type OperationsResource = "dashboard" | "siteMap" | "alerts" | "cleaners" | "workOrders" | "cameras" | "supervisors";
export type OperationsMutation = "alert_assignment" | "alert_dismissal" | "manual_work" | "work_decision" | "cleaner_update" | "cleaner_station" | "camera_publish" | "site_map_publish" | "camera_workflow";

const pageResources: Record<string, readonly OperationsResource[]> = {
  dashboard: ["dashboard"],
  alerts: ["alerts"],
  history: ["workOrders"],
  cameras: ["cameras"],
  admin: ["cleaners", "supervisors"],
  placement: [],
  site: [],
  status: [],
};

const mutationResources: Record<OperationsMutation, readonly OperationsResource[]> = {
  alert_assignment: ["alerts", "workOrders", "cleaners", "dashboard"],
  alert_dismissal: ["alerts", "dashboard"],
  manual_work: ["workOrders", "cleaners", "dashboard"],
  work_decision: ["workOrders", "alerts", "cleaners", "dashboard"],
  cleaner_update: ["cleaners", "dashboard"],
  cleaner_station: ["cleaners", "siteMap", "dashboard"],
  camera_publish: ["cameras", "siteMap", "dashboard"],
  site_map_publish: ["siteMap", "cameras", "cleaners", "dashboard"],
  camera_workflow: ["alerts", "workOrders", "cameras", "dashboard"],
};

export const resourcesForPage = (page: string) => [...(pageResources[page] ?? [])];
export const resourcesAfterMutation = (mutation: OperationsMutation) => [...mutationResources[mutation]];
