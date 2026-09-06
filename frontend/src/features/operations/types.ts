export type Box = { x1: number; y1: number; x2: number; y2: number };
export type Point = { x: number; y: number };
export type FrameResult = {
  analysisId: number;
  cameraId?: string | null;
  imageName: string;
  createdAt: string;
  peopleCount: number;
  image: { width: number; height: number };
  people: Array<{ confidence: number; bbox: Box }>;
  bins: Array<{ binIndex: number; binId?: string | null; state: string; bbox: Box }>;
  floorHazards: Array<{ className: "floor_litter" | "floor_spill"; confidence: number; bbox: Box; polygon: Point[] }>;
  flags: Array<{ severity: "critical" | "warning"; kind: string; message: string }>;
  evidenceAvailable: boolean;
  isDemo?: boolean;
};

export type Camera = { id: string; name: string; zone: string; enabled: boolean; latest: FrameResult | null };
export type Alert = {
  evidenceObservation?: import("../../../../shared/cameraMonitoring").CameraObservation;
  id: string; analysisId: number; cameraId: string; cameraName: string; zone: string; kind: string;
  severity: "critical" | "warning"; confidence: number | null; status: string;
  createdAt: string; updatedAt: string; resolvedAt: string | null; imageName: string; peopleCount: number; evidenceAvailable: boolean; evidenceMediaId?: string | null; activeWorkOrderId?: string | null;
};
export type Placement = {
  cameraId: string; cameraName: string; zone: string; recommended: boolean; status: string;
  overflowRank: number; overflowThreshold: number; overflowEpisodes: number;
  popularityRank: number; popularityThreshold: number; averagePeoplePerFrame: number;
  validDays: number; requiredValidDays: number; triggerReason: string | null;
};
