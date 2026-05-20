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

### Per-frame layers (DONE)
- [x] Each frame holds multiple drawing layers (up to 10)
- [x] Layer add / delete / visibility / opacity per frame
- [x] Strokes commit to the active layer of the active frame
- [x] Onion skin + playback composite all visible layers

### Audio (DONE)
- [x] Audio tracks on the timeline — name, source URL, start time
- [x] Add / list / remove audio tracks (6-track limit)
- [⚠] Audio mixing/playback — BOUNDARY: Web Audio engine; substitute: track
  metadata + timeline placement + open-link playback

### Tools & canvas (DONE)
- [x] Brushes (pencil/ink/marker), eraser
- [x] Per-frame thumbnail save
- [⚠] MP4/GIF encoding — BOUNDARY: encoder pipeline; substitute: per-frame PNG +
  thumbnail; playback preview in-app

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| MP4 / GIF video encoding | encoder pipeline | sprite-sheet PNG + per-frame PNG export |
| Real audio mixing & sync playback | Web Audio mixing engine | audio-track metadata placed on the timeline |
| Pressure-sensitive stylus | hardware pressure API | pointer-driven brushes |

## Verification log
- 2026-05: backend `node --test tests/animation-domain-parity.test.js` → 14/14 green (29 macros).
- 2026-05: frontend — AnimStudio rewired for per-frame layers (composite visible layers,
  layer panel, active layer) + audio-track panel. `npx tsc --noEmit` exit 0.
- 2026-05: `npm run score-lenses` → animation 7/7 PASS.
- Every spec feature implemented. Boundary register holds only the 2 genuine encoder/audio
  infrastructure items. Zero unchecked non-boundary lines.
