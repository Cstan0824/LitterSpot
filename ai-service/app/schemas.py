from pydantic import BaseModel, Field

class BoundingBox(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float

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
