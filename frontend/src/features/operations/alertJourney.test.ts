import { describe, expect, it } from "vitest";
import { alertResponseJourney } from "./alertJourney";

const work = { status: "in_progress", cleanerNameSnapshot: "Gan", reworkCount: 0, latestVerificationOutcome: null };

describe("Alert response journey", () => {
  it("keeps Cleaner assignment current while an Alert waits", () => {
    const stages = alertResponseJourney({ status: "waiting_for_cleaner", evidenceAvailable: true });
    expect(stages.map((stage) => stage.state)).toEqual(["done", "done", "current", "pending", "pending"]);
    expect(stages[2].label).toBe("Waiting for Cleaner");
  });

  it("shows active cleaning and rework without inventing travel state", () => {
    expect(alertResponseJourney({ status: "in_progress", evidenceAvailable: true }, work)[3]).toMatchObject({ label: "Cleaning in progress", state: "current" });
    expect(alertResponseJourney({ status: "in_progress", evidenceAvailable: true }, { ...work, reworkCount: 1 })[3]).toMatchObject({ label: "Rework in progress", state: "current" });
  });

  it("maps review, resolution, and dismissal to their real outcomes", () => {
    expect(alertResponseJourney({ status: "awaiting_review", evidenceAvailable: true }, { ...work, status: "awaiting_review" })[4]).toMatchObject({ label: "Verification in progress", state: "current" });
    expect(alertResponseJourney({ status: "resolved", evidenceAvailable: true }, { ...work, status: "resolved", latestVerificationOutcome: "passed" })[4]).toMatchObject({ label: "Resolved", state: "done" });
    expect(alertResponseJourney({ status: "dismissed", evidenceAvailable: true }, { ...work, status: "dismissed" })[4]).toMatchObject({ label: "Alert dismissed", state: "terminal" });
  });
});
