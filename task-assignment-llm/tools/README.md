# Assignment tools

These functions are the only task-assignment operations exposed to an LLM:

- `get_alert(alert_id)` reads the alert and its current task.
- `list_cleaner_candidates(alert_id)` returns scheduled, active cleaners with
  their zone distance, availability, and current workload.
- `assign_task(alert_id, cleaner_id)` validates and saves one assignment.

The tools never expose a file path, database credential, or raw query to the
model. The current implementation reads the isolated JSON simulation selected
by `ASSIGNMENT_SIM_DATABASE_PATH`. If the variable is unset, it uses
`database/assignment_simulation.json`.

All tool results contain an `ok` boolean. Failures also contain a stable error
`code` and a human-readable `message` so an agent can stop or retry safely.
