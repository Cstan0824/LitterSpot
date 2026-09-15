# LitterSpot documentation

This directory describes the implemented LitterSpot system. Product scope, technical behavior, and operational procedures are separated so that each fact has one authoritative home.

## Document authority

| Document | Authority |
| --- | --- |
| [Product requirements](PRD.md) | Product purpose, users, scope, capabilities, and constraints |
| [Business flows](business-flows.md) | Actor actions, automated steps, outcomes, and failure paths |
| [Technical specification](spec.md) | Implemented stack, technical requirements, state rules, timing, and validation |
| [Architecture](architecture.md) | Component boundaries, ownership, communication, and deployment shape |
| [Domain context](../CONTEXT.md) | Canonical business terminology |
| [API reference](api-reference.md) | HTTP contracts |
| [Firestore model](data-model/README.md) | Collections, fields, relationships, and integrity rules |
| [Architecture decisions](adr/README.md) | Decisions that are costly to reverse or surprising without context |

When documents disagree, use the narrower authority above and verify implementation claims against the referenced source and tests.

## Business modules

LitterSpot is divided by business responsibility.

1. **Site and spatial administration** manages Sites, accounts, permissions, Site Maps, Zones, Camera Placements, Cleaner Station Points, and map backgrounds.
2. **Camera monitoring and AI** manages Camera Creation, sources, Registration, Monitoring Sessions, adaptive sampling, delayed analyzed playback, and private inference.
3. **Alert and evidence management** qualifies Detection Signals into Flags and Alerts, retains Alert Evidence, and controls Alert state.
4. **Cleaner and Work operations** manages Cleaner schedules and availability, Work Orders, mobile progress, Completion Evidence, Verification, rework, and notifications.
5. **Orchestration and operational intelligence** manages assignment and review automation, Orchestrator Runs, dashboards, analytics, audit history, system status, and bin-placement analysis.

## Product and behavior

- [Product requirements](PRD.md)
- [Business flows](business-flows.md)
- [Technical specification](spec.md)
- [Requirements traceability](requirements-traceability.md)
- [Design system](design-system.md)

## Architecture and implementation

- [Architecture](architecture.md)
- [API reference](api-reference.md)
- [Firestore data model](data-model/README.md)
- [Configuration](configuration.md)
- [Security](security.md)
- [Privacy and retention](privacy-and-retention.md)
- [AI pipeline](ai-pipeline.md)
- [Model card](model-card.md)
- [Camera monitoring](camera-monitoring.md)
- [Orchestrator](orchestrator.md)

## Development and operation

- [Development guide](development.md)
- [Testing guide](testing.md)
- [Deployment guide](deployment.md)
- [Operations runbook](operations-runbook.md)
- [Demo guide](demo-guide.md)
- [Release checklist](release-checklist.md)

## Scoped references

- [Shared emulator fixture](../fixtures/emulator/README.md)
- [CCTV demo clips](../samples/cctv-demo/README.md)
- [Assignment provider package](../task-assignment-llm/README.md)
- [ML research archive](../progress/ml-research/README.md)

The research archive records experiments and evidence. It is not an application requirements source.
