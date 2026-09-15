from contextlib import asynccontextmanager
from io import BytesIO
import base64
import json

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError

from .config import BIN_LOCALIZER_CONFIDENCE, BIN_LOCALIZER_PATH, BIN_LOCALIZER_VERSION, INTERNAL_API_TOKEN, MAX_IMAGE_BYTES, STATE_CLASSIFIER_PATH, STATE_CLASSIFIER_VERSION
from .bin_localizer import BinLocalizer
from .multi_state_classifier import MultiStateClassifier
from .floor_hazard import FloorHazardAnalyzer
from .pipeline import AnalysisPipeline, InvalidFocusRegionError, PipelineNotReadyError
from .schemas import PipelineAnalysisResponse, PipelineOptions, Point, RegistrationContext

state_classifier = MultiStateClassifier()
bin_localizer = BinLocalizer()
floor_analyzer = FloorHazardAnalyzer()
pipeline = AnalysisPipeline(state_classifier, bin_localizer, floor_analyzer)


@asynccontextmanager
async def lifespan(_: FastAPI):
    state_classifier.load()
    bin_localizer.load()
    floor_analyzer.load()
    yield


app = FastAPI(title="LitterSpot AI service", lifespan=lifespan)


def require_token(token: str | None) -> None:
    if INTERNAL_API_TOKEN and token != INTERNAL_API_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid internal service token")


@app.get("/health")
def health():
    return {
        "status": "ok" if pipeline.ready else "degraded",
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
    }


@app.post("/analyze/frame", response_model=PipelineAnalysisResponse)
async def analyze_frame(
    file: UploadFile = File(...),
    floor_confidence: float = Form(0.25),
    localizer_confidence: float = Form(BIN_LOCALIZER_CONFIDENCE),
    focus_region: str | None = Form(None),
    x_internal_token: str | None = Header(default=None),
):
    """Run the combined models once and return inference data without persistence."""
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
    registration_context: RegistrationContext | None = None
    reference_image: Image.Image | None = None
    bin_review_enabled = False
    if focus_region:
        try:
            focus_payload = json.loads(focus_region)
            if isinstance(focus_payload, dict):
                registration_payload = focus_payload.get("registration")
                if registration_payload is not None:
                    registration_context = RegistrationContext.model_validate(registration_payload)
                reference_base64 = focus_payload.get("referenceImageBase64")
                if reference_base64:
                    if not isinstance(reference_base64, str):
                        raise ValueError("referenceImageBase64 must be a string")
                    reference_contents = base64.b64decode(reference_base64, validate=True)
                    if len(reference_contents) > MAX_IMAGE_BYTES:
                        raise ValueError("reference image is too large")
                    reference_image = Image.open(BytesIO(reference_contents)).convert("RGB")
                bin_review_enabled = focus_payload.get("binReviewEnabled") is True
                focus_payload = focus_payload.get("points", [])
            focus_points = [Point(**point) for point in focus_payload]
        except (ValueError, TypeError, UnidentifiedImageError) as error:
            raise HTTPException(status_code=422, detail="focus_region must be a JSON array of normalized points") from error
    try:
        options = PipelineOptions(
            floorConfidence=floor_confidence,
            localizerConfidence=localizer_confidence,
            focusRegion=focus_points,
            registration=registration_context,
            binReviewEnabled=bin_review_enabled,
        )
        return pipeline.analyze(image, options, reference_image=reference_image)
    except InvalidFocusRegionError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except PipelineNotReadyError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
