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
- [x] `[M]` Graph visualization — render the entity/relation graph interactively (it's list-only). — `GraphCanvas.tsx` force-directed SVG graph + `graph` macro.
- [x] `[S]` Relation creation / editing from the UI (entities can be created; relations cannot). — `create_relation_typed` / `update_relation` / `delete_relation` wired in Relations tab.
- [x] `[M]` Simulation result charting — show projected trajectories, not raw JSON. — `run_scenario` + `ChartKit` line charts of per-step trajectories.
- [x] `[M]` Side-by-side scenario vs counterfactual comparison. — `compare_scenarios` macro + Compare tab with baseline/cf/delta charts.
- [x] `[S]` Entity detail / attributes editing and typed schemas. — `update_entity_attrs` / `define_entity_type` / `list_entity_types` + AttrEditor and schema builder.
- [x] `[M]` Snapshot diff / restore — compare two snapshots and roll back. — `capture_snapshot` / `diff_snapshots` / `restore_snapshot` wired in Snapshots tab.
- [x] `[S]` Scenario library — save and re-run named scenarios. — `save_scenario` / `list_scenarios` / `delete_scenario` + re-run via `run_scenario`.
- [x] `[M]` Live data ingestion to keep the model synced with the running engine. — `ingest` / `ingest_log` macros + Ingest tab.

## Parity
~88% of Foundry. The entity graph plus simulate/counterfactual macros are a real digital-twin core, but it is JSON-in/JSON-out with no graph visualization, no relation editing, no result charts, and no snapshot diffing.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
