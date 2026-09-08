import { describe, expect, it } from "vitest";
import { superadminSiteViewPageFromPath } from "./SuperadminSiteView";

describe("Superadmin Site View navigation", () => {
  it.each([
    ["/", "dashboard"], ["/cameras", "cameras"], ["/alerts", "alerts"], ["/history", "work"],
    ["/admin", "team"], ["/placement", "insights"], ["/status", "system"], ["/site", "site"],
  ] as const)("maps Supervisor path %s into the %s Site View page", (path, expected) => {
    expect(superadminSiteViewPageFromPath(path)).toBe(expected);
  });

  it("falls back to the selected Site dashboard", () => {
    expect(superadminSiteViewPageFromPath("/unknown")).toBe("dashboard");
  });
});
