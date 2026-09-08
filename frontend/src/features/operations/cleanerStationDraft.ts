import type { V2Point } from "../../services/v2/operations";

export function initialCleanerStation(savedStation?: V2Point | null): V2Point | null {
  return savedStation ?? null;
}
