# Concordia — audit of the three contracts vs code

Date: 2026-08-25. Runtime stays Three.js in the browser. Unity/Godot are content tools, not the game.

## Load

Hub was cloning Mixamo Soldier for every NPC (plus Kenney/fauna preloads). Walk-in took ~14s and looked hung.
**Fix this pass:** only the player is Mixamo. NPCs stay the cheap figure. Fauna/Kenney no longer preload on the title screen.

---

## Contract 1 — Unity method / humanoid / presentation (not a Unity rewrite)

| Item | Status |
|---|---|
| Don't replace Concordia with Unity | **Done.** Browser runtime. |
| Humanoid bone map (pelvis→feet, Mixamo names) | **Done.** `src/game/humanoid.ts` |
| Forward-axis contract (visor vs chase cam) | **Done.** Mixamo visor is −Z; `visualYaw` has no extra π |
| Hand socket / weapon parented to RightHand | **Partial.** Sword is parented to `mixamorig:RightHand`. Grip still Mixamo-cm authored, not a full IK two-hand |
| Animation clips on mixer (idle/walk/run) | **Done.** Soldier.glb |
| Slash / heavy / hit / jump clips | **Partial.** Runtime Mixamo-bone clips in `mixamo-clips.ts`, not Mixamo.com mocap |
| Layers / masks / root-motion policy | **Missing.** Single mixer track, no upper-body mask |
| IK (foot, hand, look-at) | **Missing** as a system. Carry pose is additive rotate |
| Evo asset record (mesh, skeleton, sockets, license) | **Partial.** `evo-asset.ts` + `evo.ts` tint/scale/traits. No quality gate, no LOD, no collision profile |
| NPC visual IDs (mesh/apparel/avatar) | **Missing.** NPCs are color + height prose. 0 mesh IDs |
| Building visual IDs (mesh, facade, footprint) | **Missing.** Hub buildings are generated boxes from `layout.ts` |
| World semantics → presentation bridge | **Partial.** `world-contract.ts` exists and drives Kenney trees/rocks. Not consumed by buildings/NPCs |

## Contract 2 — Game feel / SR4 movement / combat grammar

| Item | Status |
|---|---|
| Input → gameplay state → animation presents it | **Mostly.** `combat.ts` / `locomotion.ts` own hits and motion |
| WASD, sprint, crouch | **Done** |
| Jump (Space) + coyote + land | **Done** in locomotion. Jump clip is procedural Mixamo |
| Dodge with i-frames | **Done.** Rebound to **X** (Space is jump) |
| Camera behind, see the back, world in front (SR2 shot) | **Done** |
| Sprint FOV / distance | **Done** in `camera-rig.ts` |
| Building collision | **Partial this pass.** OBB for hub buildings. World landmarks are still circles |
| Vault / climb / wall-run / glide | **Missing** |
| Attack startup / active / recovery | **Done** in `combat.ts` |
| Cancel windows | **Data only** in `anim-machine.ts`. Not wired into input |
| Weapon hit volume independent of mesh | **Done** in combat resolution. Presentation slash is separate |
| Directional hit reactions | **Partial.** Stagger + juice. No body-region Mixamo react set |
| Combos, block, weapon families | **Missing** (one sword, light/heavy/riposte) |
| Traversal world (roofs, climbables) | **Missing** |

## Contract 3 — Nine worlds / density / persistence

| Item | Status |
|---|---|
| Canonical 9 worlds (no Sere) | **Done.** `WorldId` in `content.ts` |
| World contract (fantasy, traversal, combat, fauna) | **Partial.** File exists. Not the full contract (audio, persistence, unique verbs) |
| Distinct gameplay per world | **Thin.** Style multipliers + fauna + Kenney set. Not unique verbs |
| Encounter director | **Missing.** Wild stream exists (`wild.ts`) |
| NPC schedules visible | **Partial.** `npc-life.ts` acts; Mixamo NPCs were dropped for perf so sit/sleep is the cheap figure again |
| Persistence (kill/build/steal survives) | **Partial.** `persist.ts` / kernel. Not a full world-persistence contract |
| Streaming / sim LOD | **Missing** (capped clones this pass is a stopgap) |
| Audio identity per world | **Thin.** Drone + sfx, not biome beds |
| Creator / Asset Studio scene editor | **Out of this slice** |

---

## What is actually playable now

- Hub + eight other worlds via gates
- Mixamo player: idle / walk / run / slash / heavy / jump, sword in **right** hand, camera shows the **back**
- Momentum combat (`combat.ts`) — still the sim
- Hub buildings you should not walk through (OBB)
- Ruins: Poly Haven statues + Kenney trees
- Evo beasts: Fox/Horse/bird GLBs when those kinds spawn

## P0 still open (from those three files, in order)

1. Mixamo **mocap** slash/dodge/death (or retargeted Mixamo FBX), not only authored clips
2. Upper-body mask so attacks don't kill locomotion
3. World collision = real footprints, not only hub OBB
4. NPC embodiment without cloning 20 Soldiers (impostor / 1 shared mixer)
5. Make 1–2 world verbs unique (Ruins climb, Cyber parkour) so nine worlds are not palettes
