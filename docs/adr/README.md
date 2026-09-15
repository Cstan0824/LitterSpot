# Architecture decision records

These records explain implemented decisions that are costly to reverse or surprising without their history.

| ADR | Decision |
| --- | --- |
| [0001](0001-firestore-production-topology.md) | Use Site-scoped top-level Firestore collections and revision-pointer Site Maps |
| [0002](0002-atomic-frontend-cutover.md) | Integrate the production backend and first wired frontend atomically |
| [0003](0003-orchestrator-selects-assignment-pair.md) | Let the Orchestrator select one backend-approved Alert and Cleaner pair |
| [0004](0004-keep-live-monitoring-state-in-node.md) | Keep high-frequency live monitoring state in Node memory |
| [0005](0005-detail-only-delayed-analyzed-playback.md) | Reserve delayed analyzed playback for Camera Detail |
| [0006](0006-camera-movement-operational-lifecycle.md) | Separate Map Position Correction from Physical Camera Move |
| [0007](0007-camera-removal-preserves-published-history.md) | Remove a Camera from active operation without deleting published history |

The [technical specification](../spec.md) records the current rules produced by these decisions.
