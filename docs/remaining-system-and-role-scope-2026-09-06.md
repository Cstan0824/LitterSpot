# Remaining System and role scope

This audit compares the current implementation with `current-clarified-requirements.md` and its continuation. It uses the later, specific Superadmin restriction as authoritative: the separate Superadmin area may administer Sites, perform approved structural work, and read Site operations, but it does not perform daily Alert, assignment, Work, or Verification mutations.

## System

Already built:

- Orchestrator running or paused state and pause/resume controls;
- waiting Alert and review workload counts;
- recent assignment and review Runs;
- concise explanations with one expandable Run at a time;
- candidate distances, exclusions, retries, safe tool results, identifiers, and timings;
- safe System issues, service status, and pause/resume history;
- development-only raw provider output outside Firestore and outside every product UI.

Remaining:

- the approved System playground for temporary image/video upload, temporary floor/bin plotting, and isolated inference;
- a real LLM-provider connectivity probe, because the current page correctly reports `not_probed`;
- wider durable error coverage beyond the current Orchestrator and Site-operation catalogue, especially Camera source failures and inference dependency failures;
- final acceptance with the Orchestrator worker enabled and real assignment/review Runs present.

The playground must not create operational Flags, Alerts, Work, notifications, or analytics. Existing Pipeline and Camera Registration experiments are useful implementation references but do not yet satisfy that isolated product workflow.

## Cleaner

Already built:

- Cleaner authentication and the mobile shell;
- assigned to in-progress to awaiting-review actions with no acceptance, rejection, or Report Problem action;
- recurring weekly schedule and read-only Station Point map;
- current Work and five-item recent terminal history;
- Camera-linked annotated Alert Evidence;
- one-photo coordinate Completion Evidence upload;
- durable notification inbox plus immediate read-only Firestore delivery;
- rework, resolved, and dismissed states.

Remaining or needing refinement:

- Supervisor coordinate-Work creation still blocks on the unfinished true Site Map target picker, so the complete coordinate Cleaner flow is difficult to create from the product UI;
- Camera-linked Cleaner Work currently places its map marker at a fallback centre instead of using the Work Order's published Camera point;
- after coordinate submission, the UI confirms that one photo was received but does not render the retained submitted photo in Work history;
- busy availability copy should consistently say `Busy` instead of exposing the backend reason `active_work`;
- overnight schedules work in backend policy, but the mobile timeline needs a deliberate next-day visual treatment;
- a final mobile pass is still needed for rework, inconclusive review, disconnected notification recovery, and narrow-device layout.

## Regular Supervisor

Already built:

- authority-aware session parsing and shared Supervisor routing;
- Dashboard, Alerts, Work, Cleaner management, analytics, Camera monitoring, Camera re-registration, and System access;
- Cleaner schedules, Station Points, Availability Overrides, assignments, dismissal, review, takeover, and Orchestrator pause/resume;
- Root-only enforcement for Supervisor accounts, full Site Map mutation, Camera placement/creation/deactivation, and Site audit access;
- hidden Add Camera control while existing Camera re-registration remains available;
- backend and Postman permission tests.

Remaining:

- a Root Supervisor account-management page for creating, editing, and deactivating Regular Supervisors;
- a persistent local Regular Supervisor fixture and a full browser acceptance pass through every allowed and forbidden control;
- the full Root Site Map administration UI, which is also needed to visibly prove that Regular Supervisors cannot change dimensions, publish full map drafts, reshape Zones, or move Cameras;
- final audit verification that every Regular Supervisor mutation records the real actor authority and identity.

## Superadmin

Already built in the backend:

- Superadmin authentication and role separation;
- Site list and active/inactive filtering;
- atomic Site creation with initial map dimensions and first Root Supervisor;
- Site activation and deactivation with recoverable cleanup;
- Root reset and replacement;
- Site-operation status and reconciliation endpoints;
- cross-Site Superadmin audit listing;
- Root-only Site audit access for events affecting that Site.

Remaining backend work:

- a selected-Site read model for operational Dashboard, Cameras, Cleaners, Alerts, Work, analytics, and System data without pretending the Superadmin is a Supervisor;
- approved selected-Site structural mutation routes that preserve the Superadmin actor instead of using Supervisor-only services;
- optional Site background upload during Site creation, because the current API accepts only an existing `backgroundMediaId`;
- a compact platform-overview response rather than making the future UI derive every total from raw Site lists;
- complete success and failure audit coverage for every Superadmin mutation, including manually requested Site-operation reconciliation;
- actor-aware Camera and Site Map services. Current Camera publication code records a Supervisor-shaped actor and cannot represent Superadmin structural work correctly.

Remaining frontend work:

- the entire separate Superadmin application shell;
- platform overview;
- Site selector and Site list/status views;
- create-Site and first-Root workflow;
- selected-Site administration and operational read views;
- Root recovery;
- Site activation/deactivation progress and recovery;
- Superadmin audit history.

The current Superadmin login intentionally lands on an integration-pending page. No daily Alert dismissal, Cleaner replacement, Work resolution, or Verification override should be added to the Superadmin area.
