# maker — Feature Gap vs Retool / Bubble (no-code app builder)

Category leader (2026): Retool / Bubble (no-code app building). The lens is a composite of app-building, quest scripting, and creative generation — closest single rival is a no-code app builder. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `apps` macro domain (list, metrics, promote), `quest` macro domain (list, active), `creative.generate` macros — all via `/api/lens/run`.

## Has (verified in code)
- Apps tab — list generated apps, app metrics, promote an app to published
- Quests tab — list quest chains, active-quest count (30s poll)
- Creative tab — creative-generation panel calling `creative.generate`
- MakerShowcase component, tab keyboard shortcuts

## Missing — buildable feature backlog
- [ ] `[L]` Visual app editor — drag-drop component canvas with property inspector
- [ ] `[M]` Data binding — connect components to DTU/macro data sources with queries
- [ ] `[M]` Event/action wiring — button→query→state without code
- [ ] `[M]` Quest authoring editor — branching node graph, not just a list view
- [ ] `[S]` App preview / live run inside the lens
- [ ] `[M]` Component / template marketplace for reusable blocks
- [ ] `[S]` Version history + rollback for built apps

## Parity
~30% of a no-code builder. It is an observation + simple-action surface over three generation engines (apps/quests/creative) — missing the visual editor, data binding, and event wiring that constitute actual no-code building.
