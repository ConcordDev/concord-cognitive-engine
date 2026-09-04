# ANIMATION

**Status:** PARTIAL (hero Soldier bind)  
**Authority:** Unity playback · Concord pose intent  
**Source:** `Soldier.glb`; `SoldierAnimSetup.cs`; `MixamoAvatar.cs`; `ModularPerson.AttachHero`; browser `mixamo-clips.ts`, `anim.ts`

## LIVE

The live player uses `ModularPerson.AttachHero`, which prefers `Soldier.glb` and binds `SoldierLocomotion` (Idle/Walk/Run). NPCs still rotate rocketbox / Kenney and keep the procedural gait when the controller is missing. `Slash` fires `Attack` / `Slash` if the controller has the param. Browser Mixamo path is separate.

## TARGET

Gameplay state → animation presents it. Layers/masks. No root-motion stealing locomotion unless Concord says so.

## Gap

NPC gait is still often procedural. No IK/cloth. Soldier clips are locomotion-only — jump/hurt stay procedural. Human Melee Animations FREE (store 165785) is on the curated stack in `VISUAL.md` and is not imported yet — Concordia’s combat state machine stays the authoritative layer when those clips land.
