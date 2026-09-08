# Phase 12.5 completed brief

## Outcome

The Supervisor Camera page now opens one four-page Camera-registration modal. Melissa's delivered Add Camera design remains the visual authority for Page 1, and Pages 2 through 4 use the same header, progress, workspace, side panel, status, and footer patterns.

The modal uses the V2 backend throughout. It does not create legacy Camera or Zone records.

## What was built

### Page 1: Place Camera

- Loads the active V2 Site Map and real Zone polygons.
- Selects an existing Zone or draws a provisional new Zone inside the Camera Draft.
- Keeps the existing-Zone Camera position and Camera details locked until the user presses **Next: Plot camera location** and places the Camera.
- Places the Camera with real map coordinates in metres.
- Shows read-only Coordinate X and Coordinate Y fields after placement.
- Captures Camera name and optional description.
- Enforces the source rule: the first Camera uses the laptop Camera; later prototype Cameras use looped video.
- Starts one non-operational Camera Draft when the user continues.

### Page 2: Reference

- Opens the laptop Camera or uploads a looped source video according to the Camera source rule.
- Captures one frame and stores it as the Camera Draft reference.
- Shows the stored reference dimensions and preview.
- Keeps the user on Page 2 until they press the modal's primary Continue button.

### Page 3: Plot regions

- Uses the saved reference frame as the plotting canvas.
- Requires one walkable-floor polygon.
- Supports zero or more named physical-bin polygons.
- Supports undo, clear, finish polygon, and remove-last-bin controls.
- Saves the registration and runs V2 validation before opening Page 4.

### Page 4: Validate and publish

- Shows the reference with saved floor and bin overlays.
- Summarizes the Camera, Zone, source, floor points, bin count, and initial monitoring behavior.
- Publishes only a V2-validated Camera Draft.
- Refreshes the Camera page and opens the new Camera detail after publication.

## Workflow behavior

- The modal has one body with four page states. It is not four separate routes.
- Back navigation retains the in-memory reference and plotted regions.
- Returning to Page 1 after starting the Camera Draft locks the saved placement and identity, preventing the UI from displaying edits that the existing Draft API cannot persist.
- Closing after the Camera Draft starts deletes that draft and its draft-owned reference/source media.
- A new Zone remains provisional until Page 4 publishes the Camera. Cancelling leaves no Zone behind.
- A looped-video Camera publishes with monitoring disabled. A laptop Camera publishes with monitoring enabled.

## How to test

1. Sign in as the Root Supervisor.
2. Open **Cameras** and press **Add camera**.
3. On Page 1, select an existing Zone or create a non-overlapping Zone, then place the Camera and enter its name.
4. Press **Continue to reference**. Confirm that Page 2 appears inside the same modal.
5. For a looped-video Camera, upload an MP4, MOV, or WebM file, pause at a clear frame, and press **Use current frame as reference**. For the first Camera, open the laptop Camera and capture a frame.
6. Press **Continue to region plotting**.
7. Plot at least three floor points and finish the floor region. Add bin regions only when visible.
8. Press **Continue to validation**. Invalid registration data must remain on Page 3 with a clear error.
9. Review Page 4, then press **Validate and publish**.
10. Confirm that the modal closes, the Camera list refreshes, and the new Camera detail opens.

## Automated verification

- Frontend TypeScript and production build pass.
- Frontend unit tests pass.
- The design detector reports no mechanical findings for the changed UI files.
