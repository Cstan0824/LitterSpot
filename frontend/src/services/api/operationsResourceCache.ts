import { registerAccountScopedCleanup } from "./accountScope";
import {
  getAlertsResource,
  getCamerasResource,
  getCleanersResource,
  getDashboardResource,
  getSiteMapResource,
  getWorkOrdersResource,
  type OperationsReadModel,
} from "./operations";
import { getSupervisors, type SupervisorListItem } from "./supervisors";
import { TimedResourceCache } from "./resourceCache";

export type OperationsResources = OperationsReadModel & { supervisors: SupervisorListItem[] };
export type OperationsResourceKey = keyof OperationsResources;

export const coreOperationsResources = ["dashboard", "siteMap", "alerts", "cleaners", "workOrders", "cameras"] as const;

const cache = new TimedResourceCache<OperationsResources>({
  dashboard: getDashboardResource,
  siteMap: getSiteMapResource,
  alerts: getAlertsResource,
  cleaners: getCleanersResource,
  workOrders: getWorkOrdersResource,
  cameras: getCamerasResource,
  supervisors: async () => (await getSupervisors()).supervisors,
}, { freshnessMs: 30_000 });

registerAccountScopedCleanup(() => cache.clear());

export const readOperationsResources = <K extends OperationsResourceKey>(keys: readonly K[], options: { force?: boolean } = {}) => cache.readMany(keys, options);
export const invalidateOperationsResources = (keys: readonly OperationsResourceKey[]) => cache.invalidate(keys);
export const clearOperationsResourceCache = () => cache.clear();
