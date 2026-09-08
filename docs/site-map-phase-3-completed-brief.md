# Site Map Phase 3 completed brief

Phase 3 is complete in the local emulator environment. Every active coordinate workflow now uses the published Site Map's metre coordinate model and the shared viewer.

## Delivered

- Manual Work creation supports a free in-boundary coordinate or a registered Camera target on the shared zoomable map.
- Manual Work detail renders the saved coordinate on the same published geometry.
- Cleaner Station Point creation, editing, review, profile, working-day detail, and Work location views use the shared viewer.
- Dashboard uses published Zone polygons, Camera placements, Cleaner Station markers, optional Site background media, and metre coordinates. Fixed semantic anchors and placeholder geographic coordinates are removed.
- Camera creation uses the shared viewer for existing-Zone Camera placement and provisional-Zone plotting.
- Provisional Zone creation gives immediate strict separation feedback and the backend rejects every overlap or boundary contact.
- Camera Details has a Root-only Move Camera workflow with two explicit modes.
  - Map Position Correction publishes a new map revision while preserving the source and Registration.
  - Physical Camera Move requires monitoring to be disabled and continues through a fresh reference, floor, and bin Registration before publication.
- Camera reconfiguration begins with the active source, reference, floor polygon, and bin regions. Changing the source or reference clears the retained Registration and requires fresh plotting.
- Point creation is an explicit mode. A pan gesture cannot create a coordinate, and keyboard arrows can adjust a selected point.
- Protected background media loads through authenticated endpoints and object URLs are released on unmount.
- Root and Regular Supervisor authority remains enforced by backend routes and rendered controls.

## Verification

- Frontend production build passed.
- Frontend suite passed with 78 tests across 27 files.
- Backend production build passed.
- Backend unit suite passed with 261 tests across 68 files.
- Combined Camera and Site Map Auth/Firestore emulator suite passed all 20 integration scenarios.
- Live browser checks covered Site administration, Dashboard, Manual Work placement, Cleaner Station placement, Camera creation/reconfiguration, and the Root Camera Move modal.
- The UI detector reported no findings on the changed map consumers.
- No cloud read/write acceptance was run because the project is intentionally operating against Firebase emulators to protect the cloud quota.

## Emulator cleanup utility

`npm run v2:clear-emulator-operations` performs a dry-run inventory. Applying it requires both the local-emulator environment and the exact `--confirm-site` value. It refuses any Firebase project or Firestore host other than `demo-litterspot` at `127.0.0.1:8180`.

The applied cleanup preserves the Site, identities, Cleaner accounts, Cleaner Station Points as unzoned, and Site background. It removes Zones, Cameras, Alerts, Work Orders, evidence, monitoring state, analytics, notifications, orchestration records, and their audit history before publishing one clean active map revision.
