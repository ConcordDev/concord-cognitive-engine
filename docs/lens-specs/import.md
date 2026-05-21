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
- [ ] `[M]` Interactive in-grid error correction (fix bad rows before commit, Flatfile-style)
- [ ] `[S]` Custom transform rules editor (formulas, find/replace, type coercion)
- [ ] `[M]` Connector library — import directly from Google Sheets, Notion, APIs
- [ ] `[S]` Saved import templates / mapping presets for recurring imports
- [ ] `[S]` Incremental / scheduled imports (sync, not one-shot)
- [ ] `[M]` Rollback an import that went wrong
- [ ] `[S]` Schema inference + auto-suggest target fields

## Parity
~55% of a modern import tool's surface. Validation, field mapping with confidence, dedup, and transform preview cover the core import flow well, but it lacks in-grid error correction, a connector library, saved templates, and rollback — the polish that makes Flatfile-class tools robust.
