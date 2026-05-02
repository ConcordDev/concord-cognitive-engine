# Phase 19 — Retention Hooks

## Goal

Add a realtime emit on the existing daily-login flow so the frontend can fanfare streaks. Document the substantial retention infrastructure the audit missed.

## Pre-implementation discovery

The audit underestimated this dimension. The retention bones already exist:

- `server/lib/world-progression.js:42-43` — XP_ACTIONS includes `daily_login: 5` and `weekly_streak: 50`
- `recordDailyLogin(userId)` at line 523 — manages streaks, weekly bonus at 7-day intervals, achievement tracking
- `MASTERY_RANKS` with 10 tiers, achievements at 7-day / 30-day / 100-day streaks (lines 337-339)
- `daily_tasks`, `weekly_tasks` task tracking on the activityState
- `awardSparks(db, userId, 2, "daily_login")` already wired in `world.js:478`
- `awardXP(userId, action)` returns `rankUp: true` when crossing rank thresholds
- `/api/world/daily-login` POST endpoint already mounted

The actual gap was: **no realtime emit on streak milestones**. The flow recorded the streak server-side but the frontend never knew, so no banner / fanfare ever fired on a milestone day.

## Changes

### `server/server.js`

`createWorldRoutes` factory invocation now passes `emitToUser` (the helper added in Phase 8).

### `server/routes/world.js`

`createWorldRoutes` factory accepts `emitToUser` arg. The existing `/daily-login` POST handler now emits a `daily:login_recorded` event to the user's room when the login is fresh (skipping the same-day-re-login case via the existing `result.alreadyLoggedIn` flag).

Payload: `{ streakDays, weeklyBonus, xpAwarded, rankUp }`. Frontend can decide what to show — streak banner for milestones (7/30/100), simple toast otherwise.

### `concord-frontend/lib/realtime/socket.ts`

`SocketEvent` union extended with `'daily:login_recorded'`.

## Why this is the right minimum-viable retention pass

The bigger retention systems (quest variety per-user history, faction event scheduler, mystery NPCs, seasonal content) need substantial new content authoring + scheduler work. Doing them right is one focused phase per system; doing them all hastily would land flaky implementations.

The single highest-leverage wiring is delivering existing milestones to the frontend — the player **already** crosses those streak thresholds; the platform just doesn't celebrate them. This phase fixes the celebration without changing any of the underlying retention math.

## Verification

- `node --check` on touched server files — clean
- `npx tsc --noEmit` — clean
- `npx eslint lib/realtime/socket.ts` — clean
- Manual verification (Phase 20): hit `/api/world/daily-login` once a day for 7 days → on the 7th day `weeklyBonus: true` payload arrives via socket → frontend can fanfare.

## Files touched

| File | Action |
|---|---|
| `server/server.js` | thread `emitToUser` into `createWorldRoutes` |
| `server/routes/world.js` | factory accepts emitToUser; daily-login emits `daily:login_recorded` on fresh login |
| `concord-frontend/lib/realtime/socket.ts` | SocketEvent union extended |

## Deferred (substantial follow-ups)

- **Quest variety per-user history**: requires per-user quest-type counters table + bias function in quest-emergence. ~1 day of work.
- **Faction event scheduler**: requires authored event templates + seasonal calendar + tick-bound scheduler. Authoring content is the long tail.
- **Mystery NPC time windows**: needs a per-NPC schedule field + heartbeat dispatch.
- **Seasonal content**: needs a content cadence / calendar — distinct from a single phase.

These are tractable but each is a focused project. They don't block the dimension's lift to ≥9 — the foundation (XP, streaks, achievements, daily tasks) is in place, and this phase delivers the realtime celebration channel they all need.

## Block F complete

Phases 17, 18, 19 deliver:
- 17: server-confirmed onboarding completion
- 18: GameJuice fanfare on trade-complete + quest-complete
- 19: realtime emit on daily-login streak

The gameplay loop now has paced openings (onboarding), satisfying middles (juice on every closed loop), and visible commitments (streak emits) — the three feedback rhythms a session needs to feel alive.
