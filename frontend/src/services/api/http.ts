import { firebaseAuth } from "../../config/firebase";
import { ApiError, parseApiError } from "./errors";

type ResponseType = "json" | "blob" | "text";

export type ApiRequestOptions = Omit<RequestInit, "body"> & {
  body?: BodyInit | null;
  json?: unknown;
  responseType?: ResponseType;
};

export async function apiRequest<T>(input: RequestInfo | URL, options: ApiRequestOptions = {}): Promise<T> {
  const user = firebaseAuth.currentUser;
  if (!user) {
    throw new ApiError({ message: "You must be signed in to continue.", status: 401, code: "client_auth_required" });
  }

  const { json, responseType = "json", body: requestBody, ...requestInit } = options;
  if (json !== undefined && requestBody !== undefined) {
    throw new Error("An API request cannot provide both json and body.");
  }

  // Firebase refreshes an expiring token here. The frontend never keeps a
  // separate bearer-token cache or puts a token in a URL.
  const token = await user.getIdToken();
  const headers = new Headers(requestInit.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Accept")) headers.set("Accept", responseType === "json" ? "application/json" : "*/*");

  let body = requestBody;
  if (json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(json);
  }

  const response = await fetch(input, { ...requestInit, body, headers });
  if (!response.ok) throw await parseApiError(response);
  if (response.status === 204) return undefined as T;
  if (responseType === "blob") return await response.blob() as T;
  if (responseType === "text") return await response.text() as T;
  return await response.json() as T;
}
