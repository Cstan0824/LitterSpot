import { apiFetch, readApiError } from "./apiClient";

export type BinReplacementRecommendation = {
  zoneId: string;
  evaluatedAt: string;
  windowStart: string;
  windowEnd: string;
  decision: "replacement_recommended" | "keep_current_bin" | "insufficient_evidence";
  recommended: boolean;
  provisional: true;
  automaticAction: false;
  policyVersion: string;
  windowMinutes: number;
  sampleIntervalSeconds: number;
  coverage: {
    observedSamples: number;
    validSamples: number;
    requiredValidSamples: number;
    unknownMinutes: number;
    unknownStateRatio: number;
    coverageReady: boolean;
  };
  fullMinutes: number;
  litterEpisodes: number;
  spillEpisodes: number;
  score: number;
  scoreThreshold: number;
  signals: {
    binPressure: number;
    litterPressure: number;
    spillPressure: number;
    humanPopularity: number;
  };
  highSignals: string[];
  triggerReason: string | null;
  raiseStreak: number;
  clearStreak: number;
};

async function request<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await apiFetch(input, init);
  if (!response.ok) throw new Error(await readApiError(response));
  return response.json() as Promise<T>;
}

export async function evaluateBinReplacement(
  zoneId: string,
  options: { windowMinutes?: number; evaluatedAt?: string } = {},
) {
  const params = new URLSearchParams();
  params.set("windowMinutes", String(options.windowMinutes ?? 10));
  if (options.evaluatedAt) params.set("evaluatedAt", options.evaluatedAt);
  const response = await request<{ recommendation: BinReplacementRecommendation }>(
    `/api/bin-replacement/${encodeURIComponent(zoneId)}/evaluate?${params.toString()}`,
    { method: "POST" },
  );
  return response.recommendation;
}
