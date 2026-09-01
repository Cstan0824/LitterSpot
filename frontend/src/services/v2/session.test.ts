import { describe, expect, it, vi } from "vitest";

vi.mock("../../config/firebase", () => ({ firebaseAuth: { currentUser: null } }));

import { deriveSupervisorCapabilities, parseSessionResponse } from "./session";

describe("V2 application sessions", () => {
  it("parses the Superadmin /api/me response", () => {
    expect(parseSessionResponse({ role: "superadmin", superadmin: { uid: "sa-1", email: "sa@example.com", displayName: "Platform Admin" } })).toEqual({
      role: "superadmin",
      superadmin: { uid: "sa-1", email: "sa@example.com", displayName: "Platform Admin" },
    });
  });

  it("parses root and regular Supervisor responses", () => {
    const root = parseSessionResponse({ role: "supervisor", supervisor: { uid: "root-1", email: "root@example.com", displayName: "Root", siteId: "site-1", authority: "root" } });
    const regular = parseSessionResponse({ role: "supervisor", supervisor: { uid: "regular-1", email: "regular@example.com", displayName: "Regular", siteId: "site-1", authority: "regular" } });
    expect(root.role).toBe("supervisor");
    expect(regular.role).toBe("supervisor");
    expect(root.role === "supervisor" && root.supervisor.authority).toBe("root");
    expect(regular.role === "supervisor" && regular.supervisor.authority).toBe("regular");
  });

  it("parses the Cleaner /api/me response", () => {
    expect(parseSessionResponse({ role: "cleaner", cleaner: { uid: "cleaner-auth-1", cleanerId: "cleaner-1", email: "cleaner@example.com", displayName: "Cleaner", assignedSiteId: "site-1", assignedZoneId: "" } })).toEqual({
      role: "cleaner",
      cleaner: { uid: "cleaner-auth-1", cleanerId: "cleaner-1", email: "cleaner@example.com", displayName: "Cleaner", assignedSiteId: "site-1", assignedZoneId: "", permittedSiteIds: undefined, permittedZoneIds: undefined, capabilities: undefined },
    });
  });

  it("derives Root-only and shared Supervisor capabilities", () => {
    expect(deriveSupervisorCapabilities("root")).toMatchObject({ manageSupervisors: true, configureSiteMap: true, manageCameraPlacement: true, registerCameras: true, manageCleaners: true });
    expect(deriveSupervisorCapabilities("regular")).toMatchObject({ manageSupervisors: false, configureSiteMap: false, manageCameraPlacement: false, registerCameras: true, manageCleaners: true, manageAlertsAndWork: true, manageOrchestrator: true });
  });
});
