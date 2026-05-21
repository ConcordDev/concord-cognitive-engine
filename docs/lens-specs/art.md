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
- [ ] `[L]` Raster filters: Gaussian blur, sharpen, liquify (vector model only today)
- [ ] `[M]` Pressure-sensitive stylus dynamics (size/opacity controls only)
- [ ] `[M]` Free-angle (non-90°) layer rotation
- [ ] `[M]` Selection refinement: lasso, magic-wand, feathering
- [ ] `[S]` Symmetry / drawing guides and perspective assist
- [ ] `[M]` Timelapse recording of the drawing session
- [ ] `[S]` Gradient tool + pattern fills

## Parity
~68% of Procreate's surface. The layer/blend/transform/brush stack is unusually complete for a web canvas; gaps are GPU raster filters, stylus pressure, and the selection/symmetry refinements pro artists rely on.
