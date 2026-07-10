# Mental Health Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("mental-health"' server/domains/mentalhealth.js
```
→ **49** macros in `server/domains/mentalhealth.js` (978 lines), registered
via `registerMentalhealthActions(registerLensAction)`. Domain string is
`"mental-health"` (hyphen) even though the file is `mentalhealth.js` (no
hyphen) — a genuine naming mismatch, verified by direct grep, not assumed.
One more macro (`live_medlineplus`) is registered under the same
`"mental-health"` domain string from a different file,
`server/domains/more-free-apis.js:151` — bringing the true total to **50**.

Real surfaces: 4 pure-compute legacy calculators (`moodTracker`,
`copingStrategies`, `wellnessScore`, `journalPrompt`), 2 real external-data
integrations (`crisis-hotlines` — static but authoritative 988/Samaritans/
Trevor Project/RAINN/etc. reference data verified against 988lifeline.org;
`cdc-mental-health-stats` — live CDC PLACES/BRFSS mental-distress prevalence
via `data.cdc.gov`'s public SODA API), `live_medlineplus` (live NIH/NLM
consumer-health topic search), and a full Calm/Headspace-shape mindfulness
substrate: meditation sessions + courses (`session-log/history/stats`,
`mindfulness-minutes`, `course-create/list/detail/complete-session/delete`),
mood tracking (`mood-log`, `mood-history`, `mood-insights`, `mood-log-tagged`,
`mood-calendar`), breathing exercises (`breathing-patterns`, `breathing-log`,
`breathing-stats`), sleep tracking (`sleep-log`, `sleep-history`), gratitude
journaling (`gratitude-add/list`), goals (`goal-set/status`), a wellness
dashboard (`wellness-dashboard`), an LLM-backed non-clinical check-in
companion (`companion-history/reset/chat`, Wysa-style, with a deterministic
risk-phrase scan + 988 redirect that fires even when the LLM is unavailable),
custom mood factors / Daylio-style activity tags with correlation insights
(`factor-create/list/delete`, `factor-correlations`), reminders
(`reminder-set/list/delete/due`), guided CBT/DBT worksheets
(`worksheet-templates/save/list/delete` — thought record, cognitive
reframe, DBT check-the-facts, DBT opposite action), a Stanley-Brown-model
safety plan builder (`safety-plan-template/save/get`), and a therapist-
shareable export (`therapist-report`, CSV + plain-text summary).

## Frontend surface

`concord-frontend/app/lenses/mental-health/page.tsx` +
`concord-frontend/components/mental-health/{CrisisPanel,
MentalHealthSection, MentalHealthActionPanel, MhCalendarPanel,
MhCompanionPanel, MhFactorsPanel, MhMoodPanel, MhPracticePanel,
MhReflectPanel, MhRemindersPanel, MhReportPanel, MhSafetyPlanPanel,
MhSleepPanel, MhWorksheetsPanel}.tsx` + `components/health/
MedlinePlusPanel.tsx` (shared healthcare component).

## What was already real and well-built

Unlike most lenses audited so far in this program, the **majority of this
lens's real depth was already properly, bespokely wired** before this pass:

- `MentalHealthSection.tsx` mounts an 11-tab Calm/Headspace-shape dashboard
  (Practice / Mood / Sleep / Reflect / Companion / Factors / Calendar /
  Reminders / Worksheets / Safety plan / Report), each tab a dedicated
  `Mh*Panel.tsx` component calling `lensRun('mental-health', <action>, …)`
  directly against the real macro names above (verified by grepping every
  `lensRun(` call site in all 11 panel files against the macro list —
  100% match, no invented action names, no field-shape mismatches). This
  single component surfaces essentially the entire mindfulness/tracking
  macro surface (43 of the 50 macros) as real, designed UI — session
  logging with streaks, a recharts mood trend line, sleep history, gratitude
  + goals, an LLM companion chat with risk-flag handling, factor
  correlation insights, a year-in-pixels mood calendar, reminders, the 4
  CBT/DBT worksheet templates, the Stanley-Brown safety plan sections, and
  a therapist CSV/text export.
- `CrisisPanel.tsx` correctly calls `crisis-hotlines` via
  `apiHelpers.lens.runDomain` and renders per-country hotlines with
  click-to-call `tel:` links, SMS numbers, and chat links, plus a
  Save-as-DTU button per hotline.
- `MentalHealthActionPanel.tsx` correctly wires `crisis-hotlines`,
  `cdc-mental-health-stats`, `moodTracker`, and `journalPrompt`, plus
  DTU-mint / DM / publish / agent-summary flows built on those results.
- `MedlinePlusPanel.tsx` is a real, shared NIH/NLM topic-search component.

## The defect found

### A duplicate, broken, artifact-CRUD-driven "Mood / Journal / Coping /
Resources" tab system sitting alongside the already-real
`MentalHealthSection`, plus two macros (`copingStrategies`,
`wellnessScore`) reachable only through a mis-wired panel

`app/lenses/mental-health/page.tsx` (pre-pass, 709 lines) mounted
`MentalHealthSection` (the real system above) near the top, then **also**
ran its own second, parallel mood/journal/coping tracker built on
`useLensData<...>('mental-health', 'mood' | 'journal' | 'coping', …)` — the
generic `/api/lens/mental-health` artifact CRUD, not any of the 50 domain
macros. This produced:

- A "Stat Cards Row," a "Wellness Score Ring," and a "Session History
  Timeline," all computed client-side from generic `mood`-type artifacts
  with an invented shape (`{date, mood, score, notes, triggers,
  copingUsed}`) that shares no fields with the real `mood-log`/
  `mood-history`/`mood-insights` macros already driving `MhMoodPanel`.
  This is a second, shallower, disconnected mood-tracking implementation
  duplicating what `MhMoodPanel` (recharts trend line + real
  `mood-insights` trend/average/distribution) already does correctly.
- A full second "Mood tab / Journal tab / Coping tab / Resources tab" UI
  (log mood, save journal entry, save coping strategy, static crisis
  resource list) — none of it backed by the real gratitude/worksheet/
  safety-plan/companion macros, all of it duplicating ground already
  covered by `MentalHealthSection`'s Mood/Reflect/Practice tabs and by
  `CrisisPanel`.
- A "Wellness Analysis Engine" 4-button panel (`moodTracker`,
  `copingStrategies`, `wellnessScore`, `journalPrompt`) wired through
  `useRunArtifact` → `POST /api/lens/mental-health/:id/run` →
  `register("lens","run")`, which requires an **already-persisted real
  artifact** (`STATE.lensArtifacts.get(id)`; `if (!artifact) return {
  ok:false, error:"not found" }`). The button's `artifactId =
  moodItems[0]?.id || 'mental-health'` fallback meant a user with zero
  generic mood artifacts got a hard `"not found"` error on every click —
  a dead button, gated on a permanently-empty (for real users) artifact
  store, matching the exact anti-pattern named in this program's rebuild
  loop (§5).
  - Worse, **even when unblocked** (after logging a fake mood entry via
    the duplicate CRUD above), the artifact's `.data` shape
    (`{date, mood, score, notes, triggers, copingUsed}`) does not contain
    `entries`, `sleepHours`, `exerciseMinutes`, `socialInteractions`, or
    `moodScore` — the fields `moodTracker` and `wellnessScore` actually
    read. `wellnessScore` would silently fall back to its hardcoded
    defaults (`sleep=7h, exercise=0min, social=0, mood=5`) and render a
    computed "Wellness Score" **as if it reflected the user's real data**,
    which it never did. Per this lens's honesty bar (a fake mood-score is
    a serious violation, not cosmetic), this was the most load-bearing
    defect in the lens.
  - A header "Insights" button independently called the same broken
    `runAction.mutate({ id: 'mental-health', action: 'wellnessScore' })`
    pattern with `id: 'mental-health'` — never a real artifact id, so it
    always failed too.
  - `moodTracker` and `journalPrompt` (2 of the 4 buttons) were pure
    duplicates of what `MentalHealthActionPanel` already exposes
    correctly via `lensRun`/`apiHelpers.lens.runDomain` — no unique
    capability, just a second, broken way to reach the same two macros.

Net: `copingStrategies` and `wellnessScore` were the only two macros in
the whole domain with **no other real UI home** — but their only path to
the user was broken by construction.

## What changed

`app/lenses/mental-health/page.tsx` — surgically rewritten (709 → 298
lines):

1. Removed the entire generic-CRUD-driven Mood/Journal/Coping/Resources
   tab system, its Stat Cards Row / Wellness Score Ring / Session Timeline,
   and the `useLensData` × 3 + `useRunArtifact` plumbing behind it. This
   removes the duplicate, disconnected, honesty-violating implementation
   without touching `MentalHealthSection` (which already covers the same
   ground correctly) or any backend code.
2. Replaced the broken "Wellness Analysis Engine" 4-button panel with a
   trimmed, correctly-wired "Wellness Analysis" panel covering only the two
   macros with no other home:
   - **Coping Strategies** — a real trigger-tag picker (anxiety / depression
     / stress / anger / grief, matching the backend's known trigger
     categories exactly) calling `lensRun('mental-health',
     'copingStrategies', { triggers: selectedTriggers })` directly — no
     persisted artifact, per the `POST /api/lens/run` virtual-artifact
     contract (`artifact.data` = the input body verbatim, confirmed at
     `server.js:39566`).
   - **Wellness Score** — a real number-input form (sleep hours, exercise
     minutes, social interactions, mood 1–10) so the computed score is
     honestly derived from what the user actually entered, not from
     mismatched/defaulted artifact fields. Same direct `lensRun` call.
   Both show an honest inline error state on failure (no silent swallow,
   no fabricated success).
3. Removed the duplicate `moodTracker`/`journalPrompt` buttons (already
   correctly reachable via `MentalHealthActionPanel`) rather than keeping
   a second, redundant path to the same two macros.
4. Removed `<UniversalActions>` and `<LensFeaturePanel>` from the page.
   Every one of the 50 macros is now reachable through real, bespoke,
   in-context UI (`MentalHealthSection`'s 11 tabs + `CrisisPanel` +
   `MentalHealthActionPanel` + the new Wellness Analysis panel +
   `MedlinePlusPanel`), so the generic auto-discovered-macro button wall /
   generic capabilities list added no reachable capability — only generic
   surface area the honest-mode UX-polish grader (correctly) treats as a
   scaffold signal on a page this size. `ManifestActionBar` /
   `AutoActionStrip` / `RecentMineCard` remain at the bottom as the
   program's standard cross-lens footer; they sit beside substantial
   bespoke UI, not in place of it.

No backend file was modified — `server/domains/mentalhealth.js` and
`server/domains/more-free-apis.js` are untouched. This was a pure
frontend-wiring fix: remove the fabricated duplicate system, fix the
field-shape/call-pattern bug on the two orphaned macros.

## Macro → UI classification (50 macros)

| Macro | Classification | UI |
|---|---|---|
| `moodTracker`, `journalPrompt` | DESIGNED | `MentalHealthActionPanel` |
| `copingStrategies`, `wellnessScore` | DESIGNED (fixed this pass) | new "Wellness Analysis" panel in `page.tsx` |
| `crisis-hotlines` | DESIGNED | `CrisisPanel` + `MentalHealthActionPanel` |
| `cdc-mental-health-stats` | DESIGNED | `MentalHealthActionPanel` |
| `live_medlineplus` | DESIGNED | `MedlinePlusPanel` |
| `session-log/history/stats`, `mindfulness-minutes`, `course-*`, `breathing-*` | DESIGNED | `MhPracticePanel` |
| `mood-log`, `mood-history`, `mood-insights` | DESIGNED | `MhMoodPanel` |
| `sleep-log`, `sleep-history` | DESIGNED | `MhSleepPanel` |
| `gratitude-add/list`, `goal-set/status` | DESIGNED | `MhReflectPanel` |
| `companion-history/reset/chat` | DESIGNED | `MhCompanionPanel` |
| `factor-create/list/delete`, `mood-log-tagged`, `factor-correlations` | DESIGNED | `MhFactorsPanel` |
| `mood-calendar` | DESIGNED | `MhCalendarPanel` |
| `reminder-set/list/delete/due` | DESIGNED | `MhRemindersPanel` |
| `worksheet-templates/save/list/delete` | DESIGNED | `MhWorksheetsPanel` |
| `safety-plan-template/save/get` | DESIGNED | `MhSafetyPlanPanel` |
| `therapist-report` | DESIGNED | `MhReportPanel` |
| `wellness-dashboard` | DESIGNED | `MentalHealthSection` header stat strip |

All 50 macros are now DESIGNED. Zero GENERIC-STRIP-ONLY, zero UNSURFACED.

## Confirmed real and left alone, with reason

- `MentalHealthSection.tsx` and all 11 `Mh*Panel.tsx` children — read in
  full, every `lensRun` call site verified against the real macro/param
  names, no fabrication signatures (`Math.random`, `MOCK`, hardcoded
  numbers presented as computed) found.
- `CrisisPanel.tsx` / `MentalHealthActionPanel.tsx` / `MedlinePlusPanel.tsx`
  — same verification, all clean.
- `crisis-hotlines`'s static hotline data — documented in the backend
  source as verified against 988lifeline.org + national hotline
  registries; this is reference data, not a fabricated computation, and is
  explicitly labeled as such to the user (disclaimer field in the
  response).
- `RealtimeDataPanel`/`useRealtimeLens`/`LiveIndicator`/`DTUExportButton`/
  `ManifestActionBar`/`AutoActionStrip`/`RecentMineCard`/
  `CrossLensRecentsPanel` — standard cross-lens program infrastructure
  used consistently across the rebuilt lenses; out of scope for this pass
  and not lens-specific fabrication.

## Genuinely missing, deferred

None found. Every real backend macro in this domain now has a real,
bespoke UI home; no capability required new backend work.

## Verification

- `node --check server/domains/mentalhealth.js` → OK (file untouched, but
  re-verified for syntax as a baseline check).
- `cd server && node --test tests/mentalhealth-urbanplanning-domain-parity.test.js tests/mental-health-lens-macros.test.js tests/mentalhealth-domain-parity.test.js` → **97/97 passing, 0 failing** (unmodified by this pass).
- `cd concord-frontend && npx eslint app/lenses/mental-health/page.tsx components/mental-health/*.tsx` → clean, 0 errors/warnings.
- `node scripts/verify-lens-backends.mjs` → mental-health is **WIRED**
  (not in the 2-item `NO-BACKEND-CALL` list: `narrative-walk`, `ux-suite`).
- `node scripts/grade-ux-polish.mjs --honest` → `audit/ux-polish-honest.json`
  entry for `mental-health`: `"tier":"polished"`, `"isGenericScaffold":false`,
  `"honestCapped":false`, `"pillarsPresent":5`, `"antiPatterns":0`.
  (`audit/` reverted via `git checkout -- audit/` after grading, per the
  shared-worktree protocol.)
