# Phase 12 completed brief

> Status: hardening checkpoint completed; V1 retirement is intentionally not marked complete because the V2 runtime replacement is still open.

## What was done

- Pulled and verified the configured Ollama model `qwen3.5:4b`.
- Confirmed the backend TypeScript build passes after the V2 additions.
- Confirmed the complete ordinary backend unit suite passes.
- Confirmed `git diff --check` passes.
- Preserved V1 routes and collections because replacing them before their V2 persistence implementations pass would create an unsafe cutover.

## Testable behavior

- `npm --workspace=backend run build` passes.
- `npm run test:backend` passes with the repository’s emulator-only tests skipped when emulators are not running.
- `ollama list` includes `qwen3.5:4b`.
- V2 reset tooling remains dry-run by default and does not touch local media.

## Verification guidance

Run `npm run test:emulator` before any V2 cutover. Run `npm --workspace=backend run v2:inspect-target` against the isolated development project and review the exact target before bootstrap or reset. Do not run reset with `--apply` without explicit approval.

## Remaining work

The V2 persistence/runtime migration still needs to replace the V1 Cleaner, Camera, monitoring, Alert, Work, Orchestrator, analytics, and Dashboard services before V1 retirement can be safely completed.

