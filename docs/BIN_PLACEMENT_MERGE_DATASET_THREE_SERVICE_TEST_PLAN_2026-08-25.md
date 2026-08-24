# Bin Placement Merge, Held-Out Dataset, and Three-Service Test Plan

Date: 2026-08-25

## Objective

Merge the short-window bin-replacement work with the current remote product
architecture, discover legally usable evaluation data that is not already in
the training corpus, install the AI runtime, and validate FastAPI, Node, and
React together. Testing must use held-out data and must not silently promote a
provisional placement rule to an operational dispatch decision.

## Gate 0: approved architecture

The local branch and `origin/main` implement different product architectures:

- The local work uses SQLite-backed minute observations and exposes dedicated
  placement and operations routes.
- `origin/main` removes those modules and uses authenticated Node/Firebase
  workflows, Firestore analysis records, processing jobs, and priority-zone
  analytics.

The approved direction is:

1. `origin/main` and its authenticated Firebase/Firestore workflow are the
   product foundation and final source of truth.
2. The ten-minute replacement policy is ported as a pure deep module whose
   interface accepts recent zone observations and returns one explainable
   recommendation. It does not know about SQLite or Firestore.
3. A Firestore adapter loads eligible observations and persists the latest
   recommendation/audit metadata. Node owns this adapter and the authenticated
   external interface.
4. The legacy SQLite implementation may be used temporarily as a local fallback
   and comparison oracle during the port. It must not become an externally
   visible second source of truth.
5. Before any push, the SQLite fallback, its routes, settings, migrations, and
   runtime configuration are removed. The final branch contains only the pure
   policy, Firestore adapter, and in-memory test adapter.

The temporary fallback is therefore a migration mechanism, not a supported
product mode.

## Phase 1: protect and merge the work

1. Create a `codex/` integration branch; do not merge directly on a dirty
   `main` branch.
2. Separate source/config/test/document changes from generated evidence,
   downloaded models, training caches, and prepared datasets.
3. Commit the intended local feature set in reviewable local commits:
   - inference and stability pipeline;
   - short-window placement policy and contracts;
   - frontend/backend integration;
   - tests, mock timelines, and documentation.
4. Start a clean integration worktree at `origin/main` and merge/cherry-pick
   the reviewable commits there. Preserve the Firestore/authentication changes
   whenever a deleted legacy route conflicts with the remote architecture.
5. Resolve technical conflicts immediately. For conflicts that change storage,
   authentication, alert semantics, or the meaning of a recommendation, record
   both choices and request approval; continue with unrelated conflicts.
6. Build all JavaScript workspaces after the merge. The merged integration
   branch becomes the only branch used for subsequent tests.

## Phase 1A: port the placement module to Firestore

1. Define the pure policy interface:

   ```text
   evaluateReplacement(observations, previousDecision, policy, evaluatedAt)
     -> PlacementRecommendation
   ```

   It hides minute collapsing, state-quality gates, hazard episode
   deduplication, score calculation, and raise/clear hysteresis.
2. Define one repository seam used by the Node orchestration module:

   ```text
   loadRecentZoneObservations(zoneId, start, end)
   loadPreviousRecommendation(zoneId)
   saveRecommendation(zoneId, recommendation)
   ```

3. Implement the production Firestore adapter using operational, non-test,
   analytics-eligible analysis records. Add the required composite indexes and
   enforce site/zone authorization before repository access.
4. Implement an in-memory adapter for policy/orchestration tests.
5. Temporarily adapt the current SQLite evaluator behind the same internal seam
   for local dual-run comparisons. Firestore remains the served answer; SQLite
   output is diagnostic-only and never written back into Firestore.
6. Compare both implementations on the deterministic timelines and a small
   local replay. Record every mismatch before removing the fallback.
7. Remove the SQLite adapter and all reachable SQLite placement code after the
   Firestore adapter passes the agreed public seams.

## Phase 2: discover a genuinely held-out evaluation set

1. Inventory every current source manifest, URL, source ID, checksum, and split
   under `dataset/`, `ml-training/data/`, `mock-data/`, and the research notes.
2. Build an exclusion index containing exact hashes, perceptual hashes, source
   URLs, dataset IDs, and near-duplicate video frame groups.
3. Research primary dataset repositories for missing domains:
   - small indoor waste baskets and open-top bins;
   - outdoor/theme-park-like public bins at CCTV distance;
   - partial occlusion, chairs/carts/signage, and other bin hard negatives;
   - normal, full, confirmed overflow, and object-on-lid cases;
   - litter and wet/spill surfaces near bins;
   - sparse and crowded pedestrian scenes.
4. Verify license, redistribution conditions, annotations, and stable source
   identifiers before download.
5. Acquire only a compact evaluation subset first. Keep it outside every
   training preparation path and mark it `evaluation_only`.
6. Reject exact and near duplicates against all training and mock data.
7. Produce a manifest with provenance, expected labels, review status, and an
   explicit assertion that no accepted item was used for training.

Prototype target: at least 30 independently sourced scenes, including at least
10 bin hard negatives, 10 bin-state cases, and 10 floor/occupancy context
cases. This is a diagnostic benchmark, not a statistical production claim.

## Phase 3: install and verify the AI runtime

1. Use the project `.venv` (Python 3.12.4) and upgrade packaging tools.
2. Install `ai-service/requirements.txt`; do not install into the global Python
   environment.
3. Record installed versions for Torch, torchvision, Ultralytics, OpenCV,
   Transformers, FastAPI, Pillow, and CUDA availability.
4. Verify the existing InternVL3.5-1B checkpoint with its lock metadata and a
   local load-only smoke check.
5. Run the full AI test suite. Dependency/import failures are environment
   failures; inference-contract or metric failures are product failures.

## Phase 4: agreed public test seams

The durable tests target these public boundaries:

1. **FastAPI seam:** `/health`, `/analyze/frame`, and the merged placement
   evaluation interface return validated contracts and fail closed when models
   or coverage are unavailable.
2. **Node seam:** authenticated upload/processing and placement endpoints
   validate AI responses and persist/read through the selected product store.
3. **Browser seam:** the React UI can submit an evaluation item and displays
   `replacement_recommended`, `keep_current_bin`, or
   `insufficient_evidence` with score and coverage evidence.

New regression tests are added one vertical slice at a time against these
seams. Existing implementation-level tests remain useful but are not accepted
as end-to-end proof.

## Phase 5: run all three services

1. Confirm ports 8000, 3000, and 5173 are free and no stale local stack is
   running.
2. Start FastAPI, Node, and React with the merged configuration.
3. Require successful FastAPI health, Node readiness, and Vite page load.
4. Submit held-out stills and sampled video frames through Node rather than
   calling Python directly.
5. Verify response validation, persistence, authentication, UI rendering, and
   recommendation hysteresis across consecutive minute observations.
6. Stop all services cleanly and retain sanitized logs and benchmark output.

## Phase 5A: legacy removal and pre-push gate

1. Disable the temporary fallback and rerun the complete suite with Firestore
   as the only placement store.
2. Remove the SQLite placement tables/migrations, routes, client calls,
   environment flags, fallback adapter, and related documentation.
3. Prove removal with repository searches for `placement_state`,
   `set_window_days`, `set_window_minutes`, the SQLite placement adapter name,
   and the temporary fallback flag. Any remaining match must be a historical
   migration note or an explicit negative test.
4. Squash or rebase local migration commits so the branch being pushed never
   introduces the temporary SQLite fallback as a supported feature.
5. Run AI tests, backend tests/build, frontend build, Firestore emulator tests,
   three-service smoke tests, and `git diff --check` again.
6. Review the exact pushed diff and confirm that downloaded datasets, model
   weights, evidence images, local databases, `.venv`, and credentials are not
   tracked.
7. Only then push the commits. Do not push an intermediate fallback commit.

## Phase 6: metrics and mitigation loop

Report metrics by source and scenario, not just an overall average:

- bin localization precision, recall, and chair/cart/sign false-positive rate;
- bin-state confusion matrix and normal/full/overflow/unknown macro F1;
- confirmed-overflow precision and object-on-lid false-positive rate;
- litter/spill precision and recall;
- people-count MAE or count-band accuracy;
- placement decision precision, false-recommendation rate, insufficient-data
  rate, and time-to-raise/time-to-clear.

Loop 1 records the untouched merged baseline. Loop 2 applies only the smallest
mitigation supported by Loop 1 evidence: threshold calibration, hard-negative
gating, stable-state coverage changes, or source-specific model improvement.
The same held-out set is rerun without moving any sample into training.

## Completion criteria

- Firestore is the only product source of truth for placement observations and
  recommendations.
- The integration branch contains a completed merge with no unresolved files.
- No SQLite placement adapter, route, schema, migration, or fallback flag is
  present in the pushed commit set.
- AI dependencies install reproducibly in `.venv`.
- The held-out manifest proves source and near-duplicate separation.
- All three services pass health/readiness checks together.
- The public-seam tests and builds pass.
- The benchmark report includes Loop 1, Loop 2, remaining failure cases, and a
  clear statement that the prototype is or is not safe for further field trial.
