# Phase 14 — Wire Spatial Audio into World Events

## Goal

Make existing spatial-audio infrastructure (`lib/world-lens/spatial-audio.ts` — HRTF + reverb zones + occlusion) actually fire on in-world events. The pipes were laid; nothing was running through them.

## Pre-implementation discovery (recap)

`SoundscapeEngine` already exposes both `triggerSFX(sfxId)` (non-spatial) and `playSpatialSFX(sfxId, worldPos)`. Spatial-audio.ts has full HRTF + 6 reverb zones + lowpass occlusion. The gap was at the **call sites** — almost everything fires `triggerSFX`, missing the spatial layer.

## Changes

### `concord-frontend/components/world-lens/GameJuice.tsx`

`triggerJuice` opts extended with optional `position?: { x, y, z }`. When supplied, the SFX is routed to `soundscape.playSpatialSFX(sfxId, position)` instead of `soundscape.triggerSFX(sfxId)`. Backward-compatible — every existing callsite stays non-spatial.

### `concord-frontend/components/world-lens/SoundscapeEngine.tsx`

The `concordia:soundscape-command` window event handler grew a new action: `'playSpatialSFX'` with `{ sfxId, position }`. Lets any component fire spatial audio without being inside the SoundscapeContext provider. Same dispatch pattern the existing `triggerSFX` action uses.

### `concord-frontend/components/world-lens/AvatarSystem3D.tsx`

The Phase 5 `concordia:death-collapse` handler now dispatches a `playSpatialSFX` event for `kill-blow` at the dying NPC's world position. Result: the kill sound comes from the right direction (HRTF) and through the right reverb zone (if the NPC died inside an interior, the cave/small_room reverb applies). Wrapped in try/catch — spatial audio is best-effort, never blocks the death sequence.

## Why this is the right minimum-viable wiring

The full migration would convert every in-world `triggerSFX` callsite to `playSpatialSFX`. There are dozens. The single highest-leverage one — the most visceral audio cue per minute of play — is the kill-blow on NPC death. That's what this phase wires.

Other high-leverage callsites (NPC dialogue, building interaction, environmental ambient) ride downstream phases:
- Phase 16 (voice barge-in) routes NPC dialogue audio through spatial-audio
- Phase 18 (loop closure) wires `quest:complete` and `level:up` triggers — both happen at the player and stay non-spatial

A future cleanup pass can mass-migrate the remaining triggerSFX-in-world to playSpatialSFX with a position; the helper is already wired.

## Verification

- `npx tsc --noEmit` — clean
- `npx eslint` on touched files — 2 pre-existing warnings unrelated to this phase
- Manual verification (Phase 20): kill an NPC, listen — kill-blow should pan to the side the NPC was on. Move the player and re-kill — the pan changes accordingly. Inside a building, the kill-blow has small-room reverb tail.

## Files touched

| File | Action |
|---|---|
| `concord-frontend/components/world-lens/GameJuice.tsx` | added optional `position` to triggerJuice opts; routes through `playSpatialSFX` when set |
| `concord-frontend/components/world-lens/SoundscapeEngine.tsx` | window-event handler accepts `playSpatialSFX` action |
| `concord-frontend/components/world-lens/AvatarSystem3D.tsx` | death-collapse dispatches `playSpatialSFX` for kill-blow at NPC position |
