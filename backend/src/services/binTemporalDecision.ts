import type { PipelineAnalysisResponse } from "../schemas/detection.js";
import type { BinStateHistory, VideoBinTrackingState } from "./videoBinTracking.js";

const WINDOW_MS = 5_000;
const MAX_SAMPLES = 3;

type TemporalBin = PipelineAnalysisResponse["bins"][number] & {
  binId?: string | null;
  stableState?: "normal" | "full" | "overflow" | "review" | "unknown" | null;
  confirmed?: boolean;
  confirmationFrames?: number;
  unknownReasons?: string[];
};

export function confirmTemporalBinStates(
  bins: readonly TemporalBin[],
  state: VideoBinTrackingState,
  capturedAtMs: number,
  registrationRevision: number,
) {
  const histories = { ...(state.stateHistories ?? {}) } as Record<string, BinStateHistory>;
  const output = bins.map((bin) => {
    const key = bin.binId ?? null;
    if (!key || bin.state === "unknown" || bin.state === "review") {
      if (key) delete histories[key];
      return {
        ...bin,
        confirmed: false,
        stableState: null,
        confirmationFrames: 0,
      };
    }

    const previous = histories[key];
    const history: BinStateHistory = previous && previous.registrationRevision === registrationRevision
      ? { registrationRevision, samples: previous.samples.filter((sample) => capturedAtMs - sample.capturedAtMs <= WINDOW_MS).slice(-MAX_SAMPLES) }
      : { registrationRevision, samples: [] };
    const last = history.samples[history.samples.length - 1];
    if (!last || last.state !== bin.state || capturedAtMs > last.capturedAtMs) {
      history.samples = [...history.samples, { state: bin.state, capturedAtMs }].slice(-MAX_SAMPLES);
    }
    histories[key] = history;
    const matchingFrames = history.samples.filter((sample) => sample.state === bin.state).length;
    const confirmed = matchingFrames >= 2;
    return {
      ...bin,
      confirmed,
      stableState: confirmed ? bin.state : null,
      confirmationFrames: matchingFrames,
      unknownReasons: confirmed ? (bin.unknownReasons ?? []) : [...(bin.unknownReasons ?? []), "temporal_confirmation_pending"],
    };
  });

  return { bins: output, state: { ...state, stateHistories: histories } };
}
