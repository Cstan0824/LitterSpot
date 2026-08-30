import { describe, expect, it } from "vitest";
import { busyZoneScore, equalThirdsScore, mergeMinuteMetric } from "./v2Analytics.js";

describe("V2 analytics", () => {
  it("merges one Site-wide minute metric without losing peaks", () => {
    expect(mergeMinuteMetric(undefined, { sampleAttemptCount: 1, successfulSampleCount: 1, failedSampleCount: 0, peopleSum: 2, peopleMax: 2, qualifyingLitterCount: 1, qualifyingSpillCount: 0, qualifyingBinFullCount: 0, qualifyingBinOverflowCount: 0, simulationSampleCount: 1 })).toMatchObject({ peopleSum: 2, peopleMax: 2 });
    expect(mergeMinuteMetric({ sampleAttemptCount: 1, successfulSampleCount: 1, failedSampleCount: 0, peopleSum: 2, peopleMax: 2, qualifyingLitterCount: 1, qualifyingSpillCount: 0, qualifyingBinFullCount: 0, qualifyingBinOverflowCount: 0, simulationSampleCount: 1 }, { sampleAttemptCount: 1, successfulSampleCount: 1, failedSampleCount: 0, peopleSum: 3, peopleMax: 3, qualifyingLitterCount: 0, qualifyingSpillCount: 1, qualifyingBinFullCount: 0, qualifyingBinOverflowCount: 0, simulationSampleCount: 0 })).toMatchObject({ sampleAttemptCount: 2, peopleSum: 5, peopleMax: 3 });
  });
  it("uses equal thirds for placement and equal halves for Busy Zone", () => {
    expect(equalThirdsScore({ peopleActivity: 1, cleaningFrequency: 0, binServiceFrequency: 0 })).toBeCloseTo(33.333, 2);
    expect(busyZoneScore({ normalizedPeoplePressure: 1, normalizedActiveWorkPoints: 0 })).toBe(50);
  });
});

