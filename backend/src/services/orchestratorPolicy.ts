export type Point = { xMeters: number; yMeters: number };
export type RecentLocationStrength = "strong" | "weak" | "expired";

export function mapDistanceMeters(from: Point, to: Point) {
  return Math.hypot(to.xMeters - from.xMeters, to.yMeters - from.yMeters);
}

export function recentLocationStrength(minutesSinceResolution: number): RecentLocationStrength {
  if (minutesSinceResolution <= 5) return "strong";
  if (minutesSinceResolution <= 15) return "weak";
  return "expired";
}

export function assignmentPairKey(alertId: string, cleanerId: string) {
  return `${alertId}\u0000${cleanerId}`;
}

export function isEligibleAssignmentPair(
  eligiblePairs: Array<{ alertId: string; cleanerId: string }>,
  alertId: string,
  cleanerId: string,
) {
  const expected = assignmentPairKey(alertId, cleanerId);
  return eligiblePairs.some((pair) => assignmentPairKey(pair.alertId, pair.cleanerId) === expected);
}

export function technicalRetryDelays(limit = 3) {
  return [1000, 2000, 4000].slice(0, Math.max(0, limit));
}
