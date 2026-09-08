# Site Map Phase 1 completed brief

Completed 2026-09-07. This phase establishes the backend authority and shared geometry rules required by the real Site page. It does not connect the hardcoded Site prototype to these APIs.

## Delivered contracts

- `GET /api/site-map` returns the active Site Map, user-defined metre boundary, coordinate convention, background metadata, Zones, Camera Placements, and Cleaner Station Points.
- `POST /api/site-map/draft/start` copies the active immutable revision into the Site's one Root-only draft.
- `GET /api/site-map/draft` is Root-only and recovers that draft.
- `POST /api/site-map/draft` saves a complete snapshot with optimistic `expectedRevision` concurrency.
- `POST /api/site-map/draft/validate` binds successful validation to the exact structural content hash.
- `POST /api/site-map/draft/publish` rechecks the content hash and geometry, then atomically creates and activates one immutable revision.
- `DELETE /api/site-map/draft` discards the draft without changing the active revision.
- `POST /api/site-map/background` stores a Root-uploaded Site-owned JPEG, PNG, or WebP background with validated content dimensions.
- `POST /api/site-map/camera-placements/{cameraId}` handles confirmed Root-only Map Position Correction or Physical Camera Move.

## Geometry authority

The backend rejects non-positive or out-of-bounds Site geometry, fewer than three unique Zone vertices, duplicate vertices, zero area, self-intersection, containment, area overlap, crossing edges, shared edges, shared vertices, and single-point boundary contact. A small positive gap remains valid.

Validation returns stable error codes plus structured issues and conflicting Zone IDs. The frontend now has matching pure geometry logic tested against the same shared fixture in `shared/map-geometry-cases.json`.

Coordinates use top-left origin, X right, and Y down. Boundary resizing preserves absolute metre coordinates and rejects anything outside the proposed replacement boundary. Pure frontend viewer math now covers Fit to Site, arbitrary aspect ratios, pan, anchor-preserving zoom, screen-to-map conversion, and two-decimal storage rounding for Phase 2.

## Site backgrounds

Background media is Site-owned configuration media. The backend validates the file signature, dimensions, Site ownership, availability, and image aspect ratio. Alignment must stay completely inside the Site Map Boundary and cannot stretch the image. The active map response includes an authenticated content URL and source dimensions.

The supplied `Sunway Lagoon.png` was verified as 1536 by 1024 pixels, exactly 3:2. Phase 2 will upload and render it through the real contract rather than bundle it as a hardcoded map.

## Camera placement safety

A general Site Map draft cannot silently move a Camera. Every changed point requires confirmed `map_position_correction` metadata and a reason. Physical movement cannot use that path.

Map Position Correction publishes a map-only replacement revision, retains Camera Registration, and audits the old and new points and Zones. Physical Camera Move requires disabled monitoring, preserves the existing source unless replaced later, creates a Root-only Camera Draft, and cannot publish until a fresh reference and floor/bin Registration validate. Publication changes placement and Registration atomically.

One unfinished reconfiguration or Physical Camera Move draft is locked per Camera. Publication and cancellation release the lock. Cancelling a Physical Camera Move never deletes the active Camera source media.

Camera Creation reuses the authoritative map validator for provisional Zones at draft start and revalidates the complete Zone and Camera point again at publication. A provisional Zone cannot overlap, cross, share an edge or vertex, or touch another active Zone.

## Authorization and audit

Regular Supervisors can read the active Site Map and continue to publish the narrow Cleaner Station Point operation. They cannot read Root drafts, start or save drafts, validate, publish, discard, upload Site backgrounds, or move Cameras.

Successful draft, validation, background, publication, cancellation, correction, and physical-move actions record the real actor identity and authority. Rejected Site Map mutations also record bounded failure audits without request bodies or credentials.

## Verification

- Backend TypeScript build passed.
- Backend unit suite passed: 261 tests, with emulator-only tests skipped in the ordinary run.
- Frontend TypeScript and production build passed.
- Frontend suite passed: 71 tests.
- Focused Firestore/Auth emulator suites passed: 20 Site Map and Camera integration tests.
- The complete repository Firestore/Auth emulator smoke pipeline passed after the main implementation, covering authentication, identity, Site Map, Cameras, monitoring and quota safety, Cleaner workflows, Work, Orchestrator, operations, analytics, and recovery.

## Phase 2 handoff

Phase 2 should remove the hardcoded Site records and local mutation simulations, connect the real read and draft APIs, and build the shared Map Viewer and Root/Regular Site-page states on these contracts.
