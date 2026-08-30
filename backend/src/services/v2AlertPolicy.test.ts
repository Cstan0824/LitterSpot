import { describe, expect, it } from "vitest";
import { nextAlertStatus, priorityScore, qualifiesIssue } from "./v2AlertPolicy.js";

describe("V2 Alert policy", () => {
  it("uses issue-specific confirmation windows", () => {
    const times = [0, 1000, 2000, 3000, 4000];
    expect(qualifiesIssue("floor_litter", times.map((capturedAtMs, index) => ({ capturedAtMs, positive: index !== 1 && index !== 3 })))).toBe(true);
    expect(qualifiesIssue("bin_service", [{ capturedAtMs: 0, positive: true }, { capturedAtMs: 1000, positive: false }, { capturedAtMs: 2000, positive: true }])).toBe(true);
    expect(qualifiesIssue("floor_spill", [{ capturedAtMs: 0, positive: true }])).toBe(true);
  });
  it("ages priority and prevents backward reopening", () => {
    expect(priorityScore({ severity: "warning", createdAtMs: 0, nowMs: 16 * 60 * 1000 })).toBe(50);
    expect(nextAlertStatus("in_progress", "assigned")).toBe(false);
    expect(nextAlertStatus("awaiting_review", "dismissed")).toBe(true);
  });
});
