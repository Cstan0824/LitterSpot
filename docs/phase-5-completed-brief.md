# Phase 5 completed brief

## Status

Canonical migration Phase 5 is complete. Operational Cameras are now created only through the composite V2 Camera Draft workflow.

## What was done

- Removed client-controlled Site and Zone assignment from Camera Draft requests.
- Backend derives Site from the authenticated Supervisor and Zone from Active Map geometry.
- Enforced Root authority for new Camera creation.
- Allowed Root and Regular Supervisors to reconfigure an existing same-Site Camera.
- Enforced the first Camera as `laptop_camera` and at most one laptop Camera per Site.
- Required later looped Cameras to reference an available Site-owned video asset.
- Required an available Site-owned image as the Registration reference.
- Validated floor and bin Registration geometry through the existing strict V2 Registration schema.
- Added Camera Draft read and delete endpoints.
- Added stale Camera and stale Site Map revision protection.
- New Camera publication atomically writes Camera identity, source revision, Registration revision, active Registration pointer, Camera Placement and a new Site Map Revision.
- Laptop Camera publication sets `status=active` and `monitoringEnabled=true`.
- Looped-video Camera publication sets `status=active`, `isSimulation=true`, and `monitoringEnabled=false`.
- Source replacement keeps the previous Camera and Registration operational until publication.
- Source replacement preserves the existing monitoring toggle.
- Added optimistic monitoring enable/disable control.
- Added Camera creation/reconfiguration Audit Events.

## APIs

```text
POST   /api/camera-creation/drafts
GET    /api/camera-creation/drafts/:draftId
DELETE /api/camera-creation/drafts/:draftId
POST   /api/camera-creation/drafts/:draftId/publish
PATCH  /api/camera-creation/cameras/:cameraId/monitoring
```

## Automated verification

```text
npm --workspace=backend run build
Result: passed

V2 Camera emulator integration
Result: 1 file passed, 2 tests passed

npm run test:backend
Result: 60 test files passed, 239 tests passed

git diff --check
Result: passed
```

The Camera emulator journey verifies:

- looped video is rejected for the first Camera;
- laptop Camera Draft and publication succeed;
- Camera Placement belongs to the backend-derived Zone;
- Camera, source, Registration and map pointers agree;
- laptop monitoring starts enabled;
- later looped Camera starts disabled and marked simulation;
- Supervisor can enable looped Camera monitoring;
- reconfiguration preserves the enabled state.

## Guidance to test manually

Before creating a Camera:

1. Publish at least one Site Map Zone.
2. Upload or store a reference image as an available `mediaAssets` document for the Site.
3. For a later looped Camera, also store an available Site-owned video asset.

Create the first Camera as Root using `POST /api/camera-creation/drafts` with:

```json
{
  "kind": "create",
  "name": "Laptop Camera",
  "source": { "type": "laptop_camera" },
  "placement": {
    "point": { "xMeters": 10, "yMeters": 10 }
  },
  "registration": {
    "referenceMediaId": "REFERENCE_MEDIA_ID",
    "sourceWidth": 1280,
    "sourceHeight": 720,
    "walkableFloorPolygon": [
      { "x": 0, "y": 0 },
      { "x": 1, "y": 0 },
      { "x": 1, "y": 1 },
      { "x": 0, "y": 1 }
    ],
    "bins": []
  }
}
```

Publish the returned Draft ID. Then verify the Camera, active Registration and Active Map Revision all reference the same Camera.

## Known prototype limit

Camera creation copies the current Site Map geometry in one transaction. It shares the Phase 3 prototype limit of fewer than 500 total transaction writes.

This phase validates existing media metadata. A dedicated browser sandbox for capturing webcam references and uploading looped source videos remains later UI/testing work.

## Cloud state

No Camera or media was added to cloud Firebase during Phase 5. Automated verification used Firebase emulators.

## Next phase

Phase 6 completes Monitoring Session ownership, Monitoring Episodes, live sample submission, FastAPI inference, Camera Runtime State, offline handling and in-memory temporal/analytics buffers.
