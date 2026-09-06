import { describe, expect, it } from "vitest";
import { roleDestination, supervisorRouteFromHash } from "./routing";

describe("role routing", () => {
  it("routes each role to its own destination", () => {
    expect(roleDestination({ role: "superadmin", superadmin: { uid: "1", email: "a@b.com", displayName: "Admin" } })).toBe("superadmin-integration-pending");
    expect(roleDestination({ role: "supervisor", supervisor: { uid: "2", email: "s@b.com", displayName: "Supervisor", siteId: "site", authority: "regular" } })).toBe("supervisor");
    expect(roleDestination({ role: "cleaner", cleaner: { uid: "3", cleanerId: "cleaner", email: "c@b.com", displayName: "Cleaner", assignedSiteId: "site" } })).toBe("cleaner-integration-pending");
  });

  it("does not treat Cleaner or unknown hashes as Supervisor routes", () => {
    expect(supervisorRouteFromHash("#/alerts?zone=main")).toBe("alerts");
    expect(supervisorRouteFromHash("#/site")).toBe("site");
    expect(supervisorRouteFromHash("#/cleaner")).toBe("dashboard");
    expect(supervisorRouteFromHash("#/unknown")).toBe("dashboard");
  });
});
