# Concordia measured visual benchmark and URP performance foundation

## Scope
- Preserve the existing Concordia Hub/Unburned Court runtime, LeanPlay policy, streaming authority, and shared runtime files.
- Add a persistent, evidence-backed rendering/performance audit record without changing unsupported URP features.
- Add a measurable frame-budget profile and runtime benchmark controller.
- Create a duplicate benchmark scene that boots the existing Hub runtime and records a representative Play-mode sample.

## Implementation
1. Inspect current package/URP/scene/runtime state and existing performance hooks.
2. Create a small Concordia performance foundation script with serializable audit/profile assets and a runtime benchmark controller.
3. Create and populate audit/profile assets from the supplied audited facts; mark unsupported or unmeasured items inconclusive instead of enabling them.
4. Duplicate ConcordiaHub into a benchmark scene, attach the controller to the existing ConcordiaGame node, and keep the original scene/runtime files untouched.
5. Verify compilation, asset contents, scene hierarchy, and benchmark wiring. Report exact paths and feature statuses.

## Safety gates
- Do not edit WorldHeroCatalog, WorldVisualDirector, WorldBuilder, or GoldenSliceRuntime.
- Do not enable Forward+, GPU Resident Drawer, GPU occlusion culling, APV, HDR display output, or other unverified features.
- Do not create a second renderer/look stack/streaming authority.
- Do not claim measured Play results until a Play-mode run produces a valid result file.
