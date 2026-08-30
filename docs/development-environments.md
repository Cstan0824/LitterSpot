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
Firebase project=litterspot-dev-jeremy
Firestore database=(default)
media=.local/dev-cloud-media
```

The backend refuses startup when configured, expected, and credential project IDs do not agree.

## Automated tests

```bash
npm run test:emulator
```

Tests use Firebase Auth and Firestore emulators under demo project `demo-litterspot`; they do not use either cloud Firebase project.

## Shared production

The shared production project `litterspot` with named database `litterspot` is not used by this backend rebuild. Production credentials and browser configuration must not be used in ordinary development commands.

## Future API sandbox

If browser-native testing is needed, create a separate `api-sandbox/` using the ignored `config/firebase-web.dev.json`. Do not wire new product APIs into the current `frontend/`.
