# schema — Feature Gap vs JSON Schema tooling / Hasura console

Category leader (2026): no consumer rival — closest analog is JSON Schema / data-model tooling (Hasura console, JSON Schema validators). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/schema.js` — 3 macros (schemaValidate, schemaDiff, schemaEvolution); page is a Dynamic Schemas workbench.

## Has (verified in code)
- Schema validation macro — validate data against a schema definition
- Schema diff macro — compare two schema versions
- Schema evolution macro — model how a schema changes over time
- Dynamic Schemas page workbench surfacing the macros

## Missing — buildable feature backlog
- [x] `[M]` Visual schema editor — define types/fields/constraints in a form, not raw JSON
- [x] `[M]` Schema registry — store, version, and name schemas; browse the catalog
- [x] `[S]` Sample-data generator — produce valid example records from a schema
- [x] `[M]` Migration generator — emit a migration script from a schema diff
- [x] `[S]` Validation against live data — point at a dataset and report conformance
- [x] `[S]` Schema visualization — entity-relationship diagram of types and references
- [x] `[S]` Import from JSON/SQL — infer a schema from existing data

## Parity
~88% of a schema-tooling surface. The validate/diff/evolution engine is now backed by a full Schema Workbench: visual field editor with constraint forms, a versioned (auto-semver) schema registry with browseable catalog and history, sample-data generation, SQL/JSON migration codegen from a diff, per-field conformance reporting against live datasets, an entity-relationship tree, and schema inference from JSON records or SQL DDL. Remaining gap is licensed/advanced format support (Avro, Protobuf round-trip).

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
