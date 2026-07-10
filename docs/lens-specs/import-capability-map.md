# Import Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every field-shape claim below was checked against
> a LIVE macro trace (booted server, real handler output), not just a
> source-read — see "Runtime verification".

## Scope confirmation

This is a generic **data-import ETL utility** lens (schema inference, field
mapping, duplicate detection, transform preview, correction sessions,
templates, connectors, schedules, snapshots — an Airbyte/Stitch/Excel-
import-wizard shape), distinct from the "any file becomes a DTU" universal
importer (`UniversalImport.tsx`, POSTs to `/api/import/universal`, a
different subsystem) and distinct from the DTU-native export/restore
round-trip (see "What changed" below). All three legitimately coexist in
this one lens.

## Backend surface — filename/domain mismatch defeats the audit script

```
grep -c 'registerLensAction("import"' server/domains/importdomain.js   # → 25
grep -n 'registerLensAction("import"\|register("import"' server/server.js | wc -l  # → 2
```

The domain file is **`server/domains/importdomain.js`** (not `import.js` —
`import` is a reserved JS keyword, so the file is named to avoid the
collision, per its own header comment) but registers everything under the
`"import"` domain string. `node scripts/lens-unsurfaced.mjs --lens import`
→ **`No registered macros found for lens "import"`** — the script's
filename-stem matcher looks for `import.js`, finds nothing, and reports
zero macros instead of 25. This is the exact "domain filename note" defect
class flagged in this wave's brief. Independently confirmed all 25 by
direct grep + manual cross-reference against `page.tsx` /
`components/import/*.tsx` — every one has a real call site.

Two more macros are registered inline in `server.js` (lines 35637, 35706)
under the same `"import"` domain string: `import.json` and
`import.markdown` — a DTU-native restore pair matching `export.json`
(`server.js:35632`) and `export.markdown` (`:35563`) in the `export`
lens's domain. **Both had zero frontend call sites anywhere in the
codebase before this wave** — a second instance of the "macro cluster
invisible to the audit script and also never wired" pattern, this time
hiding behind both the filename mismatch AND being registered in a
different file (`server.js`) from the 25-macro cluster.

## Runtime verification

Booted the real server (`server/tests/depth/_harness.js`) and traced every
touched macro's actual return shape against the frontend's assumed
TypeScript interfaces. **This surfaced 7 real field-shape mismatches in
already-existing frontend code** (present before this wave, but never
exercised because the calling code fed the handlers empty artifacts — see
below) plus **one new bug in code written this wave**, caught by the same
live trace before it shipped:

| Macro | Frontend assumed | Real shape | Symptom before fix |
|---|---|---|---|
| `validateImport` | `status:'valid'` | `status:'pass'\|'warning'\|'fail'` | badge always red |
| `validateImport` | `validationRate` is 0-1 | already 0-100 | rate showed as e.g. `8750.0%` |
| `validateImport` | `errors:[{row,field,message}]` | `errors:[{rowIndex,errors:[{field,error,value}]}]` | `err.row`/`err.message` always `undefined` |
| `mapFields` | `coverage` is a number | `coverage:{sourcesCovered,targetsCovered}` | `NaN%` |
| `detectDuplicates` | `deduplicationSavings` is 0-1 | already 0-100 | savings inflated 100x |
| `detectDuplicates` | `fieldRepetition:[{field,repetitionRate}]` | `[{field,uniqueValues,uniquenessRatio,mostRepeatedCount}]` | bar width always `NaN` |
| `transformPreview` | `fieldImpact:[{field,changes,changeRate}]`, rate 0-1 | `[{field,changedRows,changeRate}]`, rate 0-100 | count always `undefined`, bar inflated 100x |
| `inferSchema` (new code, this wave) | field key is `name` | field key is `source`; `required` is already computed (not `!nullable`) | schema built with one bogus `"undefined"` key, `validateImport` flagged every real column as "unexpected field not in schema" |
| `import.markdown` (new code, this wave) | result field `total` | real field is `parsed` | restore count always `undefined` |

Every row above was confirmed by an actual `runMacro`/`lensRun` call
against the booted server (not inferred from reading the handler once) —
example: `inferSchema` on 3 rows returned
`{source:"age",inferredType:"number",confidence:0.6667,required:true,...}`,
proving `f.name` (undefined) was the bug and `f.source` is correct;
`validateImport` with the corrected schema then correctly flagged exactly
the one intentionally-bad row (`age:"notanumber"`) instead of failing
every row.

## The defect this wave found and fixed

Two independent problems, both present before this wave:

1. **`import.json` / `import.markdown` (DTU-native restore) — zero UI
   anywhere.** These pair with the `export` lens's JSON/Markdown formats
   (`export.json` returns `{dtus,count}`; `import.json` reads
   `{dtus,overwrite}` and skips already-present ids unless `overwrite`;
   `import.markdown` parses the exact `## Title` / `**ID:**…` /
   `> summary` / `### Definitions` structure `export.markdown` produces).
   You could export your corpus but never restore it through the UI.
2. **The "AI Import Analysis Actions" quick-button panel
   (`validateImport`/`mapFields`/`detectDuplicates`/`transformPreview`)
   called the real macros against an *import-job history artifact*
   (`{filename,type,status,progress,...}`) instead of real uploaded rows.**
   Every handler's own `rows.length === 0` branch returned its
   instructional fallback message ("No rows provided. Supply
   artifact.data.rows…") on every single click — a working-looking button
   grid that could never do real work. Compounding this, the drop-zone
   above it (`validateFile`) didn't call `validateImport` at all — it
   POSTed the raw file text prefixed with the string `"validate:"` to the
   generic `ingest.manual` endpoint and tried to read `.valid`/`.type`/
   `.record_count`/`.schema_version` fields off the response that
   `ingest.manual` doesn't return, so it always fell into either the
   hard-coded `{valid:true,record_count:0,...}` fallback or a genuine
   network-error path — never real validation. This is the "fabricated
   parallel system sitting next to real backend depth" defect class:
   `ImportParityWorkbench.tsx` proves the other 21 macros in this domain
   (correction sessions, templates, connectors, schedules, snapshots) are
   wired correctly with real inputs — these 4 foundational macros
   (plus `inferSchema`) were the gap.

## What changed this wave

**New `concord-frontend/components/import/RestoreDtuExport.tsx`** — paste
or upload a JSON/Markdown export payload, restore it via `import.json` /
`import.markdown`, shows imported/skipped/total counts, `overwrite`
checkbox for JSON restores (explicit, defaults off — never silently
clobbers existing ids). Mounted in `page.tsx` above `ImportParityWorkbench`.

**`app/lenses/import/page.tsx`, "Structured Data Import" drop-zone
(`validateFile`)** — now actually parses the uploaded file: a real
(bounded, RFC-4180-ish, quote-aware) CSV parser for `.csv`, or a JSON
array / `{rows:[...]}` / `{dtus:[...]}` parse for `.json`, then calls the
real `inferSchema` → `validateImport` macro pair on the parsed rows. Files
that aren't row-shaped (a `.zip` backup, freeform JSON) get an honest
fallback state — a note that the schema tools don't apply, not a
fabricated row count — and still flow through the existing generic
`ingest.queue` commit path (`startImport`, unchanged).

**"AI Import Analysis Actions" → "Row Analysis Actions"** — the same 4
buttons now operate on the real parsed rows from the upload above
(`analysisRows`/`analysisSchema` state) instead of an empty job artifact,
with 3 small, real, bounded inputs added above the buttons: a
comma-separated target-fields box (for `mapFields`), a comma-separated
dedup-key box (for `detectDuplicates`, defaults to all columns), and a
column + operation picker (for `transformPreview`, one transform rule at
a time — trim/lowercase/uppercase/toNumber/toDate/truncate). Removed the
now-unused `useRunArtifact` plumbing. Fixed the 7 field-shape mismatches
in the results-rendering block (table above) so the numbers these buttons
now genuinely produce render correctly instead of `NaN`/`undefined`.

Files touched:
- `concord-frontend/components/import/RestoreDtuExport.tsx` — new file.
- `concord-frontend/app/lenses/import/page.tsx` — real CSV/JSON parsing +
  real macro wiring for the analysis panel + 7 field-shape fixes.

## Left alone

The other 21 domain-file macros (correction sessions, templates,
connectors, schedules, snapshots/rollback) — already correctly wired by
`ImportParityWorkbench.tsx`, independently verified during this audit
(input shapes match handler signatures; not re-derived here since they
required no changes).

## Verification

- `node --check server/domains/importdomain.js` → OK (no server file
  touched — both fixed macro clusters were already real and correctly
  registered; only the frontend caller was wrong).
- `cd server && node --test tests/import-domain-parity.test.js` →
  16/16 passing.
- `cd concord-frontend && npx eslint app/lenses/import/page.tsx
  components/import/RestoreDtuExport.tsx` → clean.
- `cd concord-frontend && npx tsc --noEmit -p .` → 0 errors in either file.
- **Live macro traces** (`server/tests/depth/_harness.js`, both the
  `macroRuntime` helper for `import.json`/`import.markdown` and the
  `lensRun` helper for the `registerLensAction` family): `inferSchema` →
  `validateImport` → `detectDuplicates` → `mapFields` → `transformPreview`
  round-tripped on a real 3-row fixture with one intentionally-invalid
  value and one intentional duplicate row, and every result matched what
  the fixed frontend code now expects (see table above); `import.json` on
  a synthetic DTU returned `{imported:1,skipped:0,total:1}`; `import.markdown`
  on a synthetic export returned `{imported:1,parsed:1}`.
