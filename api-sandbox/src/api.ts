export type ApiSettings = { baseUrl: string; apiKey: string; email: string; token: string };

export async function firebaseLogin(apiKey: string, email: string, password: string) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  const payload = await response.json(); if (!response.ok) throw new Error(payload?.error?.message ?? "Firebase login failed."); return payload.idToken as string;
}

export async function api<T>(settings: ApiSettings, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${settings.token}`); if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(`${settings.baseUrl}${path}`, { ...init, headers }); const text = await response.text(); const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(payload?.error ? `${payload.error}${payload.details ? ` — ${JSON.stringify(payload.details)}` : ""}` : `${response.status} ${response.statusText}`); return payload as T;
}

export async function authorizedBlob(settings: ApiSettings, path: string) { const response = await fetch(`${settings.baseUrl}${path}`, { headers: { Authorization: `Bearer ${settings.token}` } }); if (!response.ok) throw new Error("Stored source media could not be loaded."); return response.blob(); }
