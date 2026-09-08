import type { V2Alert } from "../../services/v2/operations";

const uuidLike = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function alertZoneDisplayName(alert: Pick<V2Alert, "zoneId" | "zoneNameSnapshot">, zoneNames: Map<string, string>) {
  const snapshot = String(alert.zoneNameSnapshot ?? "").trim();
  const zoneId = String(alert.zoneId ?? "").trim();
  if (snapshot && snapshot !== zoneId && !uuidLike(snapshot)) return snapshot;
  return zoneNames.get(zoneId) ?? "Unknown Zone";
}
