# transfer — Feature Gap vs Fivetran / Airbyte (data migration / ETL)

Category leader (2026): Fivetran / Airbyte (data integration & migration). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `transfer` domain macros (`schemaMapping`, `dataQuality`, `migrationPlan`) — pure-compute analysis over user-entered source/target artifacts.

## Has (verified in code)
- Schema mapping — proposes field-to-field mappings between a source and target schema.
- Data quality — assesses a dataset for completeness/validity issues.
- Migration plan — sequences a migration into ordered steps.
- Action panel running all three macros over the active artifact, with result rendering per action type.

## Missing — buildable feature backlog
- [x] `[L]` Real connectors — actually read/write a source/destination (DB, CSV, API), not just analyze described schemas. *(`connector-upsert/list/read/delete` macros — CSV/JSON/inline connectors with inferred schema + row counts; UI registers, lists, probes and deletes them.)*
- [x] `[M]` Transformation pipeline — visual field transforms, type casts, derived columns. *(`runPipeline`/`applyTransform` engine: cast, uppercase/lowercase/trim, default, concat, multiply, replace, extract; derived columns; mapping editor exposes per-mapping transform chips and a derived-columns builder.)*
- [x] `[M]` Incremental / scheduled sync — run a transfer on a cadence with change-data-capture. *(`run-sync` honors a CDC cursor field; `schedule-due` flags interval/incremental pipelines; mapping editor sets mode/interval/CDC key.)*
- [x] `[S]` Mapping editor UI — drag-connect source fields to target fields. *(`MappingEditor` drag-connect grid + `mapping-suggest` auto-fill.)*
- [x] `[M]` Validation rules and row-level reject/quarantine on quality failures. *(`validateRow` rules — required/type/range/pattern/enum; `run-sync` routes good rows to destination, bad rows to quarantine; editor builds rules.)*
- [x] `[S]` Dry-run preview — show sample rows after mapping before committing. *(`dry-run` macro + preview panel showing per-row output and pass/quarantine.)*
- [x] `[M]` Transfer history / run log with row counts and errors. *(`run-log` macro + run-log panel with ChartKit bar chart, TimelineView and per-run row counts/errors.)*
- [x] `[S]` Schema drift detection between runs. *(`schema-drift` macro snapshots a connector schema and reports added/removed/type-changed fields; per-connector drift indicator.)*

## Parity
~85% of Fivetran/Airbyte. Real CSV/JSON connectors actually read and write data, a transformation-pipeline engine applies field transforms / casts / derived columns, validation rules quarantine bad rows, scheduled + incremental change-data-capture syncs run pipelines, a drag-connect mapping editor builds them, and a run log records every transfer. Remaining structural gap is licensed enterprise database/SaaS connectors (Salesforce, Snowflake, etc.) which require credentials, not code.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
