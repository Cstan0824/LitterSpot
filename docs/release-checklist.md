# LitterSpot release checklist

## Repository

- [ ] Only intended tracked changes and known local exports remain.
- [ ] No credentials, `.env`, `.local`, media, or diagnostics are staged.
- [ ] `git diff --check` passes.
- [ ] Documentation links resolve.
- [ ] Terminology follows `CONTEXT.md`.

## Site and spatial administration

- [ ] Identity, Superadmin, Site Map, movement, removal, and Site-operation tests pass.
- [ ] Firestore rules and indexes match the data model.
- [ ] Production target and schema validation pass read-only.

## Camera monitoring and AI

- [ ] Model paths and hashes match [model-card.md](model-card.md).
- [ ] Builds and AI-service tests pass.
- [ ] Camera, monitoring, quota, scene, and removal tests pass.
- [ ] Both demo scene commands work in the intended environment.

## Alert and evidence management

- [ ] Qualification, priority, evidence, overlay, retention, and isolation tests pass.
- [ ] Existing active-key identities remain compatible.

## Cleaner and Work operations

- [ ] Availability, Cleaner, Work, Completion Evidence, Verification, and notification tests pass.

## Orchestration and operational intelligence

- [ ] Assignment, Orchestrator, analytics, bin-placement, audit, and System-event tests pass.
- [ ] Production Orchestrator configuration is intentional.

## Full gate

```bash
npm --workspace=backend run build
npm --workspace=frontend run build
npm --workspace=backend run test
npm --workspace=frontend run test
.venv/bin/python -m unittest discover -s ai-service/tests -p 'test_*.py'
npm run test:assignment
npm run fixture:emulator:verify
npm run test:emulator
npm --workspace=backend run database:validate-schema
```

- [ ] All commands pass with Vitest limited to one worker.
- [ ] No application, test, or emulator process remains.
- [ ] A coordinated Firestore and local-media backup exists before risky production changes.
- [ ] The release commit is pushed to the intended branch only.
