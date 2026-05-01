# Phase 15 — Dynamic Mixing

## Goal

Make the ambient mix feel responsive — duck the drone when combat is happening, recover after a 3-second quiet period — without breaking the existing combat-music intensifier (`combatMusicRef`).

## Pre-implementation discovery

`SoundscapeEngine` already has a per-district drone with its own `droneGainRef` GainNode. World page already has `combatMusicRef.onCombatEvent(intensity)` at line 1969 fired on player hits — separate combat-music subsystem, not relevant to ducking.

What's missing: nothing ever lowers the **ambient drone** during combat. Result: gentle ambient pad runs at full volume while you're swinging swords. Sounds wrong.

## Changes

### `concord-frontend/components/world-lens/SoundscapeEngine.tsx`

Extended the existing window-event useEffect with two more listeners:

- `concordia:hit-reaction` — fires for every Phase 4 hit (player attacks NPC, player takes damage, knockback, crit). Each fire ducks the ambient drone to 30% gain over ~250ms and starts (or restarts) a 3-second auto-revert timer.
- `concordia:death-collapse` — fires for every kill. Same duck behavior; combat ending in a kill keeps the duck for the full 3-second window after.

Implementation uses Web Audio's `GainNode.gain.setTargetAtTime(target, when, timeConstant)` for smooth exponential fades — the standard Web Audio ducking pattern, no popping. Cancels scheduled values before setting a new target so re-fires don't pile up.

3-second auto-revert means a single punch ducks for 3s; sustained combat ducks for the duration plus a 3s tail; the recovery fade is 2× the duck-down ramp (smoother to climb back to base than to drop).

## Why this is the right minimum-viable mix

The spec's "dialogue ducks SFX 50% via master ducking node" requires Phase 16's voice barge-in to land first — the trigger doesn't exist yet. Phase 16 will add a `concordia:dialogue-active` event we can wire here later.

The spec's "stinger SFX on level up / quest complete" maps to existing GameJuice triggers (`milestone`, `competition-win`, `quest-complete` → `fanfare-short`, `victory-sting`, `gather-success`) — already wired. Just need callsites that fire those triggers, which Phase 18 handles.

## Verification

- `npx tsc --noEmit` — clean
- `npx eslint` — 1 pre-existing warning unrelated to this phase
- Manual verification (Phase 20): in a district with an active drone, swing at an NPC — ambient drops audibly within ~250ms; stops getting hit for 3s, drone climbs back smoothly. Crit / kill-blow ducks just like any other hit.

## Files touched

| File | Action |
|---|---|
| `concord-frontend/components/world-lens/SoundscapeEngine.tsx` | added two window-event listeners that duck droneGainRef on combat |

## Notes for downstream phases

- Phase 16 (voice barge-in): once a `concordia:dialogue-active` event exists, add another listener here that ducks SFX (master gain) 50% during dialogue.
- Phase 18 (loop closure): when `level:up` and `quest:complete` socket events fire, dispatch `concordia:soundscape-command` with `triggerSFX: fanfare-short` / `victory-sting` to play the existing stingers.
