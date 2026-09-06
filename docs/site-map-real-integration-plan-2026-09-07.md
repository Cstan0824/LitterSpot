# Site Map real integration plan

This plan replaces the hardcoded Site Administration prototype with real backend and frontend behaviour. Delivery is limited to three phases.

## Phase 1: authoritative map contracts and geometry

Status: completed 2026-09-07. See [`site-map-phase-1-completed-brief.md`](site-map-phase-1-completed-brief.md).

Build the backend and shared rules before connecting the Site editor.

- Define one pure geometry contract for Site bounds, spatially disjoint active Zones, point containment, map transforms, and validation error codes. Frontend and backend use the same rules or the same conformance fixtures so they cannot disagree.
- Reject Zone containment, area overlap, crossing edges, shared edges, shared vertices, single-point contact, self-intersection, zero area, fewer than three valid points, and out-of-bounds geometry. A small positive gap remains valid.
- Preserve absolute metre coordinates when Site dimensions change. Use top-left origin, X right, and Y down.
- Extend the real Site Map read and draft contracts for user-controlled dimensions, grid interval, one background media asset, background alignment, Zones, Camera Placements, and Cleaner Station Points.
- Add real background upload and ownership validation. Store alignment without stretching the source image.
- Harden draft save, validation, publication, discard, concurrency, and authorization. The active revision stays operational until atomic publication.
- Add Root-only Camera placement operations for Map Position Correction and Physical Camera Move. Correction requires a reason and records old and new coordinates. Physical movement requires replacement Registration before activation of the new placement.
- Validate provisional Zones during Camera Creation through the same authoritative geometry path.
- Record success and failure audit events with the real actor identity and authority.
- Add unit and emulator integration coverage for every geometry conflict, boundary resize, authorization boundary, provisional Zone, Camera move mode, background asset, audit outcome, and concurrent revision conflict.

Phase 1 exit gate: direct API requests cannot publish invalid geometry, bypass Root authority, retain stale Registration after a Physical Camera Move, or lose the previous active revision on failure.

## Phase 2: shared Map Viewer and real Site page

Replace the Site prototype with a backend-connected Root workspace and Regular read-only view.

- Build one reusable Map Viewer that preserves the user-defined boundary aspect ratio inside a fixed viewer.
- Render one background image beneath one transparent grid. Never repeat it by grid cell or stretch it.
- Support Fit to Site, bounded zoom, drag-to-pan, touch pinch and pan, zoom percentage, scale bar, and live metre coordinates.
- Convert pointer positions through the active view transform so saved coordinates remain stable at every zoom level.
- Connect Overview, Map & Zones, and Site audit history to real read models. Remove the duplicate Cameras tab and hardcoded records.
- Connect Site dimensions, grid interval, background upload and alignment, draft creation, draft recovery, discard, validation, review, and publication.
- Build Zone creation, selection, renaming, reshaping, activation changes, undo, and live conflict feedback. Invalid geometry identifies the conflicting Zone and blocks save, continuation, and publication.
- Show Camera and Station Point markers as structural context. Zone or boundary edits must identify every affected placement before publication.
- Enforce Root mutation controls and Regular read-only presentation in both routing and rendered controls.
- Connect Site-level audit filters and action detail.

Phase 2 exit gate: a Root can create and publish a valid Site Map revision through the product UI, a Regular Supervisor cannot mutate it, and failed validation leaves the active map unchanged.

## Phase 3: every placement workflow and end-to-end acceptance

Adopt the shared Map Viewer and geometry rules everywhere coordinates are created or read.

- Update Camera Creation to use zoom and pan, enforce strict provisional-Zone separation, and publish the provisional Zone and Camera atomically.
- Add Root-only Move Camera from Camera Details. Map Position Correction keeps Registration only after confirmation and a required reason. Physical Camera Move continues into fresh reference and floor/bin plotting before atomic publication.
- Refine Reconfigure Camera View so it shows the active source, looped video, reference, floor polygon, and bin regions. Keeping the view starts from current geometry; replacing the view requires fresh plotting.
- Use the shared viewer for Cleaner Station Point creation and editing, Manual Work coordinate targets, the Dashboard map, and read-only Cleaner map views.
- Provide explicit placement modes so pan gestures cannot accidentally create or move points.
- Verify Camera points resolve to exactly one active Zone while Station Points and coordinate Work may remain in an in-bounds Unzoned Area.
- Complete responsive, keyboard, touch, error, stale-draft, empty-map, and large-map checks.
- Run frontend tests, backend tests, emulator integration tests, role acceptance for Root and Regular Supervisors, and one bounded cloud acceptance after emulator verification.

Phase 3 exit gate: every map consumer uses the same coordinate model and viewer behaviour, all required audit records exist, no hardcoded Site mutation path remains, and the complete Root and Regular permission matrix passes acceptance.

## Out of scope

- Superadmin Site activation, deactivation, and recovery UI.
- GPS, geographic latitude or longitude, live Cleaner tracking, or external map providers.
- A required physical gap between Zones beyond the rule that their boundaries cannot touch.
