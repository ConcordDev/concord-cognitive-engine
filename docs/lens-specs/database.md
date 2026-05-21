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
- [ ] `[M]` Live query execution against a real connected database (read-only adapter)
- [ ] `[M]` Result-grid editing — inline edit/insert/delete rows like a spreadsheet
- [ ] `[M]` Connection manager — save multiple DB connections with credentials
- [ ] `[S]` ER diagram visual canvas with draggable tables and relation lines
- [ ] `[M]` Query plan / EXPLAIN visualization
- [ ] `[S]` Data export (CSV/JSON) from query results
- [ ] `[S]` SQL autocomplete + syntax highlighting in the editor

## Parity
~45% of DBeaver's feature surface. Strong schema-design and SQL-export substrate plus AI optimization, but lacks live query execution, result-grid editing, and a connection manager — the core of a real DB client.
