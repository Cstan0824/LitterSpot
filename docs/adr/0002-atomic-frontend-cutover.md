---
status: accepted
---

# Cut over the production backend and first wired frontend together

The production backend and first wired frontend were integrated in one cutover. The integration connected the delivered frontend to production contracts and retired legacy consumers before merging to `main`. This increased the cutover size but prevented `main` from containing a frontend and backend that could not operate together.
