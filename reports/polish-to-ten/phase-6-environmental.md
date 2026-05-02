# Phase 6 — Knockback / Environmental Impact

## Goal

When a heavy or critical hit lands, the target's avatar actually moves backward in world space — instead of just leaning in place — so combat exchanges feel like physical interactions.

## Methodology note

The original spec called for Rapier collision callbacks (wall impact triggers secondary damage + dust particles, dynamic-rigidbody object knockover, etc.). Two of those three depend on prior art that doesn't exist yet:
- Dust particles: ParticleEffects.tsx exists but has no `dust` particle type defined
- Object knockover: requires light props to be registered as low-mass dynamic rigidbodies, which the codebase currently doesn't do

The piece that's reachable right now without significant prior-art building is the **knockback offset itself** — making the target move when hit. That delivers the bulk of the player-felt improvement; wall-impact secondary damage and prop knockover are nice-to-haves that can ride later phases (Phase 11 generalized colliders + a future particle/prop system pass).

## Changes

### `concord-frontend/components/world-lens/AvatarSystem3D.tsx`

Extended the existing `concordia:hit-reaction` handler with an optional `hitDirection: { x: number; z: number }`. When present **and** `severity === 'heavy' || 'crit'`:

- Tweens the target's mesh world position by ~0.4m (heavy) or ~0.7m (crit) in the supplied direction over 300ms (6 × 50ms steps)
- For NPCs, also nudges `targetPos` (the lerp anchor) by the same delta so the next 2Hz position update doesn't immediately yank the body back to its pre-knockback position
- Re-triggering knockback on the same target during an existing knockback cancels the prior step timers cleanly
- All knockback timers cleared on effect teardown

No new state types or events; the existing `concordia:hit-reaction` event grew an optional field. This means downstream callers that don't supply `hitDirection` get the Phase 4 behavior unchanged.

### `concord-frontend/app/lenses/world/page.tsx`

Updated both existing hit-reaction dispatches to include `hitDirection`:

- **Player attack lands on NPC** (`handleCombatAck`): direction = forward of player yaw (`{x: -sin(yaw), z: -cos(yaw)}`) so heavy/crit hits push the NPC away from the player.
- **Player takes damage** (`handleDamageTaken`): direction = backward of player yaw (`{x: sin(yaw), z: cos(yaw)}`) — proxy for "away from the attacker" since the server doesn't send attacker world position. Players generally face their attacker in combat, so this proxy is acceptable; can be tightened later if the server starts emitting attacker position.

## Verification

- `npx tsc --noEmit` — 7 pre-existing errors total, zero new
- `npx eslint components/world-lens/AvatarSystem3D.tsx app/lenses/world/page.tsx` — clean
- Manual verification (Phase 20): heavy or crit hit on NPC → NPC visibly slides ~0.4–0.7m backward as it staggers. Take a heavy hit → player avatar slides backward. Light hits stay in place (no knockback).

## Files touched

| File | Action |
|---|---|
| `concord-frontend/components/world-lens/AvatarSystem3D.tsx` | extended `concordia:hit-reaction` handler with knockback offset; cleanup |
| `concord-frontend/app/lenses/world/page.tsx` | thread `hitDirection` through both hit-reaction dispatches |

## Deferred (out of scope without prior art)

- Wall impact callbacks: would require Rapier `world.contactPairsWith` integration
- Dust particles on impact: needs particle types added to ParticleEffects
- Light prop knockover: needs prop registration as dynamic rigidbodies (Phase 11 generalized collider work could enable this, but the props themselves are mostly static meshes today)

These can land in a follow-up if the audit calls for them; the core feel improvement is in.
