# export — Feature Gap vs Notion Export / Google Takeout

Category leader (2026): Google Takeout / Notion workspace export. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `export` domain macros (generatePackage, validateExport, scheduleExport, diffExport) + REST `/api/export/universal` (`routes/universal-export.js`) + `/api/lens/export/export-dtu`.

## Has (verified in code)
- Multi-format export — JSON / CSV / Markdown / Plain Text / `.dtu` portable container
- Selectable data categories (DTUs, events, settings) with counts
- Generate package, validate export (per-item required-field check), schedule export, diff export macros
- ExportFormatGallery component; universal DTU-content export route
- Per-DTU export endpoint

## Missing — buildable feature backlog
- [ ] `[M]` Full account archive — single download bundling everything (Takeout-style)
- [ ] `[S]` Export progress / job status UI for large archives
- [ ] `[M]` Email-link delivery when a large export completes
- [ ] `[S]` Incremental export — only items changed since last export (diff macro exists but not wired to delivery)
- [ ] `[M]` Per-format options (CSV column picker, Markdown front-matter toggle)
- [ ] `[S]` Re-import round-trip verification of the produced `.dtu` pack
- [ ] `[S]` Export history log with re-download links

## Parity
~55% of Takeout. Format coverage and the `.dtu` portable container are strong and validation/scheduling macros exist, but there is no whole-account archive, no async job tracking, and no delivery pipeline.
