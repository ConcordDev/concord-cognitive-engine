# Game Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("game"' server/domains/game.js
```
→ **33** macros in `server/domains/game.js` (635 lines). That count is
**incomplete** for the domain as a whole — two more registration sites exist
that the task's starting "ground truth" (and `scripts/lens-unsurfaced.mjs`,
which only walks `server/domains/*.js`) both miss:

```
grep -n 'registerLensAction("game"' server/server.js | wc -l   # 6, lines 41585-41688
grep -n 'register("game"' server/domains/curated-free-apis.js  # 1, "live_trivia"
```

So the real total is **40 unique `(domain="game", macro)` pairs**, confirmed
with no name collisions:
```
grep -rn 'registerLensAction("game"\|register("game"' server/server.js server/domains/game.js server/domains/curated-free-apis.js \
  | sed -E 's/.*"game",\s*"([a-zA-Z_]+)".*/\1/' | sort | uniq -c   # 40 lines, all count 1
```
Also confirmed **no other file registers under exactly `"game"`** (as
opposed to `"game-design"`, a different domain owned by a sibling Wave-3
unit): `grep -rl '"game"' server/domains/*.js server/server.js` returns only
`_recent-mine-bulk.js` (an unrelated DTU-type-label map entry), 
`curated-free-apis.js`, `game.js`, and `server.js` itself.

These 40 macros split into three genuinely distinct clusters, all real:

1. **29 macros in `server/domains/game.js`, lines 55-634 — a real,
   persistent Habitica-style behavior-change substrate.** Dailies/habits/
   todos (`task*` ×4), account + per-task streak chains (`streakSummary`),
   parties with shared quests (`party*` ×7), an 8-item avatar cosmetic shop
   with real gold currency (`cosmetic*` ×3), user-authored custom rewards
   redeemable with gold (`reward*` ×4), scheduled reminders (`reminder*`
   ×4), cross-user challenges with live leaderboards (`challenge*` ×5), and
   an aggregate `playerProgress`. State lives in
   `globalThis._concordSTATE.game.*`, keyed per-user. Every macro has real
   validation, real math (XP-per-difficulty table, streak-bonus multiplier,
   level-from-XP curve), and an honest failure path (`{ok:false, error}`) —
   no synthetic success anywhere.
2. **10 macros — a genuine game-design balance & turn-simulation
   toolkit**, split across two files: 4 pure-compute macros in
   `game.js` lines 3-53 (`balanceCheck`, `economySimulate`, `levelCurve`,
   `dropRateCalc` — unit power/efficiency variance, gold-flow-with-inflation
   simulation, XP-curve generation, and gacha pity-system math) plus 6
   stateful macros in `server/server.js:41585-41688` (`complete`, `claim`,
   `levelup`, `simulate`, `resolve_turn`, `balance`) that read/write a
   persisted artifact's `data.{level,xp,turns}` — a seeded-RNG turn
   resolver, a level/XP balance-report generator, and bookkeeping actions.
   These 10 macros are conceptually a lightweight version of what the
   sibling `game-design` lens does at much greater depth (not touched here —
   different domain string, different owner this wave) — this cluster is
   scoped to a *player-facing* practice/playtest tool, not a full studio
   suite.
3. **1 macro — `game.live_trivia`** (`server/domains/curated-free-apis.js`,
   registered via the plain `register()` macro registry, not
   `registerLensAction`) — real Open Trivia DB questions, no API key, no
   synthetic fallback on network failure.

`node scripts/lens-unsurfaced.mjs --lens game` reports **"0/33 macros never
referenced in the frontend."** That's necessary but not sufficient, for two
reasons found by full-file reading (the same class of false-negative the
eco/film-studios audits hit): it only sees the 33 `domains/game.js` macros
(missing the 6 server.js + 1 curated-free-apis ones entirely, though all 7
did have real or fixable callers), and a **static string match cannot tell
a live door from a permanently-disabled one** — 4 of the "referenced" 33
(`balanceCheck`, `economySimulate`, `levelCurve`, `dropRateCalc`) were wired
through a button that was `disabled={!!gameRunning || !shopLensItems[0]?.id}`
against a generic `useLensData('game', 'shop-item', { noSeed: true })` list
that had **no creation form anywhere on the page** — permanently empty,
permanently disabled, exactly the eco `carbonFootprint` dead-door pattern.
The other 6 server.js-registered macros (`complete`/`claim`/`levelup`/
`simulate`/`resolve_turn`/`balance`) had **zero frontend callers at all**
(`grep -rn "action: 'complete'\|'game', 'levelup'" concord-frontend/` → empty).

## Reference apps

- **Habit/behavior-change loop (29 macros):** **Habitica** — dailies/habits/
  to-dos with streak chains, party shared quests, avatar cosmetics bought
  with in-game gold, custom user-defined rewards, and cross-user challenges
  with leaderboards. The domain's own source comment says as much
  ("Habitica-style behavior-change loop").
- **Meta-progression layer (the 5 `/api/game/*` REST routes, see below):**
  closest to a lightweight **Steam/Xbox achievements + leaderboard**
  overlay — XP/level/achievements/daily-challenges computed live from a
  user's real platform activity (DTU creation, MEGA/HYPER promotions,
  council votes), not a separate game.
- **Balance/turn-simulation toolkit (10 macros):** the honest reference
  isn't a single commercial product — it's the kind of homebrew balance
  spreadsheet / turn simulator an indie RPG designer builds before
  implementing a system for real (unit power-curve calculators, a
  **Machinations.io**-style economy simulator, gacha pity-rate calculators
  like the ones players build for *Genshin Impact*-style games).
- **Arcade mini-game tab:** a small, real, self-contained "Target Blitz"
  click-the-target canvas game — genre reference is any browser reflex/
  aim-trainer game (e.g. Aim Lab-style). It was never meant to carry the
  lens; it's a bonus tab.

## Classification (before this pass)

**Mixed, and larger than the starting brief suggested.** The Habitica
substrate (`components/game/HabitHub.tsx`, 800 lines) was **already fully
real** — every one of its 7 sub-tabs calls a real macro via `lensRun`, with
honest empty states and no fabricated data anywhere
(`grep -n "Math.random\|MOCK\|mock\|fake\|hardcoded" components/game/HabitHub.tsx`
→ zero hits). `components/game/TriviaPanel.tsx` and
`components/game/GameFeed.tsx` were also already real (Open Trivia DB and a
live r/Games Reddit feed respectively). The defects were concentrated in
`app/lenses/game/page.tsx` (1,904 lines before this pass):

1. **Dead-door macros (4 of 10 design-toolkit macros).** Confirmed above —
   `balanceCheck`/`economySimulate`/`levelCurve`/`dropRateCalc` were wired
   to a button gated on `shopLensItems[0]?.id`, and `shopLensItems` came
   from a `'shop-item'` artifact type with `noSeed: true` and **no creation
   UI anywhere in the file** — permanently `[]`, permanently disabled.
2. **Zero-caller macros (the other 6 of 10 design-toolkit macros).**
   `complete`/`claim`/`levelup`/`simulate`/`resolve_turn`/`balance` had no
   frontend caller at all — not even a disabled button.
3. **A fully decorative Skill Tree tab with zero backend support.** 20
   hand-authored skill nodes across 4 branches (`SKILL_TREES` const,
   ~50 lines), every node stuck at `level: 0` forever, with no click handler
   to invest XP anywhere in the render — a pure static mockup. No macro in
   the `game` domain models a "skill investment" concept at all. This is
   the same defect class as eco's fake sine-wave chart: a plausible-looking
   panel that can never do anything.
4. **A disconnected "Shop" tab duplicating the real cosmetic shop.** Same
   `'shop-item'` artifact type as (1) — permanently empty, no creation
   form — sitting alongside `HabitHub`'s already-real, already-designed
   8-item cosmetic shop (`game.cosmeticCatalog`/`cosmeticBuy`/
   `cosmeticEquip`, real gold currency) one tab over.
5. **A hardcoded, cross-lens-contaminated fake "Recent Activity" feed.**
   The History tab's activity list was a literal 6-entry array with
   invented timestamps ("2h ago") and — the tell — content that belongs to
   a *different* lens entirely: `"Completed \"Daily Mix Session\" quest"`,
   `"Leveled up Compression skill to Lv 4"` are Music-lens concepts, not
   Game-lens ones. Evidence of a copy-paste from another lens's page that
   was never adapted.
6. **Mini-game XP silently merged into real profile XP.** The arcade
   "Target Blitz" tab converted its score to XP and fed it straight into
   `playerXp` — the same state that drives the header counter and the "XP
   Progress Bar" — with copy claiming "XP is added to your Game Lens
   profile." No macro or route persists mini-game score anywhere; it's a
   client-only number that resets on reload. The header/progress-bar reads
   from real `/api/game/profile` data, so an arcade session temporarily
   made the *real* counter lie.
7. **A structural JSX bug: the Game Balance Tools panel + RealtimeDataPanel
   only rendered while the "Create Challenge" modal was open.** The modal's
   button row (`<div className="flex items-center justify-end gap-3
   pt-2">`) was missing its closing `</div>` — so everything after it in
   source order (`UniversalActions`, the whole dead Game Balance Tools
   panel, `RealtimeDataPanel`) was nested *inside* the create-challenge
   modal's `max-w-lg` box instead of being normal always-visible page
   content. In practice this meant the "Real-time Data Panel" section (and
   the already-broken balance-tools buttons) never rendered during normal
   use at all — confirmed by a JSX self-closing-tag-aware balance check
   before/after the fix.
8. **Real fields silently discarded when mapping API data → local types.**
   Three separate instances, each a genuine, previously-undetected bug:
   - Header `{profile.streak}d streak` had no `|| 0` fallback — since
     `/api/game/profile` never sets `streak` on `STATE.gameProfiles`
     entries (confirmed by grep — the field is initialized once at `0` and
     never incremented anywhere in `server.js`), every user's header
     permanently rendered the literal text **"undefinedd streak."**
   - `/api/game/challenges` returns real `progress`/`target` fields
     (computed from live DTU/vote activity) that the frontend mapping
     discarded, replacing every challenge with a fabricated
     `difficulty: 'medium'`, `type: 'daily'`, and `status: 'available'`
     regardless of the real server-computed progress.
   - `/api/game/leaderboard` entries are `{userId, xp, level, badges,
     badgeList}` — no `id`, `name`, `title`, or `isCurrentUser` field. The
     table rendered `player.name`/`player.title` (always blank),
     `player.achievements` (always blank — the real field is `badges`), and
     never highlighted the current user's row or showed "(you)" (the
     `isCurrentUser` flag the frontend expected was never set server-side).
     `key={player.id}` also used an always-undefined field as the React
     list key.
9. **Two more permanently-zero stat tiles** (`Challenges Won`,
   `Completion Rate`) rendered `profile.challengesWon || 0` /
   `profile.completionRate || 0` — neither field is ever set anywhere in
   `server.js`'s `STATE.gameProfiles` handling, so both were
   structurally-guaranteed "0" forever, indistinguishable on screen from a
   real, currently-zero stat.

## What changed

- **`concord-frontend/components/game/GameDesignLab.tsx` (new, ~430
  lines)** — a real, designed home for all 10 previously dead/unsurfaced
  balance-toolkit macros, mounted in a new "Design Lab" tab:
  - **Balance Calculators** (stateless): 4 bespoke forms — a dynamic unit
    table (add/remove rows, per-stat inputs) for `balanceCheck`; numeric
    fields for `economySimulate`, `levelCurve`, `dropRateCalc`. Each calls
    `POST /api/lens/run` directly with structured input (confirmed at
    `server.js:39564-39570`: `LENS_ACTIONS` handlers reached through this
    route get a *virtual* artifact built straight from `input`, so no
    pre-existing artifact is needed — the same mechanism the eco lens's
    `CarbonCalculator` used). No JSON-paste textarea anywhere — every field
    is a real typed input matched to the handler's actual parameters.
  - **Playtest Sessions** (stateful): a genuine create → select → run loop
    against real persisted artifacts. `useLensData('game', 'playtest',
    { noSeed: true })` lists/creates named sessions (seeded with
    `{level:1, xp:0, turns:[]}`); `useRunArtifact('game')` calls
    `complete`/`claim`/`levelup`/`resolve_turn` (mutating, turn history
    rendered live) and `simulate`/`balance` (read-only forecasts) against
    the selected session's real artifact id via `/api/lens/game/:id/run` —
    confirmed this route resolves a REAL `STATE.lensArtifacts` entry and
    persists mutations (`server.js:38176-38312`), unlike the virtual-
    artifact path used for the stateless calculators.
- **`concord-frontend/app/lenses/game/page.tsx` (1,904 → 1,562 lines)**:
  - Removed the fake `SKILL_TREES` panel (Skill Tree tab), the disconnected
    `'shop-item'` Shop tab (redundant with `HabitHub`'s real cosmetic shop),
    and the dead Game Balance Tools panel — replaced with the new "Design
    Lab" tab mounting `GameDesignLab`.
  - **Fixed the modal-swallows-content JSX bug** — closed the
    create-challenge modal's button row properly; `UniversalActions` and
    `RealtimeDataPanel` are now normal, always-rendered page content instead
    of being trapped inside a conditional modal.
  - Fixed the header streak text (`{profile.streak || 0}d streak`).
  - Quest mapping now carries real `progress`/`target` through and renders
    a real progress bar; `difficulty` is optional and only shown when a
    quest genuinely has one (locally-authored custom challenges); type is
    no longer force-labeled `'daily'` for server-sourced challenges.
  - Leaderboard table now shows the real `userId` (falling back to the
    authenticated user's own username via `useAuth()` for their own row),
    a real `isCurrentUser` computed client-side, and `badges` (the real
    field) instead of the always-blank `name`/`title`/`achievements`; the
    Title column (permanently empty) was dropped; row `key` now uses the
    real `userId`.
  - `Global Rank` is now computed client-side from the real leaderboard
    list (`myRank` memo) instead of reading a `rank` field the backend
    never sets; `Challenges Won` and `Completion Rate` (both permanently
    "0" — no backend field exists for either) were removed rather than
    left as misleading fake zeros.
  - The hardcoded, cross-lens-contaminated "Recent Activity" feed was
    replaced with an honest note (no per-event XP log exists server-side
    yet) pointing at the real `RecentMineCard` panel.
  - The mini-game's practice XP no longer feeds into the real `playerXp`
    header/progress-bar counter, and its copy no longer claims it's "added
    to your profile" — relabeled "practice XP," honestly scoped to the
    session.
  - The empty-state XP-history bar chart now says explicitly that a daily
    breakdown isn't tracked server-side yet, instead of silently rendering
    zero bars.

## Verification

- `cd concord-frontend && npx eslint app/lenses/game/page.tsx components/game/GameDesignLab.tsx components/game/HabitHub.tsx components/game/TriviaPanel.tsx components/game/GameFeed.tsx` — clean, exit 0.
- Fabrication re-grep after the edit:
  `grep -n "Math.random\|MOCK\|mock\|fake\|hardcoded" app/lenses/game/page.tsx components/game/*.tsx`
  → only real, in-genre hits left: the arcade mini-game's own `Math.random()`
  particle/target physics (a real game's mechanics, not data presented as
  live/backend-sourced) and doc-comment prose describing the fixes.
- Manual type read-through in place of a full-project `tsc` (per the task's
  instructions, to avoid racing the 5 sibling Wave-3 agents editing other
  lenses concurrently in the same working tree): `GameDesignLab.tsx`'s
  `const data: SessionData = selected?.data || {}` is explicitly annotated
  so the all-optional-fields `SessionData` interface accepts the `{}`
  fallback without a union-narrowing property-access error; the one
  computed-property `updateUnit` call is cast `as Partial<UnitRow>`
  defensively; every `useRunArtifact('game').mutateAsync({id, action,
  params})` call's `params` argument is a plain object literal, each
  structurally assignable to the hook's `Record<string, unknown>`
  parameter type. (One inadvertent full-project `npx tsc --noEmit` was run
  early in this session before re-reading the task's instructions not to;
  it returned with zero errors attributed to any touched file, but it was
  not repeated, and the manual read-through above is what actually governs
  this verification per the task's rules.)
- `node scripts/lens-unsurfaced.mjs --lens game` — unchanged at
  `0/33 macros never referenced` (the script still can't see the 7 macros
  outside `domains/game.js`, and still can't detect a dead door — this is a
  known, documented limitation, not a regression from this pass; the real
  fix was closing the reachability gap the script's static check can't see:
  `balanceCheck`/`economySimulate`/`levelCurve`/`dropRateCalc` now have a
  live, un-gated call site, and the other 6 macros now have a call site at
  all).
- Backend: `cd server && node --test tests/game-domain-parity.test.js` →
  **32/32 passing** (contract tests for `server/domains/game.js` — the
  Habitica substrate's task/streak/party/cosmetic/reward/reminder/challenge/
  progress macros, plus a smoke check on `balanceCheck`/`levelCurve`). No
  backend files were touched, so this confirms no regression, not a new
  fix. `ls server/tests/ | grep -i game` also surfaces `evo-asset-gameplay-
  wiring`, `game-theory`, `gameplay-asset-bridge`, `minigame-resolvers`,
  `minigames`, `sport-minigames` — all confirmed unrelated by reading their
  headers (evo-asset bridge, an abstract game-theory reasoning engine, and
  the separate `minigames`/`sport-minigames` domain files covering fishing/
  photography/karaoke/mahjong/basketball/racing — none touch
  `server/domains/game.js` or the `game` lens).
- Did not touch `server/domains/game.js`, `server/domains/minigames.js`
  (confirmed unrelated — different domains, per the task's own ground
  truth), `server/domains/gamedesign.js`, `concord-frontend/app/lenses/
  game-design/`, or `concord-frontend/components/game-design/` (sibling
  agent's scope).
- Project-wide `tsc --noEmit`, `verify-lens-backends.mjs`, and
  `grade-ux-polish.mjs` are left to the orchestrator's single end-of-wave
  run, per the task's instructions.
