from contextlib import asynccontextmanager
from io import BytesIO
import json

from fastapi import FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError

from .config import ALERT_CONFIRMATION_FRAMES, BIN_LOCALIZER_CONFIDENCE, BIN_LOCALIZER_PATH, BIN_LOCALIZER_VERSION, CLASS_NAMES, DEVICE, ENABLE_LEGACY_DETECTOR, INTERNAL_API_TOKEN, MAX_IMAGE_BYTES, MODEL_PATH, MODEL_VERSION, SEED_DEMO_CAMERAS, STATE_CLASSIFIER_PATH, STATE_CLASSIFIER_VERSION
from .bin_localizer import BinLocalizer
from .detector import BinDetector
from .multi_state_classifier import MultiStateClassifier
from .analysis_store import AnalysisStore
from .floor_hazard import FloorHazardAnalyzer
from .pipeline import AnalysisPipeline, InvalidFocusRegionError, PipelineNotReadyError
from .schemas import AlertStatusUpdate, BoundingBox, DetectionOptions, ImageBinAnalysisResponse, ImageInfo, LocalizedBinAnalysis, PipelineAnalysisResponse, PipelineOptions, PlacementSettingsUpdate, Point

detector = BinDetector()
state_classifier = MultiStateClassifier()
bin_localizer = BinLocalizer()
floor_analyzer = FloorHazardAnalyzer()
analysis_store = AnalysisStore(seed_demo=SEED_DEMO_CAMERAS)
pipeline = AnalysisPipeline(state_classifier, bin_localizer, floor_analyzer, analysis_store)

@asynccontextmanager
async def lifespan(_: FastAPI):
    state_classifier.load()
    bin_localizer.load()
    floor_analyzer.load()
    analysis_store.initialize()
    if SEED_DEMO_CAMERAS and pipeline.ready:
        pipeline.seed_demo_frames()
    if ENABLE_LEGACY_DETECTOR:
        detector.load()
    yield

app = FastAPI(title="LitterSpot AI service", lifespan=lifespan)

def require_token(token: str | None) -> None:
    if INTERNAL_API_TOKEN and token != INTERNAL_API_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid internal service token")

@app.get("/health")
def health():
    return {
        "status": "ok" if state_classifier.ready else "degraded",
        "modelReady": state_classifier.ready,
        "modelVersion": STATE_CLASSIFIER_VERSION,
        "modelArtifact": STATE_CLASSIFIER_PATH.name,
        "device": str(state_classifier.device),
        "reason": state_classifier.load_error,
        "mode": "known-bin-region-classification",
        "binLocalizerReady": bin_localizer.ready,
        "binLocalizerVersion": BIN_LOCALIZER_VERSION,
        "binLocalizerArtifact": BIN_LOCALIZER_PATH.name if bin_localizer.ready else None,
        "floorAnalyzerReady": floor_analyzer.ready,
        "floorAnalyzerReason": floor_analyzer.load_error,
        "thresholds": state_classifier.thresholds,
        "overflowPolicy": state_classifier.overflow_policy,
        "overflowPresenceFloor": state_classifier.overflow_presence_floor,
        "legacyDetectorEnabled": ENABLE_LEGACY_DETECTOR,
        "legacyDetectorReady": detector.ready,
    }

@app.get("/model/info")
def model_info(x_internal_token: str | None = Header(default=None)):
    require_token(x_internal_token)
    return {"version": STATE_CLASSIFIER_VERSION, "classes": ["normal", "full", "overflow", "unknown"], "ready": state_classifier.ready, "mode": "multi-head-classification", "binLocalizerVersion": BIN_LOCALIZER_VERSION, "binLocalizerReady": bin_localizer.ready, "thresholds": state_classifier.thresholds, "overflowPolicy": state_classifier.overflow_policy, "overflowPresenceFloor": state_classifier.overflow_presence_floor}

@app.post("/classify/bin")
async def classify_bin(
    file: UploadFile = File(...),
    x1: float | None = Form(None),
    y1: float | None = Form(None),
    x2: float | None = Form(None),
    y2: float | None = Form(None),
    camera_id: str | None = Form(None),
    bin_id: str | None = Form(None),
    confirmation_frames: int = Form(ALERT_CONFIRMATION_FRAMES),
    auto_locate: bool = Form(False),
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
    if not state_classifier.ready:
        raise HTTPException(status_code=503, detail=state_classifier.load_error or "State classifier is not ready")
    if confirmation_frames not in range(1, 21):
        raise HTTPException(status_code=422, detail="confirmation_frames must be between 1 and 20")
    coordinates = (x1, y1, x2, y2)
    if all(value is None for value in coordinates):
        profile_region, profile_used = state_classifier.profile_region(image, camera_id, bin_id)
        if profile_region:
            region, localizer_used = profile_region, False
        elif auto_locate:
            region, reason, _ = bin_localizer.locate(image)
            if region is None:
                raise HTTPException(status_code=422, detail=reason or "bin_not_localized")
            profile_used, localizer_used = False, True
        else:
            region, localizer_used = BoundingBox(x1=0, y1=0, x2=image.width, y2=image.height), False
    elif any(value is None for value in coordinates):
        raise HTTPException(status_code=422, detail="Provide all four region coordinates or none")
    else:
        profile_used, localizer_used = False, False
        region = BoundingBox(x1=float(x1), y1=float(y1), x2=float(x2), y2=float(y2))
    if not (0 <= region.x1 < region.x2 <= image.width and 0 <= region.y1 < region.y2 <= image.height):
        raise HTTPException(status_code=422, detail="Region coordinates must be inside the image")
    return state_classifier.classify(image, region, camera_id, bin_id, confirmation_frames, profile_used, localizer_used)


@app.post("/classify/image-bins", response_model=ImageBinAnalysisResponse)
async def classify_image_bins(
    file: UploadFile = File(...),
    localizer_confidence: float = Form(BIN_LOCALIZER_CONFIDENCE),
    max_bins: int = Form(10),
    confirmation_frames: int = Form(1),
    camera_id: str | None = Form(None),
    image_id: str | None = Form(None),
    x_internal_token: str | None = Header(default=None),
):
    """Localize and classify every bin in one image for the batch-analysis UI."""
    require_token(x_internal_token)
    if file.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=415, detail="Use JPEG, PNG, or WebP")
    if not 0.01 <= localizer_confidence <= 0.99:
        raise HTTPException(status_code=422, detail="localizer_confidence must be between 0.01 and 0.99")
    if max_bins not in range(1, 21):
        raise HTTPException(status_code=422, detail="max_bins must be between 1 and 20")
    if confirmation_frames not in range(1, 21):
        raise HTTPException(status_code=422, detail="confirmation_frames must be between 1 and 20")
    if not state_classifier.ready:
        raise HTTPException(status_code=503, detail=state_classifier.load_error or "State classifier is not ready")
    if not bin_localizer.ready:
        raise HTTPException(status_code=503, detail=bin_localizer.load_error or "Bin localizer is not ready")

    contents = await file.read(MAX_IMAGE_BYTES + 1)
    if len(contents) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image is larger than 10 MB")
    try:
        image = Image.open(BytesIO(contents)).convert("RGB")
    except UnidentifiedImageError as error:
        raise HTTPException(status_code=400, detail="Invalid image") from error

    candidates, localizer_ms = bin_localizer.locate_all(image, localizer_confidence, max_bins)
    detections: list[LocalizedBinAnalysis] = []
    for index, candidate in enumerate(candidates, start=1):
        tracking_bin_id = f"{image_id or 'batch'}-bin-{index}" if camera_id else None
        classification = state_classifier.classify(
            image,
            candidate.bbox,
            camera_id,
            tracking_bin_id,
            confirmation_frames,
            profile_used=False,
            localizer_used=True,
        )
        detections.append(LocalizedBinAnalysis(
            binIndex=index,
            localizerConfidence=candidate.confidence,
            bbox=candidate.bbox,
            classificationRegion=classification.region,
            state=classification.state,
            stableState=classification.stableState,
            stateConfidence=classification.confidence,
            signals=classification.signals,
            confirmed=classification.confirmed,
            confirmationFrames=classification.confirmationFrames,
            unknownReasons=classification.unknownReasons,
            processingTimeMs=classification.processingTimeMs,
        ))
    return ImageBinAnalysisResponse(
        localizerVersion=BIN_LOCALIZER_VERSION,
        stateModelVersion=STATE_CLASSIFIER_VERSION,
        decisionPolicy=state_classifier.overflow_policy,
        image=ImageInfo(width=image.width, height=image.height),
        detections=detections,
        reason=None if detections else "bin_not_localized",
        processingTimeMs=localizer_ms + sum(item.processingTimeMs for item in detections),
    )


@app.post("/analyze/frame", response_model=PipelineAnalysisResponse)
async def analyze_frame(
    file: UploadFile = File(...),
    camera_id: str | None = Form(None),
    floor_confidence: float = Form(0.25),
    localizer_confidence: float = Form(BIN_LOCALIZER_CONFIDENCE),
    confirmation_frames: int = Form(1),
    focus_region: str | None = Form(None),
    x_internal_token: str | None = Header(default=None),
):
    """HTTP adapter for the complete stored frame-analysis pipeline."""
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
    focus_points: list[Point] = []
    if focus_region:
        try:
            focus_points = [Point(**point) for point in json.loads(focus_region)]
        except (ValueError, TypeError) as error:
            raise HTTPException(status_code=422, detail="focus_region must be a JSON array of normalized points") from error
    try:
        options = PipelineOptions(
            cameraId=camera_id,
            floorConfidence=floor_confidence,
            localizerConfidence=localizer_confidence,
            confirmationFrames=confirmation_frames,
            focusRegion=focus_points,
        )
        return pipeline.analyze(image, file.filename or "upload", options, contents)
    except InvalidFocusRegionError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except PipelineNotReadyError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.get("/analysis/recent")
def recent_analysis(limit: int = 12, x_internal_token: str | None = Header(default=None)):
    require_token(x_internal_token)
    return {"items": analysis_store.recent(max(1, min(limit, 50)))}


@app.get("/placement/recommendation/{camera_id}")
def placement_recommendation(camera_id: str, x_internal_token: str | None = Header(default=None)):
    require_token(x_internal_token)
    return analysis_store.evaluate_placement(camera_id)


@app.patch("/placement/recommendation/{camera_id}/settings")
def update_placement_settings(camera_id: str, settings: PlacementSettingsUpdate, x_internal_token: str | None = Header(default=None)):
    require_token(x_internal_token)
    analysis_store.set_window_days(camera_id, settings.windowDays)
    return analysis_store.evaluate_placement(camera_id)


@app.get("/operations/dashboard")
def operations_dashboard(x_internal_token: str | None = Header(default=None)):
    require_token(x_internal_token)
    return analysis_store.dashboard()


@app.get("/operations/alerts")
def operations_alerts(
    status: str | None = Query(default=None, pattern="^(active|resolved|dismissed)$"),
    severity: str | None = Query(default=None, pattern="^(critical|warning)$"),
    kind: str | None = None,
    x_internal_token: str | None = Header(default=None),
):
    require_token(x_internal_token)
    return {"items": analysis_store.alerts(status=status, severity=severity, kind=kind)}


@app.patch("/operations/alerts/{alert_id}/status")
def update_alert_status(alert_id: int, update: AlertStatusUpdate, x_internal_token: str | None = Header(default=None)):
    require_token(x_internal_token)
    updated = analysis_store.update_alert_status(alert_id, update.status, update.operatorName, update.note)
    if updated is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    return updated


@app.get("/operations/history")
def operations_history(
    query: str | None = None,
    kind: str | None = None,
    x_internal_token: str | None = Header(default=None),
):
    require_token(x_internal_token)
    return {"items": analysis_store.alerts(status="resolved", kind=kind, query=query)}


@app.get("/operations/placement")
def operations_placement(x_internal_token: str | None = Header(default=None)):
    require_token(x_internal_token)
    return analysis_store.placement_summary()


@app.get("/analysis/evidence/{analysis_id}")
def analysis_evidence(analysis_id: int, x_internal_token: str | None = Header(default=None)):
    require_token(x_internal_token)
    evidence = analysis_store.evidence_path(analysis_id)
    if evidence is None:
        raise HTTPException(status_code=404, detail="Evidence image not found")
    return FileResponse(evidence)

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
    if not ENABLE_LEGACY_DETECTOR:
        raise HTTPException(status_code=503, detail="Legacy full-frame detection is disabled; use /classify/bin with a known bin region")
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
