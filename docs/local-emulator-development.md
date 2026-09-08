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

The repository includes a shared team fixture containing the configured Sunway Theme Park map, Zones, Cameras, Cleaners, development accounts, retained media, and demonstration Alert, Work, and analytics history. A developer with no saved local snapshot receives this fixture automatically on the first `npm run start:emulator` launch.

After the first launch, Firebase data and local media stay under ignored `.local/` directories. Starting the stack again preserves that developer's later changes instead of replacing them with the repository fixture.

Stop and export the emulator state with `Ctrl+C` in the launcher terminal, or from another repository terminal:

```sh
npm stop
```

`npm stop` explicitly exports Auth and the default Firestore database before it terminates any emulator process. The next `npm run start:emulator` imports that snapshot. The launcher sets emulator environment variables only for its child processes. It does not rewrite cloud credentials or connect to `litterspot-v2-database`.

Restore the repository baseline with:

```sh
npm run fixture:emulator:reset
```

The stack must be stopped first. Reset moves the previous local Firebase export and media into `.local/backups/`, then restores the shared fixture. Inspect readiness without changing anything with `npm run fixture:emulator:reset -- --dry-run`.

To update the team fixture after intentional local changes:

```sh
npm stop
npm run fixture:emulator:update
```

The tracked fixture includes about 58 MB of Camera videos and images. The large looped Camera sources are same-resolution H.264 transcodes, and each file remains below GitHub's 100 MB file limit. Review the fixture diff before committing it. To compress newly added large sources, stop the stack and run `npm run media:compress:emulator:apply`, then start the stack, run `npm run media:sync:emulator`, stop it, and regenerate the fixture.

Automated emulator tests use separate ports, Firestore `8280` and Auth `9299`, with disposable data. Running tests while this development stack is open does not add fixture documents to Sunway Theme Park.

Do not run the ordinary `npm start` at the same time. It uses `backend/.env` and therefore targets the configured cloud development project.
