# Camera phase 7: product Camera integration

Melissa's Camera wall, Zone filters, grid controls, detail layout, assignment, history and System trace remain the page structure. The wall and detail now consume one shared Camera feed. Zone filtering affects presentation only.

Camera Details includes one Enable/Disable action and a Reconfigure Camera entry into the existing four-page modal. Camera creation allows either source regardless of creation order and explains that new Cameras begin disabled. Changing an enabled Camera's source type is rejected until it is disabled. Reconfiguration of an unchanged source type preserves its monitoring setting.

Detection mode draws normalized display positions from image-pixel coordinates over the exact analyzed frame. Image and SVG use one source-sized stage. The browser check measured both at 1020 by 765 for a 640 by 480 source, with no distortion or mismatched overlay area.

The owner can choose Watch live video to see smooth source playback. Show detections returns to exact analyzed frames. Smooth playback with synchronized moving overlays remains an open presentation enhancement; it is not implemented by these two modes. Other browsers currently receive analyzed frames, not a full-rate media stream.

New Alert Evidence retains people, bins, all floor issues, dimensions, source time, sample identity and Registration metadata. Alert detail's AI overlay control now renders real geometry instead of the decorative detection box. Camera history renders retained overlays. A Cleaner can view the Alert Evidence linked to their own assigned Work, without gaining access to live Camera monitoring.

Test: enable a Camera from Details, return to the wall, change Zone filter, then return to Details. Frames continue throughout. Open Reconfigure Camera and cancel; existing configuration must remain operational. Generate an Alert, open its evidence, switch Original/AI overlay, and check boxes against the retained frame. Older evidence without complete metadata still displays the original image.
