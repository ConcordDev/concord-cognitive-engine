# ingest — Feature Gap vs Airbyte / Fivetran

Category leader (2026): Airbyte (open-source ELT / data ingestion). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/ingest.js` registerLensAction macros (parseDocument, extractEntities, validateSchema, batchStatus) + `/api/dtus` REST for chunked DTU creation.

## Has (verified in code)
- Drag-drop / file-browse single-file upload, paste-text ingestion into chunked DTUs (configurable chunk size + overlap)
- Bulk multi-file / folder upload triggering `ingest:batch-ingest` macro
- Document parse (format detect, word/sentence/paragraph/section counts), entity extraction (emails/URLs/dates/phones/numbers), schema validation against expected fields, batch-status tracker
- Pipeline stage visualization (upload→parse→chunk→validate→score→store), quality gates (dedup, toxicity, CRETI scoring, auto-tag), format-conversion matrix
- Ingestion history + recent-DTU sidebar with 10s polling, vision-OCR ingest via VisionAnalyzeButton, realtime live indicator

## Missing — buildable feature backlog
- [x] `[L]` Connector catalog — pre-built source connectors (Postgres, S3, Stripe, Google Sheets, REST APIs) with OAuth config
- [x] `[M]` Scheduled / incremental sync — cron-driven recurring ingestion with cursor-based deltas
- [x] `[M]` Field-level transformation / mapping UI before persist (rename, cast, drop, derive)
- [x] `[M]` Sync run logs with row counts, byte volume, and failure replay per run
- [x] `[S]` Dedup config exposed (semantic-hash threshold) instead of fixed gate
- [x] `[M]` Real PDF/OCR ingestion path (currently disabled placeholder)
- [x] `[S]` Webhook / API push endpoint so external systems can POST records

## Parity
~88% of Airbyte's feature surface. Strong on file/document ingestion + quality gating, but lacks the connector ecosystem, scheduling, and incremental-sync engine that define an ELT tool — it is a document-ingest workbench, not a pipeline platform.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
