import { describe, expect, it } from "vitest";
import { pipelineAnalysisResponseSchema, placementRecommendationSchema } from "./detection.js";

const specialistResponse = {
  analysisId: 1,
  imageName: "fixture.jpg",
  cameraId: "camera-1",
  image: { width: 640, height: 480 },
  peopleCount: 0,
  people: [],
  bins: [{
    binIndex: 1,
    trackingId: "bin-1",
    localizerConfidence: 0.94,
    candidateSource: "specialist_profile",
    binPresenceScore: 0.94,
    profileMatched: true,
    bbox: { x1: 100, y1: 100, x2: 300, y2: 400 },
    classificationRegion: { x1: 80, y1: 70, x2: 320, y2: 430 },
    state: "overflow",
    stateConfidence: 0.91,
    signals: { binPresence: 0.94, fullness: 0.93, overflow: 0.91 },
    confirmed: true,
    stale: false,
    confirmationFrames: 3,
    unknownReasons: [],
    processingTimeMs: 4,
  }],
  floorHazards: [],
  flags: [{ severity: "critical", kind: "bin_overflow", message: "bin-1: confirmed overflow" }],
  stages: [
    { name: "bin_state", intervalSeconds: 1, observationCount: 1, processingTimeMs: 4 },
    { name: "floor_hazard", intervalSeconds: 1, observationCount: 0, processingTimeMs: 2 },
    { name: "occupancy", intervalSeconds: 1, observationCount: 0, processingTimeMs: 1 },
  ],
  processingTimeMs: 10,
  modelVersion: "bin-v1:floor-v1:occupancy-v1",
  inferenceProvider: "specialists",
};

describe("pipeline response contract", () => {
  it("accepts specialist source observations", () => {
    const parsed = pipelineAnalysisResponseSchema.parse(specialistResponse);

    expect(parsed.bins[0].candidateSource).toBe("specialist_profile");
    expect(parsed.inferenceProvider).toBe("specialists");
  });

  it("rejects an unregistered inference provider", () => {
    expect(() => pipelineAnalysisResponseSchema.parse({
      ...specialistResponse,
      inferenceProvider: "unknown-backend",
    })).toThrow();
  });
});

describe("placement response contract", () => {
  const response = {
    cameraId: "camera-1",
    decision: "replacement_recommended",
    recommended: true,
    provisional: true,
    windowMinutes: 10,
    sampleIntervalSeconds: 60,
    observedSamples: 10,
    validSamples: 10,
    requiredValidSamples: 8,
    coverageReady: true,
    unknownMinutes: 0,
    unknownStateRatio: 0,
    fullMinutes: 10,
    litterEpisodes: 3,
    spillEpisodes: 1,
    score: 95,
    scoreThreshold: 70,
    signals: { binPressure: 100, litterPressure: 100, spillPressure: 50, humanPopularity: 100 },
    highSignals: ["bin_pressure", "litter_pressure"],
    triggerReason: "full_bin_with_recurring_litter",
    raiseStreak: 0,
    clearStreak: 0,
    nextEvaluationAt: "2026-08-25T12:11:00+00:00",
    status: "replacement_recommended",
  };

  it("accepts explainable short-window evidence", () => {
    expect(placementRecommendationSchema.parse(response).signals.binPressure).toBe(100);
  });

  it("rejects an invalid coverage ratio", () => {
    expect(() => placementRecommendationSchema.parse({ ...response, unknownStateRatio: 1.2 })).toThrow();
  });
});
