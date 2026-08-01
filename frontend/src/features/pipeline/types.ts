export type Point = { x: number; y: number };
export type Box = { x1: number; y1: number; x2: number; y2: number };
export type Flag = { severity: "critical" | "warning"; kind: string; message: string };

export type PipelineResult = {
  imageName: string;
  image: { width: number; height: number };
  focusRegion: Point[];
  peopleCount: number;
  people: Array<{ confidence: number; bbox: Box }>;
  bins: Array<{ binIndex: number; state: string; bbox: Box }>;
  floorHazards: Array<{ className: "floor_litter" | "floor_spill"; confidence: number; bbox: Box; polygon: Point[] }>;
  flags: Flag[];
  processingTimeMs: number;
};

export type PipelineHistory = PipelineResult & { id: number; createdAt: string };

export type PlacementRecommendation = {
  cameraId: string;
  windowDays: number;
  validDays: number;
  requiredValidDays: number;
  observedSamples: number;
  coverageReady: boolean;
  overflowEpisodes: number;
  overflowRank: number;
  overflowThreshold: number;
  averagePeoplePerFrame: number;
  peoplePresentFrameRatio: number;
  popularityRank: number;
  popularityThreshold: number;
  recommended: boolean;
  triggerReason?: string | null;
  raiseStreak: number;
  clearStreak: number;
  status: string;
};
