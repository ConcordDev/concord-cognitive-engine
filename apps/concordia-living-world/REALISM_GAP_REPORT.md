# Concordia realism + feel gap report

Vertical slice: **Sovereign Ruins** (500 m × 500 m), then extract. Auth/database stay off.
Do **not** replace working systems. This report is an audit of what already exists, what is unused, and what P0 must wire.

## Visual bar (locked)

**Graphics target is Saints Row 2 (2008), not 2024 photoreal.** Over-the-shoulder camera, character filling the frame, brick/grass/asphalt textures, bright daylight, circular minimap bottom-left, vitals as rings top-right. Concordia stays a living-world fantasy hub — the *fidelity and camera language* match SR2, not the setting.

Do not chase ray-traced PBR. Chase: readable clothes, textured buildings, grass you can feel, a body that occupies the screen.

---



---

## 0. Physics systems that already exist (KEEP)

These are real systems. The overhaul **extends** them. It does not rewrite them, swap them for Rapier, or invent a second combat model.

| System | File | What it already does | Verdict |
|---|---|---|---|
| Momentum vs poise | `src/game/combat.ts` | `computeImpactMomentum`, Dempster bone-mass, `resolvePoiseStagger` (graze/flinch/rocked/knockdown), `hitFeel` (hitPause, knockback, trauma, damage), attack phases (startup/active/recovery), dodge i-frames, parry window, hyperarmor, stamina/poise regen | **KEEP.** This is the combat physics. Make it visible. |
| `stancePoise` | `combat.ts` | Scales poise by block / **midStride** / stamina | **WIRE.** `applyHit` hardcodes `midStride: false`. |
| `styleMomentumMul` / `massMul` / `poiseMul` | `abilities.ts`, `worlds.ts` | Per-world fighting-style mass, speed, poise | **WIRE.** `speedMul` is used. `massMul` and `poiseMul` are dead. `styleMomentumMul` is never called. |
| Circle collision + world bound | `src/game/layout.ts` `resolveCollision` | Player vs colliders vs bound. Hub buildings, trees, stalls. World landmarks via `collidersFrom` | **KEEP.** Locomotion must still resolve here. No Rapier this slice. |
| Height field | `src/game/life.ts` `heightAt` | FBM hills, plaza flatten, world amps. Visual Y only | **EXTEND.** Use for camera collision, slope traction, hop landing. Not a second collider. |
| Juice | `src/game/juice.ts` | Trauma shake, hitstop (`timeScale = 0`), flash, unused `punch` | **KEEP separate from sim.** Cap hitstop. Use `punch` for FOV / landing. |
| Weather / road modifiers | `GameCanvas.tsx`, `kernel.ts`, `realms.onRoad` | Wind ×1.12, road ×1.38, Frontier sine drift, Tunya grove poise regen, ash weather on ruins | **KEEP and fold into traction**, do not delete. |
| Creature stats | `src/game/creatures.ts` | `mass`, `speed`, `reach`, `poise`, `role`, `flyHeight` | **WIRE mass** into knockback and chase weight. Do not reuse human locomotion for beasts. |
| Abilities / world arts | `abilities.ts`, `powers.ts` | G special / 1 weather art wrap `beginAttack` / `beginDodge` | **KEEP.** |
| Kernel / persist / quests / evo / wild / politics / cross | those modules | Living world | **DO NOT TOUCH** except `makeSim` field adds. |
| Input axes | `src/game/input.ts` `moveAxes` | A = −x, D = +x, camera-relative | **KEEP signs.** This is correct for on-foot. |
| Camera look | `GameCanvas` pointer-lock + `camYaw`/`camPitch` | RMB look, Q/R orbit, damp(8) chase at 7.4 m | **EXTEND** with collision, look-ahead, lock-on, FOV. Do not replace the look accumulator. |
| `window.__controlsTest` | `GameCanvas` + `controls-test.d.ts` | Playtest probe | **KEEP.** |

`Object.assign(sim, makeSim(nextWorld))` on gate travel. **Any new Sim field must be initialized in `makeSim`.**

---

## 1. What is missing (the “it sucked” diagnosis)

The physics **math** is there. The **body** is not.

### Locomotion (P0)

Current: `pos += dir * spd * dt` with `spd` a boolean 4.6 vs 7.2. Yaw snaps via `atan2`. Sprint is a speed multiplier. No accel, decel, turn rate, hop, crouch, analog feel.

Fail conditions already true: character slides, sprint is a multiplier only, jump is missing (floaty-by-absence), stop is a hard zero.

### Combat expression (P0)

`beginAttack` already has anticipation → active → recovery. `applyHit` already computes stagger and knockback.

Current presentation:

- Dodge is a **2.1 m teleport**.
- Knockback is an **instant position offset**.
- No attack lunge.
- Hitstop freezes the whole sim up to 140 ms.
- Pose snaps through React state (`idle/walk/windup/strike/dodge/hurt/down`).
- Walk cycle is `sin(t * 9)`, not distance-traveled.
- Auto-target within 2.6 m is not camera lock-on. `input.lockon` (C/Tab) is consumed unused. `sim.lockId` is unused.

### Camera (P0)

Damp exists. Missing: collision with `heightAt`, velocity look-ahead, sprint FOV, landing punch, lock-on framing that does not snap `camYaw`.

RMB both requests pointer lock **and** fires heavy. LMB attacks even unlocked.

### Rendering (P0, Sovereign Ruins first)

- `WorldScene` ground is a **42 m toon disk**. World bound is 1700 m.
- Sun in `WorldScene` does **not** `castShadow` (Hub already does).
- `meshToonMaterial` + 4 px nearest ramp + backface outline = the rejected low-poly look.
- Landmarks are primitive boxes/cylinders. Weather is 36 falling cubes.
- Figures are capsule mannequins, no weapon, no idle breathe tied to speed.

Hub lighting already casts shadows. Do not smash HubWorld. Upgrade ruins + player body + shared sun path.

---

## 2. Priority list

### P0 — this slice (implement now)

1. **Locomotion body** (`src/game/locomotion.ts`) sitting on top of `Combatant` xz + `resolveCollision`. Velocity, accel ~22, decel ~28, turn rate (faster when slow), walk/jog/sprint/crouch, KeyV jump + land, Space dodge as timed dash (keep `beginDodge` i-frames), attack lunge on active frames, knockback as velocity, traction from weather/world (ash 0.82, grove/mud 0.78, wind, road).
2. **Wire combat math** — pass `midStride`, `massMul`, `poiseMul` into `applyHit` opts. Do not change stagger formula.
3. **Input buffer ~120 ms** for attack/dodge/parry/jump. Pointer-lock on any click; LMB/RMB combat only while locked. Space stays dodge. Jump = KeyV. Crouch = Ctrl. C/Tab toggles `lockId`.
4. **Camera rig** — chase lag, look-ahead, height-field pull-in, sprint FOV, landing/hit punch, lock-on look-at blend **without** snapping `camYaw`.
5. **Figure** — PBR `LitMesh`, gait from `sim.foot` / speed, idle breathe, weapon swing, overlay combat poses. No pose teleport.
6. **Sovereign Ruins 500 m terrain** — displaced plane from `heightAt`, sun `castShadow`, denser ruins dressing, fog as atmosphere, `QUALITY_LOW/MEDIUM/HIGH/ULTRA`.
7. **Footsteps by material** (ash/stone/dirt/mud/metal) using existing `sfxFoot` bus.
8. **Playtest still passes.** Screenshots before claiming visual/feel wins.

### P1 — after ruins architecture is extracted

- Licensed phototextures (Poly Haven / ambientCG) with SOURCE/LICENSE/AUTHOR/URL.
- Propagate LitMesh + terrain to the other eight worlds.
- Foot IK, cloth/secondary motion.
- Creature-specific locomotion (wolf quad, golem mass, flyer wing beat already partially in `Beasts.tsx`).
- Combos, guard, charged attacks, directional attacks.
- ADS / firearms / bow (Crime, Grid). Not this slice.

### P2

- Vault/climb/swim/slide/roll as distinct from dodge.
- Ragdoll knockdown (animation → physics → getup). Do not fight `pose: "down"`.
- Input rebinding, gamepad poll, analog triggers.
- Fixed-timestep accumulator for locomotion only if variable `dt` (capped 0.1) still feels unstable.

### P3

- Photogrammetry-grade ruins, volumetric ash, full animation graph, production character rigs.
- Do not claim production-ready without a production build.

---

## 3. Feel contract mapping (what we will not fake)

| Contract | Existing hook | P0 action |
|---|---|---|
| Body in space, not a camera with a capsule | `Combatant` + `speed`/`yaw` | Add `Motion` {vx,vz,hop,vy,gait} |
| Accel/decel/turn/friction/air | none | `stepLocomotion` |
| Idle/walk/jog/sprint/crouch/strafe/backpedal/turn/start/stop/jump/fall/land/dodge | pose enum 7 states | Gait on Motion; pose remains combat overlay |
| Attacks: anticipation → contact → impact → reaction → recovery | already in `beginAttack`/`applyHit` | Lunge + velocity knockback + figure swing + capped hitstop |
| Hitstop + camera impulse + reaction + sound | juice + audio | Wire punch; cap freeze ≤ 72 ms |
| Poise decides flinch/stagger/knockdown | `resolvePoiseStagger` | Keep; express with pose + velocity |
| Weapon weight | `massMul`, light vs heavy kinematics | Multiply momentum; heavier = slower top speed via massMul |
| Lock-on no snap | `lockId`, `input.lockon` | Toggle nearest; face target; camera look-at blend |
| World traction | weather, `onRoad`, Frontier drift | `tractionOf` |
| Creatures ≠ humans | `beastDef.mass/speed/role` | Knockback / chase scaled by mass; keep AI |
| A = left under chase cam | playtest + `moveAxes` | Unchanged signs; turn-toward movement heading |
| Fail if sprint is only a multiplier | `sprint ? 7.2 : 4.6` | Sprint raises cap + slightly lowers accel, FOV, gait |

Out of P0 (named so we do not pretend): climb, swim, vault, slide, roll-as-distinct, ADS, firearm recoil, magic cast phases beyond existing G/1 arts, full blend-space, IK, ragdoll.

---

## 4. Implementation rules (non-negotiable)

- Do not delete lore, worlds, combat, quests, simulation, persistence, Godot pairing, world laws, NPCs, creatures, or cross-world systems.
- Do not replace `applyHit` / `beginAttack` / `beginDodge` / `beginParry` / `tickVitals`.
- Do not replace `resolveCollision`.
- Do not replace `moveAxes` signs.
- Do not add `@react-three/rapier` this slice.
- 3D characters/weapons are geometry, not generated photos.
- Preview stays `0.0.0.0:8080` via `npm run dev` / `startup.sh`.
- Do not SSH the pod. Do not push GitHub unless asked.

---

## 5. QA gates

- `node scripts/concordia-playtest.mjs` — W speed, W+A yaw+, W+D yaw−, gate cross.
- `node scripts/browser-smoke.mjs`
- `npm run typecheck` and `npm run build`
- Screenshots under `/workspace/screenshots/` of title, hub walk, ruins terrain, combat contact.
- Do not claim visual improvement without those shots.
- Do not claim production readiness.
