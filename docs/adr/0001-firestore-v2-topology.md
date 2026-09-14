---
status: accepted
---

# Use site-scoped top-level collections and revision-pointer maps

LitterSpot V2 keeps queryable operational records in top-level Firestore collections and requires `siteId` on every tenant-owned document. Append-only histories and large map geometry sets use subcollections. A Site selects its complete current map through one `activeMapRevisionId` pointer, so publication is atomic without rewriting every operational document. This avoids deeply nested tenant paths, keeps Superadmin cross-Site queries practical, and preserves immutable historical geometry. The trade-off is that the backend must enforce Site isolation consistently and join active revision geometry when it builds API responses.

## Final Firebase target, 2026-09-14

The owner selected the original Firebase project `litterspot` as the final cloud
target. Its backed-up V1 named database was replaced by `(default)` in
`asia-southeast1`. The latest persistent emulator data is copied with preserved
document paths, Auth UIDs, map and Camera Registration history, and media keys.
Only the schema marker and cross-project document-reference targets change.
Media remains on the Node host so this cutover does not require Firebase
Storage or a Blaze billing account. The prior `litterspot-v2-database` project
is not a migration source and is left untouched.
