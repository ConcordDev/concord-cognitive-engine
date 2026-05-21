# worldmodel — Feature Gap vs Palantir Foundry / digital-twin platforms

Category leader (2026): Palantir Foundry / Splunk ITSI (entity-graph world model + simulation) — no consumer rival; closest analog. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `worldmodel` domain — 16 macros: `status`, entity CRUD (`list_entities`, `create_entity`), `list_relations`, `simulate`, `counterfactual`, snapshots.

## Has (verified in code)
- Five-tab surface: Status, Entities, Relations, Simulate, Snapshots.
- Entity graph — list and create entities; list relations between them.
- Simulation — run a scenario (`simulate`) or a counterfactual (`counterfactual`) with a JSON scenario input, result rendered.
- Snapshots of the model state.
- Keyboard tab navigation.

## Missing — buildable feature backlog
- [ ] `[M]` Graph visualization — render the entity/relation graph interactively (it's list-only).
- [ ] `[S]` Relation creation / editing from the UI (entities can be created; relations cannot).
- [ ] `[M]` Simulation result charting — show projected trajectories, not raw JSON.
- [ ] `[M]` Side-by-side scenario vs counterfactual comparison.
- [ ] `[S]` Entity detail / attributes editing and typed schemas.
- [ ] `[M]` Snapshot diff / restore — compare two snapshots and roll back.
- [ ] `[S]` Scenario library — save and re-run named scenarios.
- [ ] `[M]` Live data ingestion to keep the model synced with the running engine.

## Parity
~40% of Foundry. The entity graph plus simulate/counterfactual macros are a real digital-twin core, but it is JSON-in/JSON-out with no graph visualization, no relation editing, no result charts, and no snapshot diffing.
