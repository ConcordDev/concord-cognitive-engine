# Reflection Lens — Capability Map (Frontend Rebuild Program, Wave 2 → closed Wave 4)

> Derived, not asserted. This unit's sub-agent was mid-rebuild when a
> container restart interrupted the session before it could write this
> artifact or send a completion report. The code on disk was already
> coherent and passes every automated gate (eslint/tsc/honest-grader/
> verify-lens-backends); this document was written by the orchestrator
> post-restart from direct verification against the live backend and the
> actual committed diff — coverage numbers below are counted, not guessed.
>
> **Update 2026-07-12 (Wave 4 gap-closure re-verification):** the "24
> macros remain UNSURFACED" claim below is now STALE and fully closed.
> Direct re-grep of every `lensRun('reflection', ...)` call site across
> `concord-frontend/components/reflection/*.tsx` + the lens page confirms
> **all 43 registered macros are wired** (the doc's "45" count was also off
> by 2 — see the corrected reproduction below). Two things happened after
> this doc was first written: (1) `JournalStudio.tsx` (mounted as the
> "Studio" tab in `ReflectionSection.tsx`) already covered 15 of the 24 —
> media attach/remove, place+weather, reminders, encryption, timeline,
> map, voice journaling, year-in-review, export + export-history, sync
> status + device check-in — confirmed real by direct component read, not
> assumed; (2) commit `5c33c6ab` ("Wave 4: close reflection's real
> remaining macro gap — 7, not 24") closed the true residual 7
> (`entry-detail`, `entry-update`, `entry-summarize`, `reflect-deepen`,
> `journal-stats`, `reflection-goal-set`, `reflection-goal-status`) via a
> new `RfEntryDetailModal.tsx` (opened by clicking an entry in
> `RfEntriesPanel.tsx`) and additions to `RfInsightsPanel.tsx`. Nothing
> further was built this pass — this update is a correction of the record,
> re-verified against a fresh read of `server/domains/reflection.js` plus
> every frontend call site, plus a full test/lint/typecheck re-run (76/76
> backend reflection tests, 14/14 frontend component tests, eslint clean,
> `tsc --noEmit -p .` 0 errors).
>
> Reproduce the macro list:
> `grep -oE 'registerLensAction\("reflection", "[a-zA-Z0-9_-]+"' server/domains/reflection.js | sort -u | wc -l` → 43.

## Backend surface — 43 real macros, one naming collision resolved

`server/domains/reflection.js` registers **43** macros (corrected from this
doc's original "45" — direct grep count): 3 general reflection macros
(`insightExtraction`, `growthMetrics`, `habitTracking`) plus a large
(40-macro) Day-One-parity journaling substrate (`journal-*`, `entry-*`,
`prompt-*`, `templates-*`, `tags-list`, `calendar-month`, `mood-trend`,
`reflect-deepen`, `entry-summarize`, `reflection-goal-*`,
`reflection-dashboard`, media/place/reminder/encryption/timeline/map/voice/
year-in-review/export/device-sync macros).

**Naming collision, confirmed real** (same pattern as Wave 1's `lattice`
finding and this rebuild's own `grounding` finding): `server/lib/emergents/
quality/self-critique.js` is a completely separate emergent quality-scoring
system with zero code-level connection to `reflection.js` (confirmed —
`grep -n "self-critique\|selfCritique" server/domains/reflection.js` returns
nothing). The rebuilt page's `Mode = 'journal' | 'selfcritique'` type does
NOT wire to that unrelated emergent module; "selfcritique" mode is an
honestly-real feature built from the 3 general reflection macros
(`insightExtraction`/`growthMetrics`/`habitTracking`) applied to the user's
actual journal entries via a new `RfAnalyticsPanel.tsx` — a legitimate,
real "reflect on your own journal" analysis surface, just not the same code
path as the emergent self-critique system (which remains a separate,
untouched, whole-platform mechanism — correctly out of scope here).

## Macro coverage — verified by direct grep against the current code (2026-07-12)

**43 of 43 macros confirmed DESIGNED** (directly wired via `lensRun`, every
one reachable from a mounted component — verified by tracing the render
tree, not just grepping for the call):

| Group | Component | Macros wired |
|---|---|---|
| Core journal CRUD (`page.tsx` → `RfEntriesPanel.tsx`) | `RfEntriesPanel` | `journal-create`, `journal-list`, `journal-delete`, `entry-create`, `entry-list`, `entry-delete`, `entry-search`, `entry-from-template` |
| Entry detail/edit/AI follow-ups | `RfEntryDetailModal` (opened by clicking an entry card) | `entry-detail`, `entry-update`, `entry-summarize`, `reflect-deepen` |
| Prompts/templates | `RfPromptsPanel` | `prompt-today`, `prompt-library`, `prompt-random`, `templates-list` |
| Calendar/mood/streaks/goal/stats | `RfInsightsPanel` | `calendar-month`, `mood-trend`, `journal-streak`, `on-this-day`, `tags-list`, `journal-stats`, `reflection-goal-set`, `reflection-goal-status` |
| Dashboard | `ReflectionSection` | `reflection-dashboard` |
| Analytics | `RfAnalyticsPanel` | `insightExtraction`, `growthMetrics`, `habitTracking` — all fed real entry data from `entry-list`, not stubbed input |
| Media/place/reminders/encryption/timeline/map/voice/export/sync ("Studio" tab) | `JournalStudio` | `entry-attach-media`, `entry-remove-media`, `entry-set-place`, `reminder-set`, `reminder-status`, `entry-encrypt`, `entry-decrypt`, `entry-timeline`, `entry-map`, `voice-entry-create`, `year-in-review`, `journal-export`, `export-history`, `sync-status`, `device-checkin` |

**0 macros remain unsurfaced.** The prior "24 macros remain UNSURFACED"
claim (below, kept for history) was accurate at the point this doc was
first written (Wave 2, mid-rebuild container restart) but went stale as
soon as `JournalStudio.tsx` + `RfEntryDetailModal.tsx` landed — see the
2026-07-12 update note at the top of this file for the closure trail and
verification. Original Wave-2 text, preserved for the record: "24 macros
remain UNSURFACED — an honest, disclosed residual gap, not silently
dropped: `entry-detail`, `entry-update`, `entry-summarize`,
`reflect-deepen`, `voice-entry-create`, `year-in-review`,
`journal-export`, `export-history`, `device-checkin`, `sync-status`,
`entry-attach-media`, `entry-remove-media`, `entry-set-place`,
`reminder-set`, `reminder-status`, `entry-encrypt`, `entry-decrypt`,
`entry-timeline`, `entry-map`, `journal-stats`, `reflection-goal-set`,
`reflection-goal-status` — the core journal/prompt/mood/analytics loop is
real and working; the deeper media/encryption/export/voice layer is
GENUINELY MISSING from the frontend (backend already supports all of
it)." That gap is now closed.

## What was fixed (generic scaffold retired)

Confirmed via grep: `page.tsx` imports none of the generic-scaffold trio
(`ManifestActionBar`/`AutoActionStrip`/`RecentMineCard`/`UniversalActions`/
`CrossLensRecentsPanel`) — the honest grader's `importsGenericTrio` is
`false`, so `isGenericScaffold` is `false` regardless of the still-present
`LensFeaturePanel` collapsible (kept as a genuine feature-discovery
affordance, not scaffold — this mirrors how several other Wave 2 rebuilds
keep `LensFeaturePanel` deliberately when it's the only remaining generic
marker and the rest of the page is bespoke).

## Verification

- `npx eslint app/lenses/reflection/page.tsx components/reflection/JournalActionPanel.tsx components/reflection/ReflectionSection.tsx components/reflection/RfAnalyticsPanel.tsx` — clean (Wave 2).
- `npx tsc --noEmit -p .` — 0 errors project-wide (post-restart, no concurrent load) (Wave 2).
- `node scripts/grade-ux-polish.mjs --honest` — `reflection`: `tier: "polished"`, `isGenericScaffold: false`, `divAsButtons: 0` (Wave 2).
- **2026-07-12 re-verification:** `node --test server/tests/reflection-domain-parity.test.js server/tests/depth/reflection-behavior.test.js` — 76/76 pass; `npx vitest run tests/components/RfEntryDetailModal.test.tsx tests/components/RfInsightsPanel.test.tsx` — 14/14 pass; `npx eslint app/lenses/reflection/page.tsx components/reflection/*.tsx` (frontend) + `npx eslint domains/reflection.js` (server) — both clean; `npx tsc --noEmit -p .` — 0 errors.

## Recommended follow-up

None outstanding for macro coverage — all 43 macros are wired (see table
above). The prior "wire the 24 unsurfaced macros" follow-up (Wave 2 text
below, preserved for history) was closed by `JournalStudio.tsx` +
`RfEntryDetailModal.tsx` + commit `5c33c6ab`: "A future Wave 2/3 pass
should wire the 24 unsurfaced macros above, particularly
`entry-detail`/`entry-update` (a journal entry can be created and listed
but not individually opened or edited from this lens yet) and
`journal-export`/`year-in-review` (real, substantial features with zero
frontend surface)." Any future work on this lens should start from a
fresh macro-coverage grep rather than trusting this doc's history section,
per CLAUDE.md's "docs are a build artifact, not prose" invariant.
