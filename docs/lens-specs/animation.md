# animation — Feature Completeness Spec

Rival app(s): FlipaClip, Pencil2D
Sources:
- https://support.flipaclip.com/article/15-layers
- https://play.google.com/store/apps/details?id=com.vblast.flipaclip
- https://www.pencil2d.org/

## Features

### Projects & frames (DONE — existing, 23 macros)
- [x] Animation projects — create/list/get/rename/update/delete, fps + dimensions
- [x] Frames — add, duplicate, delete, reorder
- [x] Per-frame exposure (hold N frames) for timing
- [x] Stroke loop — commit/batch/undo, clear a frame
- [x] Onion skinning (frontend) of adjacent frames
- [x] Playback at project fps; exposure-expanded sequence
- [x] Easing curves (linear / ease / cubic / bounce)

### Per-frame layers (PLANNED — next slice)
- [ ] Each frame holds multiple drawing layers (FlipaClip-style, up to ~10)
- [ ] Layer add / rename / reorder / delete / visibility / opacity per frame
- [ ] Strokes commit to the active layer of the active frame
- [ ] Onion skin + playback composite all visible layers

### Audio (PLANNED — next slice)
- [ ] Audio tracks on the timeline — name, source URL, start time
- [ ] Add / list / remove audio tracks
- [ ] (Boundary) actual audio mixing/playback — metadata + timeline placement only

### Tools & canvas (PARTIAL)
- [x] Brushes (pencil/ink/marker), eraser
- [ ] Shapes + fill + text on frames (reuse the art element model)
- [ ] Overlay grid for alignment (frontend)
- [ ] Frame scrubbing (frontend timeline)

### Export (PLANNED — next slice)
- [ ] Sprite-sheet PNG export (all frames tiled — client-side)
- [x] Per-frame thumbnail save
- [ ] (Boundary) MP4/GIF encoding — sprite sheet + frame PNGs are the substitute

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| MP4 / GIF video encoding | encoder pipeline | sprite-sheet PNG + per-frame PNG export |
| Real audio mixing & sync playback | Web Audio mixing engine | audio-track metadata placed on the timeline |
| Pressure-sensitive stylus | hardware pressure API | pointer-driven brushes |

## Verification log
- (teardown + gap analysis complete) — 23 existing macros audited against FlipaClip/
  Pencil2D. Remaining slices: per-frame layers, audio tracks, sprite-sheet export,
  shapes/grid. Next: build per-frame layers (the headline gap).
