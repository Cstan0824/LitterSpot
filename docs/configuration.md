# LitterSpot configuration reference

## 1. Configuration files

| File | Purpose | Commit policy |
| --- | --- | --- |
| `backend/.env` | Node, Firebase Admin, media, and worker configuration | Never commit |
| `backend/.env.example` | Safe backend template | Commit |
| `frontend/.env.local` | Firebase web client configuration | Never commit |
| `frontend/.env.example` | Safe frontend template | Commit |
| `models/model-registry.json` | Model identities, paths, thresholds, and recorded evaluation metadata | Commit |

The root launchers load `backend/.env`. Vite loads `frontend/.env.local` through its normal environment handling.

## 2. Backend and Firebase

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `APP_ENV` | Yes outside tests | none | `local-emulator`, `development-cloud`, or `production-cloud` |
| `EXPECTED_FIREBASE_PROJECT_ID` | Yes for cloud | empty | Safety match for the intended project |
| `FIREBASE_PROJECT_ID` | No | `litterspot` | Firebase project used by Admin SDK |
| `FIREBASE_DATABASE_ID` | No | `litterspot` in raw env loader; configured deployments set `(default)` | Firestore database ID |
| `GOOGLE_APPLICATION_CREDENTIALS` | Cloud only | application default credentials | Absolute service-account JSON path |
| `PORT` | No | `3000` | Node HTTP port |
| `CORS_ORIGINS` | No | localhost ports 5173 and 5174 | Comma-separated browser origin allowlist |

Cloud startup fails if the configured project, expected project, and credential project do not match. Emulator mode requires both Authentication and Firestore emulator hosts.

## 3. Camera monitoring and media

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `MEDIA_STORAGE_ROOT` | No | repository `data/media-store` | Local media root |
| `VIDEO_MAX_BYTES` | No | `262144000` | Maximum video upload size |
| `VIDEO_MAX_DURATION_SECONDS` | No | `600` | Maximum accepted video duration |
| `FFPROBE_PATH` | No | `ffprobe` | Video metadata executable |
| `CAMERA_DEMO_SCENES_ENABLED` | No | disabled unless set to `true` | Enables development Camera scene routes; production access remains Root-only |

The browser sampling cadence and delayed playback thresholds are compiled constants documented in [camera monitoring](camera-monitoring.md), not environment settings.

## 4. AI service

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `AI_SERVICE_URL` | No | `http://127.0.0.1:8000` | Node-to-FastAPI base URL |
| `AI_SERVICE_TOKEN` | Recommended | unset | Node token sent to FastAPI |
| `INTERNAL_API_TOKEN` | Recommended | unset | FastAPI token expected in `X-Internal-Token` |
| `STATE_CLASSIFIER_PATH` | No | `runs/state_classifier/multitask_bin_state/production.pt` | Bin-state classifier file |
| `STATE_CLASSIFIER_VERSION` | No | `multitask-mobilenet-bin-state` | Observation model label |
| `BIN_LOCALIZER_PATH` | No | `models/production/bin_localizer_yolo11n.pt` | Generic bin-localizer file |
| `BIN_LOCALIZER_VERSION` | No | `bin-localizer-yolo11n` | Observation model label |
| `BIN_LOCALIZER_CONFIDENCE` | No | `0.80` | Generic bin-localizer threshold |
| `FLOOR_HAZARD_PATH` | No | committed floor-hazard `best.pt` path | Floor segmentation file |
| `FLOOR_HAZARD_VERSION` | No | `floor-hazard-yolo26s-seg-v1` | Observation model label |
| `PEOPLE_COUNT_PATH` | No | `yolo26s.pt` | People and scene-object detector |
| `PEOPLE_COUNT_VERSION` | No | `yolo26s-coco` | Observation model label |
| `DEVICE` | No | `cpu` | PyTorch or Ultralytics device. Numeric values request CUDA when available. |

The repository launchers set the same value for `AI_SERVICE_TOKEN` and `INTERNAL_API_TOKEN`.

## 5. Orchestrator and analytics

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `ORCHESTRATOR_INTERNAL_TOKEN` | Required for internal routes | unset | Shared Node worker token |
| `ORCHESTRATOR_LEASE_SECONDS` | No | `300` | Run and worker lease duration, 30 to 900 seconds |
| `ORCHESTRATOR_PYTHON_PATH` | No | repository `.venv` Python | Python executable for the provider adapter |
| `ORCHESTRATOR_WORKER_ENABLED` | No | `true` | Starts the Node outbox worker |
| `ORCHESTRATOR_DEBUG_OUTPUT` | No | `false` | Writes bounded structured provider-bridge output locally |
| `ORCHESTRATOR_DEBUG_ROOT` | No | `data/orchestrator-debug` | Local diagnostic directory |
| `ANALYTICS_WORKER_ENABLED` | No | `false` | Starts the scheduled daily analytics worker |
| `SITE_OPERATION_RECOVERY_INTERVAL_MS` | No | `300000` | Site-operation recovery interval |
| `SITE_OPERATION_RECOVERY_MAX_BACKOFF_MS` | No | `3600000` | Maximum quota-error backoff |

## 6. Rate limits

| Variable | Default | Allowed range |
| --- | --- | --- |
| `GENERAL_RATE_LIMIT_PER_MINUTE` | 300 | 1 to 100,000 |
| `INFERENCE_RATE_LIMIT_PER_MINUTE` | 120 | 1 to 100,000 |
| `UPLOAD_RATE_LIMIT_PER_MINUTE` | 20 | 1 to 100,000 |
| `PROCESSING_MUTATION_RATE_LIMIT_PER_MINUTE` | 60 | 1 to 100,000 |

The main API applies the general limit, with a dedicated 3,600-per-minute in-code limit for monitoring sample submissions. Limits are in-process and reset on restart.

## 7. Frontend Firebase

| Variable | Required | Meaning |
| --- | --- | --- |
| `VITE_FIREBASE_API_KEY` | Yes | Firebase web API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Yes | Authentication domain |
| `VITE_FIREBASE_PROJECT_ID` | Yes | Firebase project |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase config field | Present in client config; application media does not use Firebase Storage |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Yes | Firebase application metadata |
| `VITE_FIREBASE_APP_ID` | Yes | Firebase web application ID |
| `VITE_FIREBASE_DATABASE_ID` | No | Firestore database ID, normally `(default)` |
| `VITE_FIREBASE_AUTH_EMULATOR_URL` | Emulator only | Authentication emulator URL |
| `VITE_FIRESTORE_EMULATOR_HOST` | Emulator only | Firestore emulator hostname |
| `VITE_FIRESTORE_EMULATOR_PORT` | Emulator only | Firestore emulator port |
| `VITE_BACKEND_PROXY_TARGET` | Development only | Vite `/api` proxy target |

## 8. Demo and test overrides

The following variables support scripts and test harnesses rather than the normal application:

- `LITTERSPOT_API_URL`
- `LITTERSPOT_AUTH_EMULATOR_URL`
- `LITTERSPOT_AUTH_MODE`
- `LITTERSPOT_FIREBASE_WEB_API_KEY`
- `LITTERSPOT_DEMO_CAMERA_ID`
- `LITTERSPOT_DEMO_CLEAN_SCENE`
- `LITTERSPOT_DEMO_DIRTY_SCENE`
- `LITTERSPOT_DEMO_ROOT_EMAIL`
- `LITTERSPOT_DEMO_ROOT_PASSWORD`
- `LITTERSPOT_DEMO_TOKEN`
- `CAMERA_BROWSER_BASE_URL`
- `CAMERA_PLAYBACK_CHECK_SECONDS`
- `RUN_HTTP_TESTS`
- `FIRESTORE_EMULATOR_HOST`
- `FIREBASE_AUTH_EMULATOR_HOST`
- `GCLOUD_PROJECT`

Demo credentials embedded in emulator launch scripts are local fixture credentials and must not be reused as production credentials.
