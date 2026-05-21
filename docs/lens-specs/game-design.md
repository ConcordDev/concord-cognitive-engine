# game-design — Feature Gap vs GameMaker / Tiled + GDD tools

Category leader (2026): GameMaker / Godot + Tiled (level design) and Milanote (GDD). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `gamedesign` domain — very deep (~70 macros): game CRUD, GDD sections, mechanics, entities + fields + enums, tile palette + tile CRUD, full level editor (layers, paint, fill, autotile rules, objects, resize, export), game loops, narrative graph (nodes + links), balance report, analytics.

## Has (verified in code)
- Game projects with status pipeline (concept→released), genre, target platform
- GDD editor — sections with reorder; mechanics analysis, player-flow, monetization model
- Tilemap level editor: layers, paint/paint-batch, fill, autotile rules, objects, resize, duplicate, export
- Entity/component system — entities, fields, enums, tile palettes
- Narrative graph — nodes + links + graph view; game loops with steps + loop analysis
- Balance report; game export; design dashboard

## Missing — buildable feature backlog
- [x] `[M]` Playable runtime — actually run/test the designed game in-browser
- [x] `[M]` Sprite / asset editor or asset import pipeline
- [x] `[S]` Collision/physics layer config on the tilemap
- [x] `[S]` Animation timeline for entities/sprites
- [x] `[M]` Visual scripting for entity behavior
- [x] `[S]` Playtest analytics ingestion (balance loop closure)
- [x] `[S]` Collaborative real-time level editing

## Parity
~100% of the Tiled+GDD design surface. The level editor (layers, autotile, objects), entity/narrative/loop systems, an in-browser canvas runtime (`runtime-compile` → playable platformer sim), asset import pipeline, collision/physics config, sprite animation timeline, trigger→action visual scripting, measured playtest analytics, and collaborative session editing are all wired front-to-back — it designs games thoroughly and runs them.
