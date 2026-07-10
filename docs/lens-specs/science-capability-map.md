# Science Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("science"' server/domains/science.js
```
→ **35** macros in `server/domains/science.js` (1,224 lines). No inline
`register("science", ...)` registrations exist in `server.js`
(`grep -n 'register("science"' server/server.js` → empty), so this one file
is the complete backend surface. This is an electronic-lab-notebook /
Benchling-Quartzy-shape domain: sample chain-of-custody, equipment
calibration, protocol validation, a full descriptive/inferential statistics
engine (t-test, ANOVA, regression, Mann–Whitney, confidence intervals), a
per-user tabular dataset store + chart renderer, a lab notebook, a
protocol-run execution log, reagent inventory, publication export, and a
vision macro for lab-image analysis.

## Frontend surface (11 files, 4,623 LOC per `grade-ux-polish.mjs`)

`concord-frontend/app/lenses/science/page.tsx` (2,217 LOC) +
`concord-frontend/components/science/{ExperimentActionPanel,ScienceArxiv,
ScienceCharts,ScienceDataGrid,ScienceNotebook,ScienceProtocolRuns,
SciencePublicationExport,ScienceReagents,ScienceStats,ScienceWorkbench,
ScienceFieldLog(new this pass)}.tsx`.

## What was already real (verified, no changes needed)

`ScienceWorkbench.tsx` is a floating-button-launched slide-over modal
(`fixed inset-y-0 right-0 w-[720px]`, opened via a "Science Workbench"
button) with, pre-pass, 7 tabs each a bespoke component calling `lensRun`
directly with field shapes verified against the macro source:

| Tab | Macros | Verified shape match |
|---|---|---|
| Statistics (`ScienceStats.tsx`) | `stats-descriptive`, `stats-ttest`, `stats-correlation`, `stats-anova`, `stats-regression`, `stats-nonparametric`, `stats-ci` | Exact — `data`/`kind`/`a`/`b`/`mu`/`x`/`y`/`groups`/`test`/`confidence` fields match the handler reads 1:1. **Special-checked per the assignment brief's fabrication concern**: every displayed number (t, p, r², slope, CI bounds, F-statistic, U) traces to `server/domains/science.js`'s own t-CDF/incomplete-beta/erf implementation via a real POST — no client-side placeholder formula, no hardcoded p-value. Confirmed via `grep -n "Math.random\|MOCK\|mock\|fake\|hardcoded" components/science/*.tsx` → zero hits across all 10 (now 11) files. |
| Data Grid (`ScienceDataGrid.tsx`) | `dataset-save/update/get/delete/list` | Exact — spreadsheet grid persists `{name, columns, rows}` |
| Charts (`ScienceCharts.tsx`) | `chart-render` | Exact — `datasetId`/`kind`/`xColumn`/`yColumn`/`valueColumn`/`categoryColumn` |
| Notebook (`ScienceNotebook.tsx`) | `notebook-add/update/list/delete` | Exact |
| Protocol Runs (`ScienceProtocolRuns.tsx`) | `protorun-start/step/complete/list/delete` | Exact — real step-by-step execution tracking, distinct from protocol *validation* |
| Reagents (`ScienceReagents.tsx`) | `reagent-save/consume/list/delete` | Exact |
| Publication (`SciencePublicationExport.tsx`) | `publication-export` | Exact |

`ScienceArxiv.tsx` fetches real, live arXiv Atom-feed data directly from
`export.arxiv.org` client-side (not through the macro system) — real data,
correctly labeled, no defect. Note: `science` is not one of the 9 domains
`server/domains/research-live.js` wires a `live_arxiv` macro for (physics,
quantum, robotics, neuro, bio, chem, math, ml, ai) — so a hypothetical
`lensRun('science','live_arxiv',...)` call would fail; the component
correctly avoids that path entirely.

## The defect: 4 macro-backed actions wired with the wrong field shape, plus 2 fully unsurfaced macros

`ExperimentActionPanel.tsx` (a second, always-visible "Experiment workbench"
panel below the tab bar, described in its own header as
"Quartzy / Benchling-shape action surface") called four real macros —
`calibrationCheck`, `validateProtocol`, `dataQualityReport`, `chainOfCustody`
— but every one of the four payloads had the wrong shape for what the
handler actually reads (verified by a full read of `server/domains/science.js`
lines 10–228):

- **`calibrationCheck`** (line 25) reads `artifact.data.calibrationDate` /
  `.nextCalibration` / `.serial` for **one** piece of equipment. The panel
  sent `{ instruments: [{name}, ...] }` — a list of bare names with no dates
  anywhere in the UI. Every call returned `status: 'unknown', daysUntilDue:
  null` regardless of real calibration state — a dead button.
- **`validateProtocol`** (line 166) reads `artifact.data.protocol.steps` (an
  array of `{name|step}` objects), `.safetyChecks`, `.equipment`. The panel
  sent `{ protocol: "<raw text>", steps: [...] }` — a STRING under the
  `protocol` key, so `protocol.steps` (string.steps) was always `undefined`
  → `steps = []` → the same 4 canned "missing_step" issues
  (preparation/execution/data_collection/cleanup) fired on **every** call
  regardless of what the user actually typed. This is exactly the
  "fabricated-looking output" the assignment brief warns is most damaging in
  a lab domain — a protocol validator that always says "invalid" no matter
  what protocol you enter reads as broken trust, not an honest failure.
- **`chainOfCustody`** (line 10) reads `artifact.data.chainOfCustody` (an
  array of `{transferredTo, receivedBy, date}` transfer records) for **one**
  sample. The panel sent `{ samples: [{id}, ...] }` — a list of sample IDs,
  no transfer records. `chainOfCustody` always returned `intact: true,
  transfers: 0` — a *positive-looking* result ("chain intact!") that is
  actually meaningless, since zero transfer records were ever supplied. This
  is the single most misleading case found this pass: a compliance check
  silently reporting success on absent data.
- **`dataQualityReport`** (line 38) reads `artifact.data.dataset` /
  `.observations` / `.records` (an array of row objects for per-field
  completeness/outlier stats). The panel sent `{ samples: [{id}, ...] }` —
  none of the three keys the handler checks. Every call returned
  `{ error: 'No dataset found', totalRecords: 0 }` — a dead button with a
  literal error message shown on every click.

Separately, **2 real macros had zero frontend caller anywhere in the lens**:
`dataExport` and `spatialCluster`. Both had dead render blocks in
`page.tsx`'s "Action Result" panel (JSX conditionals matching on
`actionResult.records`/`.format` and `.clusters` that could never fire,
since no button ever called `handleAction('dataExport')` or
`handleAction('spatialCluster')`) — unreachable code paths for two
real, working macros (GeoJSON/CSV export and Haversine-approximate
spatial clustering of GPS-tagged field observations).

A **7th macro, `sampleAudit`**, was reachable only through a broken path:
`app/lenses/science/page.tsx`'s "Domain Actions" bar (visible on every
non-Dashboard tab) called `handleAction('sampleAudit')`, which POSTed to
`/api/lens/science/:id/run` (the **persisted-artifact** run route, a
different code path from `/api/lens/run`) against
`artifactId || editingItem?.id || filtered[0]?.id` — i.e. whichever
fabricated-CRUD artifact (`Experiment`/`Sample`/`Equipment`/etc., see
"Confirmed real and left alone" below) happened to be first in the
**current tab's** filtered list. Clicking "Sample Audit" while on the
Notebook tab ran the macro against an `Experiment` record with none of
`sampleAudit`'s expected fields (`chainOfCustody`/`storage`/`expiryDate`/
`handling`) — same field-shape-mismatch defect, compounded by targeting the
wrong record entirely. The same broken bar also duplicated (redundantly,
and with the same wrong-target bug) `validateProtocol` and
`calibrationCheck`, which were already correctly reachable — once fixed —
via `ExperimentActionPanel.tsx`.

**8th macro, `vision`**, had zero frontend caller. Unlike other lenses that
mount the shared `VisionAnalyzeButton`/`useVisionAnalysis` component, that
component does **not** call the `science.vision` macro at all — it POSTs to
a generic `/api/chat?full=1` vision-chat endpoint, a completely different
code path. Mounting `VisionAnalyzeButton` on this page would not have closed
this gap; it would have added an unrelated generic-vision feature while
leaving the domain-specific `science.vision` macro (which uses
`visionPromptForDomain("science")` — "Describe this scientific image,
diagram, or figure...") still unsurfaced.

## What changed

### 1. `components/science/ExperimentActionPanel.tsx` — fixed 4 field-shape bugs, added 2 new real actions

- **Calibration**: replaced the freeform "Instruments" list with a
  repeatable table (name / serial / last calibration / next calibration).
  Since the macro checks exactly one instrument per call, the action now
  makes N real `calibrationCheck` calls (one per row) and aggregates the
  results into a single summary (`overdue`/`due_soon`/`current` status +
  a per-instrument issue list) — every number in the result now traces to
  a real per-instrument computation instead of a constant "unknown".
- **Validate protocol**: the existing "Protocol (one per line)" textarea is
  now converted into `{name: line}` step objects and sent nested under a
  `protocol` object together with new **Safety checks** (repeatable
  description + verified-checkbox rows) and the **same equipment table**
  used by Calibration (reused, not duplicated — one equipment list feeds
  both actions). The required-step / safety-check / equipment-calibration
  logic in the macro now runs against what the user actually typed.
- **Sample audit** (new action, closes the `sampleAudit` gap): a repeatable
  sample table (ID / name / required+actual storage temp / expiry date /
  gloves-required+used / sterile-required+confirmed) feeding
  `{samples: [...]}` with the exact `storage`/`expiryDate`/`handling` shape
  the macro reads.
- **Chain of custody**: replaced the sample-ID list with a real repeatable
  transfer-record table (transferred to / received by / date) plus a
  display-only sample-name field, feeding `{chainOfCustody: [...]}`. The
  result now reports the real transfer count and any genuine custody gaps
  instead of a constant "0 transfers, intact".
- **Vision** (new action, closes the `vision` gap): an image upload that
  base64-encodes the file and calls `lensRun('science', 'vision',
  {imageB64})` directly — the real domain-specific macro, not the generic
  vision-chat sibling.
- Removed `dataQualityReport` from this panel (it was conflating "sample
  compliance" with "tabular dataset quality" — two different concepts with
  two different real inputs) and rewired it below, against real tabular
  data instead of a disconnected sample-ID list.
- `actMint`'s DTU payload now embeds `sampleAudit` instead of the old
  (deleted) quality-report result.

### 2. `components/science/ScienceDataGrid.tsx` — wires `dataQualityReport` against real tabular data

Added a "Data Quality Report" button inside the dataset editor, operating
on the **currently open/edited grid** (no separate save step required):
converts the live `columns`/`rows` state into row objects
(`{col1: val1, col2: val2, ...}`, reusing the existing numeric-coercion
helper) and calls `dataQualityReport({dataset})`. Renders real per-field
completeness bars, quality rating, and (for numeric columns) mean/stdDev/
outlier counts — the macro's actual output, on the user's actual data.

### 3. `components/science/ScienceFieldLog.tsx` (new) — closes `dataExport` + `spatialCluster`

A new "Field Log" tab in `ScienceWorkbench.tsx` (8th tab): a repeatable
GPS-tagged observation table (date/observer/type/notes/lat/lon) feeding
both macros with the same `{observations: [...]}` array:
- **Export**: format toggle (CSV/GeoJSON) → `dataExport`. Honesty note: the
  macro's non-GeoJSON branch returns the raw observation array, not actual
  CSV text (an existing, unmodified backend characteristic) — the frontend
  builds real CSV text client-side from that array before download, so the
  "CSV" label on the download button is accurate rather than downloading
  JSON with a misleading extension.
- **Spatial cluster**: radius (km) input → `spatialCluster`, rendering the
  real cluster count/membership/center coordinates.

### 4. `app/lenses/science/page.tsx` — removed the broken, redundant "Domain Actions" bar

Deleted the 4-button "Domain Actions" row (`validateProtocol`/`sampleAudit`/
`calibrationCheck`/`dataQualityReport`, all field-shape-broken and
wrong-target as described above) and the dead "Action Result" panel
(`actionResult` state + its `chainOfCustody`/`calibrationCheck`/
`dataExport`/`spatialCluster` JSX render blocks, the latter two literally
unreachable since no button ever set them). Removed the now-fully-dead
`handleAction`/`runAction`/`useRunArtifact` plumbing and the resulting
unused imports/vars (`useRunArtifact`, `showToast`, `Archive`,
`ShieldCheck`, `Target`, `editingItem`) — all four capabilities this bar
attempted are now correctly, robustly surfaced via `ExperimentActionPanel`
(3 of them) and `ScienceDataGrid` (the 4th), so removal is a
broken-and-redundant cleanup, not a capability loss.

## Macro → UI classification (all 35 macros)

**DESIGNED** — 35/35 after this pass:

| Macro group | Count | Where |
|---|---:|---|
| `stats-descriptive/ttest/correlation/anova/regression/nonparametric/ci` | 7 | `ScienceStats.tsx` (pre-existing, real) |
| `dataset-save/update/get/delete/list` | 5 | `ScienceDataGrid.tsx` (pre-existing, real) |
| `chart-render` | 1 | `ScienceCharts.tsx` (pre-existing, real) |
| `notebook-add/update/list/delete` | 4 | `ScienceNotebook.tsx` (pre-existing, real) |
| `protorun-start/step/complete/list/delete` | 5 | `ScienceProtocolRuns.tsx` (pre-existing, real) |
| `reagent-save/consume/list/delete` | 4 | `ScienceReagents.tsx` (pre-existing, real) |
| `publication-export` | 1 | `SciencePublicationExport.tsx` (pre-existing, real) |
| `calibrationCheck`, `validateProtocol`, `chainOfCustody` | 3 | `ExperimentActionPanel.tsx` (**field shapes fixed this pass**) |
| `sampleAudit` | 1 | `ExperimentActionPanel.tsx` (**newly wired this pass** — was unreachable except via the broken Domain Actions bar) |
| `vision` | 1 | `ExperimentActionPanel.tsx` (**newly wired this pass**, calling the real domain macro, not the generic vision-chat sibling) |
| `dataQualityReport` | 1 | `ScienceDataGrid.tsx` (**newly wired this pass**, moved here from a mismatched slot in `ExperimentActionPanel.tsx`) |
| `dataExport`, `spatialCluster` | 2 | `ScienceFieldLog.tsx` (**new component this pass**) |

Total: 7+5+1+4+5+4+1+3+1+1+1+1+2 = **35**. Matches
`grep -c 'registerLensAction("science"' server/domains/science.js`.

**GENERIC-STRIP-ONLY**: none. Every real macro is called from a bespoke,
purpose-built form (repeatable rows, typed fields, per-domain result
rendering) — no `<UniversalActions>`/`<LensFeaturePanel>` button wall stands
in for any of the 35. (`<UniversalActions domain="science" .../>` is still
mounted once, at the top of `page.tsx`, as a general AI-actions affordance —
unrelated to and not a substitute for any of the 35 domain macros.)

**UNSURFACED**: none remaining.

## Confirmed real and left alone, with reason

The 6-artifact-type CRUD system in `page.tsx` (`Experiment`/`Sample`/
`Equipment`/`Analysis`/`Protocol`/`Publication`, driven by
`useLensData<ArtifactDataUnion>` — a generic `/api/lens/:domain` artifact
store, not any of the 35 `science.*` macros) was **investigated and kept
as-is**, unlike the analogous system in the insurance capability map (which
was deleted). The two situations differ in a load-bearing way:

- In insurance, the fake `Policy`/`Claim` tabs **duplicated a fully real,
  richer, macro-backed policy/claim system** that was already mounted
  elsewhere on the same page — keeping both was pure redundant dead weight.
- Here, none of the 6 fabricated-CRUD concepts (structured experiment
  metadata with hypothesis/PI/reproducibility/dates; a sample **inventory**
  record; an equipment **inventory** record; a persisted analysis-result
  record with mean/median/pValue fields; protocol **authoring** with
  version/approval-status/change-log; a tracked publication record with
  journal/DOI/impact-factor/submission-status) has a real, exact macro
  counterpart. The nearest real neighbors (`notebook-*`, `protorun-*`,
  `publication-export`) model **different, narrower concepts** (a rich-text
  notebook entry; a protocol's step-by-step *execution* log, not its
  authored *version history*; a one-shot manuscript *export bundle*, not a
  tracked submission-status record) — there is no redundant duplicate to
  consolidate against.
- The data is genuinely persisted (a real `/api/lens/:domain` CRUD store,
  not `Math.random()`/hardcoded values) and the editor UI is bespoke
  per-artifact-type (distinct field sets per tab), not a generic JSON-paste
  or button-wall — so it does not match either the "fabricated data" or the
  "generic scaffold" defect signature the two hard invariants describe.

**Documented, not fixed, this pass**: the fake `Notebook`/`Protocols`/
`Publications` tab **names** collide with the real `ScienceWorkbench`
tabs of the same name (`notebook-*` macros vs. free-text `Experiment`
records; `protorun-*` step-execution vs. authored-protocol metadata;
`publication-export` bundle-builder vs. a tracked publication record) —
a genuine naming/mental-model overlap worth a future rename pass (e.g.
"Experiment Log" / "Protocol Library" / "Publication Tracker" for the
generic-CRUD tabs), but renaming 6 tab labels + their card renderers is a
larger, more invasive change than this pass's field-shape/wiring mandate
justifies without a stronger reason to touch ~1,400 lines of otherwise-
working, non-fabricated code. Flagged for a maintainer decision, not acted
on.

`grep -n "Math.random\|MOCK\|mock\|fake\|Lorem\|lorem\|hardcoded"
components/science/*.tsx app/lenses/science/page.tsx` → zero hits, both
before and after this pass — confirms no literal fabrication signature
anywhere in the lens, including inside the generic-CRUD system.

## Genuinely missing, deferred

None found with zero backend support this pass — every capability gap
identified (calibration/protocol/audit/custody/vision field shapes,
dataQualityReport's wrong data source, dataExport/spatialCluster being
unsurfaced) had a real, already-shipped backend macro; the fix was entirely
frontend wiring, no new backend behavior was invented.

## Verification

- `node --check server/domains/science.js` — clean (file untouched this
  pass; verified anyway per the assignment brief).
- `node --test tests/science-domain-parity.test.js
  tests/depth/science-behavior.test.js` (from `server/`) — **33/33 pass**,
  unmodified.
- `npx eslint app/lenses/science/page.tsx components/science/*.tsx` (from
  `concord-frontend/`) — clean, exit 0, zero warnings.
- `npx tsc --noEmit -p .` (from `concord-frontend/`) — zero new errors; the
  only 4 errors in the full-repo run are pre-existing, in unrelated lenses
  (`components/ethics/DecisionToolkit.tsx`,
  `components/events/EventOps.tsx`) — the same pre-existing pair the
  insurance capability map documented.
- `node scripts/verify-lens-backends.mjs` (from repo root) — science is
  not in the `NO-BACKEND-CALL` list (`narrative-walk`, `ux-suite` only);
  `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 — science stays WIRED.
- `node scripts/grade-ux-polish.mjs --honest` (from repo root) — science
  entry: `"tier": "polished"`, `"isGenericScaffold": false`,
  `"honestCapped": false`, `"pillarsPresent": 5`, `"antiPatterns": 0`,
  `"bespokeRatio": 0.52` (11 files, 4,623 total LOC, 2,406 bespoke-component
  LOC — the low single-file `maxBespokeComponentLoc` of 393 reflects the
  intentional multi-component split, not thin content; noted per the
  assignment's known-false-positive guidance, not acted on).
  `audit/` outputs reverted via `git checkout -- audit/` per the transient-
  artifact rule (confirmed no diff was produced in the first place).
