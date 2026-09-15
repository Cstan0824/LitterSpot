---
status: accepted
---

# Let the Orchestrator select an Alert–Cleaner pair

Node supplies at most the top 10 waiting Alerts, every valid available Cleaner, calculated Station Point distances and a short-lived Recent Work Location hint. The assignment provider selects both IDs together while Node retains eligibility, geometry and transactional authority. This replaced the nearly redundant design where Node preselected one Alert and the model mostly chose the nearest Cleaner. The trade-off is a larger bounded context and pair-level conflict handling.
