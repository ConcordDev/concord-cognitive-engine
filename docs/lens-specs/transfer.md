# transfer — Feature Gap vs Fivetran / Airbyte (data migration / ETL)

Category leader (2026): Fivetran / Airbyte (data integration & migration). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `transfer` domain macros (`schemaMapping`, `dataQuality`, `migrationPlan`) — pure-compute analysis over user-entered source/target artifacts.

## Has (verified in code)
- Schema mapping — proposes field-to-field mappings between a source and target schema.
- Data quality — assesses a dataset for completeness/validity issues.
- Migration plan — sequences a migration into ordered steps.
- Action panel running all three macros over the active artifact, with result rendering per action type.

## Missing — buildable feature backlog
- [ ] `[L]` Real connectors — actually read/write a source/destination (DB, CSV, API), not just analyze described schemas.
- [ ] `[M]` Transformation pipeline — visual field transforms, type casts, derived columns.
- [ ] `[M]` Incremental / scheduled sync — run a transfer on a cadence with change-data-capture.
- [ ] `[S]` Mapping editor UI — drag-connect source fields to target fields.
- [ ] `[M]` Validation rules and row-level reject/quarantine on quality failures.
- [ ] `[S]` Dry-run preview — show sample rows after mapping before committing.
- [ ] `[M]` Transfer history / run log with row counts and errors.
- [ ] `[S]` Schema drift detection between runs.

## Parity
~30% of Fivetran/Airbyte. The three analysis macros are a reasonable planning aid, but the lens never actually moves data — no connectors, no transformation engine, no scheduled runs — so it is a migration advisor, not an ETL tool.
