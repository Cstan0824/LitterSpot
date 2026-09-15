# LitterSpot product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- LitterSpot Superadmins create Client Sites and first Root Supervisor accounts. They inspect tenant operations but do not replace Cleaners or dismiss daily operational Work from the Superadmin interface.
- Client Supervisors manage one tourist-attraction Site. Root Supervisors control critical structure and accounts; Regular Supervisors handle permitted daily operations.
- Cleaners use a mobile web interface to receive one assignment, complete physical cleaning, submit required evidence, and follow their working schedule.

## Product purpose

LitterSpot helps tourist-attraction teams detect cleanliness problems, assign one available Cleaner, track the cleaning response, verify completion, and understand which Zones need more attention or bin placement.

## Positioning

The system combines registered fixed-camera geometry, local detection models, a supervised LLM assignment workflow, site-defined indoor coordinates, and an auditable cleaning lifecycle. It does not depend on GPS or an external map provider.

## Operating context

- Each Client manages one Site, such as one theme park or attraction.
- Supervisors define Site dimensions, plot non-overlapping Zones, place Cameras, and register visible floor and bin regions.
- Monitoring samples Camera media periodically. Operational detections can qualify into Flags and Alerts, which can produce Cleaner Work Orders.
- The Orchestrator receives waiting Alerts and available Cleaners, then selects both an Alert and Cleaner. Node validates and commits the decision.
- Cleaner Work progresses through assigned, in progress, awaiting review, and resolved or rework. Supervisors can dismiss and manually take over where allowed.

## Capabilities and constraints

- React is the frontend, Node and Express own business workflows, cloud Firebase supplies Authentication and Firestore, and private FastAPI runs inference.
- The prototype uses one real laptop-camera source and optional looped-video Camera sources.
- Site locations use approximate two-dimensional metre coordinates. Cleaner Station Points may sit outside Zone polygons.
- Alerts represent conditions that require cleaning, not every individual model detection.
- Raw LLM output stays in local developer diagnostics. Product pages use safe structured explanations only.
- The System page shows Orchestrator state, workload, decision history, safe faults, and pause or resume controls.
- A later System playground will accept temporary image or video media and temporary floor or bin polygons. Playground results must not create operational records or analytics.

## Brand commitments

- Product name: LitterSpot.
- User-facing language is operational, concise, and understandable without AI terminology.
- Melissa's delivered Supervisor and Cleaner interfaces remain the visual and interaction authority for the integrated application.

## Evidence on hand

- The repository contains trained floor-hazard, people, bin-localisation, and bin-state inference code and weights.
- The backend has tested production contracts for Site Maps, Camera registration and monitoring, Alerts, Cleaners, Work Orders, Orchestrator Runs, notifications, dashboard summaries, and bin-placement analytics.
- Current screenshots and seeded development records are prototype evidence. They are not performance claims about model accuracy or production scale.

## Product principles

- Keep operational truth in Node and Firestore; models propose or detect but do not write business state directly.
- Show evidence, status, ownership, and next action without exposing hidden model reasoning.
- Keep test and simulation workflows isolated from operational Alerts, Work, and analytics.
- Preserve Site history when structure changes.
- Prefer a complete, understandable prototype workflow over unsupported production claims.
