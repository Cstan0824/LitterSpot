import { describe, expect, it } from "vitest";
import { roleDestination, superadminRouteFromHash, superadminRouteHash, supervisorRouteFromHash } from "./routing";

describe("role routing", () => {
  it("routes each role to its own destination", () => {
    expect(roleDestination({ role: "superadmin", superadmin: { uid: "1", email: "a@b.com", displayName: "Admin" } })).toBe("superadmin");
    expect(roleDestination({ role: "supervisor", supervisor: { uid: "2", email: "s@b.com", displayName: "Supervisor", siteId: "site", authority: "regular" } })).toBe("supervisor");
    expect(roleDestination({ role: "cleaner", cleaner: { uid: "3", cleanerId: "cleaner", email: "c@b.com", displayName: "Cleaner", assignedSiteId: "site" } })).toBe("cleaner-integration-pending");
  });

  it("parses Superadmin Site and Site View deep links", () => {
    expect(superadminRouteFromHash("#/superadmin/sites")).toEqual({ kind: "sites" });
    expect(superadminRouteFromHash("#/superadmin/sites/site%2Fone")).toEqual({ kind: "site", siteId: "site/one" });
    expect(superadminRouteFromHash("#/superadmin/sites/site%2Fone/view/cameras")).toEqual({ kind: "site-view", siteId: "site/one", page: "cameras" });
    expect(superadminRouteFromHash("#/superadmin/sites/site-1/view/unknown")).toEqual({ kind: "site-view", siteId: "site-1", page: "dashboard" });
    expect(superadminRouteHash({ kind: "site-view", siteId: "site/one", page: "alerts" })).toBe("#/superadmin/sites/site%2Fone/view/alerts");
  });

  it("does not treat Cleaner or unknown hashes as Supervisor routes", () => {
    expect(supervisorRouteFromHash("#/alerts?zone=main")).toBe("alerts");
    expect(supervisorRouteFromHash("#/site")).toBe("site");
    expect(supervisorRouteFromHash("#/cleaner")).toBe("dashboard");
    expect(supervisorRouteFromHash("#/unknown")).toBe("dashboard");
  });
});
