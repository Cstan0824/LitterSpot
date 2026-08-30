---
status: accepted
---

# Use site-scoped top-level collections and revision-pointer maps

LitterSpot V2 keeps queryable operational records in top-level Firestore collections and requires `siteId` on every tenant-owned document. Append-only histories and large map geometry sets use subcollections. A Site selects its complete current map through one `activeMapRevisionId` pointer, so publication is atomic without rewriting every operational document. This avoids deeply nested tenant paths, keeps Superadmin cross-Site queries practical, and preserves immutable historical geometry. The trade-off is that the backend must enforce Site isolation consistently and join active revision geometry when it builds API responses.
