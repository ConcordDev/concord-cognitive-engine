# ANIMATION

**Status:** BROKEN / PARTIAL  
**Authority:** Unity playback · Concord pose intent  
**Source:** `Soldier.glb`; `SoldierAnimSetup.cs`; `MixamoAvatar.cs`; browser `mixamo-clips.ts`, `anim.ts`

## LIVE

Soldier GLB has Idle/Walk/Run. `ModularPerson.Slash` fires `Attack` / `Slash` if the bound controller has the param; otherwise the procedural arm swing. Authored bind still falls back to primitive gait when the Kenney mesh is unusable. Browser Mixamo path is separate and more complete.

## TARGET

Gameplay state → animation presents it. Layers/masks. No root-motion stealing locomotion unless Concord says so.

## Gap

Bind SoldierLocomotion on the player before any IK/cloth work.
