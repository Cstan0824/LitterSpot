# Registered-bin, lid-object, temporal-state, and floor-ROI prototype plan

Date: 2026-08-25

## 1. Outcome

Deliver a controlled prototype in which:

- an operator enrolls each physical bin once using one whole-bin polygon and a stable `binId`;
- a bin is never duplicated even when the generic localizer produces several boxes;
- an object resting on a lid cannot directly become a confirmed overflow alert;
- a final bin state requires two matching observations from the latest three frames;
- an unregistered bin-like candidate is reported as `unknown/unregistered_candidate` and cannot alert;
- litter and spill masks are accepted and plotted only inside the registered walkable-floor region;
- one confirmed event may create a provisional placement recommendation, but no automatic placement action.

This is a stable-mock prototype plan. It optimizes deterministic demonstration behaviour and low operator effort. General camera-movement alignment, production spill accuracy, and site-wide generalisation remain deferred.

## 2. Existing benchmark used as the regression baseline

The supplied mock image currently produces:

| Execution mode | Bin results | Floor results | Meaning |
| --- | ---: | ---: | --- |
| Legacy whole-frame inference | 2 candidates | 5 hazards | Demonstrates unrestricted false-positive exposure. |
| Registered inference | 1 result: `bin-1 → normal` | 2 hazards | Demonstrates that an enrolled polygon can replace generic bin discovery. |
| Draft or resolution-mismatched registration | 0 | 0 | Demonstrates fail-closed behaviour. |

The registered benchmark already used the bounding box of the enrolled body polygon as one whole-bin crop. Its rim and ground-ring fields were schema requirements but did not materially decide the returned state. The prototype can therefore simplify registration without losing the demonstrated mitigation.

## 3. Product decisions

### Required now

1. Replace manually drawn body/rim/lid/ground regions with one `binPolygon`, `binId`, and `binType` per physical bin.
2. Derive top, side, bottom, and exterior evidence zones automatically from that polygon.
3. Use a clean registered reference frame to distinguish top-only lid changes from waste extending outside the bin.
4. Confirm a final state with a two-of-three vote within five seconds.
5. Keep generic localization in shadow mode only to report unregistered candidates as `unknown`; it cannot enter state history, alerts, or recommendations.
6. Register and render one walkable-floor polygon with optional exclusions.
7. Allow a single **confirmed** event to create a provisional placement recommendation.

### Deferred

- Manual rim annotation and a dedicated rim segmentation model.
- Automatic camera alignment beyond the existing resolution gate.
- Cross-camera temporal history and long observation windows.
- Production-quality spill promotion.
- Automatic reference-image upload from the registration canvas.
- Training an `object_on_lid` specialist class.
- Automatic bin relocation or replacement actions.

## 4. Module design and seams

Keep the difficult behaviour behind three small interfaces.

### 4.1 `CameraRegistrationModule`

The Firestore seam owns schema validation, revisioning, reference-media ownership, and compatibility with existing registrations.

```ts
resolveForInference(cameraId: string): Promise<RegisteredCameraContext | null>
validate(cameraId: string, draft: RegistrationDraftV2): Promise<RegistrationValidation>
publish(cameraId: string, draft: RegistrationDraftV2, expectedRevision: number): Promise<RegisteredCameraContext>
```

Callers do not calculate polygons, inspect Firestore documents, or interpret revision conflicts.

### 4.2 `RegisteredSceneEvidenceModule`

The Python inference seam owns reference comparison, derived regions, bin evidence, shadow candidates, and floor masking.

```python
analyze(current_frame, reference_frame, registration, thresholds) -> FrameEvidence
```

Its interface returns evidence, not alerts or placement recommendations. The implementation hides brightness normalization, difference masks, region derivation, connected-component checks, and model fusion.

### 4.3 `TemporalBinDecisionModule`

The Node decision seam owns temporal state and alert eligibility.

```ts
observe(frameEvidence: FrameEvidence, capturedAt: Date): TemporalDecision
```

The module is a pure reducer for tests. Persistence and alert creation remain adapters outside the seam.

## 5. Registration schema version 2

```ts
type RegistrationDraftV2 = {
  schemaVersion: 2;
  referenceMediaId: string;
  sourceWidth: number;
  sourceHeight: number;
  walkableFloorPolygon: Point[];
  exclusionPolygons: Point[][];
  bins: Array<{
    binId: string;
    displayName: string;
    binType: "lidded" | "open_top" | "unknown";
    binPolygon: Point[];
  }>;
  quality: {
    maxFrameAgeSeconds: number;
  };
};
```

Invariants:

- coordinates are normalized to `0..1`;
- `binId` is unique within one camera;
- every bin has exactly one valid polygon;
- the registered reference belongs to the same active camera;
- a bin polygon must be inside the frame;
- the walkable-floor polygon must be valid;
- exclusion polygons are optional;
- derived evidence zones are never stored or drawn by the operator.

Compatibility rule:

- read an existing version-1 `bodyPolygon` as version-2 `binPolygon`;
- ignore version-1 rim, lid, and ground-ring geometry during prototype inference;
- all new publishes write version 2;
- retain immutable version-1 revisions for audit and replay.

## 6. Whole-bin identity and duplicate prevention

For a registered camera, the enrolled polygon is the only authoritative bin identity.

1. Create one classification crop from `binPolygon`.
2. Emit exactly one primary observation for `cameraId + binId` per frame.
3. Do not turn generic-localizer boxes into primary bins.
4. If multiple model boxes overlap the same polygon, merge them into the same registered observation.
5. Sort output consistently by the registration order so replay results are deterministic.

The generic localizer may run in shadow mode for unregistered-candidate reporting:

```text
candidate overlaps a registered polygon sufficiently
    → discard shadow candidate; registered result is authoritative

candidate does not match any registered polygon
    → unknown/unregistered_candidate
    → confirmed=false
    → alertEligible=false
    → excluded from temporal history and placement analysis
```

The frontend should label these as “Unregistered candidate,” not as a confirmed bin. This limits the damage if a chair is still proposed by the generic model.

## 7. Lid-object mitigation

### 7.1 Automatically derived zones

For each whole-bin polygon, calculate:

- `topZone`: upper 30% of the bin bounds;
- `bodyZone`: the complete registered polygon;
- `sideZone`: 12% expansion to the left and right, excluding the bin polygon;
- `bottomZone`: 15% expansion below the bin;
- `contextCrop`: the union of the bin and expanded zones.

Clamp every derived zone to the image. These percentages live in one prototype configuration file and are not scattered through callers.

### 7.2 Reference comparison

For the current and clean reference crops:

1. verify matching dimensions;
2. convert to grayscale;
3. apply a small blur;
4. normalize average brightness;
5. calculate an absolute-difference mask;
6. remove isolated noise with morphological opening;
7. calculate changed-area ratios for the top, side, and bottom zones;
8. detect whether a changed component crosses from the bin boundary into an exterior zone.

### 7.3 Evidence policy

Initial mock-calibration defaults:

```text
top-change threshold:       0.08
side-change threshold:      0.04
bottom-change threshold:    0.03
exterior-noise ceiling:     0.02
model overflow threshold:   0.55
```

Decision rules:

```text
top change is present
+ exterior change is below the noise ceiling
    → state=review
    → reason=lid_obstruction
    → alertEligible=false

model proposes overflow
+ side or bottom evidence is present
+ a changed component crosses the registered bin boundary
    → stateCandidate=overflow

model proposes overflow
+ no exterior evidence
    → state=review
    → reason=overflow_without_exterior_evidence
    → alertEligible=false

registration/reference is invalid
    → state=unknown
    → alertEligible=false
```

An object on the lid may persist for three frames, so temporal voting is applied only after this spatial evidence policy. Temporal agreement cannot turn `lid_obstruction` into overflow.

## 8. Temporal decision policy

Use a one-second sampling interval for the stable mock videos.

```text
identity: cameraId + binId
history: latest 3 observations
maximum history age: 5 seconds
confirmation: at least 2 matching eligible candidates
gap reset: more than 5 seconds
```

Rules:

- two of the latest three eligible states must agree;
- `unknown`, `review`, and `unregistered_candidate` do not vote for overflow;
- a registration revision change resets the history;
- duplicate frames do not increase the vote count;
- a single uploaded image may show a provisional candidate but cannot create a confirmed bin alert;
- a confirmed overflow result records the contributing frame IDs and timestamps.

Output contract:

```ts
type TemporalDecision = {
  cameraId: string;
  binId: string | null;
  state: "normal" | "overflow" | "review" | "unknown";
  reason: string;
  confirmed: boolean;
  matchingFrames: number;
  observedFrames: number;
  alertEligible: boolean;
};
```

## 9. Walkable-floor plotting and filtering

The frontend registration canvas draws:

- the walkable-floor polygon;
- optional exclusion polygons;
- registered whole-bin polygons with their `binId` labels.

Inference applies the floor geometry before accepting a litter or spill result:

1. crop/mask inference to the walkable-floor polygon;
2. subtract exclusion polygons;
3. require the hazard-mask centroid to be inside valid floor;
4. require at least 60% of the hazard mask to overlap valid floor;
5. reject masks overlapping registered bins, people, furniture, or excluded areas beyond the configured limit;
6. return accepted mask polygons for overlay rendering.

The result screen uses different styling for registered floor, exclusions, accepted litter, and accepted spill. Rejected raw model proposals remain available only in development diagnostics.

## 10. Placement recommendation

A single **confirmed** overflow, litter, or spill event may trigger the existing recommendation calculation.

The output remains explicitly provisional:

```json
{
  "recommended": true,
  "provisional": true,
  "trigger": "single_confirmed_event",
  "automaticAction": false
}
```

`review`, `unknown`, and unregistered candidates cannot trigger it. The recommendation is displayed to the supervisor and does not mutate camera registration or bin placement.

## 11. Implementation stages

### Stage A — contracts and version compatibility

- Add registration schema version 2.
- Add the version-1-to-version-2 read adapter.
- Add `binId`, evidence reason, and alert-eligibility fields to inference contracts.
- Add prototype thresholds to versioned configuration.

Exit condition: existing version-1 registrations replay as one whole-bin polygon without republishing.

### Stage B — registration frontend

- Replace body/rim/lid/ground tools with one **Outline physical bin** tool.
- Require `binId`, display name, and simple bin type.
- Keep floor and exclusion drawing.
- Render `binId` directly on the enrolled polygon.
- Update validation and publish messages for schema version 2.

Exit condition: a user can register two bins and one floor region without drawing subregions.

### Stage C — registered evidence and lid mitigation

- Load the reference image through the existing media adapter.
- Extend frame inference to include the reference frame for registered cameras.
- Implement automatic zones and normalized reference difference.
- Fuse spatial evidence with the existing state-classifier score.
- Return `lid_obstruction`, `overflow_without_exterior_evidence`, and `registration_not_ready` reasons.

Exit condition: the selected lid-object mock never returns alert-eligible overflow.

### Stage D — temporal decision

- Extend the existing video-bin tracking implementation rather than introduce a second tracker.
- Key history by `cameraId + binId + registrationRevision`.
- Implement the two-of-three/five-second reducer.
- Persist contributing frame evidence with the confirmed decision.

Exit condition: overflow confirms within three seconds, while one-frame and conflicting results remain unconfirmed.

### Stage E — unregistered shadow candidates

- Compare shadow-localizer candidates with registered polygons.
- Emit unmatched candidates as `unknown/unregistered_candidate`.
- Exclude them from tracking, alerts, analytics, and placement recommendations.

Exit condition: an unregistered mock bin is visible as unknown but produces no alert; duplicated boxes over `bin-1` still produce one registered result.

### Stage F — floor ROI and overlays

- Apply the registered floor mask and exclusions in AI inference.
- Add centroid and 60%-overlap acceptance checks.
- Plot floor geometry and accepted hazard masks in image/video results.

Exit condition: an object outside the floor region produces no displayed floor hazard.

### Stage G — recommendation integration

- Permit one confirmed eligible event to invoke the recommendation calculation.
- Mark every result provisional and non-automatic.
- Show the triggering event and evidence reason.

Exit condition: confirmed overflow creates one recommendation; review and unknown results create none.

## 12. Stable mock validation suite

Use fixed files and fixed registration revisions so every run is reproducible.

| Mock case | Expected result |
| --- | --- |
| Normal registered lidded bin | `normal`, one `binId`, no alert |
| Object resting only on lid | `review/lid_obstruction`, no alert |
| Genuine waste extending down a side | overflow candidate; confirm after two matching frames |
| Genuine waste below bin | overflow candidate; confirm after two matching frames |
| One overflow-looking frame followed by normal frames | unconfirmed, no alert |
| Two model boxes on one enrolled bin | one result with the enrolled `binId` |
| Unregistered physical bin | `unknown/unregistered_candidate`, no alert |
| Chair proposed by shadow localizer | `unknown/unregistered_candidate`, no alert |
| Litter inside walkable floor | accepted and plotted |
| Litter-like object on table/outside ROI | rejected |
| Draft registration | `unknown/registration_not_ready`, no alert |
| Resolution mismatch | `unknown/registration_frame_dimensions_mismatch`, no alert |

## 13. Prototype acceptance metrics

- 0 confirmed overflow alerts from the stable lid-object mock set.
- 0 alerts from unregistered or shadow-only candidates.
- 0 duplicate primary bin results for the same `cameraId + binId + frame`.
- 100% registered-bin identity retention on the stable mock set.
- Confirmed overflow latency no greater than three sampled seconds.
- 0 displayed floor hazards whose centroid is outside the registered floor.
- Identical decisions across three consecutive replays of every mock video.
- Frontend, backend, AI process, and Firestore emulator remain healthy during the complete replay.

## 14. Principal weaknesses and prototype controls

| Weakness | Prototype control |
| --- | --- |
| Large lid object hangs down the side and resembles overflow | Require boundary-crossing plus bottom/side evidence; otherwise return review. |
| Genuine overflow stays only on top | Accept possible false negative for the prototype; route to review instead of alert. |
| Lighting change creates reference differences | Normalize brightness and require connected exterior evidence. |
| Shadow localizer calls a chair an unregistered bin | Label it candidate/unknown and prohibit every downstream action. |
| Spill model remains weak | Keep its result provisional and spatially restricted to the floor ROI. |
| Fixed thresholds overfit the selected mocks | Store thresholds in versioned configuration and state clearly that they are not production calibration. |

## 15. Definition of done

The plan is complete when all stable mock cases pass, the three processes and Firestore run together, the results show enrolled `binId` and floor polygons, the lid-object replay cannot alert, the two-of-three history is visible in the result, and a single confirmed event can create only a provisional recommendation.
