# Meditation Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("meditation"' server/domains/meditation.js
```
→ **24** macros in `server/domains/meditation.js` (724 lines), registered via
`registerMeditationActions(register)`. No domain-string collisions with any
other lens (the mental-health/self/wellness lenses use "meditation" only as
a metric-type *string value*, never as a `registerLensAction` domain).

Real surfaces: 4 pure-compute legacy macros (`pickTrack`, `dailyPrompt`,
`breathwork`, `soundscapeConfig`), a full Calm/Headspace-shape STATE-backed
practice substrate (`library`, `play`, `history`, `streak`, `mood-checkin`,
`mood-history`, `meditation-dashboard`), multi-day courses (`courses`,
`enrollCourse`, `courseProgress`, `completeCourseDay`), reminders
(`setReminder`, `reminders`, `toggleReminder`, `deleteReminder`), a sleep
timer with an eased fade curve (`sleepTimerConfig`), adaptive
recommendations (`recommendations`), gamified milestones (`milestones`),
and the two legacy top-of-file macros this pass fixed (`sessionLog`,
`streakSummary` — see below).

## Frontend surface

`concord-frontend/app/lenses/meditation/page.tsx` (main session
player/hero + "Your practice" streak card) +
`concord-frontend/components/meditation/{MeditationStudio,
BreathingVisual, SoundscapePlayer, CoursesPanel, RemindersPanel,
InsightsPanel}.tsx` (6 tabbed sub-panels: Library / Breathe / Sounds /
Courses / Reminders / For You). Already, before this pass, a genuinely
well-built lens — real Web Audio soundscape synthesis (no licensed-audio
fabrication, by design), a real animated breathwork pacer, real course
enrollment/progress, real reminders with browser Notification API
integration. This is a rare case in the program where the frontend was
**already fully DESIGNED per-macro** — the defect found was not
missing/fake UI but a **dead backend substrate silently discarding data**.

## The defect found

### `meditation.sessionLog` (and `meditation.streakSummary`) were dead —
they wrote to a virtual artifact that is discarded after every request,
so the lens's primary flow (the hero session player at the top of the
page) never counted toward the streak/milestones/insights the rest of the
lens shows

Confirmed by reading `server.js:39593-39599` (`/api/lens/run` dispatch):
every `LENS_ACTIONS` call receives `virtualArtifact = { id: null, domain,
type: "domain_action", data: rest, meta: {} }` — a **fresh, throwaway**
object built from the request's own input, never read from or written to
any persistent store. `data: rest` literally *is* the input body, so
`artifact.data?.sessions` on the very first line of the old `sessionLog`
was always `undefined` (the input has `trackId`/`minutes`/`rating`
fields, never a `sessions` array) → `sessions = []` on every single call,
regardless of history. The handler then pushed one entry, returned
`{ entry, total: 1 }` (fabricated — always `1`, never a real cumulative
count), and mutated `artifact.data`, which was immediately discarded
since `virtualArtifact.id` is `null` and nothing persists it. `CLAUDE.md`
names this exact trap explicitly ("`POST /api/lens/run` builds a virtual
artifact whose `.data` IS the input body directly ... this is the fix for
a dead button gated on a permanently-empty artifact store").

Cross-checked against `useLensData('meditation', 'sessions', ...)` in the
old `page.tsx` — that hook hits `GET /api/lens/meditation?type=sessions`,
which routes through `runMacro("lens", "list", ...)`, a **completely
separate, real, DB-backed generic artifact table.** `sessionLog` never
wrote to that table either. So the old `refetchSessions()` call after
"Log" always re-fetched an empty/unrelated list — nothing the hero player
did was ever visible anywhere else in the lens.

Meanwhile every OTHER write path in the lens (`play` from the Library/
Breathing/Insights tabs, `completeCourseDay` from Courses) correctly
persists into `STATE.meditationLens.sessions` (a `Map<userId, Array>`),
which `history`/`streak`/`meditation-dashboard`/`recommendations`/
`milestones` all read from. So the bug had two faces:

1. Completing a session in the primary hero player and clicking "Log"
   showed a "Logged session 1." success toast (fabricated — always `1`)
   but the session vanished. It never counted toward the streak badge
   in the header, never unlocked a milestone, never showed up in
   recommendations' `totalSessions`, never affected course pacing.
2. `streakSummary` (the macro whose docstring literally promises
   "current + longest streak") had the identical bug — it read the same
   dead `artifact.data.sessions`, so it always returned all-zero. The
   frontend had already worked around this by not calling it at all
   (calling `meditation.streak` instead, per a stale doc comment at the
   top of `page.tsx` that still said `meditation.streakSummary`) — but
   `streak` only returns `currentStreak`, not `longestStreak`, so
   `page.tsx` was **client-side fabricating** `longestStreak` via
   `Math.max(prev?.longestStreak ?? 0, current)` inside a `useState`
   updater — a value that resets to `0` on every page reload and can
   only grow monotonically within one browser session, never reflecting
   the user's real historical longest streak even though the backend
   already had the real streak history to compute it correctly from.

This is the recurring defect pattern's variant (b)/(d): a real macro
called with a shape that silently produces garbage (the ephemeral-
artifact trap), paired with a client-side fabricated stat standing in for
a number the backend could have supplied honestly.

## What changed

### 1. `server/domains/meditation.js` — `sessionLog` and `streakSummary`
rewired onto the same STATE-backed practice ledger every other macro uses

- `sessionLog(ctx, _artifact, params)` now calls `getMedState()` +
  `medList(s.sessions, medActor(ctx))` (the exact same substrate `play`
  writes to) and pushes an entry shaped like `play`'s
  (`{id, sessionId, title, category, durationMin, moodAfter,
  completedAt}`), accepting new optional `title`/`category` params from
  the caller so a freeform (non-`LIBRARY`) session logged from the hero
  player is recorded with real values instead of `undefined`. `total` is
  now the real cumulative session count, not a fabricated `1`.
- `streakSummary(ctx, _artifact, _params)` now reads the same
  `s.sessions` list and computes BOTH `currentStreak` and a real
  `longestStreak` server-side (the exact day-run algorithm the old, dead
  version already had — it just needed a real data source), plus
  `totalSessions`/`totalMinutes`/`lastSessionAt`.
- No new backend behavior was invented — both macros already existed
  with the right *intent* and the right *algorithm*; the fix was
  pointing them at the practice ledger that already exists and that
  every sibling macro (`play`, `history`, `streak`, `milestones`,
  `meditation-dashboard`) already reads/writes correctly.

### 2. `app/lenses/meditation/page.tsx` — wired to the fixed macros +
closed the `history` unsurfaced macro + fixed cross-tab staleness

- `actLog()` now sends `title`/`category` (derived from the current
  goal: `breath` → `breathwork`, else `guided`) alongside `trackId`/
  `minutes`/`completedAt`/`rating`, so the logged entry is honest and
  consistent with entries `play` produces.
- `loadPractice()` now calls `meditation.streakSummary` (real,
  server-computed `longestStreak`) instead of `meditation.streak` +
  client-side `Math.max` fabrication. Removed the dead
  `useLensData('meditation', 'sessions', ...)` hook and its
  `refetchSessions` — it was pointed at a permanently-empty generic
  artifact store the lens's macros never write to.
- Added `notifyPractice()`, threaded as an `onPractice`/`onPlayed`
  callback prop into `MeditationStudio`, `BreathingVisual`,
  `CoursesPanel`, and `InsightsPanel`. Before this pass, only
  `InsightsPanel`'s play button (via `onPlayed={refetchSessions}`) tried
  to refresh the header — and even that was wired to the dead artifact
  store, so it never actually worked. Now every practice-mutating action
  anywhere in the lens (library play, breathwork log, course-day
  complete, mood check-in, insights play) refreshes the header streak
  badge and the "Your practice" card, closing the "acted in one tab, the
  rest of the lens doesn't know" staleness bug.
- **Closes the `meditation.history` unsurfaced macro**: added an
  expandable "View session history" list inside the "Your practice"
  card, lazy-loaded on first expand, showing each logged session's
  title, category, timestamp, duration, and mood (a real Calm/Headspace-
  style session log, not a generic list).

### 3. `components/meditation/MeditationStudio.tsx` — closes the
`meditation.mood-history` unsurfaced macro

- The mood check-in row now also fetches `mood-history` and renders a
  compact trend strip: rolling average mood + the last 10 check-ins as
  an emoji row (hover shows the timestamp). Fits the existing
  check-in UI directly below it rather than adding a new tab.

### 4. `components/meditation/BreathingVisual.tsx` +
`CoursesPanel.tsx` — thread `onPractice`

Both now accept an optional `onPractice?: () => void` prop and call it
after a real practice-mutating action (`play` for a completed breathwork
cycle; `completeCourseDay` for a finished course day), per item 2 above.

## Macro → UI classification (all 24 macros)

**DESIGNED** — 24/24 (was 22/24 before this pass; `history` and
`mood-history` were UNSURFACED, `sessionLog`/`streakSummary` were
reachable-but-broken):

| Macro group | Count | Where |
|---|---:|---|
| `pickTrack`, `dailyPrompt` | 2 | `page.tsx` hero player (pre-existing, real) |
| `sessionLog` | 1 | `page.tsx` "Log" action (**backend bug fixed this pass**) |
| `streakSummary` | 1 | `page.tsx` "Your practice" card (**backend bug fixed + newly called this pass**) |
| `history` | 1 | `page.tsx` "Your practice" → session history list (**newly wired this pass**) |
| `library`, `play`, `meditation-dashboard` | 3 | `MeditationStudio.tsx` (pre-existing, real) |
| `mood-checkin` | 1 | `MeditationStudio.tsx` (pre-existing, real) |
| `mood-history` | 1 | `MeditationStudio.tsx` mood trend strip (**newly wired this pass**) |
| `breathwork` | 1 | `MeditationStudio.tsx` + `BreathingVisual.tsx` (pre-existing, real) |
| `soundscapeConfig`, `sleepTimerConfig` | 2 | `SoundscapePlayer.tsx` (pre-existing, real) |
| `courses`, `enrollCourse`, `courseProgress`, `completeCourseDay` | 4 | `CoursesPanel.tsx` (pre-existing, real) |
| `setReminder`, `reminders`, `toggleReminder`, `deleteReminder` | 4 | `RemindersPanel.tsx` (pre-existing, real) |
| `recommendations`, `milestones` | 2 | `InsightsPanel.tsx` (pre-existing, real) |

Total: 2+1+1+1+3+1+1+1+2+4+4+2 = **24**. Matches
`grep -c 'registerLensAction("meditation"' server/domains/meditation.js`.

**GENERIC-STRIP-ONLY**: none. `<ManifestActionBar />` is present (a
platform-standard header strip) but the page body is 6 fully-bespoke
tabbed panels with real audio synthesis, animated pacers, and CRM-style
course/reminder management — not a button-wall standing in for real UI.
Confirmed by the grader: `hasMacroButtonWall: true` (the action-card grid
in the hero player is a real, small, curated 5-action strip — mint/DM/
publish/agent/log — not a generic macro dump) but `usesGenericBody:
false`, `isGenericScaffold: false`.

**UNSURFACED**: none remaining. `node scripts/lens-unsurfaced.mjs --lens
meditation` reports 0/24 (was 2/24 — `history`, `mood-history`).

## Confirmed real and left alone, with reason

`grep -n "Math.random|MOCK|mock|fake|Lorem|lorem|hardcoded"
components/meditation/*.tsx app/lenses/meditation/page.tsx` → the only
`Math.random()` hit is in `SoundscapePlayer.tsx#makeNoiseBuffer`, which is
the actual white/pink/brown noise generator feeding a real Web Audio
buffer source (randomness is the correct implementation, not fabricated
data) — left unchanged.

- **`SoundscapePlayer.tsx`** — real Web Audio synthesis chain (noise
  buffer → biquad filter → LFO-modulated gain, or drone oscillators for
  guided/sleep/breathwork/sos tone beds) driven by the real
  `soundscapeConfig`/`sleepTimerConfig` macros, with an eased volume
  fade-out interpolated from the server-returned curve. No licensed audio
  is faked — this is the honest, documented design choice
  (`server/domains/meditation.js:289-292`). No changes needed.
- **`RemindersPanel.tsx`** — real reminder CRUD + real browser
  Notification API integration for local next-fire alerts. No changes
  needed.
- **`BreathingVisual.tsx`**'s animated orb (scale/color/timing driven by
  the real `breathwork` phase spec) — already correct, only the
  `onPractice` threading was added.

## Genuinely missing, deferred

None identified. Every real meditation-lens capability implied by the
24-macro backend now has a designed UI. No fabricated parallel artifact
type was found (unlike several prior Wave rebuilds) — the lens's only
defect was the dead-artifact-store trap on two legacy macros, now fixed
by pointing them at the practice ledger that already exists.

## Verification

- `node --check server/domains/meditation.js` — clean.
- `node --test tests/meditation-domain-parity.test.js
  tests/meditation-lens-macros.test.js` (from `server/`) — **54/54
  pass**, unmodified (neither file asserts on `sessionLog`/
  `streakSummary`'s old broken behavior, so the fix required no test
  changes; the registration test's `typeof ACTIONS.get(m) === "function"`
  check for both macros still passes).
- `node scripts/lens-unsurfaced.mjs --lens meditation` (from repo root) —
  **0/24 unsurfaced** (was 2/24 before this pass: `history`,
  `mood-history`).
- `npx eslint app/lenses/meditation/page.tsx components/meditation/*.tsx`
  (from `concord-frontend/`) — clean, exit 0.
- `node scripts/verify-lens-backends.mjs` (from repo root) —
  `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 (meditation was already
  WIRED and stays WIRED).
- `node scripts/grade-ux-polish.mjs --honest` (from repo root) —
  meditation entry: `"tier": "polished"`, `"isGenericScaffold": false`,
  `"bespokeRatio": 0.615`, `"maxBespokeComponentLoc": 283`. `audit/`
  outputs reverted via `git checkout -- audit/` per the
  transient-artifact rule.
