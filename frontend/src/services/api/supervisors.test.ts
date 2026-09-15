import { beforeEach, describe, expect, it, vi } from "vitest";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./http", () => ({ apiRequest: request }));

import { createRegularSupervisor, getSupervisors, updateSupervisorAccount } from "./supervisors";

describe("Supervisor account client", () => {
  beforeEach(() => request.mockReset().mockResolvedValue({}));

  it("loads the authority-projected Supervisor directory", async () => {
    await getSupervisors();
    expect(request).toHaveBeenCalledWith("/api/supervisors?limit=25", { signal: undefined });
  });

  it("creates a Regular Supervisor with an idempotency key", async () => {
    await createRegularSupervisor({ email: "regular@example.com", password: "password123", fullName: "Regular Supervisor", phone: null });
    expect(request).toHaveBeenCalledWith("/api/supervisors", expect.objectContaining({ method: "POST", json: expect.objectContaining({ email: "regular@example.com", idempotencyKey: expect.stringMatching(/^create-supervisor-/) }) }));
  });

  it("updates a Supervisor with the current revision", async () => {
    await updateSupervisorAccount({ uid: "regular/one", fullName: "Regular", email: "regular@example.com", phone: null, authority: "regular", status: "active", revision: 4 }, { status: "inactive" });
    expect(request).toHaveBeenCalledWith("/api/supervisors/regular%2Fone", { method: "PATCH", json: { status: "inactive", expectedRevision: 4 } });
  });
});
