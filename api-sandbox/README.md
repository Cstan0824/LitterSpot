# LitterSpot API sandbox

This is a disposable developer UI for testing backend Phases 5–7. It is separate from `frontend/` and is not product UI.

## Start

Start Node and FastAPI from the repository root:

```bash
npm start
```

In another terminal, start the sandbox:

```bash
npm run dev:sandbox
```

Open:

```text
http://127.0.0.1:5174
```

## Test order

1. Connect with the `litterspot-dev-jeremy` Firebase Web API key and Root Supervisor credentials.
2. Register a Camera. Click a Site Map point, start a Draft, capture or choose a reference image, plot the floor and optional bins, then validate and publish.
3. For a looped-video Camera, choose and store its MP4/WebM source before saving Registration geometry.
4. Monitor a published Camera. The sandbox claims the Site lease, starts a Camera Episode and submits one JPEG sample every two seconds.
5. Inspect overlays, raw sample output and the Alerts tab.

The password is held only in React state. The Firebase token uses `sessionStorage`; API key, API URL and email use `localStorage` for convenience.
