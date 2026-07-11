# Metacognition Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("metacognition"' server/domains/metacognition.js
```
→ **15** macros in `server/domains/metacognition.js` (883 lines): 3 pure-compute
statistical analyzers (`confidenceCalibration`, `learningCurve`, `biasDetection`
— real Brier/log-loss/discrimination math, power-law/exponential curve fits,
anchoring/confirmation-bias/sunk-cost detection over caller-supplied data) plus
a 12-macro STATE-backed decision journal + reflection substrate
(`journalLog/List/Resolve/Delete`, `calibrationReport`, `reflectionPrompts/
Save/List`, `biasChecklist`, `strategyLibrary`, `streakStatus`,
`accuracyHistory`).

```
grep -c 'register("metacognition"' server/server.js
```
→ a **second, separate** 12-macro registry in `server/server.js` (`status`,
`assess`, `predict`, `resolve_prediction`, `calibration`, `select_strategy`,
`blind_spots`, `introspect`, `analyze_failure`, `adapt_strategy`,
`introspection_status`, `adjust_confidence`), routed through `MACROS`/
`runMacro` (not `LENS_ACTIONS`) and exposed via 12 REST routes at
`/api/metacognition/*` in `server/routes/domain.js`. This is a genuinely
different substrate — `STATE.metacognition` (global, not per-user-keyed data
structures like the domain-file journal) modeling the AI's OWN self-assessment
of its knowledge (`assessKnowledge` scores DTU coverage on a topic via
`findSimilarDtus`), its own prediction calibration, and introspection over its
own past prediction failures (four real pattern types: `domain_weakness`,
`overconfidence`, `underconfidence`, `topic_weakness`). No domain-name
collision with the 15 above (different macro names), so both sets are live
simultaneously — `/api/lens/run` prefers `LENS_ACTIONS` then falls back to
`MACROS`, and since the macro names never overlap here, neither shadows the
other. This pass added 2 more macros to this second registry —
`predictions_list` and `assessments_list` — closing a real gap: both
`recordPrediction()`/`assessKnowledge()` persisted data server-side that
nothing had ever listed back out (see defects below).

Total live macro surface: 15 + 12 + 2 (this pass) = **29**.

## Frontend surface

`concord-frontend/app/lenses/metacognition/page.tsx` (1506 LOC, 6 tabs:
Self-Awareness / Introspection / Predictions / Learning / Decision Journal /
Practice) + `concord-frontend/components/metacognition/{CogsciFeed,
DecisionJournal, ReflectionPrompts, BiasChecklist, StrategyLibrary,
AccuracyTracker}.tsx` (6 files, ~1,116 LOC combined).

## What's real and already-wired (found before touching anything)

The Decision Journal / Practice tabs — five of the six bespoke components —
were **already genuinely well-built**, correctly wired against the 15
`registerLensAction` macros via the canonical `lensRun()` client helper (the
documented fabricated-success-envelope fix pattern), with real charts
(`ChartKit` reliability diagrams, running-Brier trend lines, rolling-accuracy
lines), honest empty states, and no fabricated data anywhere:

- `DecisionJournal.tsx` — log/list/resolve/delete a decision with predicted
  outcome + confidence, real calibration report (Brier score, ECE, reliability
  diagram, tendency) computed server-side from resolved journal entries.
- `ReflectionPrompts.tsx` — structured after-action-review prompts, saves
  answers, real day-streak tracking.
- `BiasChecklist.tsx` — pre-decision checklist, honest local-only review
  state (explicitly documented as "not a macro call — a working surface").
- `StrategyLibrary.tsx` — 12 named reasoning techniques with when/how
  guidance, server-sourced.
- `AccuracyTracker.tsx` — accuracy-by-domain + rolling-accuracy trend +
  14-day reflection-habit calendar, all from `accuracyHistory`/
  `streakStatus`.
- `CogsciFeed.tsx` — a live arXiv metacognition-research feed (real fetch
  against `export.arxiv.org`, `SaveAsDtuButton` to cite a paper as a DTU),
  no fabrication.

## The defects found

The remaining tabs (Self-Awareness, Introspection, Predictions, Learning) —
which read from the **second** (server.js `STATE.metacognition`) substrate via
`apiHelpers.metacognition.*` REST calls — were pervasively broken by
field-shape mismatches between what the backend actually returns/expects and
what the frontend read/sent. None of these were fabricated data (every broken
section rendered an honest empty state, "--", or a silently-swallowed error)
but the practical effect was that four of the lens's six tabs were
non-functional regardless of how much real data existed server-side.

### 1. Predictions could be created but never seen, resolved, or displayed —
no `list` macro existed

`recordPrediction()`/`resolvePrediction()` (server.js) persisted into
`STATE.metacognition.predictions` (a `Map`), but **no macro or route ever
listed it back out** — only an aggregate `predictions: <count>` field on
`metacognition.status`. The frontend's `predictions` derivation read fields
(`predictions_list`/`recent_predictions`/`predictions_history`) that don't
exist anywhere on any payload, so it was always `[]`: the "Confidence vs
Accuracy" scatter, the "Recent Predictions" list, and the resolve
correct/incorrect buttons were permanently dead — a user could submit a
prediction via the form and then never see it again.

**Fixed**: added `metacognition.predictions_list` (server.js) + `GET
/api/metacognition/predictions` (routes/domain.js) + `apiHelpers.metacognition.
predictions()` (client.ts), wired into a new `useQuery` in `page.tsx`.

### 2. `predict()` sent `{claim}`; the macro reads `input.statement` — every
prediction ever made had an empty statement

`recordPrediction(input)` reads `input.statement`. The client helper sent
`{claim, confidence, domain}`. Verified live via the depth harness
(`macroRuntime` + `runMacro("metacognition","predict",...)`): a `{claim:
"..."}` call produces `prediction.statement === ""`. Every prediction a user
had ever logged through this UI recorded silently as a blank statement.

**Fixed**: `apiHelpers.metacognition.predict` now maps `claim → statement`.

### 3. `resolve()` sent `{outcome}`; the macro reads `input.correct` — every
"mark correct" click silently recorded as incorrect

`resolvePrediction(predictionId, wasCorrect)` derives `wasCorrect` from
`input.correct === true || input.wasCorrect === true`. The client helper sent
`{outcome: boolean}` — neither key the macro reads. Verified live: calling
resolve with `{outcome: true}` sets `prediction.outcome = "incorrect"` every
time (`wasCorrect` evaluates `undefined === true` → `false`). This is the
worst defect found — the UI's own green "mark correct" checkmark button
silently recorded the opposite of what the user clicked, corrupting every
calibration statistic downstream (Brier score, hit rate) with inverted data.

**Fixed**: `apiHelpers.metacognition.resolve` now sends `{correct: outcome}`.
Verified live post-fix: `{correct: true}` → `prediction.outcome === "correct"`.

### 4. `assess()` sent `{domain}`; the macro reads `input.topic` — every
domain assessment silently failed

`assessKnowledge(topic)` is invoked via `const topic = String(input.topic ||
"")`; empty topic returns `{ok:false, error:"topic required"}`. The client
helper sent `{domain}`. The mutation's `onError` only did `console.error` —
no user-visible failure. Verified live: calling with `{domain:"engineering"}`
returns the "topic required" error every time. This meant the Learning tab's
"Domain Assessment" tool had **never worked**, and — combined with defect 5 —
the Knowledge Confidence Map and Skill Improvement Timeline sections were
permanently empty regardless of how many times a user tried to use them.

**Fixed**: `apiHelpers.metacognition.assess` now maps `domain → topic`.
Verified live post-fix: real `knowledgeScore`, `gaps`, `recommendation`
returned.

### 5. `assessments_list` didn't exist — same shape of gap as defect 1

Symmetric to the predictions gap: `assessKnowledge()` appends to
`STATE.metacognition.assessments`, but only the count was ever surfaced.

**Fixed**: added `metacognition.assessments_list` + `GET
/api/metacognition/assessments` + `apiHelpers.metacognition.assessments()`,
wired into `page.tsx`. Knowledge Confidence Map and Skill Improvement Timeline
now render real per-topic `{domain, confidence, gaps, recommendation}` data.

### 6. `blind_spots` returns `{blindSpots}` (capital S); the frontend read
`.blindspots` (lowercase) — Active Blind Spots panel was permanently empty

`register("metacognition","blind_spots",...)` returns `{ok, blindSpots}`. The
frontend derivation read `blindspots?.blindspots` — a field that never
existed on any casing — so `spots` was always `[]`, hiding every blind spot
`assessKnowledge()` had ever identified. The render code also referenced
nonexistent fields (`spot.description`, `spot.domain`, `spot.recommendation`,
`spot.detected_at`) instead of the real shape (`spot.topic`, `spot.gaps[]`,
`spot.severity` as a 0–1 number, `spot.identifiedAt`).

**Fixed**: corrected the field read + the render to use the real shape
(topic as title, joined gaps list, severity formatted as a percentage,
`identifiedAt` timestamp).

### 7. `getCalibrationReport()` returns `{report: {...}}`; the frontend read
`.calibration` — Calibration Report card + Meta-Score stat permanently "--"

The frontend read `calibration?.calibration` (a field that never existed —
the real key is `report`) then, inside that already-empty object, read
`.accuracy` (real field: `overallAccuracy`) and `.trend` (doesn't exist at
all — the real, richer field is `.interpretation`: `"well-calibrated"` /
`"moderately calibrated"` / `"poorly calibrated"`). The "Additional
calibration metrics" grid also iterated `Object.entries(cal)` including a
nested `buckets` object, which would have rendered `[object Object]` once the
outer bug was fixed.

**Fixed**: corrected `cal` to read `.report`; corrected every `cal.accuracy` →
`cal.overallAccuracy` (3 call sites: quick-stat, summary card, calibration
card); replaced the fictional `.trend` with the real `.interpretation`;
replaced the blind `Object.entries` iteration with an explicit field
whitelist (`totalPredictions`, `correctPredictions`, `avgCalibrationError`) so
`buckets` is never blind-stringified.

### 8. Introspection tab rendered fictional "Strengths"/"Weaknesses"
sections the backend has no concept of, and discarded the one real result

`introspectOnFailures()` analyzes resolved predictions for four real pattern
types (`domain_weakness`, `overconfidence`, `underconfidence`,
`topic_weakness`) — it has **no** strengths/weaknesses concept anywhere in
its implementation. The "Current Introspection Results" panel had dedicated
green Strengths / red Weaknesses sections that could never be populated by
any real backend call — permanently-dead UI reading as a missing feature, not
an empty one. Separately, the mutation's own response (the just-run pass's
real `{patterns, recommendations, totalPredictions, failures, successes,
failureRate, confidenceAdjustments}`) was discarded after invalidating three
queries — the UI had no way to show what a just-run introspection actually
found, only the aggregate counts from `introspection_status`.

**Fixed**: removed the fictional Strengths/Weaknesses sections; captured the
mutation's real response into new `latestIntrospection` state and render its
actual fields (failure-pattern descriptions + recommendations, per-domain
confidence-adjustment multipliers, analyzed/failed/succeeded counts).

### 9. "Introspection History" read fields that don't exist
(`history`/`results`/`past_results`); the real data is `recentPatterns`

`introspection_status` returns `recentPatterns` (last 5 stored introspection
runs, each `{id, timestamp, totalPredictions, failures, successes,
failureRate, patterns: string[], recommendations, confidenceAdjustments}` —
note `patterns` here is downgraded to type-name strings only, not full
objects, once stored). The frontend read three fields that never existed, so
History always rendered empty even after running introspection repeatedly.

**Fixed**: `introspectionHistory` now reads `recentPatterns`; the render shows
the real per-run pattern-type list + analyzed/failed counts instead of the
nonexistent `entry.focus`/`entry.summary`/`entry.findings`.

### 10. "Pattern Recognition Highlights" (Learning tab) and "Recent
Knowledge Acquisitions" (Learning tab) read fields that don't exist anywhere

Both sections read `statusInfo.patterns`/`.pattern_recognition`/
`introData.patterns`/`.insights`/`.learning_insights`/`.recent_learning` —
none of which the backend produces under any name. Both were permanently
empty regardless of how much introspection/assessment activity had occurred.

**Fixed**: "Pattern Recognition Highlights" now aggregates failure-pattern
TYPE frequency across `recentPatterns` (a genuinely real "what keeps
recurring" signal). "Recent Knowledge Acquisitions" now maps
`assessments_list` (defect 5) into `{description: recommendation, domain:
topic, timestamp: assessedAt}` — assessKnowledge's own recommendation is the
honest analogue of a "learning insight" here; there is no separate insights
concept in the backend to source from instead.

### 11. "Cognitive Load" panel — dead UI with zero backing concept, removed

No field named `cognitive_load`/`load`/`current_load` (or any synonym)
exists anywhere in `STATE.metacognition` or any of its macro outputs. This
wasn't a wiring bug — there is structurally no way for this section to ever
render real data; it would have shown "Cognitive load data not yet
available. Run introspection to generate metrics." forever, regardless of how
many introspection passes ran, misleadingly implying a feature exists.

**Fixed**: removed per the "sections with no substrate stay unrendered"
doctrine — there is no honest way to compute this without inventing a number.

### 12. "Strategies" quick-stat always read `statusInfo.strategies` (doesn't
exist) instead of the real `statusInfo.stats.strategiesUsed`

**Fixed**: corrected the field path.

### 13. The "Metacognition Analysis" panel's 3 buttons were structurally
dead — wired through an artifact bridge that never carried the right data
shape

`confidenceCalibration`/`learningCurve`/`biasDetection` (the 3 general-purpose
statistical macros in the 15-macro registry) were reached via
`useLensData`/`useRunArtifact` against a lens-artifact "snapshot" that
`bridge.sync()` populates from `statusInfo`/`cal`/`introData` — none of which
ever contain a `predictions`/`progress`/`decisions` array. Every click
returned the macro's own honest "insufficient data" message, permanently,
regardless of how much real prediction/journal data existed — there was no
code path that could ever populate the artifact correctly.

**Fixed**: replaced the artifact-bridge indirection with direct `lensRun()`
calls carrying real derived data. `confidenceCalibration` now analyzes
resolved Predictions-tab entries (`predicted: confidence, actual: outcome==
'correct'?1:0`) — a richer statistical breakdown (log loss, discrimination,
confusion-matrix counts) of the **Predictions** substrate, distinct from and
complementary to the Decision Journal's own `calibrationReport` above (a
different substrate: `STATE.metacognition.predictions` vs. the per-user
journal). `learningCurve` fits a power-law/exponential curve to the
chronological cumulative-accuracy trend of resolved predictions and now
surfaces the macro's `predictedMasteryTrial` forecast (a genuinely novel
number: "at this improvement rate, you'll reach 90% calibration accuracy
around prediction #N") that wasn't rendered anywhere before. `biasDetection`
is **not** wired here — see Genuinely Missing below; the button was removed
rather than left dead.

## Macro → UI classification (all 29 macros)

**DESIGNED** — 26/29:

| Macro group | Count | Where |
|---|---:|---|
| `journalLog/List/Resolve/Delete`, `calibrationReport` | 5 | `DecisionJournal.tsx` (pre-existing, real) |
| `reflectionPrompts`, `reflectionSave`, `reflectionList` | 3 | `ReflectionPrompts.tsx` (pre-existing, real) |
| `biasChecklist` | 1 | `BiasChecklist.tsx` (pre-existing, real) |
| `strategyLibrary` | 1 | `StrategyLibrary.tsx` (pre-existing, real) |
| `streakStatus`, `accuracyHistory` | 2 | `AccuracyTracker.tsx` (pre-existing, real) |
| `confidenceCalibration`, `learningCurve` | 2 | `page.tsx` Predictions Analysis panel (**re-wired this pass** — was structurally dead, defect 13) |
| `status`, `predict`, `resolve_prediction`, `predictions_list` | 4 | `page.tsx` Predictions tab (**field-shape fixes + new list macro this pass** — defects 1–3) |
| `assess`, `assessments_list` | 2 | `page.tsx` Learning tab (**field-shape fix + new list macro this pass** — defects 4–5) |
| `blind_spots`, `calibration` | 2 | `page.tsx` Self-Awareness tab (**field-shape fixes this pass** — defects 6–7) |
| `introspect`, `introspection_status` | 2 | `page.tsx` Introspection tab (**re-rendered against real fields this pass** — defects 8–9) |
| `select_strategy` | 1 | not called by `page.tsx` (client helper exists but no button invokes it — see below) |
| `adjust_confidence` | 1 | not called by `page.tsx` (same) |

**GENERIC-STRIP-ONLY**: none. `<ManifestActionBar>`/`<UniversalActions>`/
`<LensFeaturePanel>`/`<RecentMineCard>`/`<AutoActionStrip>` remain mounted as
the standard capability-directory pattern, but the page is 1506 LOC across 6
tabs with 6 substantial bespoke components (1,116 LOC) plus extensive
page-level bespoke rendering — not a thin generic-scaffold page. Confirmed
via `node scripts/grade-ux-polish.mjs --honest`: `tier: "polished"`,
`isGenericScaffold: false`.

**UNSURFACED**: `biasDetection` (see Genuinely Missing), plus `select_strategy`
and `adjust_confidence` — both have a working `apiHelpers.metacognition.*`
client helper (fixed for correctness this pass, see below) but no button in
`page.tsx` invokes either. `node scripts/lens-unsurfaced.mjs --lens
metacognition` only scans `server/domains/metacognition.js` (the 15-macro
registry), so it doesn't see these — they live in the server.js registry.
Both are triaged as ENGINEERING-deferred (see below).

### Two more field-shape bugs found and fixed while auditing, not currently
user-visible (dead client helpers, not yet exercised by any button)

- `apiHelpers.metacognition.strategy` sent `{strategy, params}`; the macro
  (`select_strategy`) reads `input.problem`. Fixed to map correctly — no
  functional change today since no button calls this helper, but the next
  caller to wire a strategy-selection button would otherwise hit the same
  silent-failure class as defects 2–4.
- `apiHelpers.metacognition.introspect` sends `{focus}`, which
  `introspectOnFailures()` silently ignores (analyzes ALL resolved
  predictions unconditionally — the function takes no parameters at all).
  Not a wiring bug (the field arrives, it's just unused server-side) but the
  "Focus area (optional)" input in the Introspection tab is decorative —
  documented in the client helper as a known limitation rather than silently
  left to look functional.

## Confirmed real and left alone, with reason

`grep -n "Math.random|MOCK|mock|fake|Lorem|lorem|hardcoded"
components/metacognition/*.tsx app/lenses/metacognition/page.tsx` → no
fabrication signatures found.

- **Two parallel metacognition substrates (15-macro domain file + 12-macro
  server.js registry) coexist by design**, not a defect — one is a
  human-facing personal decision journal, the other models the AI's own
  self-assessment/calibration/introspection over its own predictions. Kept
  both; fixed the wiring bugs in the second one rather than merging or
  removing either.
- **`CogsciFeed.tsx`'s live arXiv fetch** — real external API call, not
  server-proxied, correctly loading/error-states. Left alone.

## Genuinely missing, deferred

- **`biasDetection` is not wired to any real data source in this lens —
  triaged ENGINEERING, deferred.** The macro requires
  `decisions: [{options: [{name, score, evidence: [{supports, strength}]}],
  chosen, initialAnchor?, investedCost?}]` — and structurally needs **at
  least 2** decisions in each bias category to produce any signal at all
  (each of the three bias analyses in the macro short-circuits below
  `length >= 2`). Neither existing decision-capture surface in this lens
  provides that shape: the Decision Journal's `journalLog` only captures
  flat option **labels** (strings, no per-option score/evidence) and a
  single top-level confidence — there is no anchor value, no invested-cost
  field, and no per-option evidence-for/against structure anywhere in the
  journal schema. Feeding it from `predictions_list` (the other candidate)
  doesn't work either — predictions have no `options`/`chosen`/`anchor`
  concept at all. Building this honestly requires extending
  `journalLog`/the journal-entry form with per-option score + evidence +
  optional anchor/invested-cost fields — a decision-schema change, not a
  frontend wiring fix — so it is out of scope for this pass. Disposition:
  **ENGINEERING** (no external data dependency; a defined, boundable backend
  + form change for a future pass). The button was removed from the
  Predictions Analysis panel rather than left calling into an always-empty
  result (see defect 13) — leaving a button that can only ever say "no bias
  data" is a worse outcome than an honest omission with this note.
- **`select_strategy` and `adjust_confidence` have no designed UI entry
  point.** Both are functional, correctly-shaped macros (fixed this pass —
  see above) but nothing in `page.tsx` currently offers a "pick a reasoning
  strategy for this problem" or "get a domain-adjusted confidence estimate"
  interaction. Triage: **ENGINEERING** — no external data or curation
  dependency, just an unbuilt UI affordance. Deferred rather than bolted on
  as a generic button, since a designed feature (matching invariant 2) needs
  real UI thought about where in the flow a user would reach for either —
  left as a named gap rather than a rushed addition.

## Verification

- `node --check server/server.js` — clean.
- `node --check server/routes/domain.js` — clean.
- `node --test tests/metacognition-domain-parity.test.js
  tests/depth/metacognition-behavior.test.js` (from `server/`) — **18/18
  pass** (17 + 1 suite), unmodified by this pass (they cover the 15-macro
  domain-file registry, untouched).
- Live verification of every fixed macro against the booted in-memory server
  (`server/tests/depth/_harness.js`'s `macroRuntime`), not just static
  review: `predict` with `{statement}` now stores the real statement (was
  empty with the old `{claim}` shape); `resolve_prediction` with
  `{correct:true}` now resolves `outcome:"correct"` (was silently
  `"incorrect"` with the old `{outcome:true}` shape — the single worst
  defect found); `assess` with `{topic}` now returns a real knowledge score
  + gaps (was `{ok:false,error:"topic required"}` with the old `{domain}`
  shape); `predictions_list`/`assessments_list` both return real,
  newest-first data; `blind_spots` confirmed to return `{blindSpots}`
  (capital S); `calibration` confirmed to return `{report:{overallAccuracy,
  totalPredictions, ...}}`.
- `npx eslint app/lenses/metacognition/page.tsx lib/api/client.ts` (from
  `concord-frontend/`) — clean, exit 0.
- `node scripts/verify-lens-backends.mjs` (from repo root) —
  `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 (metacognition was already
  WIRED and stays WIRED).
- `node scripts/grade-ux-polish.mjs --honest` (from repo root) —
  metacognition entry: `"tier": "polished"`, `"isGenericScaffold": false`,
  `"pillarsPresent": 5`, `"antiPatterns": 0`. `audit/` reverted via `git
  checkout -- audit/` immediately after (shared working tree).
