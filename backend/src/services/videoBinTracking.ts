export const VIDEO_BIN_TRACKING_VERSION = "video-bin-tracking-v1";
export const VIDEO_BIN_MATCH_THRESHOLD = 0.35;
export const VIDEO_BIN_MAX_MISSES = 2;

export type PixelBoundingBox = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type VideoBinDetection = {
  bbox: PixelBoundingBox;
  [key: string]: unknown;
};

export type VideoBinTrack = {
  bbox: PixelBoundingBox;
  consecutiveSeen: number;
  missed: number;
  confirmed: boolean;
};

export type VideoBinTrackingState = {
  version: typeof VIDEO_BIN_TRACKING_VERSION;
  nextId: number;
  tracks: Record<string, VideoBinTrack>;
};

export type TrackedVideoBin<T extends VideoBinDetection> = Omit<T, "trackingId" | "confirmed" | "stale"> & {
  trackingId: string;
  confirmed: boolean;
  stale: false;
  trackingConfirmed: boolean;
  trackingConsecutiveSeen: number;
};

export type VideoBinTrackingInput<T extends VideoBinDetection> = {
  bins: readonly T[];
  image: { width: number; height: number };
  state?: VideoBinTrackingState | null;
};

export type VideoBinTrackingResult<T extends VideoBinDetection> = {
  bins: Array<TrackedVideoBin<T>>;
  state: VideoBinTrackingState;
};

type CandidateMatch = {
  binIndex: number;
  bboxKey: string;
  trackingId: string;
  score: number;
};

function finite(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function copyBox(box: PixelBoundingBox): PixelBoundingBox {
  return {
    x1: finite(box.x1),
    y1: finite(box.y1),
    x2: finite(box.x2),
    y2: finite(box.y2),
  };
}

function hasFiniteBox(box: PixelBoundingBox) {
  return [box.x1, box.y1, box.x2, box.y2].every(Number.isFinite);
}

function positiveInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonnegativeInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function cloneState(input?: VideoBinTrackingState | null): VideoBinTrackingState {
  const tracks: Record<string, VideoBinTrack> = {};
  if (input?.tracks && typeof input.tracks === "object") {
    for (const [trackingId, candidate] of Object.entries(input.tracks)) {
      if (!candidate || typeof candidate !== "object" || !candidate.bbox || !hasFiniteBox(candidate.bbox)) continue;
      const missed = nonnegativeInteger(candidate.missed, 0);
      if (missed > VIDEO_BIN_MAX_MISSES) continue;
      tracks[trackingId] = {
        bbox: copyBox(candidate.bbox),
        consecutiveSeen: positiveInteger(candidate.consecutiveSeen, 1),
        missed,
        confirmed: Boolean(candidate.confirmed),
      };
    }
  }
  return {
    version: VIDEO_BIN_TRACKING_VERSION,
    nextId: positiveInteger(input?.nextId, 1),
    tracks,
  };
}

function safeDimension(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function videoBinIoU(first: PixelBoundingBox, second: PixelBoundingBox) {
  if (!hasFiniteBox(first) || !hasFiniteBox(second)) return 0;
  const width = Math.max(0, Math.min(first.x2, second.x2) - Math.max(first.x1, second.x1));
  const height = Math.max(0, Math.min(first.y2, second.y2) - Math.max(first.y1, second.y1));
  const intersection = width * height;
  const firstArea = Math.max(0, first.x2 - first.x1) * Math.max(0, first.y2 - first.y1);
  const secondArea = Math.max(0, second.x2 - second.x1) * Math.max(0, second.y2 - second.y1);
  const union = firstArea + secondArea - intersection;
  const overlap = union > 0 ? intersection / union : 0;
  return Number.isFinite(overlap) ? overlap : 0;
}

export function videoBinMatchScore(
  first: PixelBoundingBox,
  second: PixelBoundingBox,
  imageWidth: number,
  imageHeight: number,
) {
  if (!hasFiniteBox(first) || !hasFiniteBox(second)) return 0;
  const overlap = videoBinIoU(first, second);
  const firstCenter = { x: (first.x1 + first.x2) / 2, y: (first.y1 + first.y2) / 2 };
  const secondCenter = { x: (second.x1 + second.x2) / 2, y: (second.y1 + second.y2) / 2 };
  const dx = (firstCenter.x - secondCenter.x) / safeDimension(imageWidth);
  const dy = (firstCenter.y - secondCenter.y) / safeDimension(imageHeight);
  const proximity = Math.max(0, 1 - Math.hypot(dx, dy) / 0.25);
  const score = Math.max(overlap, proximity * 0.7);
  return Number.isFinite(score) ? score : 0;
}

function boundingBoxKey(box: PixelBoundingBox) {
  return [box.x1, box.y1, box.x2, box.y2].map((value) => String(finite(value))).join(":");
}

function assignments<T extends VideoBinDetection>(
  bins: readonly T[],
  tracks: Record<string, VideoBinTrack>,
  image: { width: number; height: number },
) {
  const candidates: CandidateMatch[] = [];
  for (let binIndex = 0; binIndex < bins.length; binIndex += 1) {
    for (const [trackingId, track] of Object.entries(tracks)) {
      const score = videoBinMatchScore(bins[binIndex].bbox, track.bbox, image.width, image.height);
      if (score >= VIDEO_BIN_MATCH_THRESHOLD) {
        candidates.push({ binIndex, bboxKey: boundingBoxKey(bins[binIndex].bbox), trackingId, score });
      }
    }
  }
  candidates.sort((left, right) => right.score - left.score
    || left.trackingId.localeCompare(right.trackingId, undefined, { numeric: true })
    || left.bboxKey.localeCompare(right.bboxKey));

  const assignedBins = new Set<number>();
  const assignedTracks = new Set<string>();
  const result = new Map<number, string>();
  for (const candidate of candidates) {
    if (assignedBins.has(candidate.binIndex) || assignedTracks.has(candidate.trackingId)) continue;
    assignedBins.add(candidate.binIndex);
    assignedTracks.add(candidate.trackingId);
    result.set(candidate.binIndex, candidate.trackingId);
  }
  return result;
}

function allocateTrackingId(state: VideoBinTrackingState) {
  let trackingId = `bin-${state.nextId}`;
  while (state.tracks[trackingId]) {
    state.nextId += 1;
    trackingId = `bin-${state.nextId}`;
  }
  state.nextId += 1;
  return trackingId;
}

/**
 * Match only the bins observed in the current frame and return a new, JSON-safe
 * state value. Unseen tracks remain eligible for two missed frames, but are not
 * copied into the output. `confirmed` is an identity diagnostic and becomes
 * sticky after the same track is seen in two consecutive frames.
 */
export function trackVideoBins<T extends VideoBinDetection>(
  input: VideoBinTrackingInput<T>,
): VideoBinTrackingResult<T> {
  const state = cloneState(input.state);
  const matched = assignments(input.bins, state.tracks, input.image);
  const seen = new Set<string>();
  const bins = input.bins.map((bin, binIndex): TrackedVideoBin<T> => {
    let trackingId = matched.get(binIndex);
    if (trackingId) {
      const track = state.tracks[trackingId];
      track.consecutiveSeen = track.missed === 0 ? track.consecutiveSeen + 1 : 1;
      track.missed = 0;
      track.bbox = copyBox(bin.bbox);
      track.confirmed = track.confirmed || track.consecutiveSeen >= 2;
    } else {
      trackingId = allocateTrackingId(state);
      state.tracks[trackingId] = {
        bbox: copyBox(bin.bbox),
        consecutiveSeen: 1,
        missed: 0,
        confirmed: false,
      };
    }
    const track = state.tracks[trackingId];
    seen.add(trackingId);
    return {
      ...bin,
      trackingId,
      confirmed: track.confirmed,
      stale: false,
      trackingConfirmed: track.confirmed,
      trackingConsecutiveSeen: track.consecutiveSeen,
    } as TrackedVideoBin<T>;
  });

  for (const trackingId of Object.keys(state.tracks)) {
    if (seen.has(trackingId)) continue;
    const track = state.tracks[trackingId];
    track.missed += 1;
    if (track.missed > VIDEO_BIN_MAX_MISSES) delete state.tracks[trackingId];
  }

  return { bins, state };
}
