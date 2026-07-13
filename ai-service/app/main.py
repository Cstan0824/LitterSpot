from contextlib import asynccontextmanager
from io import BytesIO
from time import perf_counter

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError

from .config import ALERT_CONFIRMATION_FRAMES, CLASS_NAMES, DEVICE, INTERNAL_API_TOKEN, MAX_IMAGE_BYTES, MODEL_PATH, MODEL_VERSION
from .detector import BinDetector
from .schemas import DetectionOptions

detector = BinDetector()

@asynccontextmanager
async def lifespan(_: FastAPI):
    detector.load()
    yield

app = FastAPI(title="LitterSpot AI service", lifespan=lifespan)

def require_token(token: str | None) -> None:
    if INTERNAL_API_TOKEN and token != INTERNAL_API_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid internal service token")

@app.get("/health")
def health():
    return {"status": "ok" if detector.ready else "degraded", "modelReady": detector.ready, "modelVersion": MODEL_VERSION, "modelPath": str(MODEL_PATH), "device": DEVICE, "reason": detector.load_error}

@app.get("/model/info")
def model_info(x_internal_token: str | None = Header(default=None)):
    require_token(x_internal_token)
    return {"version": MODEL_VERSION, "classes": CLASS_NAMES, "ready": detector.ready}

@app.post("/detect/image")
async def detect_image(
    file: UploadFile = File(...),
    confidence: float = Form(0.25),
    iou: float = Form(0.70),
    imgsz: int = Form(768),
    max_detections: int = Form(100),
    camera_id: str | None = Form(None),
    confirmation_frames: int = Form(ALERT_CONFIRMATION_FRAMES),
    x_internal_token: str | None = Header(default=None),
):
    require_token(x_internal_token)
    if file.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=415, detail="Use JPEG, PNG, or WebP")
    contents = await file.read(MAX_IMAGE_BYTES + 1)
    if len(contents) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image is larger than 10 MB")
    try:
        image = Image.open(BytesIO(contents)).convert("RGB")
    except UnidentifiedImageError as error:
        raise HTTPException(status_code=400, detail="Invalid image") from error
    if not detector.ready:
        raise HTTPException(status_code=503, detail=detector.load_error or "Model is not ready")
    try:
        options = DetectionOptions(confidence=confidence, iou=iou, imgsz=imgsz, max_detections=max_detections, camera_id=camera_id, confirmation_frames=confirmation_frames)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return detector.detect(image, options)
