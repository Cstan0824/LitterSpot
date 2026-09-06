# Local emulator development

Run the complete isolated V2 stack from the repository root:

```sh
npm run start:emulator
```

Services:

- Product: `http://127.0.0.1:5173`
- Node: `http://127.0.0.1:3000`
- FastAPI: `http://127.0.0.1:8000`
- Firebase Emulator UI: `http://127.0.0.1:4100`
- Firestore emulator: `127.0.0.1:8180`
- Auth emulator: `127.0.0.1:9199`
- Firestore database: `(default)`

Development accounts:

- Root Supervisor: `root@sunway-test.com` / `password123`
- Superadmin: `superadmin@litterspot.com` / `password123`
- Cleaner Gan: `gan@sunway-cleaner.com` / `password123`

The current local state contains Sunway Theme Park, two Zones, two disabled looped-video Cameras, and Cleaner Gan. Configure or replace them through the product. Data and local media stay under ignored `.local/` directories.

Stop and export the emulator state with `Ctrl+C` in the launcher terminal, or from another repository terminal:

```sh
npm stop
```

`npm stop` explicitly exports Auth and the default Firestore database before it terminates any emulator process. The next `npm run start:emulator` imports that snapshot. The launcher sets emulator environment variables only for its child processes. It does not rewrite cloud credentials or connect to `litterspot-v2-database`.

Automated emulator tests use separate ports, Firestore `8280` and Auth `9299`, with disposable data. Running tests while this development stack is open does not add fixture documents to Sunway Theme Park.

Do not run the ordinary `npm start` at the same time. It uses `backend/.env` and therefore targets the configured cloud development project.
