# import — Feature Gap vs Flatfile / Airbyte (data import)

Category leader (2026): Flatfile (CSV import) / Airbyte (data ingestion). No direct consumer rival — closest analog is a data-import / ETL onboarding tool.
Backend: `importdomain` domain — validateImport, mapFields, detectDuplicates, transformPreview; UniversalImport + ImportToolingGallery components.

## Has (verified in code)
- File upload + import validation — total/valid/invalid rows, validation rate, per-field summary, error list
- Field mapping — source→target with auto-mapping confidence scores + confidence labels
- Duplicate detection across imported rows
- Transform preview — see how rows will look after transformation
- Import history; supports JSON / CSV / archive formats

## Missing — buildable feature backlog
- [x] `[M]` Interactive in-grid error correction (fix bad rows before commit, Flatfile-style)
- [x] `[S]` Custom transform rules editor (formulas, find/replace, type coercion)
- [x] `[M]` Connector library — import directly from Google Sheets, Notion, APIs
- [x] `[S]` Saved import templates / mapping presets for recurring imports
- [x] `[S]` Incremental / scheduled imports (sync, not one-shot)
- [x] `[M]` Rollback an import that went wrong
- [x] `[S]` Schema inference + auto-suggest target fields

## Parity
~95% of a modern import tool's surface. Validation, field mapping with confidence, dedup, transform preview, schema inference, in-grid error correction, a connector library, scheduled sync, saved templates, and snapshot rollback all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
