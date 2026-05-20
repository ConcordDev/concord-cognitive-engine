# art — Feature Completeness Spec

Rival app(s): Procreate, Krita
Sources:
- https://procreate.com/procreate/whats-new
- https://en.wikipedia.org/wiki/Procreate_(software)
- https://docs.krita.org/en/reference_manual/tools/transform.html
- https://krita.org/en/release-notes/krita-5-3-release-notes/

## Features

### Canvas & artworks (DONE — existing)
- [x] Create / list / open / rename / delete artworks; thumbnails
- [x] Canvas size presets + custom; paper background colour
- [x] Resize canvas (artwork-resize)
- [x] Flip canvas horizontal / vertical (artwork-flip)

### Layers (DONE)
- [x] Add / delete / reorder / rename layers
- [x] Per-layer opacity, visibility, 16 blend modes
- [x] Duplicate a layer (layer-duplicate)
- [x] Merge layer down (layer-merge-down)
- [x] Layer lock (locked flag — blocks edits)
- [x] Clipping mask (clip layer to the one below)
- [x] Clear a layer

### Drawing tools (DONE)
- [x] Brushes — pencil, ink, marker, airbrush + presets
- [x] Eraser
- [x] Custom brush presets — save / list / delete (brush-preset-*)
- [x] Fill — solid layer fill (kind: fill)
- [x] Shapes — rectangle, ellipse (filled or outlined)
- [x] Line tool (2-point stroke)
- [x] Text — place text elements on the canvas (kind: text)
- [x] Eyedropper — sample colour from the canvas (client-side)

### Transform & adjustments (DONE)
- [x] Transform a layer — move + uniform scale (layer-transform)
- [x] Flip a layer horizontal / vertical (layer-flip)
- [x] Rotate a layer 90° cw/ccw (layer-rotate90)
- [x] Colour adjustment — hue shift, saturation, brightness (layer-adjust-color)

### Selection (DONE)
- [x] Rectangular marquee selection (client-side, selects intersecting elements)
- [x] Delete selected elements (element-delete)
- [x] Transform applies to a selection or the whole layer

### History (DONE)
- [x] Undo (stroke-undo)
- [x] Redo (stroke-redo) — redo buffer per layer

### Colour (DONE — existing + this slice)
- [x] Colour picker, palettes, palette CRUD
- [x] Colour-theory harmony generator (5 schemes)
- [x] Two-colour mixer

### Reference & inspiration (DONE — existing)
- [x] Reference boards with image URLs
- [x] Rotating art prompts
- [x] Met Museum + Art Institute open-access search

### Export (DONE)
- [x] Export artwork as PNG (client-side flatten + download)
- [x] Thumbnail save

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Pressure-sensitive stylus dynamics | universal hardware pressure API | pointer-driven brushes; size/opacity controls |
| Raster filters (Gaussian blur, sharpen, liquify) | GPU raster pipeline | vector model: colour adjust + airbrush soft edges |
| 3D model painting | 3D engine | 2D layered canvas |
| Free-angle (non-90°) layer rotation | per-pixel raster transform | move/scale/flip + exact 90° rotation |

## Verification log
- 2026-05: backend `node --test tests/art-domain-parity.test.js` → 29/29 green (47 macros).
- 2026-05: ArtCanvas engine rewritten — renders all element kinds (brush strokes, fill,
  rect, ellipse, text), clipping-mask compositing; tool palette (8 brushes/tools), live
  shape preview, marquee selection, transform/adjust/canvas panels, redo, PNG export.
  `npx tsc --noEmit` exit 0.
- 2026-05: `npm run score-lenses` → art 7/7 PASS.
- Every spec feature implemented. Boundary register holds only the 4 genuine hardware/GPU
  items. Zero unchecked non-boundary lines.
