# Phase 7 — Respawn Cinematic

## Goal

Replace the abrupt "You have fallen" pop-up with a paced cinematic: fade-to-black, then death message, then respawn button. Same socket flow, more emotional weight.

## Pre-implementation discoveries (Block B sweep)

- `CombatSystem.tsx:185-205` had a working but pop-instant death overlay
- `world/page.tsx:2074-2106` already wires `handleCombatKill` → `setCombatState({ isDead: true })` and the existing respawn button fires `onRespawn` which emits `player:respawn` on the socket and listens for `player:respawn:ack`
- `CameraControls.tsx` has a `cinematic` mode flag but no actual fade overlay

So this phase is a UI replacement, not a flow change.

## Changes

### New file: `concord-frontend/components/world/PlayerDeathSequence.tsx`

Three-phase timed component:
- **`fade`** (0–1500ms): black overlay tweens from `rgba(0,0,0,0)` → `rgba(0,0,0,0.85)` via `requestAnimationFrame`
- **`info`** (1500–3000ms): "You have fallen" headline + optional killer / cause readout fades in
- **`respawn`** (3000ms+): the respawn button appears with its own opacity transition; disabled until this phase

Accepts optional `killer` and `deathCause` props (the world page can pass them in once it tracks attacker info; for now defaults to the existing "structures remain intact" copy). The `onRespawn` callback is the same one CombatSystem was already passing through, so no change to the upstream socket flow.

The fade uses `requestAnimationFrame` rather than CSS transitions so the cancellation on unmount is clean and the timing doesn't depend on browser CSS scheduling.

### `concord-frontend/components/world-lens/CombatSystem.tsx`

Replaced the inline death overlay JSX with `<PlayerDeathSequence onRespawn={onRespawn ?? (() => {})} />`. The fallback no-op covers the case where `onRespawn` is undefined per the existing prop typing — same effective behavior as before, no callsite changes elsewhere.

Removed now-unused `Skull` and `RefreshCw` imports.

## Verification

- `npx tsc --noEmit` — no new errors
- `npx eslint components/world/PlayerDeathSequence.tsx components/world-lens/CombatSystem.tsx` — clean
- Manual verification (Phase 20): die in combat → 1.5s fade-to-black, then headline + flavor text fades in, then respawn button materializes. Click respawn → existing socket flow runs and the player reappears at the district hub.

## Files touched

| File | Action |
|---|---|
| `concord-frontend/components/world/PlayerDeathSequence.tsx` | created |
| `concord-frontend/components/world-lens/CombatSystem.tsx` | replaced inline overlay with PlayerDeathSequence; cleaned imports |

## Notes for downstream phases

- Phase 14 (spatial audio): the death sequence can additionally duck the master gain node (70%→100% over the fade) once Phase 14 establishes the master ducking node. Hook point already in place — just add the gain-tween call in the `fade` phase effect.
- Phase 17 (onboarding refinement): the same component pattern (timed-phase overlay) can be reused for the first-death tutorial moment.
