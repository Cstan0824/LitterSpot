import { describe, expect, it } from "vitest";
import { projectV2SupervisorList } from "./v2SupervisorProjection.js";

const supervisors = [
  { uid: "root-1", fullName: "Root Supervisor", email: "root@example.test", phone: "+60111111111", authority: "root" as const, status: "active" as const, revision: 3 },
  { uid: "regular-1", fullName: "Active Regular", email: "active@example.test", phone: "+60222222222", authority: "regular" as const, status: "active" as const, revision: 2 },
  { uid: "regular-2", fullName: "Disabled Regular", email: "disabled@example.test", phone: "+60333333333", authority: "regular" as const, status: "inactive" as const, revision: 4 },
];

describe("projectV2SupervisorList", () => {
  it("gives Root the fields required for account management", () => {
    expect(projectV2SupervisorList(supervisors, "root")).toEqual(supervisors);
  });

  it("gives Regular Supervisors only active names and authority", () => {
    expect(projectV2SupervisorList(supervisors, "regular")).toEqual([
      { uid: "root-1", fullName: "Root Supervisor", authority: "root" },
      { uid: "regular-1", fullName: "Active Regular", authority: "regular" },
    ]);
  });
});
