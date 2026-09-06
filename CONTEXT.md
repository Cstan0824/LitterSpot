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

**Site Map Boundary**:
The user-defined rectangular extent of a Site Map in real metres. Its width and height define the valid coordinate range independently of the size or shape of any on-screen viewer.
_Avoid_: Map viewer size, uploaded image dimensions

**Map Viewer**:
A fixed on-screen window onto a Site Map Boundary. Fit, zoom, and pan change which part of the map is visible but never change Site dimensions, geometry, or stored metre coordinates.
_Avoid_: Site Map Boundary, image crop

**Site Background Alignment**:
The scale and position that place one uploaded Site background image within the Site Map Boundary without changing the boundary's real dimensions.
_Avoid_: Repeating grid tile, Site dimensions

**Site Map Revision**:
An immutable published version or editable draft of the Site Map dimensions, background, Zone geometry, Camera Placement, and Cleaner Station Points.
_Avoid_: Site version, floor

**Active Map Revision**:
The one published Site Map Revision that defines the Site's current dimensions, Zones, Camera Placements, and Cleaner Station Points.
_Avoid_: Current map cache, latest draft

**Cleaner Map Projection**:
The deliberately limited active-map view sent to one authenticated Cleaner: map dimensions, Zone geometry, and only that Cleaner's Station Point. Coordinate Work carries its own point separately; Camera Placements, map drafts, and other Cleaners' Station Points are excluded.
_Avoid_: Full Site Map editor, Supervisor map read model, live location feed

**Camera Draft**:
A non-operational workspace for creating a Camera or replacing its source and Registration; only publication changes the operational Camera.
_Avoid_: Incomplete Camera, temporary Camera

**Zone**:
A spatially disjoint polygon inside one Site Map Revision that groups Camera Placements, observations, Alerts, and Work Orders. Active Zone interiors and boundaries may not overlap, cross, share an edge, or touch at a point. A Cleaner may have a nearest Zone for display context, but does not belong to or become restricted by a Zone.
_Avoid_: Area, region

**Camera Placement**:
The Camera's physical point inside exactly one active Zone on the Site Map.
_Avoid_: Camera registration, camera ROI

**Map Position Correction**:
A correction to a Camera's recorded Site Map coordinate when the physical Camera and its view did not move; the existing Camera Registration remains valid.
_Avoid_: Physical Camera Move, Camera reconfiguration

**Physical Camera Move**:
A change to the Camera's real installation position or view. It changes Camera Placement and requires a new reference and Camera Registration before the replacement configuration becomes operational.
_Avoid_: Map Position Correction, source-only replacement

**Camera Creation**:
One Root Supervisor workflow that combines Camera identity, Site Map placement, source configuration, reference capture, floor/bin plotting, validation, and initial Camera Registration publication.
_Avoid_: Bare camera record, create-then-register

**Simulation Camera**:
A structurally active Camera backed by a looped video whose monitoring remains disabled until deliberately enabled for a demonstration.
_Avoid_: Live CCTV camera, automatically active test source

**Demo Source Scene**:
A developer-controlled prerecorded view for a Simulation Camera, used to visibly mimic the same live view changing between clean and issue conditions without changing the Camera Registration or interrupting monitoring continuity. The selected scene appears in normal Camera views, but its selection control is not part of the Supervisor product.
_Avoid_: Camera reconfiguration, live Camera source, System page feature

**Camera Registration**:
The Camera-view configuration containing a reference frame, visible walkable-floor polygon, and optional physical-bin polygons; initial Registration is mandatory within Camera Creation.
_Avoid_: Camera placement, zone registration

**Cleaner Station Point**:
The fixed in-boundary Site Map coordinate assigned to a Cleaner and their default assignment origin; it may be inside a Zone or an unzoned part of the Site. A fresh Recent Work Location may temporarily supplement it while the Cleaner returns.
_Avoid_: Assigned Zone, GPS location, live location, home address

**Nearest Zone**:
The active Zone whose boundary has the shortest straight-line map distance from a Cleaner Station Point. It is display context only; it does not determine Cleaner eligibility or restrict assignments.
_Avoid_: Cleaner jurisdiction, assigned Zone, allowed Zone

**Recent Work Location**:
The target snapshot of a Cleaner's most recently resolved Work Order, used for a short period as an approximate returning-to-station assignment signal; it is not live tracking.
_Avoid_: Current GPS position, Cleaner check-in, permanent Station Point

**Assignment Pair**:
One waiting Alert and one available Cleaner selected together by the Orchestrator from a bounded, backend-validated assignment context.
_Avoid_: Preselected Alert plus Cleaner choice, unvalidated model assignment

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
A Supervisor-console-owned prototype session that plays or captures enabled Camera sources and periodically submits sampled frames while at least one authenticated Supervisor console is open. It continues across page navigation and stops after the last Supervisor console disappears. Cleaner mobile sessions never own or keep it alive.
_Avoid_: Camera stream, processing job

**Camera Runtime State**:
The replaceable current connection and sampling state for a Camera; it is operational status, not historical Camera identity.
_Avoid_: Camera lifecycle, Camera history

## Cleanliness operations

**AI Observation**:
The structured result of analyzing one sampled frame, including people count, floor hazards, and registered-bin states.
_Avoid_: Alert, task, flag

**Detection Signal**:
A transient issue result from one AI Observation. Detection Signals feed rolling qualification in memory and are not durable operational history.
_Avoid_: Flag, Alert, persisted detection event

**Flag**:
A durable internal record created when rolling, issue-specific qualification confirms a cleanliness condition. One continuing condition does not create a new Flag for every sampled frame, and Flags have no standalone user page.
_Avoid_: Alert, raw detection, Supervisor flag page

**Alert**:
A camera-scoped cleanliness condition created or materially updated from a confirmed Flag when cleanup is required.
_Avoid_: Detection, model result

**Waiting Alert**:
An active Alert with no Work Order because no eligible Cleaner is currently available.
_Avoid_: Unassigned work, queued task

**Alert Evidence**:
The highest-confidence qualifying frame retained to explain an Alert, together with the complete model detection geometry needed to reconstruct every overlay from that frame.
_Avoid_: Continuous footage, annotated image

**Completion Evidence**:
A Cleaner-supplied photo required before any Supervisor-created Manual Work can enter review, whether its target is a Camera or a Site Map coordinate.
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
A Work Order location defined by a point inside the Site Map boundary without requiring a Camera. It may belong to one active Zone or to an Unzoned Area.
_Avoid_: Camera target, zone-only target

**Unzoned Area**:
The part of the Site Map boundary outside every active Zone. A Supervisor may place coordinate-targeted Manual Work there; the Work keeps its exact point and has no Zone identity.
_Avoid_: nearest Zone, implicit Zone, outside the Site

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
