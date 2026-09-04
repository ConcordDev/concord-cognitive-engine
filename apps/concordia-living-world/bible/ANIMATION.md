# ANIMATION

**Status:** BROKEN / PARTIAL  
**Authority:** Unity playback · Concord pose intent  
**Source:** `Soldier.glb`; `SoldierAnimSetup.cs`; `MixamoAvatar.cs`; browser `mixamo-clips.ts`, `anim.ts`

## LIVE

Soldier GLB has Idle/Walk/Run. Play session: T-pose. Rocketbox humans often undressed/magenta. Browser Mixamo path is separate and more complete.

## TARGET

Gameplay state → animation presents it. Layers/masks. No root-motion stealing locomotion unless Concord says so.

## Gap

Bind SoldierLocomotion on the player before any IK/cloth work.
