import { beforeEach, describe, expect, it, vi } from "vitest";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./http", () => ({ apiRequest: request }));

import { createSuperadminSite, getSuperadminAnalytics, getSuperadminOperationsView, getSuperadminSite, getSuperadminSites, getSuperadminSystemRun, reconcileSuperadminSiteOperation, recoverSuperadminRoot, updateSuperadminSiteStatus, superadminMediaContentUrl } from "./superadmin";

describe("Superadmin read client", () => {
  beforeEach(() => request.mockReset().mockResolvedValue({}));

  it("uses selected-Site GET routes without mutation options", async () => {
    await getSuperadminSites("inactive");
    expect(request).toHaveBeenLastCalledWith("/api/superadmin/sites?status=inactive&limit=25", { signal: undefined });
    await getSuperadminSite("site/one");
    expect(request).toHaveBeenLastCalledWith("/api/superadmin/sites/site%2Fone", { signal: undefined });
    await getSuperadminOperationsView("site/one");
    expect(request).toHaveBeenLastCalledWith("/api/superadmin/sites/site%2Fone/view/operations", { signal: undefined });
  });

  it("builds bounded analytics and media URLs inside the Site View route", async () => {
    await getSuperadminAnalytics("site/one", { from: "2026-09-01", to: "2026-09-07" });
    expect(request).toHaveBeenLastCalledWith("/api/superadmin/sites/site%2Fone/view/analytics?from=2026-09-01&to=2026-09-07", { signal: undefined });
    expect(superadminMediaContentUrl("site/one", "media/one")).toBe("/api/superadmin/sites/site%2Fone/view/media/media%2Fone/content");
    await getSuperadminSystemRun("site/one", "run/one");
    expect(request).toHaveBeenLastCalledWith("/api/superadmin/sites/site%2Fone/view/system/runs/run%2Fone", { signal: undefined });
  });

  it("sends management mutations only to the Superadmin route family", async () => {
    const create = { name: "Sunway", timeZone: "Asia/Kuala_Lumpur", widthMeters: 600, heightMeters: 400, gridSizeMeters: 20, rootEmail: "root@example.com", rootPassword: "temporary-password", rootDisplayName: "Root User", idempotencyKey: "create-site-123" };
    await createSuperadminSite(create);
    expect(request).toHaveBeenLastCalledWith("/api/superadmin/sites", { method: "POST", json: create });
    await updateSuperadminSiteStatus("site/one", "inactive", "Contract ended");
    expect(request).toHaveBeenLastCalledWith("/api/superadmin/sites/site%2Fone/status", { method: "PATCH", json: { status: "inactive", reason: "Contract ended" } });
    await recoverSuperadminRoot("site/one", { mode: "reset_existing", password: "new-password", displayName: "Root User", reason: "Credential recovery", idempotencyKey: "recover-root-123" });
    expect(request).toHaveBeenLastCalledWith("/api/superadmin/sites/site%2Fone/root-recovery", expect.objectContaining({ method: "POST" }));
    await reconcileSuperadminSiteOperation("site/one", "operation/one");
    expect(request).toHaveBeenLastCalledWith("/api/superadmin/sites/site%2Fone/operations/operation%2Fone/reconcile", { method: "POST", json: {} });
  });
});
