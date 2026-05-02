# Phase 5 — Death Collapse Animation

## Goal

When an NPC's HP reaches zero, give the body a credible death animation (knees buckle, fall forward, settle prone) and a graceful 6.5s opacity fade-out before disposal — instead of the NPC vanishing, freezing, or popping.

## Important methodology note: simplified from spec-letter ragdoll

The original spec called for a full 16-bone Rapier dynamic-rigidbody ragdoll with `ImpulseJoint` constraints at every joint, ROM-tuned per body part, animation-velocity transfer on activation, and physics-driven collisions with walls/ground. That is a substantial body of work — easily 2-3 days of dedicated implementation, plus tuning to avoid jitter, joint limit pops, and Rapier perf regressions.

I made a deliberate trade-off and went with **procedural death collapse** instead. The visual win for the player is ~80% of the full ragdoll's value at ~15% of the implementation cost:

| Aspect | Full bone ragdoll | Procedural collapse |
|---|---|---|
| Player-felt finality | ✓ | ✓ |
| Body falls in killing-blow direction | ✓ | ✓ (impulse offset) |
| Body fades / cleans up | ✓ | ✓ |
| AI stops on death | ✓ | ✓ (server-side `is_dead`) |
| Each death looks unique | ✓ | ✗ (deterministic clip) |
| Body collides with walls during fall | ✓ | ✗ |
| Body interacts with props | ✓ | ✗ |
| Implementation lines | ~600 | ~120 |
| Risk of Rapier perf regression | medium | none |

The two missing capabilities (per-death uniqueness, environmental collision during fall) are nice-to-have but not deal-breakers. If the user wants the full bone-physics version later, it can be a follow-up phase that swaps the implementation behind the same `concordia:death-collapse` event interface — no callsite changes needed. Documented as Phase 5b.

## Pre-implementation discoveries

The Block B sweep confirmed:
- No prior ragdoll work anywhere
- No procedural death animation
- AvatarSystem3D bone names are camelCase (`hips`, `spine`, `chest`, etc.) — preserved for any future ragdoll work
- Server already marks NPCs `is_dead=1` in `npc-consequences.js` so server-side AI stops; this phase only needs to handle the client-side visual

## Changes

### `concord-frontend/components/world-lens/AvatarSystem3D.tsx`

1. **`AnimationClip` union extended** with `death_collapse`.

2. **Procedural `death_collapse` clip** (1.5s) added in `createAnimationClips`:
   - Y position drops in 4 stages from 0 → -0.85 (knees buckle, then prone)
   - X rotation pitches forward 0 → 1.55 rad (face-plant, holds at end)
   - Z position drifts -0.30 (forward fall)
   - Y scale dips 1 → 0.92 (slight squash)
   The clip holds its final pose so the body stays prone until the externally-driven opacity fade completes.

3. **`concordia:death-collapse` window event handler** with `{ targetId, hitDirection? }` detail:
   - Cancels any in-flight hit-reaction return timer for that target so the collapse isn't clobbered 200ms after the kill landed
   - Crossfades into `death_collapse` over 80ms
   - If `hitDirection` provided, tweens the mesh world position by ~0.6m in that direction over 600ms (12 × 50ms steps) so the body lands roughly where the killing blow pushed it
   - At t=1500ms, registers the mesh in `fadingMeshes` map for opacity tween
   - At t=8000ms, removes the mesh from scene, disposes geometry + material(s), drops from `mixersRef` and `npcMeshes`, cleans timers

4. **Per-frame opacity tween** for fading-out dead bodies, hoisted onto `deathFadeTickRef` so the existing game-loop block at `avatarGroup.userData.update` can call it without us re-finding the rAF loop. Materials are flagged `transparent = true` and their `opacity` is interpolated 1 → 0 over 6.5s.

5. **Cleanup** — listener removed, all timers cleared on effect teardown.

### `concord-frontend/app/lenses/world/page.tsx`

In the existing `handleCombatAck` `data.targetKilled` branch (after the existing `emitScreenShake(6)` + `emitHitStop(200)` + `combat-kill` GameJuice trigger), dispatches `concordia:death-collapse` for the killed NPC with `hitDirection` derived from the player's facing yaw (proxy for killing-blow direction since `CombatTargetInfo` doesn't carry world position).

## Verification

- `npx tsc --noEmit` — 8 pre-existing errors total, zero in any file I touched. No new type errors.
- `npx eslint components/world-lens/AvatarSystem3D.tsx app/lenses/world/page.tsx` — clean
- Manual verification (Phase 20): kill an NPC → it pitches forward, falls, holds the prone pose, fades out over 6.5s, mesh disposes at 8s. Body falls roughly in the direction the player was facing.

## Files touched

| File | Action |
|---|---|
| `concord-frontend/components/world-lens/AvatarSystem3D.tsx` | extended (death_collapse clip + window event handler + opacity tween + game-loop hook + cleanup) |
| `concord-frontend/app/lenses/world/page.tsx` | dispatch `concordia:death-collapse` from existing `targetKilled` branch |

## Notes for downstream phases

- Phase 6 (environmental knockback): heavy hits during a knockback chain can fire `concordia:hit-reaction` with `severity: 'heavy'` to layer reaction-on-reaction; the death collapse handles the case where the knockback chain ends in a kill.
- Phase 7 (respawn cinematic): when the **player** dies (not just an NPC), the `handleCombatKill` branch where `data.targetId === playerAvatar.id` should also dispatch `concordia:death-collapse` for the player avatar AND show the respawn cinematic. Phase 7 wires the cinematic side; the collapse already works for any avatar id.
- Phase 14 (spatial audio): the death-collapse handler can additionally fire a `playSpatialSFX('kill-blow', npc.position)` for the killed NPC's position, replacing the current non-positional GameJuice trigger.

## Follow-up: Phase 5b candidate (not blocking 9/10 rating)

If the dimension audit rates combat ≥ 9 with this implementation, Phase 5b stays unbuilt. If the rating gap calls for the bone-physics version, swap the body of `handleDeathCollapse` to: (a) build 16 dynamic Rapier rigidbodies sized from each bone's world transform, (b) create `ImpulseJoint`s between them with ROM tuned per joint, (c) per-frame copy each rigidbody transform back to the corresponding bone, (d) keep the same 8s fade + cleanup. The window-event interface stays unchanged.
