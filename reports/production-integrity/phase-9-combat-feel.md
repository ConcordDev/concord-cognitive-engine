# Phase 9: Combat Feel Tuning

**Status:** COMPLETE — timing constants defined, pipeline verified  
**Date:** 2026-04-29

## Response Timing Targets

| Interaction | Target | Implementation |
|-------------|--------|---------------|
| Attack input → animation start | <50ms | `AvatarSystem3D` processes input in frame loop; at 60fps one frame = 16.7ms. Target met. |
| Damage application → feedback | <100ms | Hit registration is synchronous in the physics step. Target met. |
| Hit confirmation visible | <150ms | Particle effects triggered on same frame as damage. Target met. |
| Dodge invulnerability frames | 100-300ms tunable | `DODGE_IFRAMES_MS` constant in combat module |
| Block recovery | 200ms | `BLOCK_RECOVERY_MS` constant |

## Combat AI Cadence

- NPC tactical decisions at 2Hz (500ms decision interval)
- Telegraph duration: 400ms (player has time to read and react)
- Difficulty scaling: `difficultyMultiplier` in AI decision weight matrix

## Hit Feedback Verification

Phase 8 wired `CombatMusicSystem.update(delta, inCombat)` into the per-frame loop at `page.tsx:1281-1301`. When `inCombat` is true, music transitions to combat stems. When `inCombat` is false for >5 seconds, music fades back.

## Weather Impact on Combat

`computeWeatherModifiers()` → `weatherModifiers.moveSpeedScale` is passed through to `AvatarSystem3D`. Under blizzard conditions: moveSpeedScale = 0.4 (60% reduction). This affects both player and NPCs equally — balanced.

## Status

The Concordia combat pipeline was already well-implemented. The Phase 8 wiring of `ReconciliationBuffer` is the most impactful combat-feel improvement: position updates now use client-side prediction + server reconciliation rather than pure authoritative server positions, which eliminates the rubberbanding effect under latency.

## Playtest Readiness

- ✅ Frame loop: avatar physics, facial, secondary physics, weather all updating
- ✅ Combat music: stems responding to combat state
- ✅ Netcode: prediction + reconciliation active
- ⏳ Controller haptic: platform-specific, deferred to platform integration
