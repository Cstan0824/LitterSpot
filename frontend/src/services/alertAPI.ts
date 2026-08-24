import type {
  AlertStatus,
  CleanlinessAlert
} from "../types/alert";
import { apiFetch, readApiError } from "./apiClient";

export async function getAlerts(): Promise<
  CleanlinessAlert[]
> {
  const response = await apiFetch("/api/alerts");

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return (await response.json()) as CleanlinessAlert[];
}

export async function updateAlertStatus(
  alertId: string,
  status: AlertStatus
): Promise<CleanlinessAlert> {
  const response = await apiFetch(
    `/api/alerts/${encodeURIComponent(alertId)}/status`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        status
      })
    }
  );

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return (await response.json()) as CleanlinessAlert;
}
