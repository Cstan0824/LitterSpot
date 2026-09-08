---
status: accepted
---

# Let the Orchestrator select an Alert–Cleaner pair

Node will supply at most the top 10 waiting Alerts, every valid available Cleaner, calculated Station Point distances and a short-lived Recent Work Location hint. The LLM selects both IDs together while Node retains eligibility, geometry and transactional authority. This replaces the safer but nearly redundant design where Node preselected one Alert and the model mostly chose the nearest Cleaner; the trade-off is a larger context and more pair-level conflict handling in exchange for meaningful multi-Alert allocation reasoning.
