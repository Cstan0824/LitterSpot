# LitterSpot Operations

LitterSpot turns camera observations and manually reported cleanliness needs into location-aware cleaning work for one client-operated site.

## Organizations and people

**LitterSpot Superadmin**:
A platform operator who creates Sites and their first Root Supervisor accounts and can administer any selected Site.
_Avoid_: Client admin, site supervisor

**Root Supervisor**:
The first Client Supervisor account for a Site, with authority over Supervisor accounts and critical Site Map configuration.
_Avoid_: Superadmin, owner

**Regular Supervisor**:
A Client Supervisor account created by the Root Supervisor for daily operations at the same Site.
_Avoid_: Dispatcher, manager

**Cleaner**:
A mobile-web user who receives Work Orders, performs cleaning, reports progress, and submits work for review.
_Avoid_: System user, staff record

**Orchestrator**:
An automated service actor that reasons about operational state and uses controlled backend tools; it is not a human user type.
_Avoid_: Supervisor account, cleaner assignment model

**Orchestrator Run**:
A durable application record of one assignment or review attempt, including structured inputs, decision explanation, tool calls, result, and failures; optional raw model output is separate developer filesystem data.
_Avoid_: Hidden provider reasoning, Work Order history

## Location and cameras

**Site**:
The tenant boundary and single physical venue operated by one client team; there is no separate Client Organization entity in the first version.
_Avoid_: Area, organization record

**Site Map**:
The Site's two-dimensional, approximate real-distance coordinate plane, shown as a grid with an optional client-supplied background image.
_Avoid_: Google Map, GPS map

**Site Map Revision**:
An immutable published version or editable draft of the Site Map dimensions, background, Zone geometry, Camera Placement, and Cleaner Station Points.
_Avoid_: Site version, floor

**Active Map Revision**:
The one published Site Map Revision that defines the Site's current dimensions, Zones, Camera Placements, and Cleaner Station Points.
_Avoid_: Current map cache, latest draft

**Camera Draft**:
A non-operational workspace for creating a Camera or replacing its source and Registration; only publication changes the operational Camera.
_Avoid_: Incomplete Camera, temporary Camera

**Zone**:
A non-overlapping polygon inside one Site Map Revision that groups Cameras, Cleaners, observations, Alerts, and Work Orders.
_Avoid_: Area, region

**Camera Placement**:
The Camera's physical point inside exactly one active Zone on the Site Map.
_Avoid_: Camera registration, camera ROI

**Camera Creation**:
One Root Supervisor workflow that combines Camera identity, Site Map placement, source configuration, reference capture, floor/bin plotting, validation, and initial Camera Registration publication.
_Avoid_: Bare camera record, create-then-register

**Simulation Camera**:
A structurally active Camera backed by a looped video whose monitoring remains disabled until deliberately enabled for a demonstration.
_Avoid_: Live CCTV camera, automatically active test source

**Camera Registration**:
The Camera-view configuration containing a reference frame, visible walkable-floor polygon, and optional physical-bin polygons; initial Registration is mandatory within Camera Creation.
_Avoid_: Camera placement, zone registration

**Cleaner Station Point**:
The fixed Site Map coordinate assigned to a Cleaner; assignment decisions treat an available Cleaner as being near this point.
_Avoid_: GPS location, live location, home address

**Cleaner Schedule**:
The Root Supervisor-managed recurring daily time ranges that determine when a Cleaner can become available for assignment.
_Avoid_: Zone eligibility, Cleaner-controlled presence

**Availability Override**:
A Supervisor-controlled switch that excludes a Cleaner from assignment regardless of their recurring shift.
_Avoid_: Leave record, Cleaner online status

**Superadmin Audit Event**:
An immutable record of a privileged Superadmin access or action against a selected Site, attributed to the Superadmin rather than a Site Supervisor.
_Avoid_: Root Supervisor history, editable activity log

**Monitoring Session**:
A browser-owned prototype session that plays or captures Camera sources and periodically submits sampled frames while the monitoring page is open.
_Avoid_: Camera stream, processing job

**Camera Runtime State**:
The replaceable current connection and sampling state for a Camera; it is operational status, not historical Camera identity.
_Avoid_: Camera lifecycle, Camera history

## Cleanliness operations

**AI Observation**:
The structured result of analyzing one sampled frame, including people count, floor hazards, and registered-bin states.
_Avoid_: Alert, task, flag

**Flag**:
An internal, persisted qualification record showing that one Camera issue observation passed its confidence, magnitude, and issue-specific gates; Flags feed temporal Alert policy but have no standalone user page.
_Avoid_: Alert, raw detection, Supervisor flag page

**Alert**:
A camera-scoped cleanliness condition created or updated when its issue-specific Flag pattern proves that cleanup is required.
_Avoid_: Detection, model result

**Waiting Alert**:
An active Alert with no Work Order because no eligible Cleaner is currently available.
_Avoid_: Unassigned work, queued task

**Alert Evidence**:
The highest-confidence qualifying frame and geometry retained to explain an Alert.
_Avoid_: Continuous footage, annotated image

**Completion Evidence**:
A Cleaner-supplied photo required for reviewing coordinate-targeted manual Work that has no Camera.
_Avoid_: Alert Evidence, continuous footage

**Bin Placement Intervention**:
The timestamped event created when a Supervisor marks a Zone recommendation as implemented; it separates before and after analytics.
_Avoid_: Recommendation generation time, exact bin coordinate

**Bin Service Alert**:
One Alert issue covering a registered bin that is full or overflowing; overflow escalates the same cleanup need rather than opening a second Alert.
_Avoid_: Separate full-bin alert, overflow episode

**Work Order**:
An assigned cleaning job created only when one Cleaner has been selected, or created and assigned manually by a Supervisor.
_Avoid_: Alert, detection

**Management Mode**:
Whether an Alert-linked Work Order assignment is controlled by the Orchestrator or has been taken over by a Supervisor.
_Avoid_: User role, Work status

**Coordinate Target**:
A Work Order location defined by a point inside an active Zone without requiring a Camera.
_Avoid_: Camera target, zone-only target

**Verification**:
An explicit post-cleaning review that evaluates fresh evidence and produces passed, failed, or inconclusive; ordinary negative observations do not resolve Alerts.
_Avoid_: Auto-resolution, cleaner completion

**In-App Notification**:
A durable user-targeted event that appears immediately in connected LitterSpot clients and remains available in the notification inbox.
_Avoid_: Browser push, email, transient toast only

**Busy Zone**:
A current Zone ranking that combines recent people activity with severity-weighted active cleaning work.
_Avoid_: Crowd count, dirty Zone score

**Bin Placement Snapshot**:
The replaceable calculated Zone ranking shown until the next daily or manual refresh; it is not an accepted recommendation record.
_Avoid_: Bin Placement Intervention, pending recommendation
