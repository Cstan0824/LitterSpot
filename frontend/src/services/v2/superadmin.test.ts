import { beforeEach, describe, expect, it, vi } from "vitest";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./http", () => ({ v2Request: request }));

import { createV2SuperadminSite, getV2SuperadminAnalytics, getV2SuperadminOperationsView, getV2SuperadminSite, getV2SuperadminSites, getV2SuperadminSystemRun, reconcileV2SuperadminSiteOperation, recoverV2SuperadminRoot, updateV2SuperadminSiteStatus, v2SuperadminMediaContentUrl } from "./superadmin";

describe("V2 Superadmin read client", () => {
  beforeEach(() => request.mockReset().mockResolvedValue({}));

  it("uses selected-Site GET routes without mutation options", async () => {
    await getV2SuperadminSites("inactive");
    expect(request).toHaveBeenLastCalledWith("/api/superadmin/sites?status=inactive", { signal: undefined });
    await getV2SuperadminSite("site/one");
    expect(request).toHaveBeenLastCalledWith("/api/superadmin/sites/site%2Fone", { signal: undefined });
    await getV2SuperadminOperationsView("site/one");
    expect(request).toHaveBeenLastCalledWith("/api/superadmin/sites/site%2Fone/view/operations", { signal: undefined });
  });

  it("builds bounded analytics and media URLs inside the Site View route", async () => {
    await getV2SuperadminAnalytics("site/one", { from: "2026-09-01", to: "2026-09-07" });
    expect(request).toHaveBeenLastCalledWith("/api/superadmin/sites/site%2Fone/view/analytics?from=2026-09-01&to=2026-09-07", { signal: undefined });
    expect(v2SuperadminMediaContentUrl("site/one", "media/one")).toBe("/api/superadmin/sites/site%2Fone/view/media/media%2Fone/content");
    await getV2SuperadminSystemRun("site/one", "run/one");
    expect(request).toHaveBeenLastCalledWith("/api/superadmin/sites/site%2Fone/view/system/runs/run%2Fone", { signal: undefined });
  });

  it("sends management mutations only to the Superadmin route family", async () => {
    const create = { name: "Sunway", timeZone: "Asia/Kuala_Lumpur", widthMeters: 600, heightMeters: 400, gridSizeMeters: 20, rootEmail: "root@example.com", rootPassword: "temporary-password", rootDisplayName: "Root User", idempotencyKey: "create-site-123" };
    await createV2SuperadminSite(create);
    expect(request).toHaveBeenLastCalledWith("/api/superadmin/sites", { method: "POST", json: create });
    await updateV2SuperadminSiteStatus("site/one", "inactive", "Contract ended");
    expect(request).toHaveBeenLastCalledWith("/api/superadmin/sites/site%2Fone/status", { method: "PATCH", json: { status: "inactive", reason: "Contract ended" } });
    await recoverV2SuperadminRoot("site/one", { mode: "reset_existing", password: "new-password", displayName: "Root User", reason: "Credential recovery", idempotencyKey: "recover-root-123" });
    expect(request).toHaveBeenLastCalledWith("/api/superadmin/sites/site%2Fone/root-recovery", expect.objectContaining({ method: "POST" }));
    await reconcileV2SuperadminSiteOperation("site/one", "operation/one");
    expect(request).toHaveBeenLastCalledWith("/api/superadmin/sites/site%2Fone/operations/operation%2Fone/reconcile", { method: "POST", json: {} });
  });
});
