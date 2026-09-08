# Phase 12.4 completed brief — Cleaner integration

Status: implemented locally against the V2 API. The frontend build and automated frontend tests pass. The V2 Node API is listening on port 3000 again and FastAPI remains on port 8000; a manual authenticated browser pass is ready for you.

## What is wired

### Cleaner mobile presentation baseline

- The delivered Melissa Cleaner mobile interface is the visual source of truth. Home, Work, Schedule, Updates, and Profile retain its page hierarchy, calendar, map card, typography, spacing, and bottom navigation while V2 data replaces the mock values.
- The calendar is now driven by the Cleaner's real recurring weekly schedule and the selected month/year, rather than the prototype's fixed May 2026 demo.
- The Station Point map preserves the delivered illustrated-map composition while overlaying the authenticated Cleaner's active Zone geometry and real Station/coordinate Work point when available.

### Supervisor: Cleaner Management

- The existing Field Station Cleaner Management page now reads and writes V2 Cleaners instead of local browser-only roster data.
- Creating a Cleaner provisions the Firebase Authentication account and V2 Cleaner profile through `POST /api/cleaners`.
- The setup wizard now collects the required email and initial password in addition to staff ID, name, phone, Station Point, and weekly schedule.
- The Station Point screen renders the active V2 Zone polygons over the delivered site-plan image. Any point inside the Site Map can be saved; the displayed Nearest Zone is calculated from the shortest distance to a Zone boundary and never restricts assignment. The request is converted to the Site Map's real metre coordinates.
- Editing a Cleaner updates profile and schedule through `PATCH /api/cleaners/{id}`, then publishes a new Station Point revision through `PUT /api/site-map/station-points/{id}`.
- The roster, metrics, schedule summary, and availability labels refresh from the V2 read model after a successful mutation.
- Clicking a roster row now opens a read-only Cleaner detail modal instead of the edit wizard.
- The detail modal shows profile data, effective availability and reason, active Work, read-only Station Point geometry, nearest Zone, metre coordinates, and the full seven-day schedule.
- **Edit Cleaner** replaces the detail view with the existing four-page wizard. Saving returns to the refreshed detail view.
- An active Cleaner without active Work can be marked unavailable or returned to schedule directly from the detail view. Busy availability remains controlled by active Work.

### Cleaner: mobile web app

- A Cleaner Firebase login now enters `CleanerMobileApp`, not the role-integration placeholder.
- The app reads `/api/cleaner/me`, `/api/cleaner/map`, `/api/cleaner/work-orders?status=all`, and `/api/cleaner/notifications`.
- The mobile Station Point and Coordinate Work views render the authenticated Cleaner's real active-map dimensions and Zone polygons. The map endpoint intentionally excludes draft data, Camera placements, and other Cleaners' Station Points.
- A Cleaner can start assigned Work, then submit it for review.
- Camera-targeted Work does not ask for Cleaner proof. Coordinate-targeted Work requires one image; the app uploads it to the V2 completion-evidence endpoint before submitting for review.
- The notifications tab has a recipient-only Firestore listener, with the authenticated API inbox as its initial/fallback read model. Notification records stay immutable; this UI does not invent a read/unread mutation.
- Profile, availability, schedule, active Work, history, and notifications no longer use `cleanerMobileMock.ts` at runtime.

## Verification performed

```text
npm --prefix frontend test -- --run
11 test files passed, 31 tests passed

npm --prefix frontend run build
Passed

git diff --check
Passed
```

The added request-client test verifies the V2 Cleaner create, update, and Station Point mutation contracts. The backend integration test also verifies that the Cleaner map projection returns only active map geometry and the requesting Cleaner's Station Point. No Firestore index deployment was needed. The normal V2 Node development process was restarted only because the prior recorded process was no longer listening on port 3000.

## Manual browser test once the V2 Node API is running

1. Start the normal V2 stack, then open the frontend at `http://127.0.0.1:5173`.
2. Sign in as the Root Supervisor and open **Cleaner management**.
3. Create a Cleaner using a unique email and an 8+ character password. Put the Station Point anywhere inside the Site Map and save. Confirm its nearest Zone and distance appear after refresh.
4. Open a Cleaner row. Confirm it first shows the read-only detail view, including Station Point, nearest Zone, effective availability, current Work, and all seven schedule days.
5. Press **Edit Cleaner**, alter one schedule time, and move the Station Point into an unzoned part of the map. Save and confirm the refreshed detail view returns.
6. For an active Cleaner without active Work, test **Set unavailable**, then **Return to schedule**. Confirm both changes survive refresh.
7. Sign out and sign in with the newly created Cleaner credentials. Confirm the mobile workspace loads rather than a pending-role page.
8. For the seeded Coordinate Work: open it, start it, select one image, submit for review, and confirm it becomes `awaiting_review`.
9. For Camera-linked Work: start it and submit without a photo. Confirm it becomes `awaiting_review`.
10. Trigger or use an existing Cleaner notification. Confirm it appears in Updates without a full page reload.

## UI/backend mismatches found

- The Cleaner-management wizard now renders the active V2 polygons correctly enough to validate Station Point placement, but the wider site map and camera views are still not the true shared Site Map renderer. That renderer remains later work; no fake coordinates are sent by this phase.
- The mobile Station Point and Coordinate Work views now use a narrow Cleaner-safe active-map read model. The broader shared Site Map renderer still remains later work.
- Camera-targeted Work currently tells the Cleaner that post-cleaning camera verification is pending. The live Camera stream/snapshot view itself belongs to the monitoring integration phase.
