# Sports Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Backend surface enumerated by reading
> `server/domains/sports.js` (1034 LOC) in full — every macro registered
> via `registerLensAction("sports", "<name>", ...)`, confirmed with
> `grep -c 'registerLensAction("sports"' server/domains/sports.js` → **45**
> (the task brief's preliminary "45 hits" grep was correct; re-verified
> here independently). Frontend audited by reading
> `app/lenses/sports/page.tsx` (1096 LOC pre-fix) and all 10
> `components/sports/*.tsx` files (~148 KB combined) in full. Also
> audited the sibling `/api/sports/*` REST routes in `server.js`
> (7 routes, `sports-league-engine.js`) and the `sports_careers` domain
> (`server/domains/sports-careers.js`, 13 macros) that those routes back.

## Backend surface — 45 macros in `sports`, all real

Four pure-compute helpers (`performanceStats`, `trainingPlan`,
`injuryRisk`, `teamAnalysis` — the ones the depth-fleet sweep's
`sports.injuryRisk` bugfix touched; verified fixed, current code uses
`Number.isFinite(_rd) ? _rd : 2` for `restDays`, not a `||`-falsy
footgun). Two free-API lookups (`team-lookup`, `league-table` via
TheSportsDB) and one ESPN scoreboard puller. A large ESPN-2026-parity
"fan hub" cluster — followed teams, game tracking, Pick'em predictions,
watchlist, standings, tracked athletes + per-game stat lines, a
personalized `my-scores` feed, a `sports-dashboard` summary, and a
`feed` macro that ingests real TheSportsDB fixtures as DTUs (the
`LensFeedButton` convention). An ESPN "spectator core" cluster —
`espn-game-summary` (play-by-play + boxscore + recap), `espn-schedule`,
`espn-standings`, `espn-news`, `team-roster`, `player-lookup`,
`reminder-*` (persistent per-user), `bracket-*` (single-elimination,
handles BYEs and downstream-round rebuilds on re-advance), and a
pure-compute `win-probability` logistic model. All state-backed macros
are scoped by `spAid(ctx)` (`ctx.actor.userId || ctx.userId`) — verified
per-user isolation throughout, no cross-user leakage found.

Separately, `server/domains/sports-careers.js` registers 13
`sports_careers` macros (open_league/add_team/schedule_match/play_match/
tick/etc.) that wrap `server/lib/sports-league-engine.js`. **No frontend
lens references the `sports_careers` domain at all** (confirmed —
`grep -rln "sports_careers" concord-frontend/` returns nothing); it's
reached only via `/api/sports/*` REST routes in `server.js`, which is
what `LeagueStandings.tsx` + `MatchSimulator.tsx` (mounted in my lens's
"Leagues (live)" tab) actually call.

## Reference apps

ESPN (scores/standings/news/play-by-play/brackets) + ESPN Fantasy
(Pick'em, watchlist) + Strava (activity logging, training plans, injury
risk). The lens explicitly names both in its own UI chrome (`espn
fantasy · strava` badge in `ActivityActionPanel`, `espn · live` /
`espn shape` badges elsewhere) — this is a case of the reference-app
naming discipline already being followed by the code, not something I
had to add.

## Audit result: real, well-built, one genuine security defect fixed

Full read of `page.tsx` and all 10 sub-components confirms the CLAUDE.md
claim "DC1 sports lens calls the engine" is still true and is a real
data path — `LeagueStandings.tsx` / `MatchSimulator.tsx` hit
`/api/sports/league/*` and `/api/sports/match/*` directly (not the
macro system), confirmed live against `server.js:51004-51038`.

No `Math.random()` in a render path, no hardcoded arrays presented as
live data, no fake-success toasts. `grep -rniE "TODO|FIXME|mock|dummy|
hardcoded|fake" app/lenses/sports/ components/sports/` returns nothing
load-bearing. Every macro reads real per-user state or a real external
API (TheSportsDB / ESPN), and every panel that calls a macro is a
purpose-built component, not a generic button wall wrapping raw JSON.

### 🔴 Found and fixed: match-outcome-rigging via `rollOverride` passthrough

`server/lib/sports-league-engine.js#playMatch(db, matchId, opts)` reads
`opts.rollOverride` as a **test-only determinism hook** (its own doc
comment: "rollOverride for tests") — when set, it replaces
`Math.random()` in the win-probability roll, letting a caller force an
exact score and winner. The route that backs my lens's own
`MatchSimulator.tsx` was forwarding the raw request body straight into
it:

```js
// server.js:51030-51033 (before)
app.post("/api/sports/match/:matchId/play", requireAuth(), asyncHandler(async (req, res) => {
  const { playMatch } = await import("./lib/sports-league-engine.js");
  res.json(playMatch(db, req.params.matchId, req.body || {}));
}));
```

Any authenticated user could `POST /api/sports/match/:matchId/play` with
body `{"rollOverride": 0}` for **any** `matchId` in the system —
including matches between teams/leagues they have no relationship to —
and force the home team to win with a near-maximum score (or `0.99` to
force the away side), corrupting `sports_teams.wins/losses/power_score`
league standings. `MatchSimulator.tsx` itself never sends this (it POSTs
an empty body), so this was invisible from the UI, but the endpoint was
reachable directly. This is the same class of defect CLAUDE.md's
`_validateDamageCap`/`_validateCombatReach` invariant exists to prevent
for world combat — "never reintroduce a trust-the-client-value path."

**Fix** (`server/server.js:51030-51035`): the route no longer forwards
`req.body` at all — `playMatch` only ever needs `rollOverride` from
tests calling the JS function directly, never from an HTTP body:

```js
app.post("/api/sports/match/:matchId/play", requireAuth(), asyncHandler(async (req, res) => {
  const { playMatch } = await import("./lib/sports-league-engine.js");
  // Never forward the request body into playMatch: opts.rollOverride is a
  // test-only determinism hook (see sports-league-engine.js), and forwarding
  // req.body let any authenticated caller pin rollOverride to rig the score
  // of ANY match by id, regardless of which teams/league they belong to.
  res.json(playMatch(db, req.params.matchId, {}));
}));
```

**Scope note — related but NOT fixed:** the `sports_careers.play_match`
macro (`server/domains/sports-careers.js:64-68`) has the identical
`rollOverride` passthrough, and `/api/sports/tryout`
(`routeforwardsreq.body` into `requestTryout`, whose pass/fail check
trusts client-supplied `athleticSkill`/`reflexSkill` with no server-side
skill source) has an analogous self-reported-stat trust issue. Neither
is reachable from any frontend lens (`grep -rln "sports_careers"
concord-frontend/` and `grep -rn "api/sports/tryout"
concord-frontend/` both return nothing) — they are dead career/tryout
backend capability with zero UI surface, so no user of the sports lens
is exposed through them today. Left unfixed because (a) fixing them
means editing `server/domains/sports-careers.js` and
`server/lib/sports-league-engine.js`, both outside this task's
authorized file scope (`server/domains/sports.js` + `/api/sports/*`
routes only), and (b) the task brief's "the sports lens" is the lens I
was assigned, and this dead career system isn't part of it. Flagging
for whoever eventually wires (or removes) `sports_careers` — the fix
pattern (don't forward `opts.rollOverride`/self-reported skill from the
network) is now demonstrated in the route I did fix.

### Wired dead backend capability: `league-table`

`sports.league-table` (TheSportsDB real league standings by
`leagueId`) was implemented and tested but never called from any
frontend component (`grep -rn "league-table" concord-frontend/`
returned nothing before this session). `team-lookup` already returns a
`leagueId` field per team hit that nothing consumed. Wired it into
`SportsSpectatorHub.tsx`'s `RosterPanel` (the "Rosters" tab): each team
search result now shows a small standings-icon button (only when the
hit carries a `leagueId`) that pulls and renders the live table — rank,
played/win/draw/loss, goal difference, points — in the same table idiom
`StandingsPanel` already uses elsewhere in the file. This is a real,
designed feature reusing an already-live macro and an already-fetched
field, not new backend code.

`sports.game-detail` (returns a tracked game + the caller's own
predictions on it) was also found unused, but its value is redundant
with what `SportsPredictionsPanel` already surfaces per-matchup — left
unwired rather than adding a thin duplicate view.

### Fluidity: added the missing 4th tab keyboard shortcut

`page.tsx`'s `useLensCommand` registered `g`/`s`/`t` for the
Games/Stats/Training tabs but not the "Leagues (live)" tab added later
(DC1) — 3 of 4 tabs discoverable via the command palette, one wasn't.
Added `{ id: 'tab-leagues', keys: 'l', ... }` for consistency with
§2/§5 of `docs/UI_QUALITY_RUBRIC.md` (scoped keyboard commands must be
complete, not partial).

## 1.5 Reference-parity checklist

| # | Item | Disposition |
|---|---|---|
| 1 | Live scoreboard (ESPN, multi-sport) | ALREADY REAL — `LiveScoreboard.tsx` → `sports.scoreboard` |
| 2 | Followed teams / news / standings (fan hub) | ALREADY REAL — `SportsFanSection` → `SportsTeamsPanel` |
| 3 | Pick'em predictions + accuracy tracking | ALREADY REAL — `SportsPredictionsPanel` |
| 4 | Tracked athletes + per-game stat lines | ALREADY REAL — `SportsAthletesPanel` |
| 5 | Play-by-play / boxscore / recap | ALREADY REAL — `SportsSpectatorHub` → `espn-game-summary` |
| 6 | Schedule + reminders | ALREADY REAL — `SchedulePanel` + `RemindersPanel` |
| 7 | League standings tables (ESPN, live) | ALREADY REAL — `StandingsPanel` → `espn-standings` |
| 8 | Team/player search + rosters | ALREADY REAL — `RosterPanel` / `PlayersPanel` |
| 9 | Tournament brackets | ALREADY REAL — `BracketPanel`, handles BYE seeding + downstream rebuild |
| 10 | Win-probability model | ALREADY REAL — `WinProbPanel`, pure-compute logistic curve |
| 11 | Fantasy/Strava-style activity workbench (stats/plan/risk/team + mint/DM/publish/agent) | ALREADY REAL — `ActivityActionPanel`, 8 designed actions each calling a real macro/route |
| 12 | Persistent league / team / match simulation | ALREADY REAL — `LeagueStandings` + `MatchSimulator` → `/api/sports/league|match/*`; **outcome-rigging exploit fixed this session** |
| 13 | League table for a followed/looked-up team | WAS DEAD CAPABILITY — closed this session (`league-table` wired into `RosterPanel`) |

**Coverage summary:** 12 of 13 checklist items were already real and at
a caliber that holds up against ESPN/ESPN-Fantasy/Strava individually —
dense, purpose-built panels (not a generic CRUD list), real external
data with honest failure states, real per-user persistence. Item 13
closed this session. One genuine integrity defect (match-outcome
rigging) found and fixed; one keyboard-shortcut completeness gap fixed.

## Files touched

- `server/server.js` — `/api/sports/match/:matchId/play` no longer
  forwards `req.body`; closes the `rollOverride` outcome-rigging hole.
- `concord-frontend/components/sports/SportsSpectatorHub.tsx` —
  `RosterPanel`: `TeamHit.leagueId`, a "view league table" button per
  team hit, `LeagueTableRow` render (wires `sports.league-table`).
  `activeTeam` state changed from `string | null` to `TeamHit | null`
  (needed to carry `leagueId` through to the table-load call).
- `concord-frontend/app/lenses/sports/page.tsx` — added the `l` →
  Leagues tab entry to the existing `useLensCommand` registration.
- `docs/lens-specs/sports-capability-map.md` — this file.

## Verification

- `node --check server/server.js` — clean.
- `cd server && node --test tests/sports-league-engine.test.js
  tests/sports-domain-parity.test.js tests/sports-fan-domain-parity.test.js
  tests/sports-space-domain-parity.test.js tests/depth/sports-behavior.test.js
  tests/integration/sports-engine.test.js` — **59/59 passing, 0 fail**
  (this run first surfaced a pre-existing, unrelated environment defect —
  `better-sqlite3`'s native binding wasn't compiled in this worktree,
  failing every DB-backed test with `ERR_TEST_FAILURE: Could not locate
  the bindings file`; `npm rebuild better-sqlite3` in `server/` fixed it
  for this worktree only, confirmed isolated by re-running
  `tests/economy/ledger-conservation.test.js` clean afterward).
  `tests/sports-league-engine.test.js`'s own `playMatch(...,
  {rollOverride: ...})` unit tests still pass unchanged — they call the
  library function directly, which still accepts the param; only the
  HTTP route stopped forwarding it.
- `cd server && npx eslint server.js` — clean, 0 warnings.
- Frontend eslint/tsc could not be run to completion — this worktree's
  `concord-frontend/node_modules` is effectively empty (pre-existing;
  not something this session's commands created), so `next lint` /
  `tsc` fail on missing-module resolution before reaching real
  diagnostics. Substituted a syntax-only check: copied both touched
  `.tsx` files to a scratch dir and ran the globally-installed
  `tsc --noEmit --jsx react-jsx --skipLibCheck` against them — 0 parse
  errors (only expected `Cannot find module`/`JSX runtime` noise from
  the absent `node_modules`), confirming no syntax defects were
  introduced. Also manually re-read the full diff for type consistency
  (`activeTeam` reference-site audit, `TeamHit`/`LeagueTableRow` shape
  match against what `sports.team-lookup`/`sports.league-table` return).
- `node scripts/verify-lens-backends.mjs` → `{"WIRED":258,
  "NO-BACKEND-CALL":2} total 260` — unchanged from the pre-session
  baseline; `sports` does not appear in the `NO-BACKEND-CALL` list, i.e.
  still WIRED.
- `node scripts/grade-ux-polish.mjs --honest` → `audit/ux-polish-honest.json`
  `sports` entry: `tier: "polished"`, `isGenericScaffold: false` — byte-
  identical to the HEAD-committed snapshot (`git show
  HEAD:audit/ux-polish-honest.json`) for those two fields, confirming no
  regression. `audit/` reverted via `git checkout -- audit/` afterward
  per the no-commit-transient-artifacts rule.
