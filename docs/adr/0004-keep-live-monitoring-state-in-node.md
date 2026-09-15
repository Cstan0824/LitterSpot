---
status: accepted
---

# Keep live monitoring state in the Node process

LitterSpot runs one Node backend, while a Supervisor-owned browser samples enabled Cameras at an adaptive cadence. Monitoring leases, frame sequence, current runtime freshness, rolling qualification windows, evidence candidates, and partial Camera Verification samples stay in Node memory. Firestore records configuration and material transitions such as episode start/end, first online/error state, confirmed Flags, Alerts, completed Verification outcomes, and minute analytics summaries. This prevents ordinary frames from consuming Firestore operations. A Node restart discards unfinished live windows and starts fresh Camera episodes, but recovery reloads durable Camera Verification requests and never loses Alerts, Work Orders, evidence, or configuration.
