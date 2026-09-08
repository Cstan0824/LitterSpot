import { describe, expect, it } from "vitest";
import { cleanerAvailabilityLabel, cleanerCompletionActionLabel, cleanerGreeting, cleanerUsesCompletionPhoto, durationLabel, notificationTone, scheduleDurationMinutes } from "./cleanerMobilePresentation";

describe("Cleaner mobile presentation", () => {
  it("uses human availability copy instead of backend reason codes", () => {
    expect(cleanerAvailabilityLabel({ hasActiveWork: true, available: false, reasons: ["active_work"] })).toBe("Busy");
    expect(cleanerAvailabilityLabel({ hasActiveWork: false, available: false, reasons: ["outside_schedule"] })).toBe("Outside schedule");
  });

  it("formats all-day and overnight durations without decimal hours", () => {
    expect(scheduleDurationMinutes(0, 1439)).toBe(1440);
    expect(durationLabel(scheduleDurationMinutes(0, 1439))).toBe("24 hours");
    expect(durationLabel(scheduleDurationMinutes(1320, 360))).toBe("8 hours");
  });

  it("maps notification event names to visible tones", () => {
    expect(notificationTone("work_rework")).toBe("rework");
    expect(notificationTone("work_resolved")).toBe("resolved");
    expect(notificationTone("work_dismissed")).toBe("dismissed");
  });

  it("uses the current part of day", () => {
    expect(cleanerGreeting(9)).toBe("Good morning");
    expect(cleanerGreeting(14)).toBe("Good afternoon");
    expect(cleanerGreeting(20)).toBe("Good evening");
  });

  it("uses Work origin rather than target type for completion evidence", () => {
    expect(cleanerUsesCompletionPhoto("manual")).toBe(true);
    expect(cleanerUsesCompletionPhoto("alert")).toBe(false);
    expect(cleanerCompletionActionLabel("manual", false)).toBe("Add 1 completion photo");
    expect(cleanerCompletionActionLabel("manual", true)).toBe("Submit photo for review");
    expect(cleanerCompletionActionLabel("alert", false)).toBe("Done cleaning");
  });
});
