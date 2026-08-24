# Isolated assignment database

`assignment_simulation.json` is the initial mock database for the task
assignment LLM. It is intentionally separate from LitterSpot's existing SQLite
database.

The JSON document contains:

- a fixed simulation time and timezone;
- registered zones and their relative distance ranks;
- cleaners and recurring work schedules;
- alerts that are assumed to have already been created; and
- current tasks used to derive availability and workload.

For the initial implementation:

- `ASSIGNED` and `IN_PROGRESS` tasks count toward workload;
- a scheduled cleaner with an `IN_PROGRESS` task is busy;
- `PENDING_VERIFICATION` and `COMPLETED` tasks do not count toward workload;
- `TASK-001` is the unassigned task the agent will eventually process.

The application should load and validate the whole document before exposing
any data to an LLM tool. Writes should use a temporary file followed by an
atomic replacement so a failed write cannot leave partial JSON.
