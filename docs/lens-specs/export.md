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
- [ ] `[M]` Actual scheduled-export execution — schedule is "configured" but no heartbeat runs it
- [ ] `[S]` Export to cloud destinations (S3, Google Drive, Dropbox) via OAuth
- [ ] `[S]` PDF export (listed in format picker but no generator)
- [ ] `[M]` Incremental / delta exports — only changed records since last run
- [ ] `[S]` Export history log with re-download of past archives
- [ ] `[S]` Encrypted / password-protected archive option
- [ ] `[M]` Selective field-level export (column picker per data type)

## Parity
~55% of a personal-export tool's surface. Solid format coverage and a unique `.dtu` container, but scheduled exports are not actually executed, there is no cloud delivery, and the PDF format is stubbed.
