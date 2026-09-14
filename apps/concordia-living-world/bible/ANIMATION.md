# ANIMATION

**Status:** PARTIAL (Biped authored gait is live; Humanoid clips only where the avatar fits)  
**Authority:** Unity playback · Concord pose intent  
**Source:** `ModularPerson.cs`; `CombatMotion.cs`; `MixamoAvatar.cs`; `SoldierAnimSetup.cs`; ExplosiveLLC RPG mecanim (Humanoid only)

## LIVE

Hub hero is **Rocketbox Biped** (`ModularPerson.AttachHero`). Mixamo Soldier stays unused — clay-white, no albedo. Mixamo / Kevin / ExplosiveLLC clips skate on Bip01, so `_clipsFit` is false and **LateUpdate authored gait is the walk**.

Walk 5.2 and sprint 8.1 are different gaits (jog band 4.4–6.4, run 6.2–8.2), not the same sine played faster. Arms lag legs (`phase - 0.42`). `Hurt` / `Land` / `Stagger` move hips and spine on that gait. Strikes use `CombatMotion.Pulse` with three beats so successive hits are not one Euler.

`MixamoAvatar` (Soldier.glb Humanoid) keeps the animator **enabled while airborne** and remaps Speed onto Idle/Walk/Run. ExplosiveLLC `Unarmed-Attack-R1` overlays the Soldier controller when the Attack trigger exists — Humanoid only.

## TARGET

Gameplay state → animation presents it. Layers/masks. No root-motion stealing locomotion unless Concord says so. Human Melee Animations FREE (store 165785) still not imported.

## Gap

Rocketbox cannot play the owned Humanoid melee pack. That is a skeleton fact, not a missing import. Cloth/IK still absent. Jump/hurt on Mixamo stay procedural overlays.
