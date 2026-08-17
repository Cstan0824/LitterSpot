import { firebaseAuth } from "../config/firebase";

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error("You must be signed in to continue.");

  const token = await user.getIdToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);

  return fetch(input, { ...init, headers });
}

export async function readApiError(response: Response) {
  try {
    const body = await response.json() as { error?: string };
    return body.error ?? "The request could not be completed.";
  } catch {
    return "The request could not be completed.";
  }
}
