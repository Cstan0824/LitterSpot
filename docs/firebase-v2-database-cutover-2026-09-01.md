# Canonical Firebase V2 database cutover

Date: 2026-09-01

## Decision

`litterspot-v2-database/(default)` is the canonical Firebase target for:

- backend and Postman development;
- Phase 11 cloud acceptance;
- Phase 12 frontend integration;
- the working prototype and team handoff.

The former `litterspot-dev-jeremy/(default)` personal project and `litterspot/litterspot` team prototype are retired. They were not deleted, copied or mutated during this cutover. No runtime environment or Firebase CLI default points to them.

## Deployed infrastructure

- Firebase Authentication with Email/Password enabled by the project owner.
- Firestore `(default)` database.
- Current `firestore.rules` deployed.
- All 62 composite indexes deployed and confirmed `READY`.
- Admin credential stored outside the repository with macOS mode `600`.
- Local backend, frontend and Postman Web API configuration switched to the new project.
- `.firebaserc` default switched to `litterspot-v2-database`.

## Bootstrapped application state

- LitterSpot Superadmin Firebase identity and V2 account.
- Sunway Root Supervisor Firebase identity and V2 profile.
- Site `sunway-theme-park`, named Sunway Theme Park.
- Active initial Site Map Revision `sunway-theme-park-initial`, 100 by 100 metres.
- Orchestrator configuration and V2 schema metadata.

Credentials remain in ignored local configuration/Postman Vault. Passwords, tokens, Web API keys and Admin private keys are not stored in this document.

## Controlled Phase 11 seed

The project-locked command is:

```bash
npm --workspace=backend run v2:seed-phase11
```

It refuses any cloud target except `litterspot-v2-database/(default)`. It creates idempotent development data for:

- Zones `main-entrance` and `food-court`;
- completed Site-local dates 2026-08-29, 2026-08-30 and 2026-08-31;
- one minute bucket per historical date plus recent Dashboard activity;
- people observations for both Zones;
- nine resolved simulated bin-service Alerts;
- nine resolved simulated Work Orders;
- rebuilt Daily Summaries and a 30-day recommendation snapshot.

Expected initial analytics state:

| Check | Expected |
| --- | --- |
| Zone count | 2 |
| Alert count | 9 resolved |
| Work count | 9 resolved |
| Daily summaries | 3 |
| Recommendation status | `partial_data` |
| Rank 1 | Food Court |
| Rank 2 | Main Entrance |
| Eligible recommendation count | 2 |
| Intervention count | 0 until the Supervisor tests Implement |

The seed is development data. It does not claim that real Cameras produced those historical observations.

## Cloud acceptance result

The following authenticated Root Supervisor requests passed against the new project:

| Request | Result |
| --- | --- |
| Root and Superadmin Firebase Web login | 200 |
| `/api/me` for Root and Superadmin | 200 with correct role/Site |
| Dashboard refresh/read | 201 / 200 |
| Daily rebuild/list for the three seed dates | 200 / 200 |
| Recommendation refresh/read for 30 days | 201 / 200 |
| Intervention list | 200, empty |
| Minute cleanup | 200, `deleted: 0` |

Implement and comparison remain intentionally unexecuted in cloud acceptance. They are the final two manual Phase 11 Postman checks.

## Runtime

```text
Node API: http://127.0.0.1:3000
FastAPI:  http://127.0.0.1:8000
ANALYTICS_WORKER_ENABLED=false
ORCHESTRATOR_WORKER_ENABLED=false
```

Manual Phase 11 routes remain available with both workers disabled. This protects the Spark quota during API testing.
