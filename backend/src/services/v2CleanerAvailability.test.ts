import { describe, expect, it } from "vitest";
import { deriveCleanerAvailability, isWithinWeeklySchedule } from "./v2CleanerAvailability.js";

describe("V2 Cleaner availability", () => {
  it("handles regular and overnight shifts in the Site timezone", () => {
    const regular = { mon: { startMinute: 540, endMinute: 1020 } };
    expect(isWithinWeeklySchedule(regular, new Date("2026-08-31T04:00:00.000Z"), "Asia/Kuala_Lumpur")).toBe(true);
    expect(isWithinWeeklySchedule(regular, new Date("2026-08-31T12:00:00.000Z"), "Asia/Kuala_Lumpur")).toBe(false);
    const overnight = { mon: { startMinute: 1320, endMinute: 120 } };
    expect(isWithinWeeklySchedule(overnight, new Date("2026-08-31T16:30:00.000Z"), "Asia/Kuala_Lumpur")).toBe(true);
    expect(isWithinWeeklySchedule(overnight, new Date("2026-08-31T18:30:00.000Z"), "Asia/Kuala_Lumpur")).toBe(false);
  });

  it("reports every blocking availability reason", () => {
    const result = deriveCleanerAvailability({ siteActive: true, accountActive: true, cleanerActive: true, availabilityOverride: "unavailable", activeWorkOrderId: "work-1", stationPointValid: false, schedule: {}, scheduleTimeZone: "Asia/Kuala_Lumpur", at: new Date("2026-08-31T04:00:00.000Z") });
    expect(result.available).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining(["availability_override", "active_work_order", "invalid_station_point", "outside_schedule"]));
  });
});

