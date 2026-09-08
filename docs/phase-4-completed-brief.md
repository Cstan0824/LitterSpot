# Phase 4 completed brief

## Status

Canonical migration Phase 4 is complete. `/api/cleaners` now uses the V2 Cleaner model. The V1 Zone, capability, GPS presence and invitation workflow is no longer mounted for Cleaner management.

## What was done

- Added direct Cleaner email/password account creation with Firebase Authentication.
- Added durable identity operations and email reservations for Cleaner provisioning.
- Added compensation that removes partial Auth, account, profile, Station and reservation state if provisioning fails.
- Added Site-scoped stable Cleaner profiles.
- Added Site-scoped staff-code uniqueness keys.
- Added one recurring time range per weekday with overnight support through the existing tested schedule evaluator.
- Added Supervisor-controlled Availability Override.
- Added atomic `activeWorkOrderId` fields for the later Work migration.
- Added derived availability from Site status, account status, Cleaner status, schedule, override, Station Point validity and active Work.
- Added Station Point publication during Cleaner creation.
- Added Cleaner list/detail/profile update, schedule, override and deactivation APIs.
- Added busy-Cleaner deactivation protection.
- Preserved staff-code reservations after deactivation.
- Updated Cleaner self-profile to return V2 schedule, Station Point and availability as read-only data.
- Removed mounted Cleaner GPS presence, location history, invitation, push-token and notification-read operations from the V2 Cleaner contract.
- Added immutable Audit Events for Cleaner creation, updates and Station changes.
- Replaced the V1 Cleaner emulator journey with the V2 journey.

## APIs

```text
GET    /api/cleaners
GET    /api/cleaners/:cleanerId
POST   /api/cleaners
PATCH  /api/cleaners/:cleanerId
DELETE /api/cleaners/:cleanerId
PUT    /api/cleaners/:cleanerId/schedule
PUT    /api/cleaners/:cleanerId/availability-override
PUT    /api/site-map/station-points/:cleanerId

GET    /api/cleaner/me
```

Root and Regular Supervisors may manage Cleaners. Cleaners can only read their own profile through `/api/cleaner/me`.

## Automated verification

```text
npm --workspace=backend run build
Result: passed

npm run test:backend
Result: 60 test files passed, 239 tests passed

npm run test:emulator
Result: passed

V2 Cleaner integration
Result: 1 file passed, 4 tests passed

git diff --check
Result: passed
```

The emulator journey verifies:

- direct Auth account creation and immediate Cleaner login;
- schedule and Station Point persistence;
- derived available state;
- Supervisor override and outside-schedule reasons;
- absence of assigned Zone and capability fields;
- duplicate Site staff-code rejection;
- compensation deletes the failed duplicate Auth identity;
- compensation does not delete the existing Cleaner's staff-code key;
- deactivation disables the account and preserves its staff-code reservation.

## Guidance to test manually

First publish at least one Zone in the Sunway Theme Park Site Map. Then sign in as Root or Regular Supervisor and create a Cleaner:

```http
POST /api/cleaners
```

```json
{
  "staffCode": "CLN-001",
  "fullName": "Test Cleaner",
  "phone": "+60123456789",
  "email": "cleaner@example.com",
  "password": "choose-a-test-password",
  "weeklySchedule": {
    "mon": { "startMinute": 480, "endMinute": 1020 },
    "tue": { "startMinute": 480, "endMinute": 1020 }
  },
  "stationPoint": { "xMeters": 10, "yMeters": 10 },
  "idempotencyKey": "cleaner-create-001"
}
```

Check that:

1. `stationZoneId` is derived by the backend.
2. `availability.available` reflects the current Site-local schedule.
3. The response has no `assignedZoneId`, permitted Zone list, capabilities or GPS fields.
4. The Cleaner can immediately sign in and call `GET /api/cleaner/me`.
5. Setting Availability Override to `unavailable` adds `availability_override` to the reason list.

Do not put test passwords in tracked Postman environment files.

## Cloud state

No Cleaner was added to `litterspot-dev-jeremy` during automated Phase 4 verification. Tests used only `demo-litterspot` emulators.

## Next phase

Phase 5 completes composite Camera Creation, source revision, Registration validation, Site Map Placement publication, monitoring defaults, reconfiguration and Camera APIs.
