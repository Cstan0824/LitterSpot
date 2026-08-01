import type {
  AlertStatus,
  CleanlinessAlert
} from "../types/alert";

async function readErrorMessage(
  response: Response
): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: string;
    };

    return body.error ?? "The request could not be completed.";
  } catch {
    return "The request could not be completed.";
  }
}

export async function getAlerts(): Promise<
  CleanlinessAlert[]
> {
  const response = await fetch("/api/alerts");

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as CleanlinessAlert[];
}

export async function updateAlertStatus(
  alertId: string,
  status: AlertStatus
): Promise<CleanlinessAlert> {
  const response = await fetch(
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
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as CleanlinessAlert;
}