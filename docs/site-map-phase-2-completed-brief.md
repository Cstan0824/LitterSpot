# Site Map Phase 2 completed brief

Phase 2 is complete. The Site page is no longer a hardcoded prototype: it now reads and mutates the revisioned V2 Site Map through authenticated backend contracts.

## Delivered product behaviour

- Added a shared Site Map Viewer with a fixed product viewport and a user-defined real boundary aspect ratio.
- Added bounded wheel/button zoom, drag pan, two-pointer pinch, Fit to Site, zoom percentage, an adaptive metre scale, and live metre coordinates.
- Rendered one authenticated background image below one SVG grid. The saved transform preserves the source aspect ratio and never tiles the image by grid cell.
- Connected Site Overview, Map & Zones, and Site audit history to live V2 read models.
- Removed the duplicate Cameras workspace from Site administration. Camera and Cleaner Station markers remain visible as structural context.
- Connected Root draft creation, recovery, save, validation, review, atomic publication, and discard.
- Connected Site dimensions, grid interval, background upload, aspect-locked alignment, opacity, and background removal.
- Added Zone creation, point plotting, selection, naming, vertex editing, keyboard adjustment, undo, deactivation, and restoration of retained retired-Zone geometry.
- Added immediate client feedback for invalid boundaries, self-intersection, touching or overlapping Zones, Camera coverage loss, Station Point boundary loss, and invalid background alignment.
- Kept the active published revision operational until a validated draft is atomically published.
- Rendered Regular Supervisor access as read-only and kept all structural mutation and retired-Zone recovery endpoints Root-only.
- Connected structural success/failure audit events to the Site audit ledger with actor identity, authority, outcome, resource, and reason.

## Backend additions

```text
GET /api/site-map/retired-zones     Root only
GET /api/site-map/draft             now includes authenticated background metadata
```

Publishing a revision now retains the last published name, polygon, centroid, and area on a Zone that becomes retired. Restoring the Zone reuses its stable Zone identity instead of creating a replacement record.

## Quota behaviour

The Site page performs bounded, user-driven reads. It loads the active map once on entry. Root additionally loads one draft lookup, one retired-Zone lookup, and the existing bounded audit feed. It does not poll Firestore or attach client-side Firestore listeners. Mutations refresh only the data affected by that explicit action.

## Verification completed

- Frontend production build: passed.
- Frontend suite: 27 files, 77 tests passed.
- Backend TypeScript build: passed.
- Backend unit suite: 68 files and 261 tests passed; emulator-only suites skipped in that run as designed.
- Focused Auth/Firestore emulator suite: 11 Site Map integration scenarios passed.
- Live Chrome verification: Site Overview, Map & Zones, Site audit history, Camera/Zone rendering, bounded zoom, and Fit to Site all loaded against the local emulator without a fetch failure.
- Impeccable static UI detector: no findings in the changed Site page or shared viewer.

## Phase 3 boundary

Phase 3 adopts this shared viewer and coordinate model in Camera Creation, Camera Move/Reconfigure, Cleaner Station Point editing, Manual Work coordinate targets, Dashboard, and Cleaner read-only maps. It also completes role-based browser acceptance and large-map/touch edge-case acceptance across every consumer.
