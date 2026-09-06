# Camera wall controls completed brief

## Completed behavior

- Removed the Camera summary strip beneath the Zone filters.
- Added a right-aligned Both, Enabled, and Disabled filter with live counts.
- Kept the whole Camera card as the Camera Details target.
- Added a separate Enable or Disable button to each card footer.
- Separated the footer condition state from the video-stage runtime state.
- Corrected Zone indicators to use unresolved Alert severity before Camera online state.
- Preserved Camera wall Zone and monitoring-state filters after viewing Camera Details.
- Returned Camera links opened from Work to the Work queue.
- Returned Camera links opened from Cleaner management to the Team page.
- Left exact analyzed-frame overlays unchanged. Smooth synchronized overlays remain deferred.

## Verification

The browser check confirmed:

- enabling Camera 1 from its card did not open Camera Details;
- Enabled filtering reduced the wall to Camera 1 and updated the URL;
- Camera 1 produced an analyzed frame with overlays and showed Online;
- opening the card and returning restored the Enabled filter;
- opening Camera 1 from Work showed Back to Work and returned to the Work queue;
- disabling Camera 1 removed it from the Enabled-only result and restored both Cameras to disabled.

Automated route-origin tests live in `frontend/src/features/operations/CameraOperationsPage.test.ts`.
