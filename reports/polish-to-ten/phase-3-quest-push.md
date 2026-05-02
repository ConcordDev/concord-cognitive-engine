# Phase 3 — Quest Realtime Push

## Goal

Make emergent quests appear in the player's quest log within sub-second of being generated, instead of only on next page navigation / quest log open.

## Pre-implementation discoveries

The Block A sweep changed the scope substantially:

- **Heartbeat scheduler is already wired.** `server.js:27615-27627` already runs `quest-emergence.detectQuestOpportunities` for up to 5 NPCs every 20 ticks. The original spec's "add scheduler" subtask was redundant.
- **`QuestLog.tsx` was already demand-driven, not polling.** The spec's "remove 45s poll" subtask was based on an inaccurate audit — there is no poll. Quests fetch on mount and on user actions only.
- **WebSocket subscription pattern, toast system, soundscape SFX trigger event** all exist and are reusable. The work is wiring, not building.
- **Real gap**: `user:${userId}` rooms didn't exist. Quest emergence had no notion of "who is the recipient" — quests are tied to `giver_npc_id` and `world_id`, with no explicit player target.

## Changes

### `server/lib/city-presence.js`

Added `getUserIdsInCity(cityId)` — returns an array of userIds currently present in the given city. Used by emergent systems to determine notification recipients without exposing the internal `_userPositions` map.

### `server/server.js`

Two surgical edits:

1. **Auto-join `user:${userId}` room** on socket connect (after auth). Single line. Now any emergent system can `REALTIME.io.to(\`user:\${userId}\`).emit(event, payload)` to push a private notification to one user's tabs.

2. **Quest push at emergence callsite** (line ~27622). Wrapped the existing `detectQuestOpportunities` invocation so the returned quest rows are emitted to every user currently present in that NPC's world. Each quest fires `quest:new` with `{ questId, worldId, title, description, giverNpcId, rewardJson, ts }`. Failures are non-fatal — never crashes the heartbeat tick.

### `concord-frontend/lib/realtime/socket.ts`

Added `'quest:new'` to the `SocketEvent` union. `subscribe('quest:new', ...)` now type-checks and runs through the existing ordering/sequence guard.

### `concord-frontend/components/concordia/quests/QuestLog.tsx`

New `useEffect` subscribes to `quest:new`. On receipt:
- Filters to the active world (defensive — server already filters by city, but a tab in world A shouldn't see a push for world B if the player teleports between two open tabs)
- Calls existing `fetchServerQuests()` so the new quest appears in the log without manual reload
- Fires existing toast slice with `type: 'info', message: \`New quest: ${title}\`, duration: 8000`
- Dispatches `concordia:soundscape-command` window event with `sfxId: 'notification-glow'` (existing entry in SoundscapeEngine SFX_MAP)

The unsubscribe is returned from the effect, so the listener is cleaned up on unmount and re-bound on world change.

## Verification

- `npx tsc --noEmit` — no errors in touched files
- `npx eslint components/concordia/quests/QuestLog.tsx lib/realtime/socket.ts` — clean
- `node --check server.js` — syntax OK
- `node --check lib/city-presence.js` — syntax OK
- Manual verification (deferred to Phase 20): two-tab test with one player in world A — generate a quest from a low-`purpose` NPC in world A, confirm toast appears + log refetches + notification SFX plays without page reload.

## Files touched

| File | Action |
|---|---|
| `server/lib/city-presence.js` | added `getUserIdsInCity` export |
| `server/server.js` | socket.join user room on auth, push `quest:new` after each emergence |
| `concord-frontend/lib/realtime/socket.ts` | extended SocketEvent union |
| `concord-frontend/components/concordia/quests/QuestLog.tsx` | subscribe to `quest:new`, refetch + toast + SFX |

## Notes for downstream phases

- Phase 8 (trade): the `user:${userId}` room is reused for `trade:request`, `trade:offer_updated`, `trade:other_ready`, `trade:complete`. Already wired here.
- Phase 9 (party): same — `party:invite`, `party:member_joined`, etc. flow through the user room.
- Phase 18 (loop closure): the `subscribe('quest:new', ...)` pattern is the template for `quest:complete`, `level:up`, `dtu:validated` push events that GameJuice will react to.
