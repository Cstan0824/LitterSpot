# Phase 3 completed brief

## Status

Canonical migration Phase 3 is complete. Site Map data is now usable through authenticated V2 APIs and tested with Auth and Firestore emulators.

## What was done

- Removed client-supplied `siteId` from Supervisor Site Map writes. The backend derives Site from the authenticated principal.
- Added active map, draft and revision-list read APIs.
- Added complete draft save, validate, publish and delete lifecycle.
- Added configurable dimensions, grid size, background media reference and background transform fields.
- Draft saving removes omitted Zone, Camera Placement and Cleaner Station documents instead of leaving stale geometry.
- Draft creation and deletion keep `sites.mapDraftExists` synchronized.
- Publishing rechecks the Site's Active Map Revision, draft revision and validation state inside the transaction.
- Published map revisions retain immutable geometry subcollections.
- Publication atomically switches `sites.activeMapRevisionId`.
- Added stable `zones` identity documents and retirement of Zones removed from the Active Map Revision.
- Added map publication and draft-deletion Audit Events.
- Added a narrow Station Point API available to Root and Regular Supervisors.
- Station Point updates copy the complete Active Map Revision, change one Cleaner station, validate exact Zone containment and atomically switch the Site pointer.
- Improved polygon overlap detection to catch edge crossings where neither polygon contains another polygon's vertex.
- Added end-to-end Site Map emulator coverage.

## APIs

```text
GET    /api/site-map
GET    /api/site-map/revisions
GET    /api/site-map/draft
POST   /api/site-map/draft
POST   /api/site-map/draft/validate
POST   /api/site-map/draft/publish
DELETE /api/site-map/draft
PUT    /api/site-map/station-points/:cleanerId
```

Full draft mutation/publication/deletion requires Root authority. The Station Point endpoint also allows Regular Supervisors, as required.

## Automated verification

```text
npm --workspace=backend run build
Result: passed

Targeted Site Map emulator test
Result: 1 file passed, 4 tests passed

npm run test:backend
Result: 60 files passed, 239 tests passed, 11 emulator-only files skipped

git diff --check
Result: passed
```

The Site Map emulator test verifies:

- draft save and validation;
- immutable publication and active pointer switch;
- stable Zone identities;
- publication Audit Event;
- Regular Supervisor Station-only publication;
- removal of omitted draft geometry;
- retirement of removed Zones;
- rejection of overlapping geometry.

## Guidance to test manually

1. Sign in as `root@sunway-test.com` and obtain a Firebase ID token.
2. Call `GET /api/site-map` to retrieve the initial Sunway Theme Park revision.
3. Save a draft with `POST /api/site-map/draft`. Do not send `siteId`; the backend uses the signed-in Root's Site.
4. Call `POST /api/site-map/draft/validate`.
5. Correct every returned geometry error.
6. Publish with `POST /api/site-map/draft/publish`.
7. Call `GET /api/site-map` again and confirm `activeRevisionId` changed.
8. Call `GET /api/site-map/revisions` to see both immutable revisions.

Station Point testing requires an active V2 Cleaner, which is created in Phase 4. After that, Root or Regular Supervisor can call:

```text
PUT /api/site-map/station-points/:cleanerId
```

with:

```json
{
  "point": { "xMeters": 10, "yMeters": 10 }
}
```

## Known prototype limit

Map publication writes one revision and its geometry in a Firestore transaction. The prototype Site must remain below Firestore's 500-write transaction limit. If the project grows beyond that size, revision content should be staged in chunks before the final pointer transaction.

Background media ownership and image validation are completed with Camera/media migration rather than trusting arbitrary media IDs in product use.

## Next phase

Phase 4 replaces the V1 Cleaner Zone/capability/GPS/invitation model with direct accounts, schedules, Availability Override, Station Points and derived availability.
