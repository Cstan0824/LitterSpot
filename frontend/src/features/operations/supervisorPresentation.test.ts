import { describe, expect, it } from "vitest";
import { activeSupervisorDirectory, canManageSupervisor, filterManagedSupervisors, supervisorStatusLabel } from "./supervisorPresentation";

const supervisors = [
  { uid: "root", fullName: "Root Supervisor", email: "root@example.com", phone: null, authority: "root" as const, status: "active" as const, revision: 1 },
  { uid: "regular", fullName: "Regular Supervisor", email: "regular@example.com", phone: null, authority: "regular" as const, status: "inactive" as const, revision: 2 },
];

describe("Supervisor presentation", () => {
  it("uses Disabled as the product label for an inactive account", () => expect(supervisorStatusLabel("inactive")).toBe("Disabled"));
  it("filters Root account-management rows by status and email", () => expect(filterManagedSupervisors(supervisors, "inactive", "regular@example")).toEqual([supervisors[1]]));
  it("keeps disabled records out of a Regular Supervisor directory", () => expect(activeSupervisorDirectory(supervisors)).toEqual([supervisors[0]]));
  it("allows only Root to manage a Regular Supervisor", () => {
    expect(canManageSupervisor("root", supervisors[1])).toBe(true);
    expect(canManageSupervisor("regular", supervisors[1])).toBe(false);
    expect(canManageSupervisor("root", supervisors[0])).toBe(false);
  });
});
