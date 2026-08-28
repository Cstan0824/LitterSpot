import {
  binReplacementPolicySchema,
  type BinReplacementCoverage,
  type BinReplacementPolicy,
  type BinReplacementRecommendation,
} from "../schemas/binReplacement.js";

export type BinState = "normal" | "full" | "overflow" | "unknown";
export type BinReplacementSignalName = "bin_pressure" | "litter_pressure" | "spill_pressure" | "human_popularity";
export type NormalizedPoint = { x: number; y: number };
export type NormalizedBox = { x1: number; y1: number; x2: number; y2: number };

export type BinReplacementObservation = {
  createdAt: string;
  peopleCount: number;
  isTest: boolean;
  bins: Array<{
    state: BinState;
    stableState?: BinState | null;
    confirmed?: boolean | null;
    stale?: boolean;
  }>;
  floorHazards: Array<{
    className: "floor_litter" | "floor_spill";
    bboxNormalized?: NormalizedBox | null;
  }>;
  /** A completed, downstream-eligible event may trigger the short prototype recommendation. */
  confirmedEvent?: boolean;
};

export type PreviousBinReplacementDecision = {
  recommended: boolean;
  triggerReason: string | null;
  raiseStreak: number;
  clearStreak: number;
};

export const DEFAULT_BIN_REPLACEMENT_POLICY: BinReplacementPolicy = {
  version: "bin-replacement-v1-short-window",
  provisional: true,
  windowMinutes: 10,
  minimumValidMinutes: 8,
  unknownRatioLimit: 0.20,
  scoreThreshold: 70,
  minimumHighSignals: 2,
  weights: {
    binPressure: 0.50,
    litterPressure: 0.25,
    spillPressure: 0.10,
    humanPopularity: 0.15,
  },
  thresholds: {
    binPressure: 50,
    litterPressure: 50,
    spillPressure: 50,
    humanPopularity: 60,
  },
  evaluationsToRaise: 2,
  evaluationsToClear: 3,
  hazardGapMinutes: 2,
  hazardMatchDistance: 0.12,
  sampleIntervalSeconds: 60,
};

type MinuteSample = {
  timestamp: Date;
  peoplePresent: boolean;
  full: boolean;
  unknown: boolean;
  hazards: Record<"floor_litter" | "floor_spill", Array<NormalizedPoint | null>>;
};

function parseInstant(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Invalid observation timestamp: ${value}`);
  return parsed;
}

function minuteStart(value: Date) {
  const result = new Date(value);
  result.setUTCSeconds(0, 0);
  return result;
}

function round(value: number, places = 1) {
  const multiplier = 10 ** places;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}

function percentage(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : numerator / denominator * 100;
}

function pointForHazard(hazard: BinReplacementObservation["floorHazards"][number]) {
  if (!hazard.bboxNormalized) return null;
  return {
    x: (hazard.bboxNormalized.x1 + hazard.bboxNormalized.x2) / 2,
    y: (hazard.bboxNormalized.y1 + hazard.bboxNormalized.y2) / 2,
  };
}

function distance(left: NormalizedPoint, right: NormalizedPoint) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function stateForBin(bin: BinReplacementObservation["bins"][number]): BinState {
  if (bin.stale) return "unknown";
  // A stable classifier result is authoritative. In particular, stable
  // unknown must not fall back to a tempting raw full/overflow state.
  if (bin.stableState !== undefined && bin.stableState !== null) return bin.stableState;
  if (bin.confirmed === true) return bin.state;
  // A normal state is a safe negative even when the temporal confirmer has not
  // promoted it yet. A raw full classification is a capacity signal; a raw
  // overflow classification remains a known state for coverage but is
  // deliberately gated below because it is the common object-on-lid false
  // positive.
  if (bin.state === "full" || bin.state === "overflow" || bin.state === "normal") return bin.state;
  return "unknown";
}

function triggerReason(highSignals: BinReplacementSignalName[]) {
  if (highSignals.includes("bin_pressure") && highSignals.includes("litter_pressure")) return "full_bin_with_recurring_litter";
  if (highSignals.includes("bin_pressure")) return "capacity_pressure";
  if (highSignals.includes("litter_pressure")) return "recurring_litter";
  if (highSignals.includes("spill_pressure")) return "recurring_spills";
  return "high_zone_activity";
}

function countHazardEpisodes(samples: MinuteSample[], kind: "floor_litter" | "floor_spill", policy: BinReplacementPolicy) {
  const episodes: Array<{ last: Date; point: NormalizedPoint | null }> = [];
  for (const sample of samples) {
    for (const point of sample.hazards[kind]) {
      const matching = episodes.filter((episode) => {
        const gapMinutes = (sample.timestamp.getTime() - episode.last.getTime()) / 60_000;
        if (gapMinutes > policy.hazardGapMinutes) return false;
        return !point || !episode.point || distance(point, episode.point) <= policy.hazardMatchDistance;
      });
      if (matching.length > 0) {
        const episode = matching[0];
        episode.last = sample.timestamp;
        episode.point = point ?? episode.point;
      } else {
        episodes.push({ last: sample.timestamp, point });
      }
    }
  }
  return episodes.length;
}

function minuteSamples(observations: BinReplacementObservation[], windowMinutes: number): MinuteSample[] {
  const grouped = new Map<number, BinReplacementObservation[]>();
  for (const observation of observations) {
    const timestamp = minuteStart(parseInstant(observation.createdAt));
    const key = timestamp.getTime();
    const bucket = grouped.get(key) ?? [];
    bucket.push(observation);
    grouped.set(key, bucket);
  }
  if (grouped.size === 0) return [];

  const latest = Math.max(...grouped.keys());
  const first = latest - (windowMinutes - 1) * 60_000;
  return [...grouped.entries()]
    .filter(([timestamp]) => timestamp >= first)
    .sort(([left], [right]) => left - right)
    .map(([timestamp, rows]) => {
      const states: BinState[] = [];
      let full = false;
      let peoplePresent = false;
      const hazards: MinuteSample["hazards"] = { floor_litter: [], floor_spill: [] };
      for (const row of rows) {
        peoplePresent ||= row.peopleCount > 0;
        for (const bin of row.bins) {
          const state = stateForBin(bin);
          states.push(state);
          if (state === "full") full = true;
          if (state === "overflow" && (bin.stableState === "overflow" || bin.confirmed === true)) full = true;
        }
        for (const hazard of row.floorHazards) hazards[hazard.className].push(pointForHazard(hazard));
      }
      const knownStates = new Set(states.filter((state) => state === "normal" || state === "full" || state === "overflow"));
      return {
        timestamp: new Date(timestamp),
        peoplePresent,
        full,
        unknown: knownStates.size === 0,
        hazards,
      };
    });
}

function coverageFor(samples: MinuteSample[], policy: BinReplacementPolicy): BinReplacementCoverage {
  const unknownMinutes = samples.filter((sample) => sample.unknown).length;
  const validSamples = samples.length;
  const unknownStateRatio = validSamples === 0 ? 1 : unknownMinutes / validSamples;
  return {
    observedSamples: samples.length,
    validSamples,
    requiredValidSamples: policy.minimumValidMinutes,
    unknownMinutes,
    unknownStateRatio: round(unknownStateRatio, 4),
    coverageReady: validSamples >= policy.minimumValidMinutes && unknownStateRatio <= policy.unknownRatioLimit,
  };
}

export function evaluateBinReplacement(
  zoneId: string,
  observations: BinReplacementObservation[],
  previous: PreviousBinReplacementDecision | null = null,
  options: { evaluatedAt?: Date; windowMinutes?: number; policy?: BinReplacementPolicy } = {},
): BinReplacementRecommendation {
  const policy = binReplacementPolicySchema.parse(options.policy ?? DEFAULT_BIN_REPLACEMENT_POLICY);
  const windowMinutes = options.windowMinutes ?? policy.windowMinutes;
  if (!Number.isInteger(windowMinutes) || windowMinutes < 5 || windowMinutes > 30) throw new Error("windowMinutes must be between 5 and 30");
  // Repository implementations decide whether test observations are exposed;
  // the pure policy evaluates the rows it is given so replay fixtures and
  // emulator data use exactly the same path as production observations.
  const samples = minuteSamples(observations, windowMinutes);
  const coverage = coverageFor(samples, policy);
  const latestEvent = observations
    .filter((observation) => observation.confirmedEvent === true)
    .map((observation) => parseInstant(observation.createdAt).getTime())
    .filter((timestamp) => timestamp >= (options.evaluatedAt ?? new Date()).getTime() - windowMinutes * 60_000)
    .length > 0;
  const fullMinutes = samples.filter((sample) => sample.full).length;
  const litterEpisodes = countHazardEpisodes(samples, "floor_litter", policy);
  const spillEpisodes = countHazardEpisodes(samples, "floor_spill", policy);
  const binPressure = percentage(fullMinutes, coverage.validSamples);
  const litterPressure = Math.min(100, litterEpisodes / 3 * 100);
  const spillPressure = Math.min(100, spillEpisodes / 2 * 100);
  const peoplePresentRatio = coverage.validSamples === 0
    ? 0
    : samples.filter((sample) => sample.peoplePresent).length / coverage.validSamples;
  const humanPopularity = Math.min(100, peoplePresentRatio / 0.60 * 100);
  const signals = {
    binPressure: round(binPressure),
    litterPressure: round(litterPressure),
    spillPressure: round(spillPressure),
    humanPopularity: round(humanPopularity),
  };
  const highSignals = (Object.entries({
    bin_pressure: binPressure,
    litter_pressure: litterPressure,
    spill_pressure: spillPressure,
    human_popularity: humanPopularity,
  }) as Array<[BinReplacementSignalName, number]>).filter(([name, value]) => {
    const threshold = policy.thresholds[name === "bin_pressure" ? "binPressure" : name === "litter_pressure" ? "litterPressure" : name === "spill_pressure" ? "spillPressure" : "humanPopularity"];
    return value >= threshold;
  }).map(([name]) => name);
  const score = round(
    policy.weights.binPressure * binPressure
    + policy.weights.litterPressure * litterPressure
    + policy.weights.spillPressure * spillPressure
    + policy.weights.humanPopularity * humanPopularity,
  );
  const passing = coverage.coverageReady && score >= policy.scoreThreshold && highSignals.length >= policy.minimumHighSignals;
  const current = previous ?? { recommended: false, triggerReason: null, raiseStreak: 0, clearStreak: 0 };
  let recommended = current.recommended;
  let trigger = current.triggerReason;
  let raiseStreak = current.raiseStreak;
  let clearStreak = current.clearStreak;
  let decision: BinReplacementRecommendation["decision"];
  // A single confirmed event is sufficient for the short prototype demo. It
  // remains explicitly provisional and never performs an automatic action.
  // Longer windows retain the existing ranking/hysteresis policy so the old
  // benchmark fixtures remain comparable.
  const singleConfirmedEvent = latestEvent && observations.length <= 3;
  if (singleConfirmedEvent) {
    recommended = true;
    trigger = "single_confirmed_event";
    raiseStreak = 0;
    clearStreak = 0;
    decision = "replacement_recommended";
  } else if (!coverage.coverageReady) {
    raiseStreak = 0;
    clearStreak = 0;
    decision = "insufficient_evidence";
  } else if (recommended) {
    raiseStreak = 0;
    if (passing) clearStreak = 0;
    else {
      clearStreak += 1;
      if (clearStreak >= policy.evaluationsToClear) {
        recommended = false;
        trigger = null;
        clearStreak = 0;
      }
    }
    decision = recommended ? "replacement_recommended" : "keep_current_bin";
  } else {
    clearStreak = 0;
    if (passing) {
      raiseStreak += 1;
      if (raiseStreak >= policy.evaluationsToRaise) {
        recommended = true;
        trigger = triggerReason(highSignals);
        raiseStreak = 0;
      }
    } else raiseStreak = 0;
    decision = recommended ? "replacement_recommended" : "keep_current_bin";
  }

  const evaluatedAt = options.evaluatedAt ?? new Date();
  const latestObservation = samples.at(-1)?.timestamp ?? evaluatedAt;
  const windowEnd = new Date(Math.max(latestObservation.getTime(), evaluatedAt.getTime()));
  const windowStart = new Date(windowEnd.getTime() - (windowMinutes - 1) * 60_000);
  return {
    zoneId,
    evaluatedAt: evaluatedAt.toISOString(),
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    decision,
    recommended,
    provisional: true,
    automaticAction: false,
    policyVersion: policy.version,
    windowMinutes,
    sampleIntervalSeconds: policy.sampleIntervalSeconds,
    coverage,
    fullMinutes,
    litterEpisodes,
    spillEpisodes,
    score,
    scoreThreshold: policy.scoreThreshold,
    signals,
    highSignals,
    triggerReason: trigger,
    raiseStreak,
    clearStreak,
  };
}
