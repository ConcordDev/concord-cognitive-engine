# Phase 18 — Loop Closure Feedback

## Goal

Fire the existing GameJuice triggers on quest-complete and trade-complete events so the player gets the satisfying audio + visual fanfare when their loop closes.

## Pre-implementation discovery

GameJuice's `TRIGGER_SFX` map already has every trigger we need:
- `'milestone'` → `fanfare-short`
- `'competition-win'` → `victory-sting`
- `'quest-complete'` → `gather-success`
- `'validate-pass'` → `ascending-chime`
- `'earn-royalty'` → `coin-clink`
- `'place-dtu'` → `snap-click`

The audio + visual feedback is fully built. The gap was purely callsites — gameplay events that should fire `triggerJuice` but don't.

## Changes

### `concord-frontend/components/trade/TradeWindow.tsx`

On `trade:complete` socket event, dispatches `concordia:game-juice` with `trigger: 'milestone'`. Plays the `fanfare-short` SFX + visual cue. Best-effort try/catch.

### `concord-frontend/components/concordia/quests/QuestLog.tsx`

`fetchServerQuests` now compares the incoming quest list against the previous server state and dispatches `concordia:game-juice` with `trigger: 'quest-complete'` for any quest that transitioned from non-completed to completed in this fetch. The diff happens inside the `setServerQuests((prev) => ...)` updater so it stays consistent with React's batching. Re-mounts don't re-fire (no fresh transition).

## Why these two callsites

These are the player-felt loop closures that have **realtime delivery channels** already wired:
- Trade complete: Phase 8's `trade:complete` socket event
- Quest complete: HTTP refetch driven by Phase 3's `quest:new` realtime hint (a new quest arrival often means someone else's recent action) + the existing manual refetch on quest accept/abandon

Other loop closures (level-up, DTU validated, reputation changed) need server-side emit hooks that don't exist yet:
- Level-up: `awardXP` returns `rankUp: true` but doesn't fire any socket event today. Adding a callback hook is straightforward but needs a small architectural decision (where does the realtime emitter come from in the world-progression module). Deferred as a follow-up that ships with a dedicated XP-emit pass.
- DTU validated: similar — quality approval already fires `quality:approved` per `lib/realtime/socket.ts:172`. Wiring a juice listener for that trigger is one line in any component that mounts globally; can be added in Phase 20 verification or later.

## Verification

- `npx tsc --noEmit` — clean
- `npx eslint components/concordia/quests/QuestLog.tsx components/trade/TradeWindow.tsx` — clean
- Manual verification (Phase 20):
  1. Complete a player-to-player trade → fanfare-short SFX + milestone overlay
  2. Open quest log with an active quest → satisfy its objectives → next refetch fires the gather-success SFX

## Files touched

| File | Action |
|---|---|
| `concord-frontend/components/trade/TradeWindow.tsx` | dispatch milestone juice on trade:complete |
| `concord-frontend/components/concordia/quests/QuestLog.tsx` | dispatch quest-complete juice on fresh status transition |

## Notes for downstream phases

- Phase 19 (retention): seasonal events firing `competition-win` triggers would feel great. The GameJuice trigger exists; just needs the seasonal emit.
- Phase 20 (verification): quality:approved and DTU:validated callsites can be added during the e2e pass if dimension audit calls for them.
