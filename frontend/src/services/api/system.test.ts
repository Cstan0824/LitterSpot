import { beforeEach, describe, expect, it, vi } from "vitest";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./http", () => ({ apiRequest: request }));

import { getOrchestratorRunDetail, getSystemView, setOrchestratorStatus } from "./system";

describe("System client", () => {
  beforeEach(() => request.mockReset().mockResolvedValue({}));

  it("loads the bounded Site System view", async () => {
    const controller = new AbortController();
    await getSystemView(controller.signal);
    expect(request).toHaveBeenCalledWith("/api/operations/system", { signal: controller.signal });
  });

  it("sends a bounded pause reason and a null resume reason", async () => {
    await setOrchestratorStatus("paused", "  Camera maintenance  ");
    expect(request).toHaveBeenCalledWith("/api/orchestrator/status", { method: "POST", json: { status: "paused", reason: "Camera maintenance" } });
    await setOrchestratorStatus("running");
    expect(request).toHaveBeenLastCalledWith("/api/orchestrator/status", { method: "POST", json: { status: "running", reason: null } });
  });

  it("encodes the Run ID before loading its technical detail", async () => {
    await getOrchestratorRunDetail("run/one");
    expect(request).toHaveBeenCalledWith("/api/orchestrator/runs/run%2Fone", { signal: undefined });
  });
});
