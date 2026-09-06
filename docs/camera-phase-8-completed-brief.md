# Camera phase 8: acceptance and limits

## Evidence collected

- Backend, frontend, and API sandbox production builds passed.
- Backend unit run passed 257 tests; frontend passed 45 tests.
- All 58 affected backend emulator tests passed across the final targeted runs, including the Cleaner evidence-access regression. The Orchestrator outbox test now scopes its worker to its own Site so other tests cannot consume its batch limit; its 22-test suite passed after that correction.
- Two-Camera sandbox browser test proved route and clean-scene continuity with unchanged episode IDs.
- Six-Camera product browser test proved concurrent feeds, navigation, viewer delivery, owner takeover, and deliberate disable/re-enable. No JavaScript errors occurred.
- Desktop Camera detail was inspected visually. Source image and overlay matched at 1020 by 765 pixels. A tablet capture was also inspected; its existing navigation drawer behavior remains outside the Camera redesign.
- The UI detector reported no findings in the changed Camera view and registration targets.
- Actual FastAPI inference accepted a repository video frame at 832 by 464, detected 12 people, and reported approximately 607 ms processing time on CPU. This is one request, not a sustained throughput or accuracy claim.

## Operational limits

The prototype runs one Node process, one source-owning Supervisor browser, and ephemeral server memory. It does not guarantee an exact one-Hz cadence for every Camera. A fair bounded queue protects latency under load. Phone sources and full-rate remote media delivery remain deferred.

Live frames are never written to Firestore. Registration reads are cached briefly, reference media is cached by revision, runtime status is checkpointed every five seconds and sequence every ten seconds. Control mutations invalidate relevant cached documents. Sample authentication is cached for at most ten seconds and never beyond token expiry; normal application mutations still authenticate directly. A Node restart starts new episodes, preventing reuse of uncheckpointed sample IDs.

Firestore still receives operational Flags, Alert occurrences, Work and evidence metadata. An indefinitely dirty loop can consume daily quota. These changes reduce repetitive sample overhead; they do not make unlimited monitoring fit a free quota. Quota errors cause sampling backoff instead of rapid retries.

## Deliberately open presentation choice

Exact analyzed frames are the current default because their overlays are aligned. Smooth source playback is available separately to the owner. A synchronized full-motion overlay renderer is not included. The main plan kept this choice open for user evaluation after browser testing.

## Development target

Canonical application data remains `litterspot-v2-database/(default)`. Automated tests used `demo-litterspot` emulators on separate ports. No shared-production data was reset or migrated.

Evidence field-index exclusions were deployed successfully to the canonical development database. The LitterSpot Node watcher reloaded on port 3000 and its readiness check reported inference ready. Development scene switching is enabled in the ignored local backend environment; no scenes are uploaded to the cloud project by these tests.

Use [camera-monitoring-testing-guide.md](camera-monitoring-testing-guide.md) for the product and underground scene workflow.
