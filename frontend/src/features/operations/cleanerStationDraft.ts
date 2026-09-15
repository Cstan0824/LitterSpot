import type { OperationsPoint } from "../../services/api/operations";

export function initialCleanerStation(savedStation?: OperationsPoint | null): OperationsPoint | null {
  return savedStation ?? null;
}
