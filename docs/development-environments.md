# LitterSpot development environments

## Default API development

```bash
npm start
```

This starts only:

- Node/Express on `127.0.0.1:3000`;
- private FastAPI on `127.0.0.1:8000`.

It does not start or open the legacy `frontend/`.

The ignored local `backend/.env` targets:

```text
APP_ENV=development-cloud
Firebase project=litterspot-v2-database
Firestore database=(default)
media=.local/dev-cloud-media
```

The backend refuses startup when configured, expected, and credential project IDs do not agree.

`litterspot-dev-jeremy/(default)` is the retired personal development target. It remains untouched for recovery after its 2026-08-31 Spark read-quota incident. New cloud testing uses `litterspot-v2-database/(default)`.

## Automated tests

```bash
npm run test:emulator
```

Tests use Firebase Auth and Firestore emulators under demo project `demo-litterspot`; they do not use either cloud Firebase project.

## Shared production

The shared production project `litterspot` with named database `litterspot` is not used by this backend rebuild. Production credentials and browser configuration must not be used in ordinary development commands.

## Future API sandbox

Browser-native API experiments use the separate `api-sandbox/`. Product frontend wiring follows the Phase 12 integration plan.
