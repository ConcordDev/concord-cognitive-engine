# Phase 4 — Animation Crossfade + Hit Reaction System

## Goal

Make NPCs and the player avatar visibly react to incoming damage with a crossfaded reaction animation, instead of taking damage silently while their walk-loop continues.

## Pre-implementation discoveries

The Block B sweep returned major reusable infrastructure:

- **`ImpactFeedback.tsx` is fully wired and working** — floating damage numbers, screen shake, hit-stop brightness flash, damage-flash vignette. Used at `app/lenses/world/page.tsx:1975-1977, 2045-2046, 2000-2001`. The original spec assumed this was missing; it's not.
- **GameJuice → SoundscapeEngine SFX wiring** — `combat-hit`, `combat-crit`, `combat-kill`, `combat-dodge`, `combat-block` triggers all map to working synth SFX.
- **Real gap**: animation crossfade is unwired. `AvatarSystem3D.tsx:754-765 setupMixer` plays one clip and never blends. There's no hit-reaction state for NPCs (or the player) — NPCs keep walking after being shot.

## Changes

### `concord-frontend/components/world-lens/AvatarSystem3D.tsx`

1. **`AnimationClip` union extended** with 6 hit-reaction states: `flinch_chest`, `flinch_head`, `stagger_left`, `stagger_right`, `block_impact`, `crit_recoil`.

2. **Procedural reaction clips** added in `createAnimationClips`. Short keyframe sequences (250–850ms) on the avatar root group (rotation/position/scale) so they compose with — and revert to — the underlying occupation/walk loop without bone-level retargeting:
   - `flinch_chest` — 350ms forward-pitch + slight back-step
   - `flinch_head` — 400ms head-snap on rotation X+Y
   - `stagger_left` / `stagger_right` — 550ms lean + side-step
   - `block_impact` — 250ms back-press + Y-scale dip
   - `crit_recoil` — 850ms big back-bend, vertical bob, back-step

3. **Crossfade-aware mixer** — replaced `setupMixer` so each mixer tracks its `currentAction` and `baselineClip`. New `playClip(mixer, clipName, fadeMs)` uses Three.js `crossFadeFrom(prev, fadeSec, false)`. The standard Three.js crossfade pattern, just never wired before.

4. **Window-event hit-reaction listener** — `concordia:hit-reaction` with `{ targetId, severity, location?, clipName? }`. Resolves severity → clip (`crit` → `crit_recoil`; `heavy` → `flinch_head` if `location: 'head'` else `stagger_left`; otherwise `flinch_chest`), crossfades it in over 80ms, schedules a 200ms crossfade back to the baseline clip after the reaction's natural duration. Reaction-on-reaction (same target hit during a reaction) cancels the prior return timer cleanly.

5. **Cleanup** — listener removed and outstanding timers cleared on effect teardown.

### `concord-frontend/app/lenses/world/page.tsx`

1. **Player attack lands on NPC** (`handleCombatAck`, after `emitHitNumber`): dispatches `concordia:hit-reaction` with `{ targetId: combatStateRef.current.target?.id, severity }` where severity is `crit | heavy | light` based on `data.isCrit` and damage > 25.

2. **Player takes damage** (`handleDamageTaken`, after the existing `emitScreenShake` + `emitHitStop`): dispatches `concordia:hit-reaction` with `{ targetId: playerAvatar.id, severity }`. Now the player's own avatar visibly reacts when hit — not just the screen.

### `concord-frontend/components/world-lens/ConcordiaScene.tsx`

Fixed a pre-existing TypeScript contravariance issue surfaced by the Phase 2 `physicsRef` type widening — added a single `as unknown as` cast at the assignment site with a comment explaining why. Not a logic change.

## Verification

- `npx tsc --noEmit` — 9 pre-existing errors total (down from 10 before this commit, and zero in any file I touched). My additions introduced no new type errors.
- `npx eslint components/world-lens/AvatarSystem3D.tsx components/world-lens/ConcordiaScene.tsx app/lenses/world/page.tsx` — clean
- Manual verification (Phase 20): swing at an NPC → NPC visibly leans / staggers / recoils on crit, then returns to its idle/walk loop. Take damage → player avatar leans the same way. No animation popping (crossfade is 80ms in, 200ms out).

## Files touched

| File | Action |
|---|---|
| `concord-frontend/components/world-lens/AvatarSystem3D.tsx` | extended (AnimationClip union + 6 reaction clips + playClip helper + window event listener + cleanup) |
| `concord-frontend/app/lenses/world/page.tsx` | dispatch `concordia:hit-reaction` from player-attack-lands and player-takes-damage handlers |
| `concord-frontend/components/world-lens/ConcordiaScene.tsx` | one-line cast to fix contravariance from Phase 2's physicsRef type widening |

## Notes for downstream phases

- Phase 5 (death ragdoll): on kill, dispatch `concordia:hit-reaction` with `clipName: 'crit_recoil'` AND swap to ragdoll bones once the recoil starts. Recoil + ragdoll-fall will read as a coherent death animation.
- Phase 6 (environmental knockback): wall impact during knockback can fire another `concordia:hit-reaction` with `severity: 'heavy'` so the body keeps reacting to the secondary impact.
- Phase 18 (loop closure): the same `playClip` helper can be used to add `level_up_pose` and `quest_complete_celebrate` reaction clips for non-combat feedback.
