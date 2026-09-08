# Shared emulator fixture

This directory holds the team baseline for the Firebase Auth emulator, Firestore emulator, and LitterSpot's local media store.

`npm run start:emulator` copies this fixture into `.local/` only when that developer has no saved emulator snapshot. Later starts import the developer's own `.local/firebase-emulator-data` and preserve their changes.

Use this command to discard the current local state and restore the team baseline:

```sh
npm run fixture:emulator:reset
```

The reset command requires the local stack to be stopped. It moves the previous local state into `.local/backups/` before restoring the fixture.

To publish a revised baseline:

1. Run `npm run start:emulator` and make the required changes.
2. Run `npm stop` to export the latest Auth and Firestore state.
3. Run `npm run fixture:emulator:update`.
4. Review `fixtures/emulator/manifest.json` and commit the fixture changes.

The fixture contains development-only accounts and media. The eight large looped Camera sources are stored as same-resolution H.264 files to keep the fixture manageable. Never import it into a production Firebase project.

Verify that every exported database and media file matches the manifest after cloning:

```sh
npm run fixture:emulator:verify
```

If new large looped sources are added later, stop the local stack, run `npm run media:compress:emulator:apply`, start the emulator, run `npm run media:sync:emulator`, stop it again, and regenerate the fixture with `npm run fixture:emulator:update`.
