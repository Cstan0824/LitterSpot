import { beforeEach, describe, expect, it, vi } from "vitest";

const { getIdToken } = vi.hoisted(() => ({ getIdToken: vi.fn(async () => "fresh-firebase-token") }));
vi.mock("../../config/firebase", () => ({ firebaseAuth: { currentUser: { getIdToken } } }));

import { v2Request } from "./http";

describe("V2 request layer", () => {
  beforeEach(() => {
    getIdToken.mockClear();
  });

  it("gets a Firebase token for every request and sends JSON without retrying", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer fresh-firebase-token");
      expect(headers.get("Content-Type")).toBe("application/json");
      expect(init?.body).toBe(JSON.stringify({ status: "paused" }));
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(v2Request<{ ok: boolean }>("/api/orchestrator/v2/status", { method: "POST", json: { status: "paused" } })).resolves.toEqual({ ok: true });
    expect(getIdToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves FormData content headers and AbortSignal", async () => {
    const form = new FormData();
    form.append("photo", new Blob(["photo"], { type: "image/jpeg" }), "photo.jpg");
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.has("Content-Type")).toBe(false);
      expect(init?.body).toBe(form);
      expect(init?.signal).toBe(controller.signal);
      return new Response(JSON.stringify({ evidence: { id: "media-1" } }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await v2Request("/api/cleaner/work-orders/work-1/completion-evidence", { method: "POST", body: form, signal: controller.signal });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
