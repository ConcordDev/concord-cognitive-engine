# Ingest Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. The macro list below was enumerated by reading
> `server/domains/ingest.js` (879 LOC) in full and grepping every
> registration site. There are **three distinct "ingest" backend surfaces**
> in this repo — only the first is this lens's substrate:
>
> 1. **`server/domains/ingest.js` → `LENS_ACTIONS`** (25 macros, the ELT
>    pipeline + document-analysis workbench) — reached by `/api/lens/run`,
>    which prefers `LENS_ACTIONS` over `MACROS` (server.js:39592-39596). This
>    is `/lenses/ingest`.
> 2. **`server.js:16804-16814` inline `register("ingest", …)`** (submit_url /
>    queue / status / stats / process_next / flush / allowlist / add_allowlist
>    / remove_allowlist / add_blocklist / metrics) — the corpus/URL-crawler
>    engine (`emergent/ingest-engine.js`), surfaced NOT here but on the
>    separate `/app/ingest/page.tsx` admin page via `/api/ingest/*` REST
>    routes. Out of scope for this lens.
> 3. **`server.js:25202-25265` inline `register("ingest", url/queue/processQueueOnce")`** — a second thin URL-queue path. Also not this lens.
>
> No name collision between (1) and (2)/(3): the 25 domain names
> (`listConnectors`, `configureConnector`, …) are disjoint from the URL-queue
> names, so there is **no macro-shadowing** — the domain macros win via
> `LENS_ACTIONS` for every name this lens calls.
>
> Reproduce: `grep -n 'registerLensAction("ingest"' server/domains/ingest.js`

## Reference app — the caliber bar

Judged as a standalone product against **Airbyte** (open-source ELT — the
domain file's own header comment literally calls this an "ELT-style pipeline
substrate: pre-built source connectors, scheduled / incremental sync with
cursor deltas, field-level transformation mapping, sync run logs with replay,
configurable dedup, an OCR ingestion path, and a webhook push endpoint"),
with **Fivetran** (managed incremental sync + connector catalog) and
**Zapier's data-import UX** as secondary references. The caliber question:
would the ELT surface hold up next to Airbyte's connection wizard, not just
next to Concord's other 259 lenses? The connector catalog + configure →
schedule → transform-preview → run-with-cursor-delta → replay loop in
`PipelinePanel` genuinely tracks Airbyte's model (sources, connections,
incremental cursors, mapping, sync history). The document-analysis actions
(parse/extract/validate) are the "profile inbound data before it lands"
step that a real loader runs — closer to a data-quality preflight than to
Airbyte proper, and honestly framed as such.

## Backend surface — 25 macros (domain file), all real (no stubs)

Two tiers, both real:

**(A) 20 `STATE.ingestLens`-backed ELT macros** (real per-user persistent
`Map`s in `globalThis._concordSTATE`, checkpointed by the state debouncer):
connector catalog + configured connections (with redacted secrets + OAuth
pending flow), scheduled/incremental sync with real cursor deltas + dedup,
field-mapping transforms (rename/cast/derive/drop) with a live preview, sync
run logs + replay, a configurable dedup policy, an OCR ingestion structurer,
and a per-user webhook push endpoint.

**(B) 5 stateless "workbench" macros** operating on caller-supplied
`artifact.data` (no persistence of their own): `parseDocument`,
`extractEntities`, `validateSchema`, `batchStatus` (document/data profiling
calculators), and `batch-ingest` (reads dropped text-file contents and
genuinely mints one DTU per text file via `dtu.create`; binaries are
honestly reported `skipped`, never faked).

| Macro | Real result / effect | Classification (before) | Classification (after) |
|---|---|---|---|
| `listConnectors` | static connector catalog (postgres/rest-api/google-sheets/… incl. OAuth-required) + categories | DESIGNED — `PipelinePanel` connector grid | DESIGNED |
| `configureConnector` | validates required fields, mints a connection; OAuth connectors return `pending_oauth` + authorize URL | DESIGNED — `PipelinePanel` configure form | DESIGNED |
| `listConnections` | connections with secrets redacted (`••••••••`) | DESIGNED — `PipelinePanel` | DESIGNED |
| `deleteConnection` | delete + cascade its schedules | DESIGNED — `PipelinePanel` | DESIGNED |
| `scheduleSync` | schedule with a real `nextRunAt` (hourly/daily/…), full/incremental mode | DESIGNED — `PipelinePanel` schedules | DESIGNED |
| `listSchedules` | list schedules for the user | DESIGNED — `PipelinePanel` | DESIGNED |
| `toggleSchedule` | enable/disable a schedule | DESIGNED — `PipelinePanel` | DESIGNED |
| `deleteSchedule` | delete a schedule | DESIGNED — `PipelinePanel` | DESIGNED |
| `runSync` | incremental extract past stored cursor + dedup + saved-mapping applied + cursor advance | DESIGNED — `PipelinePanel` run + records paste | DESIGNED |
| `listSyncRuns` | run log with row/byte totals | DESIGNED — `PipelinePanel` run history + throughput | DESIGNED |
| `replaySyncRun` | replay a logged run (appends a new run) | DESIGNED — `PipelinePanel` replay | DESIGNED |
| `previewTransform` | rename/cast/derive/drop preview with before→after per row + field deltas | DESIGNED — `PipelinePanel` transform preview | DESIGNED |
| `saveMapping` | validate + persist a mapping per connection | DESIGNED — `PipelinePanel` | DESIGNED |
| `getMapping` | read back a connection's mapping | DESIGNED — `PipelinePanel` | DESIGNED |
| `getDedupConfig` | current dedup policy (enabled/threshold/strategy/keyField) | DESIGNED — `PipelinePanel` dedup panel | DESIGNED |
| `setDedupConfig` | persist a custom dedup policy | DESIGNED — `PipelinePanel` | DESIGNED |
| `ocrIngest` | structures multi-page OCR text → headings + chunks + low-confidence page flags | DESIGNED — `PipelinePanel` OCR panel | DESIGNED |
| `getWebhookEndpoint` | mint/rotate a stable per-user webhook URL + token | DESIGNED — `PipelinePanel` webhook panel | DESIGNED |
| `pushRecord` | accept records into the webhook endpoint | DESIGNED — `PipelinePanel` in-lens test push | DESIGNED |
| `listWebhookRecords` | list received webhook records | DESIGNED — `PipelinePanel` | DESIGNED |
| `parseDocument` | document structure profile (format/word/sentence/paragraph/section counts) | **GENERIC-STRIP-ONLY + dead input** — reached only through a fabricated `useRunArtifact` button that required an `ingest-job` artifact that could never be created, so the button was permanently disabled; and `params:{}` meant the user's text was never passed | **DESIGNED** — runs on the main text-area content via `lensRun('ingest','parseDocument',{text})` |
| `extractEntities` | emails/urls/dates/phones/numbers extraction + counts | same fabricated dead-input defect | **DESIGNED** — runs on the text area |
| `validateSchema` | validate JSON records against expected fields (missing/extra/null) | same fabricated dead-input defect | **DESIGNED** — parses the text area as a JSON array; "Expected fields" input feeds `expectedFields` |
| `batchStatus` | summarize a batch of `{status}` items (completed/pending/failed/…) | same fabricated dead-input defect | **DESIGNED** — parses the text area as a JSON array of items |
| `batch-ingest` | reads dropped text-file contents → one DTU per file; binaries honestly `skipped` | DESIGNED — "Bulk Upload" button, but called via raw `api.post` that ignored the wrapped macro's `ok` | **DESIGNED** — now via `lensRun`, so a wrapped `{ok:false}` surfaces an honest error toast instead of "Ingested 0 files" |

**25/25 macros are DESIGNED** after this rebuild. There is also a real
external-data feature — `IngestionRepos` browses live GitHub repos by
ingestion topic (`api.github.com/search/repositories`) with a Save-as-DTU
action — which is genuine data-sourcing, not fabrication.

## The defect found and fixed

The lens's core ELT surface (`PipelinePanel`, 1273 LOC) was already real,
well-wired, and Airbyte-shaped — it uses the safe `lensRun` helper
(`lib/api/client.ts`), which unwraps the `/api/lens/run` envelope and checks
the **wrapped** macro's own `ok` (not just the always-true transport
envelope), so it is not subject to the envelope-unwrap bug seen in
`kingdoms`/`poetry`/`photography`.

The defect was in the page's **"AI Ingest Actions" panel** (defect class (c)
+ (a) from the program brief): the four document-analysis macros
(`parseDocument`, `extractEntities`, `validateSchema`, `batchStatus`) were
wired through the fabricated generic-artifact system —
`useLensData('ingest','ingest-job',{seed:[]})` +
`useRunArtifact('ingest')` → `POST /api/lens/{domain}/{id}/run`. That path:

1. required a **persisted `ingest-job` artifact** to exist, but the lens has
   no code path that ever creates one (`seed: []`), so `ingestArtifacts[0]?.id`
   was always `undefined` and **all four buttons were permanently disabled**
   ("Create an ingest job to run AI actions" showed forever) — a dead,
   unsurfaced capability sitting next to a fully-real macro;
2. even if an artifact had existed, it passed `params: {}`, so the user's
   actual text was **never** sent to the macro.

**Fix:** deleted the `useLensData`/`useRunArtifact` path entirely and replaced
it with direct `lensRun('ingest', action, input)` calls that pass real input —
`{text}` from the main text area for parse/extract, and a `JSON.parse`d array
(`{records, expectedFields}` / `{items}`) for schema/batch, with an honest
inline hint when the text isn't a JSON array. Added a bespoke "Expected
fields" input (comma-separated) driving `validateSchema`. Added honest
error/`message` rendering for the macros' empty-input and failure returns.
Also converted `batch-ingest` from raw `api.post` (which read
`res.data?.result` without checking `ok`, mis-reporting a failure as "Ingested
0 files") to `lensRun`, so a real failure now surfaces an error toast.

**Fluidity:** each analysis button flips to a per-action spinner immediately
on click (sub-100ms perceived response) and clears the prior result while the
real call is in flight; the primary Ingest button now shows a discoverable
`⌘↵` kbd chip matching its existing `useLensCommand` `mod+enter` binding.

## 1.5 Reference-parity checklist (vs. Airbyte / Fivetran)

| # | Checklist item | Disposition | Notes |
|---|---|---|---|
| 1 | Pre-built source connector catalog | ALREADY REAL | `listConnectors` catalog + categories, `PipelinePanel` grid; caliber: tracks Airbyte's source picker |
| 2 | Configure a connection (required-field validation, secret handling) | ALREADY REAL | `configureConnector` validates + redacts secrets; OAuth sources return a real `pending_oauth` + authorize URL |
| 3 | Scheduled sync (cadence) | ALREADY REAL | `scheduleSync` with real `nextRunAt`, toggle/delete |
| 4 | Incremental sync with cursor deltas | ALREADY REAL | `runSync` extracts only records past the stored cursor + advances it — the core Airbyte/Fivetran incremental model |
| 5 | Field-level transformation mapping + preview | ALREADY REAL | `previewTransform` (rename/cast/derive/drop) before→after; `saveMapping` applied by `runSync` |
| 6 | Configurable dedup | ALREADY REAL | `getDedupConfig`/`setDedupConfig` (strategy/threshold/key-field), applied in-run |
| 7 | Sync run history + replay | ALREADY REAL | `listSyncRuns` (row/byte totals) + `replaySyncRun` |
| 8 | Webhook / push ingestion endpoint | ALREADY REAL | `getWebhookEndpoint` (mint/rotate) + `pushRecord` + `listWebhookRecords` |
| 9 | OCR / document ingestion path | ALREADY REAL | `ocrIngest` structures multi-page OCR → headings/chunks/low-confidence flags |
| 10 | Inbound data profiling / validation (preflight before load) | FIXED THIS PASS | `parseDocument`/`extractEntities`/`validateSchema`/`batchStatus` were dead (fabricated-artifact path); now real, run on live input |
| 11 | Bulk file ingestion → knowledge store | ALREADY REAL (hardened) | `batch-ingest` mints one DTU per text file; now honest about wrapped-macro failures |
| 12 | Connector marketplace / discovery | ALREADY REAL (adjacent) | `IngestionRepos` browses live GitHub ingestion-topic repos + Save-as-DTU |

## Genuinely missing (deferred) — triage per the sixth hard invariant

The ELT surface is functionally complete against Airbyte's model at the
lens-local single-user tier. The honest gaps below are the "hard 20" for a
future Wave-4 gap-closure pass, each pre-triaged:

- **Live connector execution (real pulls from Postgres/REST/Sheets).**
  Today `runSync` is fed records the caller supplies (a real incremental
  engine over caller-provided rows), not an outbound fetch to the configured
  source. **Triage: ENGINEERING + DATA-SOURCING** — the SSRF-guarded
  `connectorFetch` chokepoint + encrypted per-user tokens already exist for
  Gmail/Calendar (`docs/CONNECTORS_GO_LIVE.md`); extending them to the
  REST-API connector is an engineering task, and each concrete source
  (Postgres, Sheets) needs its own real credential/egress path. Not faked in
  the meantime — the UI is honest that records are supplied to the run.
- **Server-persisted schedules that actually fire.** Schedules carry a real
  `nextRunAt` but there is no heartbeat draining due schedules into runs (the
  state is per-user in-memory `STATE.ingestLens`). **Triage: ENGINEERING** —
  a `registerHeartbeat("ingest-sync-cycle", …)` that walks due schedules,
  once live connector execution (above) exists to give it something to run.
- ~~**Schema auto-inference / column-type detection on preview.**~~ **CLOSED
  (2026-07-16, `e4f73b1d`)** — new `detectSchema` macro promotes
  `validateSchema`'s field-name-only no-schema branch into real per-field
  column-TYPE inference (type, nullable %, uniqueness %, real sample
  values), sampling every record rather than just the first. Type
  detection order matters and is deliberate: integer is checked before the
  general number bucket, and date patterns are checked before falling back
  to string. A field is only reported as a single type when the sample
  genuinely agrees — otherwise it's honestly `"mixed"` with a breakdown,
  never forced to a majority type. A new "Detect Schema" button and a real
  per-field table (type badge, nullable/uniqueness %, "likely PK" chip,
  sample-value chips) were added to the ingest page.

None of these are papered over with fabricated data in the current UI.
