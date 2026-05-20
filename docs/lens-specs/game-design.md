# game-design — Feature Completeness Spec

Rival app(s): Tiled (level editor), LDtk (modern 2D level designer),
Nuclino (GDD wiki), Twine (narrative branching), Machinations (loop / economy modelling)
Sources:
- https://doc.mapeditor.org/en/stable/manual/introduction/
- https://doc.mapeditor.org/en/stable/manual/editing-tile-layers/
- https://doc.mapeditor.org/en/stable/manual/terrain/
- https://ldtk.io/
- https://deepwiki.com/deepnight/ldtk/2-core-concepts
- https://deepnight.itch.io/ldtk (devlogs — IntGrid, AutoLayer, enums, world layout)

## Features

### Game projects (Nuclino-style workspace)
- [x] Create / list / get / update / delete game projects (macro: game-design.game-*)
- [x] Project metadata — genre, platform, pitch
- [x] Project dashboard rollup (macro: game-design.game-dashboard)
- [x] Whole-project JSON export (macro: game-design.game-export)

### Game Design Document (Nuclino nested wiki)
- [x] GDD sections — add / update / delete with ordering (macro: game-design.gdd-*)
- [x] Reorder GDD sections (macro: game-design.gdd-reorder)

### Mechanics & core loops (Machinations)
- [x] Mechanics list with category taxonomy (macro: game-design.mechanic-*)
- [x] Mechanics depth / pillar analysis (macro: game-design.mechanicsAnalysis)
- [x] Core-loop modelling — named loops with ordered steps (macro: game-design.loop-*)
- [x] Loop kind taxonomy — core / progression / positive / negative / economy
- [x] Loop balance analysis — net resource delta per loop (macro: game-design.loop-analysis)
- [x] Player-flow / pacing analysis — challenge vs skill flow zone (macro: game-design.playerFlow)
- [x] Monetization model projection (macro: game-design.monetizationModel)

### Entities (LDtk entity definitions)
- [x] Entity roster — kind, combat stats, description (macro: game-design.entity-*)
- [x] Custom typed fields per entity — int / float / string / bool / enum / color (macro: game-design.entity-field-set)
- [x] Delete a custom field (macro: game-design.entity-field-delete)
- [x] Enums — define named value sets, used by entity enum fields (macro: game-design.enum-*)
- [x] Entity balance report — stat spread, outliers, difficulty band (macro: game-design.balance-report)

### Tilesets & palette (Tiled)
- [x] Built-in greybox tile palette — colour-typed tiles by category (macro: game-design.tile-palette)
- [x] Custom project tiles — name + colour + category (macro: game-design.tile-create / tile-list / tile-delete)
- [⚠] Image-based tilesets — BOUNDARY: needs binary file storage; substitute: colour-typed tile palette + custom tiles

### Level editor — tilemap (Tiled + LDtk)
- [x] Levels — create / list / get / delete, sized grid (macro: game-design.level-*)
- [x] Tile layers — paint single cell, batch paint, fill (macro: game-design.level-paint / level-paint-batch / level-fill-layer)
- [x] Multiple layers per level — add / update / delete / reorder / duplicate (macro: game-design.level-layer-*)
- [x] Layer visibility toggle + per-layer opacity (macro: game-design.level-layer-update)
- [x] Layer kinds — tile / object / intgrid (macro: game-design.level-layer-add kind param)
- [x] Object layers — place named objects with x/y/w/h + props (macro: game-design.level-object-*)
- [x] IntGrid layers — paint integer collision/region values (macro: level-paint on intgrid layer)
- [x] Auto-layer rules — IntGrid value → tile mapping (macro: game-design.autotile-rule-*)
- [x] Apply auto-layer — generate a tile layer from an IntGrid layer (macro: game-design.level-autotile)
- [x] Resize a level — grid grows/shrinks, layers preserved (macro: game-design.level-resize)
- [x] Duplicate a level (macro: game-design.level-duplicate)
- [x] Level JSON export — Tiled/LDtk-style map data (macro: game-design.level-export)
- [x] Map orientation metadata — orthogonal / isometric / hexagonal (level-create + level-update orientation)
- [⚠] Terrain / Wang corner-blend brush — BOUNDARY: needs per-tile edge metadata from image tilesets; substitute: auto-layer IntGrid→tile rules cover the procedural-fill use case

### Narrative & branching (Twine / articy)
- [x] Narrative nodes — start / scene / choice / ending kinds (macro: game-design.narrative-node-*)
- [x] Links between nodes with choice labels (macro: game-design.narrative-link-*)
- [x] Narrative graph analysis — endings, orphans, reachability, max depth (macro: game-design.narrative-graph)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Image-based tilesets (sprite sheets) | binary file storage + atlas slicing | colour-typed built-in palette + named custom tiles |
| Terrain / Wang corner-blend brush | per-tile edge metadata on image tiles | auto-layer rules (IntGrid value → tile) for procedural fill |

## Verification log
- 2026-05-20: Backend — 68 macros across game / GDD / mechanics / loops / entities /
  enums / tiles / levels / object+IntGrid layers / auto-layer / narrative areas;
  `node --check` clean.
- 2026-05-20: Tests — `tests/gamedesign-domain-parity.test.js` 26/26 green (layer
  reorder/delete/duplicate/opacity, object layers, IntGrid + auto-layer generation,
  level resize/duplicate/export, custom tiles, entity fields, enums, core loops +
  balance analysis, narrative graph reachability, balance report, project export).
- 2026-05-20: Frontend — six tabs (Design Doc with reorder, Mechanics, Loops,
  Entities with typed fields + enums + balance report, Levels with the tile/object/
  IntGrid editor + auto-layer + resize + export, Narrative graph); `npx tsc --noEmit`
  exit 0.
- 2026-05-20: `npm run score-lenses` → game-design 7/7 PASS.
