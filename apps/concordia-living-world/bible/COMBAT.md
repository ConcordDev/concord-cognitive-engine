# COMBAT

**Status:** Browser LIVE · Unity MISSING (hitscan) · Server unused from this client  
**Authority:** Concord  
**Source:** `src/game/combat.ts`; Unity `ConcordiaPlayer.cs`; `server/routes/combat.js`

## LIVE (browser TS)

Momentum = boneMass × leverArm × angularVelocity. Stagger: graze / flinch / rocked / knockdown. Light/heavy/riposte kinematics. Parry 180ms. Dodge i-frames 350ms. Poise regen 4.2/s. Stamina regen 18/s.

## LIVE (Unity play)

LMB light, F heavy, G special, X dodge (shove), Space jump. Flower-law in Court. Arena dummy HP. Hitscan SphereCast. Hostile: perception cone, last-seen, strafe, per-name speed. Fauna compose hunt/flee. Poise is a HUD bar, not a stagger resolver. Socket down.

## TARGET

2B chooses action. Engine resolves i-frame/parry/hit. Telemetry → personal style. No model-declared dodge.

## Gap

Port `combat.ts` onto server `applyAttack`. Unity plays ack. Do not grow Move Forge until a dummy HP drop is authoritative.
