# ADR 0006: Camera movement operational lifecycle

Status: accepted

## Context

A Camera point can change because its recorded coordinate was inaccurate or because the physical Camera and its view moved. Treating both cases alike either retains stale Registration after a real move or destroys valid cleaning work after a metadata correction. Every structural publication also creates a new Active Map Revision, so waiting Alerts must not become unusable merely because their Camera coordinate was corrected.

## Decision

Map Position Correction is limited to the Camera's current active Zone. It retains Camera Registration and active operations. Publication retargets unresolved Camera Alerts and active Camera Work to the corrected point and replacement map revision, records append-only before/after events, notifies assigned Cleaners, and requests a fresh assignment cycle.

Physical Camera Move may target the current Zone, another active Zone, or a valid provisional new Zone. It requires a fresh reference and floor/bin Registration. Final publication atomically activates the structural and Registration changes, dismisses active operations tied to the old Camera view with reason `camera_physically_moved`, releases Cleaners, and preserves evidence and history. Cancelling the draft changes no active state.

## Consequences

Root cannot use correction to change Zone assignment or bypass Registration. A Cleaner whose active Work location was corrected keeps the assignment and receives the new point. A real Camera move cannot leave Alerts, Work or verification attached to obsolete footage. Physical movement can still complete as one guided flow when the destination requires a new Zone.
