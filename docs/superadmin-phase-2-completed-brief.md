# Superadmin Phase 2 completed brief

## Delivered behavior

Authenticated Superadmins now enter a separate LitterSpot interface at `#/superadmin/sites`. The application no longer sends this role to an integration-pending screen.

The Sites ledger supports status filtering, Site or Root account search, active and inactive counts, and direct navigation into each Site register. The selected Site register shows tenant identity, status, Root ownership, published map dimensions, operational record counts, and Superadmin audit history.

## Site management

The create workflow provisions these records together:

- Site identity and timezone;
- the first empty published Site Map revision with metre dimensions;
- an automatically recommended but editable Grid interval;
- the first Root Supervisor Firebase identity and V2 profiles;
- the initial Orchestrator configuration;
- the immutable Superadmin audit event.

The Root Supervisor adds and aligns an optional map background later through Site administration. This avoids temporary unowned media during Site creation.

Superadmins can deactivate or reactivate a Site with a required reason. A pending or failed deactivation cleanup appears in the Site register with a recovery action. Manually continuing that operation creates a Superadmin audit event.

Root recovery supports resetting the current Root identity or replacing it. Replacement also repairs a Site with a missing Root reference. Resetting such a Site fails with a message directing the Superadmin to replacement.

## Authority boundary

The global and selected-Site audit ledgers return only events whose actor role is `superadmin`. Ordinary Supervisor audit history remains in the Supervisor Site page.

The **Open Site** control currently enters the Phase 3 route. It does not impersonate a Supervisor or expose Supervisor mutations.

## Verification

- Backend and frontend TypeScript production builds pass.
- Frontend unit suite passes with 118 tests.
- Backend unit suite passes with 265 tests; emulator-only suites remain skipped in that command.
- The identity and Site emulator suite passes with 8 tests, including missing-Root replacement, inactive Site reads, media isolation, Superadmin audit filtering, and Site View mutation rejection.
- Desktop and 390 × 844 responsive browser passes completed.
- The Impeccable mechanical detector reported no findings for the new interface.
