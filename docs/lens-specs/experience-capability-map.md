# Experience Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface — three separate macro clusters, one lens

```
grep -c 'registerLensAction("experience"' server/domains/experience.js
```
→ **31** macros in `server/domains/experience.js` (797 lines). The file's own
header comment scopes the lens: "Experience lens — UX-research suite,
category leader: Maze / UserTesting." Two families:
- **4 artifact-bound analytical macros**: `journeyMap`, `usabilityScore`,
  `heuristicEval`, `personaBuilder` — real computed math (SUS score formula
  against the industry-average-68 benchmark, the 10 Nielsen heuristics,
  journey-stage satisfaction rollups, persona completeness scoring).
- **27 stateful UX-research macros**: unmoderated usability test runner
  (`createTest`/`listTests`/`recordRun`/`listRuns`), click/heatmap studies
  (`createHeatmapStudy`/`recordClick`/`heatmapResults`), card sorting
  (`createCardSort`/`submitCardSort`/`cardSortResults`), a branching survey
  builder with NPS/CSAT/CES templates (`surveyTemplates`/`createSurvey`/
  `listSurveys`/`surveyNext`/`submitSurveyResponse`/`surveyResults`),
  participant panel + screeners (`addParticipant`/`listPanel`/`screenPanel`/
  `inviteParticipants`), highlight reels (`createClip`/`listClips`/
  `buildReel`), and prototype-embed interaction analytics
  (`createPrototype`/`listPrototypes`/`recordInteraction`/
  `prototypeAnalytics`).

**A second, separate cluster the static scanners cannot see**:
```
grep -n 'registerLensAction("experience"' server/server.js
```
→ **5 more macros** at `server/server.js:40710-40763` — `endorse`,
`analyze`, `generate_resume`, `compare_versions`, `validate_claims` — a
"verifiable career portfolio" system (skills + endorsements + resume
generation + version diffing + evidence validation) operating on
`artifact.data.{skills,endorsements,experience,education,snapshots}`.
`scripts/lens-unsurfaced.mjs` only scans `server/domains/*.js`
(`DOMAINS = path.join(ROOT, 'server/domains')` at the top of the script), so
it structurally cannot see macros registered directly in `server.js` — this
is exactly the class of gap the task brief asked to look past the narrow
detector for. Confirmed this cluster belongs to THIS lens, not a stray
naming collision, via the lens manifest:
```
grep -n "domain: 'experience'" -A 12 concord-frontend/lib/lenses/manifest.ts
```
→ `artifacts: ['portfolio', 'skill', 'history', 'insight', 'credential']`,
`actions: ['endorse', 'analyze', 'generate_resume', 'compare_versions',
'validate_claims']`, empty-state copy "Build a verifiable portfolio... Skills,
history, credentials — endorsed and validated against the substrate," and a
first-run guide describing exactly these 3 actions. The manifest is the
authoritative declaration of what this lens is supposed to do — it isn't
guesswork.

**A third, unrelated cluster with the same domain name**: `server/server.js
:13196-13251` registers `experience.status/retrieve/patterns/consolidate/
strategies/recent` via `register()` (the `MACROS` map, not `LENS_ACTIONS`) —
surfaced at `/api/experience/status` etc. (`server/routes/domain.js:640-664`).
Read the handlers: this is an **agent cognitive "Experience Learning"
subsystem** (an internal learning/pattern-consolidation loop), unrelated to
either the UX-research suite or the career-portfolio feature — confirmed by
reading `server.js:13190-13260` (no artifact/user-facing framing, operates
on an internal experience-buffer). Left untouched; it isn't a lens-UI gap,
it's a different subsystem that happens to share the string "experience" as
a macro-registry key.

## Reference apps

- **UX research suite**: Maze / UserTesting (unmoderated test execution,
  click-testing, card sorting) + Optimal Workshop (tree testing, IA
  validation) + Typeform/Delighted (NPS/CSAT survey builder) + Lookback
  (highlight-reel clipping) + Figma prototype-analytics overlays.
- **Career portfolio**: LinkedIn Skills & Endorsements (peer-verified skill
  claims) + a resume builder (Zety/Novoresume-style structured export) +
  a portfolio version-history diff (see your trajectory over time).

## Classification (before this pass)

**Mixed, more severely than eco/creative-writing in one respect**: the 27+4
UX-research macros were ALREADY genuinely, excellently surfaced
(`UXResearchSuite.tsx`, 1032 lines, real forms + real results for all 27
stateful macros — verified by reading the whole file; `DesignSystemAtlas.tsx`,
113 lines, a live GitHub design-system search). But the page's TOP ~950
lines were a "Creative Portfolio" scaffold that was **completely
disconnected from any of the 3 real macro clusters above**:

1. **Hardcoded blank profile, never fetched.** `const PROFILE = { name: '',
   bio: '', location: '', genres: [], stats: {...all 0}, socials: [] }` was a
   static module-level constant — not a query result, not state, a literal
   empty object rendered as if it were the user's profile (avatar showed a
   hardcoded "AR" initial). "Edit Profile" only fired a toast
   ("Profile editor opening...") with no editor. This is the "hardcoded
   placeholder rendered as live data" defect class named directly in
   CLAUDE.md's zero-demo-content section.
2. **Portfolio / Skills / History tabs had zero creation path.**
   `useLensData('experience', 'portfolio'|'skill'|'history', { seed: [] })`
   fetches generic artifacts of those types from `/api/lens/experience?type=
   ...` — a real endpoint, but (a) no macro in any of the 3 clusters above
   ever produces a `portfolio`/`skill`/`history`-typed generic artifact, and
   (b) `useLensData`'s own auto-seed only fires in development
   (`concord-frontend/lib/hooks/use-lens-data.ts:88`: `if (!isDev || ...)
   return;`) — so in production these lists were **permanently empty**, and
   the "Add to Portfolio" button just showed a toast
   ("Add new portfolio item via the creative lens") instead of creating
   anything. The "Skills" tab's radar chart / skill bars, the "History"
   tab's timeline, and the entire "Insights" tab (computed client-side from
   `portfolio`+`history`, which were always `[]`) were real, well-built
   components rendering off data that could never exist. This is the exact
   "disconnected generic CRUD with no creation UI" pattern documented in the
   `eco` capability map's Populations/Climate/Biodiversity tabs.
3. **The 4 real analytical macros (journeyMap/usabilityScore/heuristicEval/
   personaBuilder) WERE wired, but to a dead trigger.** The page's
   "Experience Domain Actions" panel called `handleExpAction` →
   `useRunArtifact('experience').mutateAsync({ id: expArtifacts[0]?.id,
   action })`, where `expArtifacts` came from `useLensData('experience',
   'experience', { seed: [] })` — again permanently empty in production, so
   `targetId` was always `undefined` and every button's `onClick` was a
   no-op guarded by `if (!targetId) return;`. The 4 result-renderer
   components (`JourneyMapResult`, `UsabilityScoreResult`,
   `HeuristicEvalResult`, `PersonaBuilderResult`) were themselves real and
   well-designed — they simply never received data. This is the exact
   "backend-capable-but-genuinely-unreachable" class from the `eco`
   capability map's `carbonFootprint`/`biodiversityIndex` finding.
4. **The real career-portfolio macros (`endorse`/`analyze`/`generate_resume`/
   `compare_versions`/`validate_claims`) were never called anywhere in the
   frontend at all** — `grep -rn "endorse\|generate_resume\|compare_versions
   \|validate_claims" concord-frontend/app concord-frontend/components
   concord-frontend/lib` (pre-fix) hit only the lens manifest declaration
   and unrelated same-named identifiers in `aviation`/`insurance` (pilot/
   claims "endorsement," a different domain). A real, manifest-declared
   feature with zero UI.

No `Math.random()` or Lorem-ipsum-style fabrication was present — the defect
here is entirely the "real backend, permanently unreachable UI" class, at a
larger scale (~950 lines) than `eco`'s because the disconnect spanned 3
separate macro clusters, not variations on one.

## What changed

- **`concord-frontend/components/experience/AnalysisTools.tsx` (new, ~330
  lines)** — real forms for the 4 artifact-bound analytical macros, each
  calling `lensRun('experience', <action>, <form data>)` directly (the
  `/api/lens/run` route builds a *virtual* artifact from the request body —
  `server.js:39560` — so no pre-existing artifact is needed, same pattern
  validated for `eco.carbonFootprint`). Journey Map: an add/remove stage
  builder (name, emotion, touchpoints, pain points, opportunities,
  satisfaction). Usability Score: the 4 SUS inputs. Heuristic Eval: all 10
  Nielsen heuristics with score/severity/finding/notes per heuristic,
  matched by array index to the handler's own heuristics list (documented
  in-code so a future edit doesn't desync them). Persona Builder: name, age,
  occupation, tech-savviness, quote, goals/frustrations/behaviors. The 4
  original result-renderer components were moved into this file verbatim
  (unchanged visuals) and now render real computed results.
- **`concord-frontend/components/experience/CareerPortfolio.tsx` (new, ~290
  lines)** — the real "verifiable portfolio" feature the manifest declares.
  Explicit create ("Create my portfolio" button → `useLensData(...).create()`
  against a real single artifact, not auto-seeded), then real forms to add
  skills (name/category/level/years/evidence links), experience entries, and
  education entries, each persisted via `update()`. Wires all 5 real macros:
  "Analyze skills" → `analyze` (per-skill strength ranking), "Generate
  resume" → `generate_resume` (renders the composed sections), "Save
  snapshot" → appends the current skill list into `data.snapshots` so
  "Compare vs. last snapshot" → `compare_versions` has something honest to
  diff against (an explicit UI note explains this — "Compare needs at least
  one saved snapshot" — rather than silently returning an empty diff),
  "Validate claims" → `validate_claims` (evidence-backed vs. not, per
  skill), and a per-skill "Endorse" button → `endorse`. ~~Documented
  limitation: true peer endorsement needs a public-portfolio directory
  that doesn't exist yet, so only self-endorsement is currently reachable.~~
  **CLOSED (2026-07-16, `83aa19fe`)** — the generic cross-lens artifact
  layer already permitted peer action on a published portfolio; the actual
  gaps were a missing self-endorsement guard and no directory to discover
  other users. Both closed: `endorse` now rejects `endorserId === ownerId`,
  and a new Directory tab surfaces real published portfolios from other
  users, confirmed private ones stay genuinely invisible (tested across
  get/list/run, not assumed).
- **`concord-frontend/app/lenses/experience/page.tsx` (rewritten, 1,626 →
  ~165 lines)** — removed the entire dead scaffold: the hardcoded `PROFILE`
  constant, the Portfolio/Skills/History/Insights tabs and every helper
  that only existed to serve them (`radarPoints`/`radarGridPoints`/
  `radarLabelPos`, `HEAT_COLORS`/`DAY_LABELS`, `historyIcon`/`groupLabel`/
  `categoryColor`/`categoryBg`/`typeBadge`, the `computedInsights` derivation,
  the dead "Experience Domain Actions" button wall calling the disconnected
  artifact-store path), and all now-unused `useLensData`/`useRunArtifact`
  imports for the `portfolio`/`skill`/`history`/`experience` artifact types.
  Replaced with a 4-section page (Portfolio / Analysis Tools / UX Research
  Suite / Design System Atlas, keyboard-switchable 1-4) mounting
  `CareerPortfolio`, `AnalysisTools`, and the two already-good
  `UXResearchSuite`/`DesignSystemAtlas` components untouched. Kept the
  shared generic infrastructure (`LensFeaturePanel`, `UniversalActions`
  compact secondary strip, the realtime toolbar, `RecentMineCard`/
  `AutoActionStrip`/`CrossLensRecentsPanel`) per the established precedent
  of not stripping legitimate shared platform chrome.
- **`server/tests/depth/experience-career-portfolio-behavior.test.js`
  (new)** — the `endorse`/`analyze`/`generate_resume`/`compare_versions`/
  `validate_claims` cluster had **zero** test coverage before this pass
  (it isn't in `server/domains/experience.js`, so none of the domain-level
  test files exercise it). 6 behavioral tests via the `lensRun` harness:
  `analyze` ranks skills by evidence+experience-derived strength;
  `endorse` appends a real endorsement row; `generate_resume` composes
  sections ranked correctly and marks a no-`endDate` role as `current`;
  `compare_versions` returns an honest `no_previous_versions` note with no
  snapshot, and a real added/removed/retained diff with one;
  `validate_claims` only marks a skill validated when it has evidence.

## Known, documented, unfixed gap

*(Closed 2026-07-12 — see below. No other known gap remains.)*

## Wave 4 follow-up (2026-07-12): branch-aware survey UI

`surveyNext` (branching-logic resolver) was genuinely unsurfaced — the old
`UXResearchSuite.tsx#SurveyPanel` rendered every question in a survey flat
rather than one-at-a-time with branch-aware navigation, so it never called
`surveyNext`. Fixed: `SurveyPanel`'s taking flow now asks one question at a
time and calls `surveyNext({ surveyId, questionId, answer })` after every
answer — the branch (`question.branch[answer]` lookup, else fall through
to `questions[idx+1]`) is resolved server-side, not guessed client-side.
Added a custom survey builder (Template vs. Custom+branching toggle) with
a per-answer branch editor, since the pre-existing NPS/CSAT/CES templates
never populate `branch` — without it there was no way to author a
branching survey through the UI at all. Also fixed a latent bug where
`kind: 'multi'` questions had no input case in the old flat renderer.

3 new behavioral tests (`server/tests/depth/experience-behavior.test.js`):
a 4-question survey where one path branches straight to the last question
(skipping two) and the other falls through in array order; an unknown
`questionId` rejected vs. an unknown answer value falling through instead
of erroring; and a full two-respondent branch-aware take→submit→results
round trip asserting only the traversed path's answers are persisted and
scored (`avgScore`/`samples`/`answered` counts differ per respondent based
on which questions they actually reached).

## Verification

- `cd concord-frontend && npx eslint app/lenses/experience/page.tsx components/experience/AnalysisTools.tsx components/experience/CareerPortfolio.tsx components/experience/UXResearchSuite.tsx` — clean, exit 0.
- `cd concord-frontend && npx tsc --noEmit -p .` — 0 errors project-wide.
- `node scripts/lens-unsurfaced.mjs --lens experience` → `0/31 macros never referenced` (was `1/31` — `surveyNext` is now referenced).
- `node scripts/verify-lens-backends.mjs` → experience lens still `WIRED`; overall `{"WIRED":258,"NO-BACKEND-CALL":2}` unaffected.
- `cd server && node --test tests/experience-domain-parity.test.js tests/depth/experience-behavior.test.js tests/depth/experience-career-portfolio-behavior.test.js tests/llm-hint-macros-contract.test.js` → `74 pass / 0 fail`.
- `cd server && npx eslint tests/depth/experience-behavior.test.js tests/llm-hint-macros-contract.test.js` — clean, exit 0.
