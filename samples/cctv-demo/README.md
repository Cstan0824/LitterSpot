# CCTV demo source clips

Eight selected MP4 clips are grouped as two inputs for each mock camera.
They are short source clips, not five-minute feeds. Loop or sequence them when
the video-ingestion pipeline needs a longer continuous stream.

## Camera assignments

| Camera | File | Raw duration | Intended demonstration | Suitability |
| --- | --- | ---: | --- | --- |
| CAM-01 Crowd | `camera-01-crowd/crowd-aerial-mall.mp4` | 10.17 s | High-angle person detection and occupancy | High |
| CAM-01 Crowd | `camera-01-crowd/crowd-high-angle-mall.mp4` | 31.27 s | Denser crowd and occlusion stress case | High |
| CAM-02 Bin | `camera-02-bin/bin-normal-disposal.mp4` | 11.35 s | Bin localization while a person deposits waste | Medium |
| CAM-02 Bin | `camera-02-bin/bin-full-street.mp4` | 10.08 s | Full bin with rubbish extending onto the ground | High |
| CAM-03 Spill | `camera-03-spill/spill-water-event.mp4` | 40.64 s | Temporal event: a person spills water | Medium |
| CAM-03 Spill | `camera-03-spill/spill-visible-wet-floor.mp4` | 6.46 s | Visibly wet floor/puddle and pedestrian interaction | Medium |
| CAM-04 Floor litter | `camera-04-floor-litter/litter-garbage-tree.mp4` | 9.12 s | Bags and loose waste on the ground | High |
| CAM-04 Floor litter | `camera-04-floor-litter/litter-trash-pile-street.mp4` | 8.71 s | Mixed rubbish pile beside a road | High |

## Source pages

- Crowd aerial mall: https://www.pexels.com/video/aerial-view-of-busy-urban-shopping-mall-37439458/
- Crowd high-angle mall: https://www.pexels.com/video/high-angle-view-of-a-crowded-shopping-mall-15007111/
- Active bin disposal: https://www.pexels.com/video/person-throwing-trash-into-bin-10061891/
- Full street bin: https://mixkit.co/free-stock-video/old-rusty-can-full-of-garbage-on-the-street-25557/
- Water-spill event: https://www.pexels.com/video/a-woman-spilled-water-on-the-floor-7705348/
- Visible wet floor: https://www.pexels.com/video/a-person-stepping-on-a-wet-floor-5512043/
- Garbage under tree: https://mixkit.co/free-stock-video/garbage-piled-up-at-the-base-of-a-tree-in-25543/
- Street trash pile: https://mixkit.co/free-stock-video/trash-pile-on-the-street-on-a-sunny-day-25552/

Pexels clips are supplied under the Pexels license. Mixkit clips are supplied
under the license shown on each linked source page. Keep these source links
with any prototype distribution.

## Important limitations

- The clips represent independent mock cameras; they are not synchronized
  views of one physical location.
- Most footage is stock footage rather than genuine CCTV.
- Clear water can be difficult for a vision model to segment. The wet-floor
  clip provides a stronger visible puddle case than the spill-event clip.
- These clips are useful for pipeline and UI demonstrations, not model
  accuracy claims or deployment validation.

The `_alternates` folder contains rejected candidates and visual-QA frames; it
is not part of the selected eight-video set.
