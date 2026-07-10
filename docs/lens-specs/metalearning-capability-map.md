# Metalearning Lens — Capability Map (Frontend Rebuild Program, Wave 2)

Reproduce the macro list:
`grep -c 'registerLensAction("metalearning"' server/domains/metalearning.js` → 19
Plus a separate real-REST macro-learning system registered inline in
`server/server.js` (`register("metalearning", "status"|"define_strategy"|
"record_outcome"|"adapt"|"curriculum"|"best_strategy"|"list_strategies"|
"adaptations", ...)`), surfaced through `server/routes/domain.js` at
`/api/metalearning/*` (not through the generic `/api/lens/metalearning` path).

## Reference apps

- **Anki / SuperMemo** — spaced-repetition scheduling (SM-2-derived interval growth).
- **A learning-strategy-science coach** — deliberate-practice technique library
  (retrieval practice, interleaving, elaboration, dual coding, self-explanation,
  Feynman technique), goal tracking, and A/B strategy experiments, in the spirit
  of tools like RemNote/Learning-How-to-Learn courseware.

## Audit finding: this lens was already largely rebuilt

Before this pass, the page already mounted seven bespoke, backend-wired
practice panels (`SpacedRepetitionPanel`, `LearningPlanPanel`,
`TechniqueLibraryPanel`, `ProgressAnalyticsPanel`, `GoalTrackerPanel`,
`StrategyExperimentPanel`, `StudyJournalPanel`) plus a live arXiv research
feed (`MetalearningFeed`) and a real strategy-creation/curriculum-generation
form wired to the `/api/metalearning/*` REST surface. None of that was
fake or generic — it was left as-is.

What was genuinely wrong, found by close reading rather than assumed from a
working-looking UI:

1. **Field-name mismatch silently broke the strategy list.** The frontend's
   `Strategy` interface declared `type` and `successRate`; the real backend
   (`list_strategies` macro in `server.js`) returns `domain` and
   `avgPerformance` — there is no `type` concept on the server model at all.
   Effect: every strategy's type badge and success-rate progress bar
   rendered blank/undefined, silently, for every user, always. Fixed by
   renaming the interface fields to match the real payload and rewriting the
   filter/search/bridge logic around `domain`.
2. **The "New Strategy" form's type dropdown was discarded server-side.**
   `createStrategy({ name, type })` posted a `type` field
   (exploration/exploitation/hybrid/curriculum) that `define_strategy` on the
   server never reads — it reads `domain` (used to group/rank strategies via
   `best_strategy(domain)`). The dropdown looked functional but every
   selection was silently dropped. Replaced with a real domain text input
   and fixed the `apiHelpers.metalearning.createStrategy`/`recordOutcome`
   TypeScript signatures to match what the server macros actually consume
   (`server.js` `recordStrategyOutcome` reads `outcome.performance`, not the
   `metrics` field the old type declared).
3. **Two real, already-live REST endpoints were completely unsurfaced:**
   `POST /api/metalearning/strategies/:id/outcome` (record a success/failure
   against a strategy — feeds its running average and can trigger
   auto-adaptation) and `GET /api/metalearning/adaptations` (the log of
   parameter changes the server already makes in response to recorded
   outcomes). Added: per-strategy Success/Failure/Adapt-now buttons and a new
   Adaptation Log panel rendering real `{strategyName, adaptations[],
   triggerPerformance, adaptedAt}` records.
4. **The three analysis macros (`strategySelection`, `transferAnalysis`,
   `performanceProfile`) were wired to the wrong data source.** The page ran
   them against `mlStratItems[0]` — an artifact pulled from the generic
   per-domain artifact store (`/api/lens/metalearning?type=strategy`) whose
   `.data` shape is `{id, name, domain, uses, avgPerformance}` (the bridged
   real strategies). None of the three macros read those fields —
   `strategySelection` wants `taskFeatures`/`landmarkTasks`,
   `transferAnalysis` wants `sourceDomain`/`targetDomain`,
   `performanceProfile` wants `assessments`. Concretely:
   `strategySelection` silently fell into its no-landmark-data heuristic
   branch every time (identical hardcoded-default output regardless of which
   real strategy was "selected" — a confident, wrong "fake success"), while
   the other two correctly degraded to an honest "no data" message. Fixed by
   dropping the generic-artifact indirection entirely and calling
   `lensRun('metalearning', action, input)` directly with real, small,
   purpose-built input forms per action (numeric task-feature sliders for
   strategy selection; source/target domain name + concept/skill fields for
   transfer analysis; an addable skill/difficulty/score row list for the
   performance profile) — `/api/lens/run` passes the posted input straight
   through as the macro's `artifact.data`, so no artifact needs to exist
   first.

## What this rebuild changed

- `concord-frontend/app/lenses/metalearning/page.tsx` — dropped the generic
  AI-action bar and the generic capability-list section (both templated,
  neither reachable through any bespoke panel above); consolidated the
  duplicated stat-card row into one meaningful set (avg performance,
  recorded outcomes, best strategy + its domain, curricula/outcomes/
  adaptation counts); added the Record Outcome/Adapt controls, the
  Adaptation Log panel, and the three purpose-built analysis-input forms
  described above.
- `concord-frontend/lib/api/client.ts` — fixed `metalearning.createStrategy`/
  `recordOutcome` signatures to match the real backend, added
  `metalearning.adaptations()`.

## Verification

- `npx eslint app/lenses/metalearning/page.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide.
- `node scripts/verify-lens-backends.mjs` — `metalearning` still `WIRED`; total unchanged at 258 WIRED / 2 NO-BACKEND-CALL.
- `node scripts/grade-ux-polish.mjs --honest` — `metalearning`: `tier: "polished"`, `isGenericScaffold: false`.
- No existing metalearning-lens test file (confirmed by search) — nothing to update.
