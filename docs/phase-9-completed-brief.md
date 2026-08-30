# Phase 9 completed brief

> Status: rules and system-event foundation completed; full deactivation reconciliation and emulator rules coverage remains open.

## What was done

- Updated Firestore rules to keep default deny while allowing addressed active users to read only their own active-Site notifications.
- Direct client notification writes remain denied.
- Added deterministic system-event keying and open/recovered state aggregation helpers.
- V2 audit writes remain Admin SDK-owned and immutable through the application API.

## Testable behavior

- A user cannot read another user’s notification or a notification from another Site.
- An inactive account or Site cannot read notifications.
- Repeated system failures increment one event episode instead of creating unbounded duplicate records.

## Verification guidance

Run the Firestore emulator rules suite with notification reads and writes. Keep Admin SDK authorization tests because Admin SDK calls bypass Firestore rules.
