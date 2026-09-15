import { describe, expect, it } from "vitest";
import { projectSupervisorList } from "./supervisorProjection.js";

const supervisors = [
  { uid: "root-1", fullName: "Root Supervisor", email: "root@example.test", phone: "+60111111111", authority: "root" as const, status: "active" as const, revision: 3 },
  { uid: "regular-1", fullName: "Active Regular", email: "active@example.test", phone: "+60222222222", authority: "regular" as const, status: "active" as const, revision: 2 },
  { uid: "regular-2", fullName: "Disabled Regular", email: "disabled@example.test", phone: "+60333333333", authority: "regular" as const, status: "inactive" as const, revision: 4 },
];

describe("projectSupervisorList", () => {
  it("gives Root the fields required for account management", () => {
    expect(projectSupervisorList(supervisors, "root")).toEqual(supervisors);
  });

  it("gives Regular Supervisors only active names and authority", () => {
    expect(projectSupervisorList(supervisors, "regular")).toEqual([
      { uid: "root-1", fullName: "Root Supervisor", authority: "root" },
      { uid: "regular-1", fullName: "Active Regular", authority: "regular" },
    ]);
  });
});
