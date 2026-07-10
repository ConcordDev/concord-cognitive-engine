# Ethics Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -n 'registerLensAction("ethics"' server/domains/ethics.js | wc -l
```
→ **19** macros, all `registerLensAction("ethics", ...)`, all in one file:
`server/domains/ethics.js` (807 lines). No inline `registerLensAction("ethics"...)`
calls exist in `server.js` outside the domain file
(`grep -nE "registerLensAction\(['\"]ethics['\"]" server/server.js` → empty).

**Unrelated substrate warning (confirmed, not assumed):** `server/tests/a6-values-ethics.test.js`
and `server/tests/a9-identity-constructs.test.js` sound related but are not —
they exercise `server/affect/{engine,policy,projection,defaults,index}.js`
(Concord's AI-agent affect/values/identity substrate), never import
`server/domains/ethics.js`, and never reference any of the 19 macro names
below. Confirmed by reading both files' imports in full. This mirrors the
`eco.js` vs. `ecology.js` precedent from Wave 3's eco audit — same pattern,
different domain pair. Left untouched, out of scope.

The 19 macros split into two generations, both real:

- **3 original "creative-tools" macros** (`frameworkAnalysis`, `stakeholderImpact`,
  `biasDetection`, lines 12–347): dense, self-contained analytical engines —
  4-framework (utilitarian/deontological/virtue/care) synthesis with tension
  detection, Mitchell-Agle-Wood stakeholder salience + power/interest quadrant
  classification + equity scoring, and a dataset-level fairness audit
  (disparate-impact ratio, four-fifths rule, statistical parity, a rough
  chi-squared). All three read only from `artifact.data` (ignore the `params`
  arg) and are pure-compute — no persistence, no `list*` counterpart.
- **16 "decision-toolkit" macros** (lines 349–807, comment: "Persistent
  per-user state in `globalThis._concordSTATE.ethicsLens`"):
  `multiFrameworkDilemma`/`listMultiFramework`, `stakeholderMap`/`listStakeholderMaps`,
  `decisionMatrix`/`listDecisionMatrices`, `biasChecklistTemplate`/`biasChecklist`/`listBiasChecklists`,
  `submitReview`/`addReviewOpinion`/`recordVerdict`/`listReviews`,
  `archiveCase`/`searchCases`/`deleteCase`. Each is wrapped in `ewrap()`
  (try/catch, never throws) and persists into a per-user `Map` in the shared
  `STATE.ethicsLens` object, with a fail-closed poisoned-numeric contract
  (`fnum()` clamps `Infinity`/`NaN`/`"1e999"`/`"Infinity"` to a default rather
  than leaking non-finite values into a record — pinned by
  `server/tests/ethics-lens-macros.test.js`).

`node scripts/lens-unsurfaced.mjs --lens ethics` originally reported
`1/19 macros never referenced in the frontend` (only `frameworkAnalysis`).
That number was **wrong in the honest direction that matters** — a false
negative caused by the script's naive cross-domain string match:
`stakeholderImpact` and `biasDetection` are ALSO real macro names in other,
unrelated domains (`registerLensAction("cri", "stakeholderImpact", ...)` in
`server/domains/cri.js:262`, called from `components/cri/CrisisActionPanel.tsx`;
`registerLensAction("news", "biasDetection", ...)` in `server/domains/news.js:12`
plus `registerLensAction("metacognition", "biasDetection", ...)` in
`server/domains/metacognition.js:297`, called from `components/news/intel/intel-api.ts`
and `app/lenses/metacognition/page.tsx`). The script matches on macro name
alone, not `(domain, macro)` pairs, so it credited `ethics.stakeholderImpact`
and `ethics.biasDetection` as "surfaced" because *some* domain's macro of the
same name has a frontend call site. Verified by grepping every
`lensRun('ethics', ...)` call site in the tree
(`grep -rn "lensRun('ethics'" concord-frontend/`) before this pass: it
returned exactly 16 distinct macro names — the 16 decision-toolkit macros,
and none of the three creative-tools macros. So the real starting state was
**3/19 unsurfaced**, not 1/19.

## Reference apps

- **Multi-framework / framework-analysis tools**: no single consumer app
  dominates this niche the way iNaturalist does species ID; the closest
  professional analogs are ethics-consulting decision frameworks (the
  Markkula Center's "Framework for Ethical Decision Making," corporate AI-ethics
  review boards) and structured-argumentation tools (Kialo, argument maps).
- **Stakeholder analysis**: the Mitchell-Agle-Wood salience model and the
  classic power/interest matrix are standard project-management and
  business-ethics tooling (Miro/Lucidchart stakeholder-map templates, PMI
  stakeholder registers) — quantified here rather than left as a manual
  drag-and-drop diagram.
- **Bias/fairness auditing**: IBM AI Fairness 360 (AIF360) and Aequitas —
  dataset-level disparate-impact audits (four-fifths rule, statistical parity,
  group-rate tables) against a CSV/tabular decision log.
- **Cognitive-bias self-review**: pre-mortem / decision-journal tooling
  (Farnam Street's decision journal, structured "red team yourself" checklists).
- **Peer review + case library**: informal ethics-committee workflows
  (submit → deliberate → verdict) and legal/precedent case libraries.
- **Philosophy Q&A**: philosophy.stackexchange.com directly (the lens embeds
  its live feed via `PhilosophyStack`).

## Classification (before this pass)

**Mixed, same disease as the `eco` lens's pre-rebuild scaffold**: a real,
well-built macro-backed tool (`DecisionToolkit`, 16/19 macros) sitting
*alongside* a second, parallel, fully-fabricated surface on the same page —
plus a shared-infrastructure defect (`ManifestActionBar`/`ToolPalette`) that
extended past this one page.

1. **`components/ethics/DecisionToolkit.tsx` (1,188 lines before this pass) —
   real, clean, all 16 wired macros verified by direct grep of every
   `lensRun('ethics', ...)` call site.** Six tabs (Multi-Framework,
   Stakeholder Map, Decision Matrix, Bias Checklist, Ethics Review, Case
   Library), each a bespoke form + a `LoadGate` component that makes
   LOADING / ERROR (with a working retry) / EMPTY / POPULATED genuinely
   distinguishable — pinned end-to-end by
   `concord-frontend/tests/ethics-lens-states.test.tsx` (5 tests, mocks the
   `lensRun` channel and asserts each of the four states against the real
   macro result shape). No fabrication signatures anywhere
   (`grep -n "Math.random\|MOCK\|mock\|fake\|Lorem\|lorem" components/ethics/DecisionToolkit.tsx`
   → no hits before or after this pass).

2. **`components/ethics/PhilosophyStack.tsx` — real, clean, external API.**
   Live `philosophy.stackexchange.com` feed via the Stack Exchange API
   (`api.stackexchange.com/2.3/questions?tagged=...&site=philosophy`), 7
   curated tags, vote/answer/accept counts genuinely from the API response,
   an honest "Stack Exchange unreachable" error state, and a `SaveAsDtuButton`
   that mints a real DTU from the fetched question list. Untouched.

3. **`app/lenses/ethics/page.tsx` (pre-rebuild, 902 lines) — a second,
   parallel, fully-fabricated CRUD surface duplicating and confusing the real
   one.** This is the exact defect class documented for the `eco` lens's
   pre-rebuild scaffold, independently re-discovered here:
   - A **client-invented `EthicsArtifact` interface** with ~20 fields
     (`weight`, `principle`, `focus`, `jurisdiction`, `precedent`, `outcome`,
     `category`, `source`, `scope`, `reviewer`, `recommendation`, `riskLevel`,
     `policyArea`, `effectiveDate`, `expiryDate`, ...) that **no `ethics`
     domain macro reads or produces anywhere** (confirmed by grepping every
     one of those field names against `server/domains/ethics.js` — zero
     hits).
   - **Six generic CRUD tabs** (`MODE_TABS`: Frameworks, Dilemmas, Cases,
     Principles, Reviews, Policies) sourced entirely from
     `useLensData<EthicsArtifact>('ethics', activeArtifactType, { seed: [] })`
     — the generic per-artifact-type persistence hook, completely
     independent of the 19 real macros. A 300+-line `renderEditor()` modal
     built a full form (name/description/status/category + up to 8
     type-specific fields) for creating these fabricated artifacts.
   - **Two of those six tabs directly name-collided with real, macro-backed
     features**: "Cases" (fake, generic CRUD) sat alongside `DecisionToolkit`'s
     real Case Library tab (`archiveCase`/`searchCases`/`deleteCase`); "Reviews"
     (fake, generic CRUD) sat alongside `DecisionToolkit`'s real Ethics Review
     tab (`submitReview`/`addReviewOpinion`/`recordVerdict`/`listReviews`).
     A user had no way to tell, from the UI alone, that one "Cases" tab was
     real and the other was a disconnected local list.
   - **Every item's "Activate" (Zap) button called a macro that doesn't
     exist.** `handleAction('analyze', item.id)` → `useRunArtifact('ethics')`
     → `POST /api/lens/ethics/:id/run` → `runMacro("lens","run",{action:'analyze'})`
     → `LENS_ACTIONS.get('ethics.analyze')` (server.js:38279) → **undefined**
     → falls through to the anonymous utility-brain AI catch-all
     (server.js:38281-38297) — a real LLM call, dressed as if it were a
     domain feature, silently substituting for a macro that was never
     registered. This is the identical "dead-wired button → generic AI
     fallback" pattern the eco audit and this task's brief both call out by
     name.
   - A **dashboard stats grid** (Total Items / Frameworks / Resolved /
     Contested) computed entirely from this fabricated `items` array — real
     arithmetic, but over data with no macro backing, so the numbers were
     honest-looking noise from day one (a fresh account would show all
     zeros; a populated one would show counts of hand-typed local records
     nobody's `ethics` macro ever validated or used for anything).

4. **`frameworkAnalysis`, `stakeholderImpact`, `biasDetection` — real,
   sophisticated, and genuinely unreachable from any `ethics`-domain UI.**
   Not fabrication — a `backend-capable-but-unsurfaced` defect, same class
   the eco audit found for `carbonFootprint`/`biodiversityIndex`/`sustainabilityScore`.
   All three are pure-compute (no persistence layer, no `list*` macro), which
   is why they were never candidates for the generic `useLensData` CRUD
   pattern in the first place — they needed a bespoke "fill in a form → run →
   see the real computed result" surface, and nobody had built one.

5. **Shared-infrastructure defect, found while auditing #3, scoped and fixed
   to this lens's manifest entry only**: `concord-frontend/lib/lenses/manifest.ts`'s
   `ethics` entry declared `actions: ['evaluate_case', 'apply_framework',
   'check_alignment', 'generate_report', 'stakeholder_analysis',
   'risk_assessment']` and a `macros` block pointing at `'lens.ethics.create'`
   / `'lens.ethics.list'` / etc. **None of these six action names are
   registered `ethics` macros** (`grep -rn "evaluate_case\|apply_framework\|check_alignment\|generate_report\|stakeholder_analysis\|risk_assessment" server/` →
   zero hits anywhere in the backend). Two live, cross-lens consumers
   dispatch this array as literal macro calls with empty params:
   - `components/lens/ManifestActionBar.tsx` (mounted on the ethics page via
     `<ManifestActionBar />`) turns each `actions[]` entry into a button that
     calls `apiHelpers.lens.runDomain('ethics', action, {})` →
     `POST /api/lens/run` → same `LENS_ACTIONS.get('ethics.<action>')` miss →
     same anonymous AI catch-all as defect #3's Zap button, six times over,
     directly in the page's action bar.
   - `components/chat/ToolPalette.tsx` (the global `/tool` command palette,
     spanning all ~200 lens manifests) also iterated `manifest.actions` and
     dispatched the same way — polluting the app-wide tool catalog with six
     ethics-domain entries that could never do anything real.
   - `FirstRunTour.tsx` (mounted via `<FirstRunTour lensId="ethics" />`) read
     `manifest.firstRunGuide.steps`, whose copy described `stakeholder_analysis`
     and `generate_report` as if they were real, clickable capabilities.

   This is very likely a systemic pattern across a meaningful slice of the
   ~200 manifest entries in this file (spot-checked one sibling entry,
   `domain: 'vote'`, whose `actions` include `cast_ballot`/`tally_votes`/
   `audit_results` — none of which exist anywhere in `server/`
   either), but auditing or fixing every entry is out of scope for a
   single-lens task and risks colliding with sibling Wave-3 agents editing
   other lenses' entries in the same shared file concurrently. **Fixed only
   the `ethics` entry**, surgically, leaving every other domain's entry
   byte-for-byte untouched.

## What changed

- **`concord-frontend/components/ethics/DecisionToolkit.tsx` (1,188 → 1,757
  lines)** — added three new tools, each a bespoke form wired directly to its
  macro via `lensRun`, following the file's own established `SECTION`/`errBox`/
  `ds` design-system conventions (no `LoadGate` needed — these three macros
  are pure-compute one-shot analyses with no `list*` counterpart, so each
  panel is "fill in → run → see the real computed result," never a fabricated
  history list):
  - **Framework Analysis** (`frameworkAnalysis`) — action description,
    comma-tag principles, dynamic consequence rows (description/impact/affected
    count/probability), dynamic stakeholder rows (name/description/vulnerable/
    impact). Renders all four frameworks' scores + assessments + their
    real `details` payload (virtue framework's per-virtue breakdown gets its
    own chip row), the overall score, consensus label, detected tensions, and
    the handler's own recommendation string. The macro's `artifact.data.context`
    field is read but never actually used anywhere in the handler's
    computation (verified by reading every line of `frameworkAnalysis` in
    `server/domains/ethics.js:12-151` — `context` is destructured once and
    never referenced again) — no UI was built for it, since a control that
    changes nothing would itself be a fabrication.
  - **Stakeholder Impact** (`stakeholderImpact`) — dynamic stakeholder rows
    (name/group/power/interest/impact/vulnerability). Renders the
    Mitchell-Agle-Wood salience/quadrant table, per-quadrant bar chart
    (`ChartKit`), equity score + assessment, and group aggregates. Explicitly
    distinguished in its own UI copy from the already-wired Stakeholder Map
    tool (`stakeholderMap` compares impacts *per option*; `stakeholderImpact`
    analyzes one decision's full stakeholder field with power/interest
    salience — different macros, different math, different question).
  - **Bias Audit** (`biasDetection`) — a CSV paste box (header row + ≥10 data
    rows; header must include an `outcome` column, every other column is a
    protected attribute to test) parsed client-side with real validation
    (`parseDecisionCsv`) mirroring the handler's own ≥10-row minimum, so a
    short paste fails honestly client-side before ever hitting the network.
    Renders the four-fifths-rule pass/fail badge, per-group table (N,
    positive rate, favored/disadvantaged tags), disparate-impact ratio,
    statistical parity difference, chi-squared/p-value, severity, and the
    handler's own recommendations. Explicitly distinguished in its own UI
    copy from the already-wired Bias Checklist tool (`biasChecklist` is a
    single-decision qualitative self-review of 10 cognitive biases;
    `biasDetection` is a quantitative dataset-level fairness audit — a
    genuinely different question a real ethics/compliance tool needs both
    answered).
  - `TOOL_TABS` and `ToolTab` are now exported (previously module-private)
    and `DecisionToolkit` accepts optional `activeTab`/`onTabChange` props
    (falls back to its own `useState` when uncontrolled, so the existing
    `<DecisionToolkit />` call in `ethics-lens-states.test.tsx` is unaffected)
    so the page can drive tab selection via keyboard shortcuts. Each tab
    button now shows a `<kbd>` chip with its single-key shortcut.
- **`concord-frontend/app/lenses/ethics/page.tsx` (rewritten, 902 → 83
  lines)** — removed the entire fabricated CRUD surface: `EthicsArtifact`,
  `ModeTab`, `ArtifactType`, `Status` types; `MODE_TABS`, `STATUS_CONFIG`,
  `FRAMEWORK_TYPES`, `RISK_LEVELS`, `CATEGORIES` constants; all ~25 `formX`
  state hooks; `useLensData`/`useRunArtifact` calls; `renderDashboard`,
  `renderEditor`, `renderLibrary`, `handleAction`, `openCreate`/`openEdit`/
  `handleSave`/`resetForm`. The page now renders `<DecisionToolkit>` (all
  nine tools) directly, with `<PhilosophyStack>` below it, `UniversalActions`
  kept as the small secondary AI-helper strip it's designed to be (no
  `artifactId`, per its own optional-prop contract — matching the eco
  precedent), and `ManifestActionBar`/`DepthBadge`/`FirstRunTour`/the Sprint-17
  polish-sentinel components (`SessionRail`/`RecentMineCard`/`AutoActionStrip`/
  `CrossLensRecentsPanel`) all kept exactly as mounted before. A single-key
  keyboard shortcut is now registered per toolkit tab via `useLensCommand`
  (discoverable through the app's existing command-palette/help-modal
  surface, per `docs/UI_QUALITY_RUBRIC.md` §2's "scoped keyboard commands
  must be discoverable" requirement) — replacing the removed page's one
  "/ to focus search" binding, which no longer had a search box to focus.
- **`concord-frontend/lib/lenses/manifest.ts` (`ethics` entry only)** —
  replaced the six fictional `actions` names with six real, genuinely
  zero-argument-safe `ethics` macros (`listMultiFramework`,
  `listStakeholderMaps`, `listDecisionMatrices`, `listBiasChecklists`,
  `listReviews`, `biasChecklistTemplate` — all succeed with `{}` and return a
  real result, or an honest "nothing yet" outcome when the user's list is
  empty, never a fabricated one); replaced `artifacts` with the six real
  persisted record types (`multi_framework_analysis`, `stakeholder_map`,
  `decision_matrix`, `bias_checklist`, `review`, `case`); replaced `macros`
  with real dotted macro references (`ethics.listMultiFramework`,
  `ethics.searchCases`, `ethics.multiFrameworkDilemma`, `ethics.deleteCase`,
  `ethics.frameworkAnalysis` — `update`/`export` dropped rather than filled
  with another fiction, since no generic update or export macro exists for
  any of the six record types); rewrote `emptyState` and `firstRunGuide` copy
  to describe the real nine-tool Decision Toolkit instead of the fictional
  `case_file`/`decision_tree`/`policy_check` artifact set. Every other
  domain's manifest entry in this ~1,700-line shared file is untouched.
- **`concord-frontend/components/lens/ManifestActionBar.tsx`** — `humanize()`
  now splits camelCase word boundaries (`listMultiFramework` → "List Multi
  Framework") before its existing snake_case/kebab-case splitting, since the
  fix above introduces literal camelCase macro names into an `actions` array
  whose display convention up to now was snake_case labels. Purely additive
  (a no-op on strings with no lower→upper transition, so every existing
  snake_case/kebab-case manifest entry across all other lenses renders
  identically to before) — pinned by the existing
  `tests/components/ManifestActionBar.test.tsx` (10/10 still green) which
  covers several snake_case fixtures.

## Verification

- `cd concord-frontend && npx eslint app/lenses/ethics/page.tsx components/ethics/DecisionToolkit.tsx lib/lenses/manifest.ts components/lens/ManifestActionBar.tsx` —
  clean, exit 0, zero warnings.
- Manual type read-through in place of a full-project `tsc` (avoided here to
  not race sibling agents editing other lenses concurrently in the same
  working tree): the three new panels' `Record<string, unknown>` /
  `Record<string, FaFrameworkDetail>` typings for macro results mirror the
  file's own pre-existing pattern (`SmapStakeholder.impacts: Record<string,
  {...}>` in the already-shipped `StakeholderMapPanel`); the generic
  `{...prev, [field]: val}` row-setter pattern used in the three new panels
  is byte-identical in shape to `setOpt`/`setSh`/`setCrit`/`setOptScore` in
  the four pre-existing panels, which already type-check; `parseDecisionCsv`'s
  `{error:string} | {decisions:...; protectedAttributes:...}` return type is
  narrowed correctly by the `'error' in parsed` guard (standard TS `in`-operator
  discriminated-union narrowing) before the early return.
- Fabrication re-grep after the edit:
  `grep -n "Math.random\|MOCK\b\|fake\|Lorem\|lorem" app/lenses/ethics/page.tsx components/ethics/*.tsx lib/lenses/manifest.ts`
  → no hits (the one `page.tsx` hit is a doc-comment describing the removed
  defect, not code).
- `node scripts/lens-unsurfaced.mjs --lens ethics`: **before** this pass, the
  script itself reported `1/19` (a false negative from cross-domain name
  collision, corrected above to the real `3/19`); **after** this pass,
  `0/19 macros never referenced in the frontend` — verified by an independent
  grep of every `lensRun('ethics', ...)` call site, now 19 distinct macro
  names, not just the script's cross-domain-polluted count.
- `cd server && node --test tests/ethics-domain-parity.test.js tests/ethics-lens-macros.test.js`
  → 44/44 passing (both files pre-existing, untouched — this pass made no
  backend changes; all 19 macros were already real and already tested at the
  macro layer, the defect was 100% on the frontend reachability + shared
  manifest-metadata side).
- `cd concord-frontend && npx vitest run tests/ethics-lens-states.test.tsx tests/lib/lenses/manifest.test.ts tests/components/ManifestActionBar.test.tsx tests/components/EmptyStateCTA.test.tsx`
  → 44/44 passing. The manifest test initially caught a real regression from
  this pass (dropping `macros.get` entirely failed
  `'every manifest has list/get macros that are non-empty dotted ids'`) —
  fixed by setting `get: 'ethics.searchCases'` (the closest real "retrieve
  records" macro among the 19) rather than leaving the field fictional or
  removing the requirement.
- Did not touch `server/domains/ethics.js` (no backend gap — all 19 macros
  were already real; the fix was 100% frontend reachability + shared
  manifest-metadata correction) or `server/affect/*` (confirmed unrelated,
  see the "Unrelated substrate warning" above).
- Project-wide `tsc --noEmit`, `verify-lens-backends.mjs`, and
  `grade-ux-polish.mjs` are left to the orchestrator's single end-of-wave
  run, per the task's instructions.
