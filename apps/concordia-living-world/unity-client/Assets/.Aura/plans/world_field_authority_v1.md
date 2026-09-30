# World Field Authority

## Scope
Create a new additive deterministic world-field authority under `Assets/Concordia/Scripts/GameplayCore/WorldField/` without modifying `GameplayCoreBridge.cs` or existing source files.

## Design
- Reuse existing `Concordia.WorldId`, `Canon`, `WorldGeography`, `WorldBook`, `MegaworldMap`, and `StableWorldId` as read-only canonical inputs.
- Add serializable DTOs for field profiles, anchors, regional modifiers, query context, snapshots, and explainable contributions.
- Model Hub plus the nine existing world IDs with authored baseline profiles; no scene/rendering authority.
- Calculate deterministic spatial, topology, terrain, biome, temporal, and local modifiers; normalize blended snapshots and preserve capabilities by affecting conditions only.
- Add stable cell caching and deterministic bilinear interpolation.

## Files
- `WorldFieldAuthorityContracts.cs`
- `WorldFieldAuthorityProfiles.cs`
- `WorldFieldAuthority.cs`
- `WorldFieldAuthorityCache.cs`

## Verification
Refresh/compile Unity and run a read-only source/compile check. Report the created root and files.