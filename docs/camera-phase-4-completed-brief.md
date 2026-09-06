# Camera phase 4 completion

Live configuration is available at `GET /api/monitoring/live/config`. Authenticated event streaming is available at `GET /api/monitoring/live/events`, using a Bearer header and fetch streaming. Connections expire after 50 seconds so reconnection revalidates credentials and Site access.

Observations carry episode, sequence, captured time, image dimensions, playback generation, source time, and Registration identity. Box coordinates are image pixels. The corresponding JPEG and observation travel together. A bounded transient cache supplies late viewers with the latest frame; frames expire after 15 seconds and the cache is capped at 32 MiB. Ordinary frames are not persisted.

Alert Evidence now includes all people, bins, and issues belonging to the selected frame, with image dimensions and a complete observation. Candidate frames expire after leaving the rolling sample window or 30 seconds. Ephemeral delivery and expanded evidence tests passed, including Site isolation.

Rendering tests must compare boxes against the retained frame itself. Smooth source playback must never reuse an unrelated frame's coordinates.
