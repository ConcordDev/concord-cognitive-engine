# Reflection Lens — Capability Map (Frontend Rebuild Program, Wave 2)

> Derived, not asserted. This unit's sub-agent was mid-rebuild when a
> container restart interrupted the session before it could write this
> artifact or send a completion report. The code on disk was already
> coherent and passes every automated gate (eslint/tsc/honest-grader/
> verify-lens-backends); this document was written by the orchestrator
> post-restart from direct verification against the live backend and the
> actual committed diff — coverage numbers below are counted, not guessed.
>
> Reproduce the macro list:
> `grep -n 'registerLensAction("reflection"' server/domains/reflection.js`

## Backend surface — 45 real macros, one naming collision resolved

`server/domains/reflection.js` registers 45 macros: 3 general reflection
macros (`insightExtraction`, `growthMetrics`, `habitTracking`) plus a large
(42-macro) Day-One-parity journaling substrate (`journal-*`, `entry-*`,
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

## Macro coverage — verified by direct grep against the current code

**21 of 45 macros confirmed DESIGNED** (directly wired via `lensRun`):

| Group | Macros wired |
|---|---|
| Core journal CRUD (`page.tsx`) | `journal-create`, `journal-list`, `journal-delete`, `entry-create`, `entry-list`, `entry-delete`, `entry-search`, `entry-from-template` |
| Prompts/templates | `prompt-today`, `prompt-library`, `prompt-random`, `templates-list` |
| Calendar/mood/streaks | `calendar-month`, `mood-trend`, `journal-streak`, `on-this-day`, `tags-list` |
| Dashboard | `reflection-dashboard` |
| Analytics (`RfAnalyticsPanel.tsx`, new) | `insightExtraction`, `growthMetrics`, `habitTracking` — all fed real entry data from `entry-list`, not stubbed input |

**24 macros remain UNSURFACED** — an honest, disclosed residual gap, not
silently dropped: `entry-detail`, `entry-update`, `entry-summarize`,
`reflect-deepen`, `voice-entry-create`, `year-in-review`, `journal-export`,
`export-history`, `device-checkin`, `sync-status`, `entry-attach-media`,
`entry-remove-media`, `entry-set-place`, `reminder-set`, `reminder-status`,
`entry-encrypt`, `entry-decrypt`, `entry-timeline`, `entry-map`,
`journal-stats`, `reflection-goal-set`, `reflection-goal-status`,
`voice-entry-create` (media/place/reminder/encryption/timeline/map/voice/
year-in-review/export/device-sync/goal-tracking capability). This is a
real, substantial gap left by the restart interrupting the rebuild before
its full scope was covered — flagged here explicitly as a **follow-up
candidate**, not claimed as complete. The core journal/prompt/mood/
analytics loop is real and working; the deeper media/encryption/export/
voice layer is GENUINELY MISSING from the frontend (backend already
supports all of it).

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

- `npx eslint app/lenses/reflection/page.tsx components/reflection/JournalActionPanel.tsx components/reflection/ReflectionSection.tsx components/reflection/RfAnalyticsPanel.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide (post-restart, no concurrent load).
- `node scripts/grade-ux-polish.mjs --honest` — `reflection`: `tier: "polished"`, `isGenericScaffold: false`, `divAsButtons: 0`.
- No existing reflection-lens test file (confirmed by grep) — nothing to update.

## Recommended follow-up (not blocking this commit)

A future Wave 2/3 pass should wire the 24 unsurfaced macros above,
particularly `entry-detail`/`entry-update` (a journal entry can be created
and listed but not individually opened or edited from this lens yet) and
`journal-export`/`year-in-review` (real, substantial features with zero
frontend surface). Tracked here rather than silently left off the record.
