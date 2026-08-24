import { HttpError } from "../shared/httpError.js";
import {
  type BinReplacementRecommendation,
  type BinReplacementQuery,
} from "../schemas/binReplacement.js";
import { evaluateBinReplacement } from "./binReplacementPolicy.js";
import {
  FirestoreBinReplacementRepository,
  type BinReplacementRepository,
} from "./binReplacementRepository.js";

const defaultRepository = new FirestoreBinReplacementRepository();

function evaluatedAt(value: string | undefined) {
  const result = value ? new Date(value) : new Date();
  if (!Number.isFinite(result.getTime())) throw new HttpError(400, "evaluatedAt must be a valid instant.");
  return result;
}

export async function evaluateZoneBinReplacement(
  zoneId: string,
  query: BinReplacementQuery,
  repository: BinReplacementRepository = defaultRepository,
): Promise<BinReplacementRecommendation> {
  const at = evaluatedAt(query.evaluatedAt);
  const start = new Date(at.getTime() - (query.windowMinutes - 1) * 60_000);
  const observations = await repository.loadRecentZoneObservations({
    zoneId,
    start,
    end: new Date(at.getTime() + 60_000),
    includeTestData: query.includeTestData,
  });
  const previous = await repository.loadPreviousRecommendation(zoneId);
  const recommendation = evaluateBinReplacement(zoneId, observations, previous, {
    evaluatedAt: at,
    windowMinutes: query.windowMinutes,
  });
  await repository.saveRecommendation(zoneId, recommendation);
  return recommendation;
}

export async function getPreviousZoneBinReplacement(
  zoneId: string,
  repository: BinReplacementRepository = defaultRepository,
) {
  const recommendation = await repository.loadCurrentRecommendation(zoneId);
  if (!recommendation) throw new HttpError(404, "No bin-replacement evaluation exists for this zone.");
  return recommendation;
}
