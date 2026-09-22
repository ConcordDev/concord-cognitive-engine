# Concordia master-material layer

## Scope
Create the minimum persistent URP-compatible material library for the current visual benchmark and bound world heroes without editing gameplay, streaming, or the HubLook runtime stack.

## Evidence inspected
- `Assets/Concordia/Generated/CONCORDIA_ASSET_BIBLE.md`
- `Assets/Concordia/Scripts/HubLook.cs`
- `Assets/Concordia/Editor/PolyHavenPipeline.cs`
- `Assets/Concordia/PolyHaven/AURA_MANIFEST.json`
- `Assets/Concordia/Scripts/WorldHeroCatalog.cs`
- URP package `com.unity.render-pipelines.universal` 17.5.0

## Implementation
1. Resolve existing Poly Haven 2k texture sets for wet court stone, forge/ash stone, ruins archive stone, root/bark, and weathered metal.
2. Create persistent URP Lit materials under `Assets/Concordia/Materials/Masters/` with exact texture references, controlled tint, metallic/smoothness, normal, occlusion, and emission/transparent settings where supported.
3. Create one transparent URP Lit water/puddle material only because the active pipeline supports the required surface mode; keep it unified and lightweight.
4. Write a concise material registry/ledger documenting exact paths, properties, source textures, Poly Haven CC0 provenance, and inconclusive items.
5. Verify asset metadata, shader dependencies, texture dependencies, clean compilation, and ledger contents.

## Non-goals
No gameplay, world streaming, hero mesh binding, HubLook code edits, 4k/8k claims, or creation of missing engraved atlases/meshes/cloth textures.