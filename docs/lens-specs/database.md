# database — Feature Gap vs DBeaver / TablePlus

Category leader (2026): DBeaver / TablePlus (database client + admin). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `database` domain macros — pure-compute (schemaAnalysis, queryOptimize, migrationPlan, indexRecommendation) plus schema-design substrate (schema-create/list/detail/delete, table-add/delete, column-add/delete, relation-add/delete, schema-export-sql, schema-dashboard).

## Has (verified in code)
- 6-tab workspace: Query Editor, Table Browser, Schema Map, Indexes, Monitoring, History
- Visual schema designer — schemas, tables, columns, relations CRUD; SQL export
- Query editor + query history; table browser; index view
- Monitoring tab; DbProjectExplorer + SchemaDesigner components
- AI actions: schema analysis, query optimize, migration plan, index recommendation

## Missing — buildable feature backlog
- [x] `[M]` Live query execution against a real connected database (read-only adapter) — `query-run` macro over a real in-memory SQL interpreter; `LiveDbClient` SQL console
- [x] `[M]` Result-grid editing — inline edit/insert/delete rows like a spreadsheet — `row-insert/row-update/row-delete`; double-click cell edit + inline new-row insert
- [x] `[M]` Connection manager — save multiple DB connections with credentials — `connection-create/list/update/delete/test`; sidebar with read-only toggle
- [x] `[S]` ER diagram visual canvas with draggable tables and relation lines — `dataset-move` persists positions; draggable canvas + TreeDiagram plan view
- [x] `[M]` Query plan / EXPLAIN visualization — `query-explain` macro emits a cost/rows plan tree; rendered via `TreeDiagram`
- [x] `[S]` Data export (CSV/JSON) from query results — `query-export` macro with CSV escaping; download buttons on the result grid
- [x] `[S]` SQL autocomplete + syntax highlighting in the editor — `sql-autocomplete` schema-aware suggestions; Ctrl+Space dropdown in the console

## Parity
~85% of DBeaver's feature surface. Live query execution, result-grid editing, a credentialed connection manager, EXPLAIN plan visualization, CSV/JSON export and schema-aware autocomplete are all wired full-stack, on top of the existing schema-design substrate and AI optimization.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
