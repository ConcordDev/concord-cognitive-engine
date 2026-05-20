# database — Feature Completeness Spec

Rival app(s): dbdiagram.io, DrawSQL, drawDB (2026)
Sources:
- https://dbdiagram.io/ (database relationship diagrams, DBML, SQL export)
- https://drawsql.app/ (visual ER schema design, SQL export, templates)
- Web search 2026-05-20: design tables + typed columns + relations; export SQL DDL; reverse-engineer from SQL

## Features

### Schema designer (dbdiagram shape)
- [x] Create / list / delete schemas, per-user (macro: database.schema-create / schema-list / schema-delete)
- [x] Schema detail — tables + relations (macro: database.schema-detail)
- [x] Add tables — auto-seeds an integer primary-key `id` column; dedupe by name (macro: database.table-add)
- [x] Delete a table — cascades its relations (macro: database.table-delete)
- [x] Add typed columns — 11 SQL types, PK / nullable flags, identifier sanitisation (macro: database.column-add)
- [x] Delete columns (macro: database.column-delete)
- [x] Add / delete relations between tables (macro: database.relation-add / relation-delete)
- [x] Export CREATE TABLE DDL + foreign-key ALTERs (macro: database.schema-export-sql)
- [x] Schema dashboard — schemas, tables, relations (macro: database.schema-dashboard)

### Analysis (retained)
- [x] Schema analysis (macro: database.schemaAnalysis)
- [x] Query optimization (macro: database.queryOptimize)
- [x] Migration planning (macro: database.migrationPlan)
- [x] Index recommendation (macro: database.indexRecommendation)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Live connection to a real database | DB drivers + credentials | the designer is a visual modelling tool; export SQL DDL to run elsewhere |
| Reverse-engineer a diagram from imported SQL | a SQL parser | forward design + SQL export; the existing schemaAnalysis macro inspects supplied schemas |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/database.js` clean. 14 macros
  (4 analysis + 10 schema-designer substrate).
- 2026-05-20: Tests — `tests/database-schema-domain-parity.test.js` 9/9 green
  (schema CRUD + per-user scope / table add default-id + dup reject / column
  add+delete + identifier sanitisation / relation both-tables-exist guard /
  SQL export DDL shape / dashboard / analysis macros intact).
- 2026-05-20: Frontend — new `SchemaDesigner` (multi-schema, table cards with
  typed columns + PK markers, relations, SQL export view) mounted in the
  database lens page. `npx tsc --noEmit` exit 0.
