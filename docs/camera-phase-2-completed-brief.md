# Camera phase 2 completion

Monitoring start is idempotent for the current Camera, source, Registration, and owner. Repeating it returns the same episode and next sequence without clearing temporal observations. One Site owner may start episodes for multiple Cameras. Samples now explicitly require the episode to belong to the active session. Inference rechecks Camera and ownership before producing operational observations, protecting disablement and reconfiguration during an in-flight request.

A process-wide queue admits one executing frame and at most one pending frame per Camera, with a 32-Camera pending limit. New pending frames replace older ones without moving that Camera ahead of others. Overload returns 429 before sequence consumption.

Camera stop is separate from Site session release. Disablement ends only the affected episode. Queue tests and the existing five monitoring emulator workflows passed, including idempotent resume and duplicate rejection.

Test `POST /api/monitoring/sessions/:sessionId/cameras/:cameraId/start` twice: episode ID must match and nextSequence must advance after samples. Repeat for a second enabled Camera under the same lease.
