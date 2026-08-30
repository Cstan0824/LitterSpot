export type CleanerCandidate = { cleanerId: string; distanceMeters: number; available: boolean };

export function selectCandidate(candidates: CleanerCandidate[], excludedIds: Set<string>) {
  return candidates.filter((candidate) => candidate.available && !excludedIds.has(candidate.cleanerId)).sort((a, b) => a.distanceMeters - b.distanceMeters)[0] ?? null;
}

export function nextCandidateAfterConflict(candidates: CleanerCandidate[], excludedIds: Set<string>, conflictedId: string) {
  excludedIds.add(conflictedId);
  return selectCandidate(candidates, excludedIds);
}

export function technicalRetryDelays(limit = 3) { return [1000, 2000, 4000].slice(0, Math.max(0, limit)); }

