# Tournaments lens — capability map (Wave 3, Frontend Rebuild Program)

Audited 2026-07-10. Backend: `server/domains/tournaments.js` (12 macros, no
shadowing re-registration in `server.js` — confirmed by
`grep -n '"tournaments"' server/server.js`, which finds no
`registerLensAction("tournaments", ...)`/`register("tournaments", ...)`
call outside the domain file). State is in-memory per-user
(`globalThis._concordSTATE.tournamentsLens.tournaments`, a `Map<userId,
Tournament[]>`) — this lens has no DB table of its own; it is a
Challonge/Battlefy-class bracket-platform toolkit layered entirely on the
macro system.

## Backend surface

Reproduce: `grep -c 'registerLensAction("tournaments"' server/domains/tournaments.js` → 12.

| Macro | Kind | Notes |
|---|---|---|
| `create` | mutating | organizer spins up a tournament; validates `prizePoolCc`/`payoutSplit` fail-closed against `isSaneCc` before persisting |
| `list` | read | status/format-filtered list + per-status counts for the organizer's lifecycle archive |
| `get` | read | full detail by `id`, or by `shareSlug` for the spectator deep-link path |
| `addEntrant` / `removeEntrant` | mutating | solo entrant or team (with roster), pre-lock only |
| `seed` | mutating | manual reorder, rating-based auto-seed, or single-entrant seed move |
| `openCheckin` / `checkIn` | mutating | check-in window lifecycle; un-checked entrants auto-forfeit on `start` |
| `start` | mutating | locks the bracket, generates matches for the tournament's format (single/double elimination, round robin, Swiss) |
| `reportMatch` | mutating | submit a match result; auto-advances the bracket, recomputes standings, and auto-finalizes (crowns a champion + computes payouts) when the format's completion condition is met |
| `payouts` | mutating (re-split) | recompute prize distribution from a new `payoutSplit`, or re-read the stored one, once `status === 'completed'` |
| `cancel` | mutating | organizer cancels an un-started tournament |

## What's real / already-wired (unchanged)

This lens was already close to fully built. `app/lenses/tournaments/page.tsx`
and its five child components (`EntrantsManager`, `BracketView`,
`StandingsPanel`, `SpectatorBar`, plus `EsportsFeed` for real-world esports
context via the Reddit API) are all bespoke, domain-shaped UI wired directly
against `lensRun('tournaments', ...)` with correct field shapes:

- **List/browse** — status-filter chips with live per-status counts, prize
  pool + entrant count per card, real four-state UX (loading `role=status` /
  error `role=alert` with a working Retry / empty CTA / populated).
- **Create** — a real form (title, game, 4 bracket formats, max entrants,
  prize pool, solo/team + team size, Swiss round count, payout split) — not
  a JSON-paste textarea.
- **Detail** — Start/Cancel lifecycle actions, `SpectatorBar` (status pill,
  live-bout count, copyable share link resolving via `get { shareSlug }`),
  `EntrantsManager` (register, remove, seed-by-rating, manual seed
  up/down, open check-in, per-entrant check-in), `BracketView` (a real
  round-column bracket renderer for elimination formats and a flat
  round-grouped match list for round-robin/Swiss, with inline score
  reporting that gates on `canReport`/`m.status==='pending'`), and
  `StandingsPanel` (win/loss/diff table + win/loss bar chart via
  `ChartKit` for round-robin/Swiss, plus the prize-distribution
  breakdown and re-split control).
- **Spectator deep link** — `?spectate=<shareSlug>` on page load resolves
  through `get { shareSlug }` and opens read-only detail, matching the
  `SpectatorBar`'s generated share link.

12/12 macros are DESIGNED (verified via
`node scripts/lens-unsurfaced.mjs --lens tournaments` → `0/12 macros never
referenced in the frontend`, cross-checked against every call site by
reading the components — none of the 12 is reachable only through a
generic `<UniversalActions>`/`<LensFeaturePanel>` button wall). No
fabrication signatures found (`grep -n "Math.random\|MOCK\|mock\|fake\|
Lorem\|lorem\|hardcoded" concord-frontend/components/tournaments/*.tsx
concord-frontend/app/lenses/tournaments/page.tsx` → empty); `EsportsFeed`'s
Reddit pull is an honest live external fetch (with an explicit `isError`
state), not fabricated content.

## Defect found + fixed

**`tournaments.payouts` didn't return `tournament` in its result, so the
"Re-split" button silently did nothing in the UI.** Every other
`tournaments.*` macro returns `{ tournament: publicView(t) }`, and the
page's generic `run()` helper (`app/lenses/tournaments/page.tsx`) reads
`r.data.result?.tournament` to refresh local `detail` state after any
mutating action:

```ts
const t = r.data.result?.tournament || null;
if (t) setDetail(t);
```

But `payouts`'s handler (`server/domains/tournaments.js`) returned only
`{ prizePoolCc, payoutSplit, payouts, unallocated }` — no `tournament` key.
So clicking `StandingsPanel`'s "Re-split" button (`onRepayout` →
`run('payouts', { id, payoutSplit: split })`) correctly recomputed
`t.payoutSplit`/`t.payouts` server-side (in-memory state), but the
`run()` helper's `t` was always `null`, `setDetail` was never called, and
neither `TournamentDetail` nor `StandingsPanel` calls `onRefresh()` after
`onRepayout` either — so the new payout numbers never appeared. The button
looked entirely dead from a user's perspective despite the backend doing
the right thing. This is exactly the #1 recurring defect pattern (field-
shape mismatch causing a silent no-op), just on the response side instead
of the request side.

Fixed by adding `tournament: publicView(t)` to the `payouts` macro's
result, alongside the existing summary fields (`prizePoolCc`,
`payoutSplit`, `payouts`, `unallocated`), matching the contract every
other macro in this file already honors. Purely additive — no existing
test asserts the absence of a `tournament` key (checked
`server/tests/tournaments-domain-parity.test.js`,
`server/tests/tournaments-lens-macros.test.js`,
`server/tests/depth/tournaments-behavior.test.js`, all of which only
assert on `prizePoolCc`/`payoutSplit`/`payouts`/`unallocated`).

## Investigated and honestly deferred / left alone

- **`server/routes/tournaments.js` (mounted at `/api/tournaments`) is a
  genuinely broken, orphaned REST surface — but it is unrelated to this
  lens and was left alone.** `POST /api/tournaments` (create) and
  `POST /:id/register`/`POST /:id/start` call `server/lib/tournament.js`
  (singular), which reads/writes the migration-103 `tournaments` /
  `tournament_entrants` / `tournament_brackets` tables. But this route
  file's own `GET /` and `GET /:id` handlers query `world_tournaments`
  directly (`db.prepare('SELECT * FROM world_tournaments WHERE ...')`) —
  the *different*, migration-213 table that a *separate* library,
  `server/lib/tournaments.js` (plural, "Phase S — real-money
  tournaments"), actually owns and that a *third*, disconnected set of
  inline routes in `server.js` (`/api/tournaments/create`,
  `/api/tournaments/:id/register`, etc., ~line 52974) reads/writes
  correctly. In other words: `routes/tournaments.js` writes tournaments
  into one table (`tournaments`) and lists/reads from a completely
  different table (`world_tournaments`) that its own writes never touch —
  any tournament created through this router is permanently invisible to
  its own list/detail endpoints. This traces back to the migration-213
  collision CLAUDE.md documents (`tournaments`→`world_tournaments`
  rename) — the route file's GET handlers were evidently updated to point
  at the renamed table while its POST handlers, which delegate to the
  older `lib/tournament.js`, were not. **Confirmed this REST surface has
  zero frontend callers** (`grep -rn "/api/tournaments\|/api/world_tournaments"
  concord-frontend/` → no hits outside `.next` build output), so it does
  not affect the tournaments lens or any other shipped UI — it is dead,
  broken, orphaned backend code serving a different subsystem (an
  in-Concordia-world PvP/heist tournament feature that was apparently
  superseded by the inline `server.js` routes before ever getting a
  frontend). **Triage: ENGINEERING** — a real bug with no external-data
  dependency (either point the GET handlers back at `tournaments`/
  `tournament_entrants`/`tournament_brackets`, or point the POST handlers
  at `lib/tournaments.js`'s `world_tournaments`-backed functions instead
  of `lib/tournament.js`) — but out of scope for a frontend-lens audit
  pass with zero live callers to verify against; flagged here for a
  future backend-cleanup pass rather than fixed blind.
- **`server/domains/tournaments.js` state is in-memory, not DB-backed.**
  Unlike most lenses, tournaments created through this macro surface do
  not survive a server restart (`globalThis._concordSTATE.tournamentsLens`
  is a plain object). This is a pre-existing architectural choice (the
  file's own header comment describes it as intentional — "Persistent
  per-user state lives in `globalThis._concordSTATE.tournamentsLens`"),
  not a defect this pass introduced or is positioned to fix; a durable
  DB-backed rewrite would be a much larger CURATION/ENGINEERING project
  (new migration + table design) outside a frontend-rebuild pass's remit.
- **No `server/tests/*tournament*` file exercises the frontend's exact
  field shapes end-to-end** (they test the macros directly via `lensRun`/
  a local `call()` harness, which is the correct level for backend tests)
  — the payouts-shape bug above was found by reading the macro and the
  page's generic `run()` helper side by side, not by a failing test. No
  new test was added for this pass (frontend-only mandate); the existing
  53 macro-level tests across the 5 tournaments test files continue to
  pass unmodified.

## Verification

- `node --check server/domains/tournaments.js` — clean.
- `cd server && node --test tests/tournaments.test.js
  tests/tournaments-domain-parity.test.js tests/tournaments-lens-macros.test.js
  tests/tournament-e2e.test.js tests/depth/tournaments-behavior.test.js` —
  **53/53 passing, 0 failing** (4 + 20 + 26 + 2 + 1 across the five files).
- `cd concord-frontend && npx eslint app/lenses/tournaments/page.tsx
  components/tournaments/*.tsx` — 0 errors, 0 warnings.
- `node scripts/lens-unsurfaced.mjs --lens tournaments` —
  `tournaments: 0/12 macros never referenced in the frontend`.
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}`
  total 260, 0 broken; `tournaments` reports WIRED.
- `node scripts/grade-ux-polish.mjs --honest` — `tournaments` entry:
  `tier: "polished"`, `antiPatterns: 0`, `pillarsPresent: 5`, `fileCount: 6`,
  `totalLoc: 1203`.
- `npx tsc --noEmit` was intentionally **not** run per this pass's
  memory-safety instruction (centralized tsc check runs after all lenses
  land).

## Left alone, with reason

- `server/domains/tournaments.js` — all 12 macros correctly implemented,
  honest (fail-closed CC-amount validation via `isSaneCc`, real bracket
  generation for all 4 formats, real standings computation, real payout
  math with conservation — `distributed + unallocated === prizePoolCc`,
  pinned by `tests/tournaments-lens-macros.test.js`) except for the one
  field-shape gap fixed above.
- `components/tournaments/EsportsFeed.tsx` — real external Reddit API
  pull (r/esports, r/LoL, r/DotA2, r/CompetitiveOverwatch), honest loading/
  error states, `SaveAsDtuButton` to mint the feed into a DTU — left as-is,
  no defects found.
- `server/routes/tournaments.js` / `server/lib/tournament.js` /
  `server/lib/tournaments.js` / the migration-213 `world_tournaments`
  in-world tournament subsystem — genuinely broken (see above) but
  entirely disconnected from this lens and from any frontend caller;
  left alone as a documented finding for a dedicated backend pass, not
  silently fixed blind without a UI to verify the fix against.
