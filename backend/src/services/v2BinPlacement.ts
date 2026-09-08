export type RankingFactor = { raw: number; normalized: number; contribution: number };
import { fullDayExclusion } from "./phase11Calendar.js";

export function rankBinPlacementFactors(input: { peopleActivity: number; cleaningFrequency: number; binServiceFrequency: number }, maxima = { peopleActivity: 1, cleaningFrequency: 1, binServiceFrequency: 1 }) {
  const normalize = (raw: number, maximum: number): RankingFactor => ({ raw, normalized: maximum <= 0 ? 0 : Math.min(1, raw / maximum) * 100, contribution: maximum <= 0 ? 0 : Math.min(1, raw / maximum) * (100 / 3) });
  const factors = { peopleActivity: normalize(input.peopleActivity,maxima.peopleActivity), cleaningFrequency: normalize(input.cleaningFrequency,maxima.cleaningFrequency), binServiceFrequency: normalize(input.binServiceFrequency,maxima.binServiceFrequency) };
  return { totalScore: factors.peopleActivity.contribution + factors.cleaningFrequency.contribution + factors.binServiceFrequency.contribution, factors };
}

export function interventionExclusionEndsAt(implementedAt: Date, timeZone = "UTC") {
  return fullDayExclusion(implementedAt,timeZone);
}

export function hasEnoughComparisonDays(requestedDays: number) { return Number.isInteger(requestedDays) && requestedDays >= 2; }
