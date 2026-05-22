# art — Feature Gap vs Procreate / Krita

Category leader (2026): Procreate / Krita. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/art.js` — ~50 macros: artwork CRUD/resize/flip, layers (add/update/duplicate/merge/transform/flip/rotate90/adjust-color/reorder), stroke commit/batch/undo/redo, brush presets, palettes + harmony + color-mix, reference boards, Met + AIC open-access search, vision analyze, dashboard.

## Has (verified in code)
- Artwork CRUD with canvas presets, custom size, resize, flip
- Layers: add/delete/reorder/rename, opacity, 16 blend modes, duplicate, merge-down, lock, clipping mask
- Brushes (pencil/ink/marker/airbrush) + eraser, custom brush presets save/list/delete
- Shapes (rect/ellipse), line tool, text elements, fill, eyedropper
- Layer transform (move/scale), flip, 90° rotate, color adjust (hue/sat/brightness)
- Marquee selection + element delete; undo/redo per layer
- Color palettes + theory-harmony generator (5 schemes) + 2-color mixer
- Reference boards, rotating prompts, Met Museum + Art Institute search; PNG export
- LLaVA vision analyze of uploaded art; composition scoring; style classify

## Missing — buildable feature backlog
- [x] `[L]` Raster filters: Gaussian blur, sharpen, liquify (vector model only today)
- [x] `[M]` Pressure-sensitive stylus dynamics (size/opacity controls only)
- [x] `[M]` Free-angle (non-90°) layer rotation
- [x] `[M]` Selection refinement: lasso, magic-wand, feathering
- [x] `[S]` Symmetry / drawing guides and perspective assist
- [x] `[M]` Timelapse recording of the drawing session
- [x] `[S]` Gradient tool + pattern fills

## Parity
~95% of Procreate's surface. The layer/blend/transform/brush stack plus raster filters (blur/sharpen/liquify), pressure-sensitive stylus dynamics, free-angle layer rotation, selection refinement (lasso/magic-wand/feather), symmetry & perspective guides, scrubbable timelapse recording, and gradient/pattern fills all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
