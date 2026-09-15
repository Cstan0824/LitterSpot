from pydantic import BaseModel, Field, model_validator

class BoundingBox(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float

class Point(BaseModel):
    x: float
    y: float

class ImageInfo(BaseModel):
    width: int
    height: int

class StateSignals(BaseModel):
    binPresence: float = Field(ge=0, le=1)
    fullness: float = Field(ge=0, le=1)
    overflow: float = Field(ge=0, le=1)

class StateClassificationResponse(BaseModel):
    modelVersion: str
    decisionPolicy: str
    state: str
    confidence: float = Field(ge=0, le=1)
    signals: StateSignals
    unknownReasons: list[str] = Field(default_factory=list)
    image: ImageInfo
    region: BoundingBox
    processingTimeMs: float


class FrameBinInference(BaseModel):
    """One stateless bin result returned by the combined frame endpoint."""

    binIndex: int = Field(ge=1)
    # Published camera registrations may provide a stable identity.  The
    # field is omitted for legacy/localizer candidates so the stateless
    # response remains backwards compatible.
    binId: str | None = Field(default=None, min_length=1, max_length=64, exclude_if=lambda value: value is None)
    evidence: dict[str, object] | None = Field(default=None, exclude_if=lambda value: value is None)
    localizerConfidence: float = Field(ge=0, le=1)
    bbox: BoundingBox
    classificationRegion: BoundingBox
    state: str
    stateConfidence: float = Field(ge=0, le=1)
    signals: StateSignals
    unknownReasons: list[str] = Field(default_factory=list)
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


class RegisteredBinContext(BaseModel):
    binId: str = Field(min_length=1, max_length=64)
    displayName: str = Field(default="", max_length=120)
    binType: str = Field(default="unknown", max_length=32)
    binPolygon: list[Point] = Field(min_length=3, max_length=64)

    @model_validator(mode="before")
    @classmethod
    def accept_legacy_registration_bin(cls, value):
        if isinstance(value, dict) and "binPolygon" not in value and "bodyPolygon" in value:
            value = {**value, "binPolygon": value["bodyPolygon"]}
        if isinstance(value, dict) and value.get("binType") == "lid":
            value = {**value, "binType": "lidded"}
        return value


class RegistrationQuality(BaseModel):
    minAlignmentScore: float = Field(default=0.82, ge=0.5, le=1)
    minRimVisibility: float = Field(default=0.75, ge=0.5, le=1)
    maxFrameAgeSeconds: int = Field(default=300, ge=1, le=86_400)


class RegistrationContext(BaseModel):
    """Camera geometry passed by the backend for fixed-view inference.

    A non-ready context intentionally blocks bin and floor decisions. The
    backend may attach a runtime alignment score/status when a frame is
    compared with the enrolled reference image; omitted values are treated as
    the published, ready registration for backwards-compatible callers.
    """

    schemaVersion: int = Field(default=1, ge=1, le=2)
    revision: int = Field(default=0, ge=0)
    status: str = Field(default="ready", max_length=32)
    alignmentStatus: str = Field(default="valid", max_length=16)
    runtimeAlignmentScore: float | None = Field(default=None, ge=0, le=1)
    sourceWidth: int | None = Field(default=None, ge=1, le=16_000)
    sourceHeight: int | None = Field(default=None, ge=1, le=16_000)
    walkableFloorPolygon: list[Point] = Field(min_length=3, max_length=64)
    bins: list[RegisteredBinContext] = Field(default_factory=list, max_length=32)
    quality: RegistrationQuality = Field(default_factory=RegistrationQuality)

    def runtime_safe(self) -> bool:
        if self.status != "ready" or self.alignmentStatus != "valid":
            return False
        return self.runtimeAlignmentScore is None or self.runtimeAlignmentScore >= self.quality.minAlignmentScore

    def frame_dimensions_match(self, width: int, height: int) -> bool:
        """Reject a frame from a changed/rescaled camera feed when dimensions are enrolled."""
        return (
            self.sourceWidth is None
            or self.sourceHeight is None
            or (self.sourceWidth == width and self.sourceHeight == height)
        )


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
    registration: RegistrationContext | None = None
    # Still images expose the classifier result directly. Video callers opt
    # into reference-evidence review because they can resolve ambiguity across
    # subsequent frames.
    binReviewEnabled: bool = False
