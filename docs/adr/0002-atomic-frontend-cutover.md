---
status: accepted
---

# Cut over the production backend and first wired frontend together

The production backend will not be merged into `main` while the frontend team still depends on legacy APIs and hardcoded data. After backend Phases 9–11 and the frontend team's complete first UI delivery, the integration branch will wire that frontend to the production contracts, retire legacy consumers, organize the repository and merge one working system. This increases the size of the cutover PR but prevents `main` from entering a known broken state and lets later frontend work build and test directly against stable production contracts.
