# export — Feature Gap vs Google Takeout / Notion Export

Category leader (2026): Google Takeout / Notion bulk-export. No direct consumer rival — closest analog is a personal-data export tool.
Backend: `export` domain macros (generatePackage, validateExport, scheduleExport, diffExport) + `/api/lens/export/export-dtu` REST route producing a `.dtu` binary container; page does client-side JSON/CSV/MD/text serialization.

## Has (verified in code)
- Multi-format export: JSON, CSV, Markdown, plain text, and Concord `.dtu` portable container
- Data-source selection (DTUs / events / settings) with counts
- Export package estimation (size, mime, extension, item count)
- Export validation against a schema (required-field checks, error list)
- Scheduled exports (daily/weekly/monthly, destination, next-run calc)
- Diff export — added/removed/modified/unchanged between two snapshots

## Missing — buildable feature backlog
- [x] `[M]` Actual scheduled-export execution — schedule is "configured" but no heartbeat runs it
- [x] `[S]` Export to cloud destinations (S3, Google Drive, Dropbox) via OAuth
- [x] `[S]` PDF export (listed in format picker but no generator)
- [x] `[M]` Incremental / delta exports — only changed records since last run
- [x] `[S]` Export history log with re-download of past archives
- [x] `[S]` Encrypted / password-protected archive option
- [x] `[M]` Selective field-level export (column picker per data type)

## Parity
~95% of a personal-export tool's surface. Format coverage, the `.dtu` container, executed scheduled exports, cloud delivery via OAuth, real PDF generation, incremental/delta exports, an export-history log with re-download, encrypted archives, and selective field-level export all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
