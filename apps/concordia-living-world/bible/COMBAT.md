# COMBAT

**Status:** Browser LIVE · Unity hitscan at **apex** · Server unused until `/unity-ws`  
**Authority:** Concord  
**Source:** `src/game/combat.ts`; Unity `ConcordiaPlayer.cs`, `CombatMotion.cs`, `Hostile.cs`; `server/routes/combat.js`

## LIVE (browser TS)

Momentum = boneMass × leverArm × angularVelocity. Stagger: graze / flinch / rocked / knockdown. Light/heavy/riposte kinematics. Parry 180ms. Dodge i-frames 350ms. Poise regen 4.2/s. Stamina regen 18/s.

## LIVE (Unity play)

LMB light, F heavy, G special, X dodge (shove), Space jump. Flower-law in Court. Arena dummy HP. Hostile: perception cone, last-seen, strafe, per-name speed; **Slash on commit** after telegraph. Fauna compose hunt/flee.

Damage is **not** on the click. `CombatMotion.Delay` (~0.36 of the strike) is the SphereCast. Combo beats 0–2 through `Slash(heavy, beat)` after `ComboOpen`. Local hitstop 45ms on connect (planar slow, not `timeScale`). Dummy `Hurt` / yaw / stagger — not only a scale flash.

Poise is a HUD bar, not a stagger resolver. Socket down stays `{ok:false, reason:'no_gateway'}`.

## TARGET

2B chooses action. Engine resolves i-frame/parry/hit. Telemetry → personal style. No model-declared dodge.

## Gap

Port `combat.ts` onto server `applyAttack`. Unity plays ack. Do not grow Move Forge until a dummy HP drop is authoritative.
