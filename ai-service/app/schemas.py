from pydantic import BaseModel, Field

class BoundingBox(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float

class Point(BaseModel):
    x: float
    y: float

class Detection(BaseModel):
    binId: str | None = None
    className: str
    confidence: float = Field(ge=0, le=1)
    confirmed: bool = False
    confirmationFrames: int = Field(ge=0)
    bbox: BoundingBox

class ImageInfo(BaseModel):
    width: int
    height: int

class DetectionResponse(BaseModel):
    modelVersion: str
    cameraId: str | None = None
    image: ImageInfo
    detections: list[Detection]
    processingTimeMs: float

class DetectionOptions(BaseModel):
    confidence: float = Field(default=0.25, ge=0.01, le=0.99)
    iou: float = Field(default=0.70, ge=0.05, le=0.95)
    imgsz: int = Field(default=768, ge=320, le=1280)
    max_detections: int = Field(default=100, ge=1, le=300)
    camera_id: str | None = Field(default=None, min_length=1, max_length=100)
    confirmation_frames: int = Field(default=3, ge=1, le=20)

class StateSignals(BaseModel):
    binPresence: float = Field(ge=0, le=1)
    fullness: float = Field(ge=0, le=1)
    overflow: float = Field(ge=0, le=1)

class StateClassificationResponse(BaseModel):
    modelVersion: str
    decisionPolicy: str
    state: str
    stableState: str | None = None
    confidence: float = Field(ge=0, le=1)
    signals: StateSignals
    confirmed: bool = False
    confirmationFrames: int = Field(ge=0)
    distinctFrameAccepted: bool = True
    transitionPending: bool = False
    unknownReasons: list[str] = Field(default_factory=list)
    cameraId: str | None = None
    binId: str | None = None
    image: ImageInfo
    region: BoundingBox
    profileUsed: bool = False
    localizerUsed: bool = False
    processingTimeMs: float


class LocalizedBinAnalysis(BaseModel):
    binIndex: int = Field(ge=1)
    trackingId: str | None = None
    localizerConfidence: float = Field(ge=0, le=1)
    bbox: BoundingBox
    classificationRegion: BoundingBox
    state: str
    stableState: str | None = None
    stateConfidence: float = Field(ge=0, le=1)
    signals: StateSignals
    confirmed: bool = False
    stale: bool = False
    confirmationFrames: int = Field(ge=0)
    unknownReasons: list[str] = Field(default_factory=list)
    processingTimeMs: float = Field(ge=0)


class FrameBinInference(BaseModel):
    """One stateless bin result returned by the combined frame endpoint."""

    binIndex: int = Field(ge=1)
    localizerConfidence: float = Field(ge=0, le=1)
    bbox: BoundingBox
    classificationRegion: BoundingBox
    state: str
    stateConfidence: float = Field(ge=0, le=1)
    signals: StateSignals
    unknownReasons: list[str] = Field(default_factory=list)
    processingTimeMs: float = Field(ge=0)


class ImageBinAnalysisResponse(BaseModel):
    localizerVersion: str
    stateModelVersion: str
    decisionPolicy: str
    image: ImageInfo
    detections: list[LocalizedBinAnalysis]
    reason: str | None = None
    processingTimeMs: float = Field(ge=0)


class FloorHazard(BaseModel):
    className: str
    confidence: float = Field(ge=0, le=1)
    bbox: BoundingBox
    polygon: list[Point] = Field(default_factory=list)


class PersonDetection(BaseModel):
    confidence: float = Field(ge=0, le=1)
    bbox: BoundingBox


class PipelineModelVersions(BaseModel):
    floorHazard: str
    people: str
    binLocalizer: str
    binState: str


class PipelineAnalysisResponse(BaseModel):
    image: ImageInfo
    focusRegion: list[Point] = Field(default_factory=list)
    peopleCount: int = Field(ge=0)
    people: list[PersonDetection]
    bins: list[FrameBinInference]
    floorHazards: list[FloorHazard]
    modelVersions: PipelineModelVersions = Field(default_factory=lambda: PipelineModelVersions(
        floorHazard="unknown",
        people="unknown",
        binLocalizer="unknown",
        binState="unknown",
    ))
    processingTimeMs: float = Field(ge=0)


class PipelineOptions(BaseModel):
    floorConfidence: float = Field(default=0.25, ge=0.01, le=0.99)
    localizerConfidence: float = Field(default=0.80, ge=0.01, le=0.99)
    focusRegion: list[Point] = Field(default_factory=list)
