import { beforeEach, describe, expect, it, vi } from "vitest";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./http", () => ({ v2Request: request }));

import { getV2OrchestratorRunDetail, getV2SystemView, setV2OrchestratorStatus } from "./system";

describe("V2 System client", () => {
  beforeEach(() => request.mockReset().mockResolvedValue({}));

  it("loads the bounded Site System view", async () => {
    const controller = new AbortController();
    await getV2SystemView(controller.signal);
    expect(request).toHaveBeenCalledWith("/api/operations/v2/system", { signal: controller.signal });
  });

  it("sends a bounded pause reason and a null resume reason", async () => {
    await setV2OrchestratorStatus("paused", "  Camera maintenance  ");
    expect(request).toHaveBeenCalledWith("/api/orchestrator/v2/status", { method: "POST", json: { status: "paused", reason: "Camera maintenance" } });
    await setV2OrchestratorStatus("running");
    expect(request).toHaveBeenLastCalledWith("/api/orchestrator/v2/status", { method: "POST", json: { status: "running", reason: null } });
  });

  it("encodes the Run ID before loading its technical detail", async () => {
    await getV2OrchestratorRunDetail("run/one");
    expect(request).toHaveBeenCalledWith("/api/orchestrator/v2/runs/run%2Fone", { signal: undefined });
  });
});
