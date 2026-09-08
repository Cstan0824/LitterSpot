import { registerAccountScopedCleanup } from "./accountScope";
import {
  getV2AlertsResource,
  getV2CamerasResource,
  getV2CleanersResource,
  getV2DashboardResource,
  getV2SiteMapResource,
  getV2WorkOrdersResource,
  type V2OperationsReadModel,
} from "./operations";
import { getV2Supervisors, type V2SupervisorListItem } from "./supervisors";
import { TimedResourceCache } from "./resourceCache";

export type OperationsResources = V2OperationsReadModel & { supervisors: V2SupervisorListItem[] };
export type OperationsResourceKey = keyof OperationsResources;

export const coreOperationsResources = ["dashboard", "siteMap", "alerts", "cleaners", "workOrders", "cameras"] as const;

const cache = new TimedResourceCache<OperationsResources>({
  dashboard: getV2DashboardResource,
  siteMap: getV2SiteMapResource,
  alerts: getV2AlertsResource,
  cleaners: getV2CleanersResource,
  workOrders: getV2WorkOrdersResource,
  cameras: getV2CamerasResource,
  supervisors: async () => (await getV2Supervisors()).supervisors,
}, { freshnessMs: 30_000 });

registerAccountScopedCleanup(() => cache.clear());

export const readOperationsResources = <K extends OperationsResourceKey>(keys: readonly K[], options: { force?: boolean } = {}) => cache.readMany(keys, options);
export const invalidateOperationsResources = (keys: readonly OperationsResourceKey[]) => cache.invalidate(keys);
export const clearOperationsResourceCache = () => cache.clear();
