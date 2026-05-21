# schema — Feature Gap vs JSON Schema tooling / Hasura console

Category leader (2026): no consumer rival — closest analog is JSON Schema / data-model tooling (Hasura console, JSON Schema validators). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/schema.js` — 3 macros (schemaValidate, schemaDiff, schemaEvolution); page is a Dynamic Schemas workbench.

## Has (verified in code)
- Schema validation macro — validate data against a schema definition
- Schema diff macro — compare two schema versions
- Schema evolution macro — model how a schema changes over time
- Dynamic Schemas page workbench surfacing the macros

## Missing — buildable feature backlog
- [ ] `[M]` Visual schema editor — define types/fields/constraints in a form, not raw JSON
- [ ] `[M]` Schema registry — store, version, and name schemas; browse the catalog
- [ ] `[S]` Sample-data generator — produce valid example records from a schema
- [ ] `[M]` Migration generator — emit a migration script from a schema diff
- [ ] `[S]` Validation against live data — point at a dataset and report conformance
- [ ] `[S]` Schema visualization — entity-relationship diagram of types and references
- [ ] `[S]` Import from JSON/SQL — infer a schema from existing data

## Parity
~35% of a schema-tooling surface. The validate/diff/evolution macros are a real engine, but it lacks a visual editor, a versioned schema registry, and a migration generator — the workflow that makes schema tooling productive.
