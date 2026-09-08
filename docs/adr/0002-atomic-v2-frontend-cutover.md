---
status: accepted
---

# Cut over V2 backend and first wired frontend together

The V2 backend will not be merged into `main` while the frontend team still depends on V1 APIs and hardcoded data. After backend Phases 9–11 and the frontend team's complete first UI delivery, the integration branch will wire that frontend to V2, retire V1 consumers, organize the repository and merge one working system. This increases the size of the cutover PR but prevents `main` from entering a known broken state and lets later frontend work build and test directly against stable V2 contracts.
