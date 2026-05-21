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
- [ ] `[L]` Live WebXR camera AR preview / placement in the browser
- [ ] `[M]` Interactive behaviors / triggers (tap → animate, proximity → play)
- [ ] `[M]` Real 3D model viewport with transform gizmos
- [ ] `[M]` Animation timeline for AR objects
- [ ] `[S]` QR/link publishing so a phone can open the AR scene
- [ ] `[M]` Real image-target / marker compilation from uploaded images
- [ ] `[S]` Spatial audio placement preview
- [ ] `[M]` Physics / occlusion settings per object

## Parity
~32% of Adobe Aero's surface. This is an AR scene-data manager — it stores scenes, layers, anchors, and models as artifacts — but lacks the live WebXR preview, interactive behaviors, and 3D viewport that define an AR authoring tool.
