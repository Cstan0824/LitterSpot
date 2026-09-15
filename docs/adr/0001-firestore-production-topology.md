---
status: accepted
---

# Use site-scoped top-level collections and revision-pointer maps

LitterSpot keeps queryable operational records in top-level Firestore collections and requires `siteId` on every tenant-owned document. Append-only histories and large map geometry sets use subcollections. A Site selects its complete current map through one `activeMapRevisionId` pointer, so publication is atomic without rewriting every operational document. This avoids deeply nested tenant paths, keeps Superadmin cross-Site queries practical, and preserves immutable historical geometry. The trade-off is that the backend must enforce Site isolation consistently and join active revision geometry when it builds API responses.

## Production Firebase target

The production target is Firebase project `litterspot`, Firestore database
`(default)`. Application document paths, Authentication UIDs, map and Camera
Registration history, and media keys use the production schema. Media remains
on the Node host, so Firebase Storage and Blaze billing are not part of this
architecture.
