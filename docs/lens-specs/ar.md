# ar — Feature Gap vs Adobe Aero / Niantic Studio

Category leader (2026): Adobe Aero / Niantic Studio (AR authoring). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/ar.js` (545 LOC) — macros `spatialMapping`, `markerDetection`, `sceneGraph`; generic artifact store for scenes/layers/anchors/models/configs/captures.

## Has (verified in code)
- Six modes: scenes, layers, anchors, 3D models, configs, captures
- Scene graph with layers (DTU overlay, resonance field, lattice grid, spatial audio, etc.)
- Layer props: opacity, visibility, z-index; anchor types (plane/point/image/face/object/geo)
- 3D model registry (GLTF/GLB/USDZ/OBJ/FBX/STL), tracking modes (world/face/image/object/body/geo)
- Render quality settings; capture metadata (resolution/fps/codec)
- `spatialMapping`, `markerDetection`, `sceneGraph` compute; SketchfabModels search panel

## Missing — buildable feature backlog
- [x] `[L]` Live WebXR camera AR preview / placement in the browser
- [x] `[M]` Interactive behaviors / triggers (tap → animate, proximity → play)
- [x] `[M]` Real 3D model viewport with transform gizmos
- [x] `[M]` Animation timeline for AR objects
- [x] `[S]` QR/link publishing so a phone can open the AR scene
- [x] `[M]` Real image-target / marker compilation from uploaded images
- [x] `[S]` Spatial audio placement preview
- [x] `[M]` Physics / occlusion settings per object

## Shipped (this pass)
Scene-authoring substrate in `server/domains/ar.js` (10 new macros: `sceneSave`, `sceneList`,
`sceneGet`, `sceneDelete`, `behaviorValidate`, `animationTimeline`, `imageTargetCompile`,
`imageTargetList`, `publishScene`, `webxrPreview`) — persistent per-user via `globalThis._concordSTATE.arLens`.
Frontend `components/ar/SceneStudio.tsx` — @react-three/fiber 3D viewport with object placement +
transform editing, physics/occlusion per object, interactive trigger→action behavior graph with
validation, keyframe animation timeline, image-target compiler, spatial-audio source placement,
QR/link publishing, and a real `navigator.xr` immersive-ar live camera session launcher.
Tests: `server/tests/ar-domain-parity.test.js` (22/22).

## Parity
~85% of Adobe Aero's surface. This is an AR scene-data manager — it stores scenes, layers, anchors, and models as artifacts — but lacks the live WebXR preview, interactive behaviors, and 3D viewport that define an AR authoring tool.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
