export type ApiErrorKind =
  | "bad_request"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "server_error"
  | "unavailable"
  | "http_error";

type StructuredErrorBody = {
  error?: unknown;
  code?: unknown;
  details?: unknown;
  requestId?: unknown;
};

const fallbackMessages: Record<number, string> = {
  400: "The request contains invalid information.",
  401: "Your session is missing or has expired.",
  403: "Your account is not allowed to perform this action.",
  404: "The requested record was not found.",
  409: "The record changed or conflicts with another operation.",
  429: "Too many requests were sent. Wait before trying again.",
  500: "The server could not complete the request.",
  503: "The service is temporarily unavailable.",
};

function kindForStatus(status: number): ApiErrorKind {
  if (status === 400) return "bad_request";
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status === 500) return "server_error";
  if (status === 502 || status === 503) return "unavailable";
  return "http_error";
}

function retryAfterSeconds(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;

  constructor(input: {
    message: string;
    status: number;
    code?: string;
    details?: unknown;
    requestId?: string;
    retryAfterSeconds?: number;
  }) {
    super(input.message);
    this.name = "ApiError";
    this.kind = kindForStatus(input.status);
    this.status = input.status;
    this.code = input.code;
    this.details = input.details;
    this.requestId = input.requestId;
    this.retryAfterSeconds = input.retryAfterSeconds;
  }

  get isFirestoreQuotaExceeded() {
    return this.status === 503 && this.code === "firestore_quota_exceeded";
  }
}

export async function parseApiError(response: Response): Promise<ApiError> {
  let body: StructuredErrorBody = {};
  try {
    const text = await response.text();
    if (text) body = JSON.parse(text) as StructuredErrorBody;
  } catch {
    body = {};
  }

  const message = typeof body.error === "string" && body.error.trim()
    ? body.error
    : fallbackMessages[response.status] ?? `The request failed with status ${response.status}.`;

  return new ApiError({
    message,
    status: response.status,
    code: typeof body.code === "string" ? body.code : undefined,
    details: body.details,
    requestId: typeof body.requestId === "string"
      ? body.requestId
      : response.headers.get("X-Request-ID") ?? undefined,
    retryAfterSeconds: retryAfterSeconds(response.headers.get("Retry-After")),
  });
}

export function loginErrorMessage(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-email"].includes(code)) {
    return "The email or password is incorrect.";
  }
  if (code === "auth/user-disabled") return "This Firebase account is disabled.";
  if (code === "auth/too-many-requests") return "Too many sign-in attempts. Wait a moment before trying again.";
  if (code === "auth/network-request-failed") return "Firebase Authentication is unavailable. Check the network connection and try again.";
  return "Sign-in could not be completed. Try again.";
}

export function sessionErrorCopy(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return { title: "Session expired", message: "Sign out, then sign in again to refresh your Firebase session." };
    if (error.isFirestoreQuotaExceeded) return { title: "Cloud database quota reached", message: "LitterSpot cannot load the application session until the Firestore quota resets." };
    if (error.status === 403 && /inactive/i.test(error.message)) return { title: "Application access is inactive", message: error.message };
    if (error.status === 403) return { title: "Application access is forbidden", message: error.message };
    if (error.status === 503 || error.status === 502) return { title: "Backend unavailable", message: "LitterSpot could not load your application session. Try again when the Node service and its dependencies are available." };
    if (error.status >= 500) return { title: "Session service failed", message: "The backend could not load your application session." };
    return { title: "Session could not be loaded", message: error.message };
  }
  return { title: "Session could not be loaded", message: "LitterSpot could not load your account context." };
}
