export type RankingFactor = { raw: number; normalized: number; contribution: number };

export function rankBinPlacementFactors(input: { peopleActivity: number; cleaningFrequency: number; binServiceFrequency: number }) {
  const values = [input.peopleActivity, input.cleaningFrequency, input.binServiceFrequency];
  const maximum = Math.max(...values, 0);
  const normalize = (raw: number): RankingFactor => ({ raw, normalized: maximum === 0 ? 0 : (raw / maximum) * 100, contribution: maximum === 0 ? 0 : (raw / maximum) * (100 / 3) });
  const factors = { peopleActivity: normalize(input.peopleActivity), cleaningFrequency: normalize(input.cleaningFrequency), binServiceFrequency: normalize(input.binServiceFrequency) };
  return { totalScore: factors.peopleActivity.contribution + factors.cleaningFrequency.contribution + factors.binServiceFrequency.contribution, factors };
}

export function interventionExclusionEndsAt(implementedAt: Date) {
  const result = new Date(implementedAt);
  result.setUTCDate(result.getUTCDate() + 2);
  return result;
}

export function hasEnoughComparisonDays(requestedDays: number) { return Number.isInteger(requestedDays) && requestedDays >= 2; }

