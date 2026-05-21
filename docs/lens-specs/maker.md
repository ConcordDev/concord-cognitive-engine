# maker — Feature Gap vs Retool / Bubble (no-code app builder)

Category leader (2026): Retool / Bubble (no-code app building). The lens is a composite of app-building, quest scripting, and creative generation — closest single rival is a no-code app builder. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `apps` macro domain (list, metrics, promote), `quest` macro domain (list, active), `creative.generate` macros — all via `/api/lens/run`.

## Has (verified in code)
- Apps tab — list generated apps, app metrics, promote an app to published
- Quests tab — list quest chains, active-quest count (30s poll)
- Creative tab — creative-generation panel calling `creative.generate`
- MakerShowcase component, tab keyboard shortcuts

## Missing — buildable feature backlog
- [x] `[L]` Visual app editor — drag-drop component canvas with property inspector
- [x] `[M]` Data binding — connect components to DTU/macro data sources with queries
- [x] `[M]` Event/action wiring — button→query→state without code
- [x] `[M]` Quest authoring editor — branching node graph, not just a list view
- [x] `[S]` App preview / live run inside the lens
- [x] `[M]` Component / template marketplace for reusable blocks
- [x] `[S]` Version history + rollback for built apps

## Parity
Full no-code builder shipped. The `Builder` tab hosts a real project workspace: a drag-drop visual editor with a component palette and property inspector (`editor.*` macros), a data-model designer with tables/fields/relations and per-element data binding (`data.*` macros), a workflow builder wiring triggers→action steps (`workflow.*` macros), a cross-user component marketplace (`market.*` macros), version snapshot/rollback (`version.*` macros), and live in-iframe preview + one-click deploy (`preview.render` / `deploy.*`). The `Quest Designer` tab authors branching quests as a draggable node graph with structural validation (`questGraph*` / `questNode*` / `questEdge*` macros). Apps/Quests/Creative observation tabs retained.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
