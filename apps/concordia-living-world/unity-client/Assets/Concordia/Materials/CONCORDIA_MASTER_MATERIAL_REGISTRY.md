# Concordia master-material registry

Status: **created / URP-compatible / evidence-based**  
Scope: persistent material assets for the current visual benchmark and currently bound world heroes. This pass does not edit gameplay, streaming, `HubLook`, hero mesh bindings, or world builders.

## Pipeline evidence

- Active pipeline: `Universal Render Pipeline`.
- Pipeline asset: `Assets/Settings/URP-Pipeline.asset`.
- URP package: `com.unity.render-pipelines.universal` `17.5.0`.
- Render state observed: HDR enabled, depth + opaque textures enabled, forward renderer, per-pixel lighting, 8 additional lights.
- Poly Haven evidence: `Assets/Concordia/PolyHaven/AURA_MANIFEST.json` reports 791 texture sets; this project copy is Poly Haven CC0 and uses `_2k` maps. No 4k/8k claim is made.
- Existing look authority retained: `Assets/Concordia/Scripts/HubLook.cs` and `Assets/Concordia/Editor/PolyHavenPipeline.cs`.

## Created assets

All six materials use shader **`Universal Render Pipeline/Lit`**. Opaque masters use `_BaseMap`, `_BaseColor`, `_BumpMap`, `_BumpScale`, `_OcclusionMap`, `_OcclusionStrength`, `_Metallic`, `_Smoothness`, `_SpecularHighlights`, and `_EnvironmentReflections`. Poly Haven ARM is retained as a linear occlusion source; metallic and smoothness are deliberate scalar controls so the assets remain stable without creating duplicate packed maps. Displacement sources remain available in the source set but are not bound because the active URP Lit path has no tessellation/displacement stage.

### 1. Wet Court stone

- Material: `Assets/Concordia/Materials/Masters/Concordia_Master_WetCourtStone.mat`
- Intended binding: Unburned Court / Hub ground and wet architectural stone; companion to `HubLook.WetStone`.
- Shader: `Universal Render Pipeline/Lit` (opaque).
- Scalars: `_BaseColor=(0.34,0.37,0.39,1)`, `_Metallic=0.02`, `_Smoothness=0.62`, `_BumpScale=1.0`, `_OcclusionStrength=0.8`, tiling `5.5`.
- Source textures (Poly Haven CC0, 2k):
  - `Assets/Concordia/PolyHaven/Textures/patterned_cobblestone_02/patterned_cobblestone_02_diffuse_2k.jpg` -> `_BaseMap`
  - `Assets/Concordia/PolyHaven/Textures/patterned_cobblestone_02/patterned_cobblestone_02_nor_gl_2k.jpg` -> `_BumpMap`
  - `Assets/Concordia/PolyHaven/Textures/patterned_cobblestone_02/patterned_cobblestone_02_arm_2k.jpg` -> `_OcclusionMap`
- Existing runtime evidence: `HubLook.WetStone` and Court builders already request `patterned_cobblestone_02`; no runtime code was changed in this pass.

### 2. Obsidian / ash forge stone

- Material: `Assets/Concordia/Materials/Masters/Concordia_Master_ObsidianAshForgeStone.mat`
- Intended binding: Tunya / Sangree Fire Forge.
- Hero evidence: `Assets/Generated_Models/Concordia_Sangree_Fire_Forge/Concordia_Sangree_Fire_Forge.fbx`; current runtime authority is `GoldenSliceRuntime`.
- Shader: `Universal Render Pipeline/Lit` (opaque).
- Scalars: `_BaseColor=(0.16,0.12,0.10,1)`, `_Metallic=0.08`, `_Smoothness=0.38`, `_BumpScale=1.0`, `_OcclusionStrength=0.8`, tiling `4.5`.
- Source textures (Poly Haven CC0, 2k):
  - `Assets/Concordia/PolyHaven/Textures/burned_ground_01/burned_ground_01_diffuse_2k.jpg` -> `_BaseMap`
  - `Assets/Concordia/PolyHaven/Textures/burned_ground_01/burned_ground_01_nor_gl_2k.jpg` -> `_BumpMap`
  - `Assets/Concordia/PolyHaven/Textures/burned_ground_01/burned_ground_01_arm_2k.jpg` -> `_OcclusionMap`
- Visual grammar alignment: black volcanic masonry, ash/soot weathering, ember-warm forge presentation.

### 3. Ruins archive stone

- Material: `Assets/Concordia/Materials/Masters/Concordia_Master_RuinsArchiveStone.mat`
- Intended binding: Sovereign Ruins / Refusal Cascade Archive.
- Hero evidence: `Assets/Generated_Models/RefusalCascadeArchive/RefusalCascadeArchive.fbx`; binding target is `Chunk_Ruins/VisualFidelity/RefusalCascadeArchive`.
- Shader: `Universal Render Pipeline/Lit` (opaque).
- Scalars: `_BaseColor=(0.42,0.37,0.31,1)`, `_Metallic=0.01`, `_Smoothness=0.34`, `_BumpScale=1.0`, `_OcclusionStrength=0.8`, tiling `3.8`.
- Source textures (Poly Haven CC0, 2k):
  - `Assets/Concordia/PolyHaven/Textures/old_stone_wall_02/old_stone_wall_02_diffuse_2k.jpg` -> `_BaseMap`
  - `Assets/Concordia/PolyHaven/Textures/old_stone_wall_02/old_stone_wall_02_nor_gl_2k.jpg` -> `_BumpMap`
  - `Assets/Concordia/PolyHaven/Textures/old_stone_wall_02/old_stone_wall_02_arm_2k.jpg` -> `_OcclusionMap`
- Visual grammar alignment: weathered archive masonry with restrained roughness and warm ash-stone tint.

### 4. Root Curse organic / root

- Material: `Assets/Concordia/Materials/Masters/Concordia_Master_RootCurseOrganic.mat`
- Intended binding: Fantasy / Root Curse Forest Shrine and root-safe organic dressing.
- Hero evidence: `Assets/Generated_Models/RootCurseForestShrine/RootCurseForestShrine.fbx`; binding target is `Chunk_Fantasy/VisualFidelity/RootCurseForestShrine`.
- Shader: `Universal Render Pipeline/Lit` (opaque).
- Scalars: `_BaseColor=(0.20,0.14,0.10,1)`, `_Metallic=0.0`, `_Smoothness=0.24`, `_BumpScale=1.0`, `_OcclusionStrength=0.8`, tiling `4.2`.
- Source textures (Poly Haven CC0, 2k):
  - `Assets/Concordia/PolyHaven/Textures/bark_brown_02/bark_brown_02_diffuse_2k.jpg` -> `_BaseMap`
  - `Assets/Concordia/PolyHaven/Textures/bark_brown_02/bark_brown_02_nor_gl_2k.jpg` -> `_BumpMap`
  - `Assets/Concordia/PolyHaven/Textures/bark_brown_02/bark_brown_02_arm_2k.jpg` -> `_OcclusionMap`
- Visual grammar alignment: living wood / bark / root contact; this is a surface master, not a claim that the hero mesh is final.

### 5. Frontier weathered metal

- Material: `Assets/Concordia/Materials/Masters/Concordia_Master_FrontierWeatheredMetal.mat`
- Intended binding: Frontier / Mesh Gate and weathered metal infrastructure.
- Hero evidence: `Assets/Generated_Models/FrontierMeshGate/FrontierMeshGate.fbx`; binding target is `Chunk_Frontier/VisualFidelity/FrontierMeshGate`.
- Shader: `Universal Render Pipeline/Lit` (opaque).
- Scalars: `_BaseColor=(0.42,0.44,0.43,1)`, `_Metallic=0.72`, `_Smoothness=0.48`, `_BumpScale=1.0`, `_OcclusionStrength=0.8`, tiling `3.0`.
- Source textures (Poly Haven CC0, 2k):
  - `Assets/Concordia/PolyHaven/Textures/metal_plate_02/metal_plate_02_diffuse_2k.jpg` -> `_BaseMap`
  - `Assets/Concordia/PolyHaven/Textures/metal_plate_02/metal_plate_02_nor_gl_2k.jpg` -> `_BumpMap`
  - `Assets/Concordia/PolyHaven/Textures/metal_plate_02/metal_plate_02_arm_2k.jpg` -> `_OcclusionMap`
- Visual grammar alignment: weathered industrial/road metal with controlled reflection for the Frontier key/rim lighting.

### 6. Unified water / puddle

- Material: `Assets/Concordia/Materials/Masters/Concordia_Master_WaterPuddle.mat`
- Intended binding: shared shallow puddles and water accents for the Court benchmark and wet-world dressing.
- Shader: `Universal Render Pipeline/Lit` (transparent alpha blend).
- Scalars/state: `_BaseColor=(0.05,0.24,0.27,0.46)`, `_Metallic=0.02`, `_Smoothness=0.88`, `_BumpScale=0.18`, `_Surface=1`, `_Blend=0`, `_SrcBlend=SrcAlpha`, `_DstBlend=OneMinusSrcAlpha`, `_ZWrite=0`, `_ReceiveShadows=0`, render queue `Transparent`.
- Source texture: no dedicated Poly Haven water/fabric family was found in the inspected library. A restrained breakup normal is borrowed from `Assets/Concordia/PolyHaven/Textures/patterned_cobblestone_02/patterned_cobblestone_02_nor_gl_2k.jpg` -> `_BumpMap` at tiling `2.6`; color is a deliberate Concordia surface control.
- Pipeline support: URP renderer has opaque texture and depth texture enabled, so a transparent Lit puddle layer is supported. This does not replace the missing plate-grade puddle mesh/mask or engraved floor treatment.

## Inconclusive / explicitly deferred

- These assets are persistent master materials. They are not silently substituted into gameplay or world-streaming code in this pass; current runtime authorities remain unchanged.
- The Asset Bible still marks engraved Court atlas/mesh, authored Court wall/plinth/arch kit, production cloth, gatehouse massing, lore stones, and lantern pillars as missing. No fabricated substitute is claimed here.
- The Asset Bible marks the hero tree and several Poly Haven props as candidates pending scale/socket/shot validation. Materials do not close those validation gates.
- Poly Haven displacement maps exist for each selected set, but the active URP Lit path does not consume them; no displacement claim is made.
- Water/puddle support is shader/pipeline-level only; plate-grade puddle geometry, masks, and edge breakup remain open.

## Verification checklist

- [x] Six persistent `.mat` assets created under one library folder.
- [x] All selected source files are existing Poly Haven `_2k` textures.
- [x] URP Lit shader used for all assets.
- [x] No gameplay, streaming, HubLook, or hero binding code edited.
- [ ] Runtime hero integration and named Play-shot validation remain downstream work.
