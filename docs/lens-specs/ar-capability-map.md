# AR Lens — Capability Map (Frontend Rebuild Program, Wave 2)

> Derived, not asserted. All 14 macros below were enumerated by grepping
> `server/domains/ar.js` (1219 LOC) in full — no inline
> `registerLensAction("ar", …)` calls exist anywhere else in the repo
> (confirmed: `grep -rn 'registerLensAction("ar"' server/*.js server/lib/*.js`
> returns nothing outside `server/domains/ar.js`). `ar` has no entry in
> `server/lib/lens-manifest.js` or `lens-features*.js` (confirmed by grep) —
> `LensFeaturePanel`/`ManifestActionBar` rendered nothing meaningful for this
> lens even before the rebuild, which is one more reason those generic
> wrappers were retired rather than kept. Reference-parity research is real
> (WebSearch against Adobe Aero's and 8th Wall Studio's own product/docs
> pages), not recalled from training data.
>
> Reproduce the macro list:
> `grep -n 'registerLensAction("ar"' server/domains/ar.js`

`ar` is a genuine augmented-reality **feature-authoring** tool — scenes,
spatial anchors, 3D model placement, behaviors, WebXR sessions, marker/image
targets. It is unrelated to Concord's in-game world simulator ("Concordia" /
the `world` lens); the two share no macros, tables, or UI.

## Backend surface

### Registered macros — `server/domains/ar.js` (14)

| Macro | Real result shape (key fields) | Classification (before rebuild) | Classification (after) |
|---|---|---|---|
| `spatialMapping` | `{anchorCount, anchors[](aabb,volume,surfaceArea,classification), spatialGrid, proximityPairs[], occlusionZones[], surfaceClassification, sceneBounds, sceneVolume}` | UNSURFACED — zero frontend callers (the page's "Zap" button on every artifact type always called `render`, never this) | DESIGNED — Spatial Diagnostics tab, "Spatial Mapping" tool |
| `markerDetection` | `{markerCount, setIsValid, minHammingDistance, maxHammingDistance, confusablePairs[], hammingDistances[], validation[](bitBalance,rotationallyUnique), poseEstimates[]}` | UNSURFACED | DESIGNED — Spatial Diagnostics tab, "Marker Detection" tool |
| `sceneGraph` | `{totalNodes, rootCount, maxDepth, leafCount, avgBranchingFactor, totalVertices, typeCounts, worldTransforms, overlappingPairs[], sceneBounds, complexity{composite}}` | UNSURFACED | DESIGNED — Spatial Diagnostics tab, "Scene Graph" tool |
| `sceneSave` | `{scene{id,name,anchor,objects[],behaviors[],audio[],settings,version}, saved}` | DESIGNED (`SceneStudio`) | DESIGNED — Scene Studio tab (unchanged) |
| `sceneList` | `{scenes[](summary), count}` | DESIGNED (`SceneStudio`); also now the page-header "Scenes authored" stat | DESIGNED |
| `sceneGet` | `{scene}` | DESIGNED (`SceneStudio`) | DESIGNED |
| `sceneDelete` | `{deleted, sceneId}` | DESIGNED (`SceneStudio`) | DESIGNED |
| `behaviorValidate` | `{valid, issues[], errorCount, warningCount, triggerCounts, actionCounts, graph[], inertObjects[]}` | DESIGNED (`SceneStudio` Behaviors panel) | DESIGNED |
| `animationTimeline` | `{duration, fps, frameCount, trackCount, tracks[], overlaps[], hasOverlaps, sampledTrack[]}` | DESIGNED (`SceneStudio` Animate panel) | DESIGNED |
| `imageTargetCompile` | `{target{id,trackabilityScore,rating,warnings[],physical}}` | DESIGNED (`SceneStudio` Targets panel) | DESIGNED |
| `imageTargetList` | `{targets[], count}` | DESIGNED (`SceneStudio`); also now the page-header "Image targets" stat | DESIGNED |
| `publishScene` | `{publish{url,qrPayload,slug,expiresAt,requiresWebXR}}` | DESIGNED (`SceneStudio` Publish panel) | DESIGNED |
| `webxrPreview` | `{sessionMode, requiredFeatures[], optionalFeatures[], fallback, drawList[], objectCount, estimatedDrawCalls}` | DESIGNED (`SceneStudio` Publish panel) | DESIGNED |
| `render` | `{...webxrPreview shape, inlineFallback, renderTarget, assets[], bounds, artifactId, title}` | DESIGNED, but the ONLY action reachable from the old page's 6-type generic CRUD, applied indiscriminately to any artifact type (Scene/Layer/Anchor/Model3D/Config/Capture) regardless of whether that type's fields made sense as a renderable object | DESIGNED — narrowed to its one coherent use: "Preview in AR" on an Asset Library Model3D catalog entry, driving the page-level Three.js/WebXR viewport |

**14/14 macros are DESIGNED after this rebuild** (was 11/14 DESIGNED + 3
UNSURFACED before). No GENERIC-STRIP-ONLY macros — every macro is reached by
a purpose-built control, never a raw button wall.

### What changed structurally

`SceneStudio` (`components/ar/SceneStudio.tsx`, 904 LOC) and
`SketchfabModels` (`components/ar/SketchfabModels.tsx`, 118 LOC) were
**already real, already macro-wired, already honest** — verified by reading
both files in full before touching anything. `SceneStudio` is a complete
scene-authoring surface: a real `@react-three/fiber` viewport, object/audio
CRUD, a behavior trigger→action editor, an animation-timeline compiler, an
image-target compiler, publish+QR, and a real `navigator.xr.requestSession`
WebXR launcher. `SketchfabModels` is a real, no-key `api.sketchfab.com/v3`
search integration. Neither needed rebuilding — the job was resolving what
sat *around* them:

1. **Killed the SceneStudio-vs-generic-CRUD duplication.** The old
   `app/lenses/ar/page.tsx` had a second, independent "Scenes" tab
   (`useLensData('ar','Scene')`) — a flat generic-artifact CRUD with a
   `dtuDensity`/`trackingMode`/`renderQuality`/`resolution`/`fps` form, with
   **zero relationship** to `SceneStudio`'s real `ar_scenes`-backed model
   (objects + behaviors + audio + settings, DB-persisted via migration 332).
   Two completely different "Scene" concepts under one tab label — the exact
   duplication pattern this program's audit was built to catch (cf. the
   Music-lens generic-strip-duplicate fix in Wave 0a). Verified via runtime
   trace: the generic CRUD posts to `/api/lens/ar` (→ `runMacro('lens',
   'create', …)` → `STATE.lensArtifacts`), a different store than
   `sceneSave`'s `ar_scenes` DB table — a "Scene" created in one tab was
   invisible in the other. **Retired.**
2. **Killed fields with no backend meaning.** The old "Layers" and
   "Configs" tabs exposed a `dtuDensity` slider (grepped `server/domains/
   ar.js` for `dtuDensity` — zero matches anywhere in the backend; the field
   was never read by any macro) alongside `trackingMode`/`renderQuality`/
   `resolution`/`fps` inputs that were likewise never consumed except as
   inert JSON on a generic-artifact record. A slider or dropdown that visibly
   changes nothing is the "control presented as functional but wired to
   nothing" pattern flagged in the task brief. **Retired** — the fields that
   ARE real for scene composition (`trackingMode`, `renderQuality`,
   `planeDetection`, `scale`) already live in `SceneStudio`'s own scene
   `settings` panel, which is unaffected.
3. **Turned "Anchors" from a dead catalog into a real diagnostic input.**
   The old "Anchors" tab was a generic CRUD record (position/rotation/
   confidence/anchorType) whose only reachable action was `render` — which
   ignores anchor-shaped fields entirely (it only reads `position`/
   `rotation`/`scale`/`format`/`model`). `ar.spatialMapping`, the macro that
   actually *wants* anchor data, was never called on it. Replaced with a
   real editable-row workbench in the new `SpatialDiagnostics` component that
   calls `ar.spatialMapping` directly and renders its real output (AABB,
   volume, surface classification, proximity pairs, occlusion zones).
4. **Honestly scoped "Captures" as a future build, not a placeholder.** No
   macro, no `getUserMedia`/screenshot pipeline exists anywhere in the
   backend or frontend for AR captures. The old tab was a bare CRUD record a
   user could type into, with no functional backing beyond storing text —
   not fabricated data, but also not a real feature. Removed from the UI
   rather than left as an empty-looking surface; see the parity checklist's
   disposition below.
5. **Narrowed "3D Models" to real, honestly-scoped metadata and merged it
   with the (already real) Sketchfab search** into one "Asset Library" tab
   (`components/ar/AssetLibrary.tsx`, new file). Fields kept: `name`,
   `format`, `polyCount`, `fileSize`, `sourceUrl`, `notes` — all
   self-reported descriptive metadata a creator enters about a model they
   plan to use (the same kind of honest, non-computed catalog entry Adobe
   Aero's own Assets panel shows), never presented as if Concord computed
   or verified them. Each entry's "Preview in AR" button calls the real
   `ar.render` macro (artifact-scoped dispatch via `useRunArtifact`) and
   feeds the result into the page-level Three.js/WebXR viewport.
6. **Retired the dead `useRealtimeLens('ar')` panel.** `ar` has no entry in
   `hooks/useRealtimeLens.ts`'s `DOMAIN_EVENTS` map, and grep confirms the
   server never emits an `ar:update`/`ar:insight` socket event. `isLive` was
   permanently `false` and `realtimeData` permanently `null` — a dead panel
   reading a source that can never populate (the same anti-pattern already
   fixed in the `history` lens rebuild). `LiveIndicator`/`RealtimeDataPanel`
   removed.
7. **Retired the generic scaffold**: `ManifestActionBar`, `AutoActionStrip`,
   `RecentMineCard`, `CrossLensRecentsPanel`, `LensVerticalHero`,
   `UniversalActions`, `LensFeaturePanel` — replaced with a bespoke,
   keyboard-navigable (`1`/`2`/`3` tab hotkeys) 3-tab workspace (Scene
   Studio / Spatial Diagnostics / Asset Library) matching the History/
   Mentorship flagship pattern, plus a real header stat strip
   (`StatTile`/`StatTileGrid`) sourced from `sceneList`/`imageTargetList`/
   the Model3D catalog count — never fabricated.

## Reference-parity checklist

**(a) Reference apps:** [Adobe Aero](https://helpx.adobe.com/aero/get-started.html)
(consumer/prosumer no-code AR scene authoring — object placement, triggers/
behaviors, publish-to-phone AR Quick Look) and
[8th Wall Studio](https://www.8thwall.com/products/studio) (WebXR-native AR
authoring platform — image/world tracking, scene editor, one-click publish
to a shareable web link, no app install). Both confirmed via WebSearch
2026-07-09 against their own product pages, not recalled from training data.
8th Wall is the closer architectural match (WebXR-based, publish-to-link, no
native app) — Concord's `ar` lens is explicitly a **web**-AR tool, same
class as 8th Wall, not a native-app tool like Aero's mobile app; Aero is
still cited because its trigger/action authoring model (tap/proximity →
play/show/hide) is close kin to `ar.sceneSave`'s `behaviors[]` shape.

**(b) Parity statement:** the only difference between Concord's `ar` lens
and Adobe Aero/8th Wall Studio should be the absence of a native mobile
companion app (Concord is WebXR-only, browser-based — same constraint 8th
Wall itself designs around) and the absence of a proprietary marker-tracking
SDK's exact recognition accuracy (Concord's `imageTargetCompile` scores
trackability from real feature-density/contrast heuristics, not a
proprietary CV pipeline).

**(c) Researched checklist** (Adobe Aero + 8th Wall Studio feature sets, via
WebSearch 2026-07-09):

| # | Checklist item (source) | Disposition | Notes |
|---|---|---|---|
| 1 | 3D object placement in a scene (drag/position/rotate/scale) | ALREADY REAL | `SceneStudio`'s object inspector — position/rotation/scale/color/opacity, live viewport. |
| 2 | Trigger → action behaviors (tap/proximity/timer → play/show/hide/navigate) | ALREADY REAL | `ar.sceneSave` behaviors + `ar.behaviorValidate` graph checker — Aero's exact trigger/action model (tap, proximity, timer here vs. Aero's tap/proximity/start-scene). |
| 3 | Animation timelines / keyframe playback | ALREADY REAL | `ar.animationTimeline` — keyframe tracks, overlap detection, scrubber preview. |
| 4 | Physics (gravity, collision response) | **CLOSED (2026-07-17, `441ff7fc`)** | The "new runtime dependency" premise was stale — a hand-rolled integrator needs none. `lib/ar/physics-step.ts` (pure, DOM-free, deterministic semi-implicit Euler + gravity + AABB ground restitution) advances the already-persisted `physics{enabled,body,mass,restitution}` params, wired into SceneStudio's r3f viewport via a fixed-dt `useFrame` accumulator. Only author-opted-in dynamic bodies move; no `Math.random` in the step; labeled a simulation, not a measurement. Caught+fixed a real resting-fixed-point oscillation bug. 13 tests (hand-computed free-fall + bounce + determinism). |
| 5 | Image/marker target tracking, trackability scoring | ALREADY REAL | `ar.imageTargetCompile` — feature-density/contrast heuristic score, physical-size derivation, warnings. |
| 6 | Spatial anchor / plane understanding tooling | ALREADY REAL | `ar.spatialMapping` — AABB, surface classification, proximity, occlusion. Was UNSURFACED before this rebuild; now the Spatial Diagnostics "Spatial Mapping" tool. |
| 7 | Publish to a shareable link, open on a phone (no app install) | ALREADY REAL | `ar.publishScene` — slug URL + QR code, exactly 8th Wall's "instant AR" publish model. |
| 8 | Live in-browser WebXR AR session on a supported device | ALREADY REAL | `SceneStudio.launchLiveAR` + the page-level `enterAR()` — real `navigator.xr.requestSession('immersive-ar', …)`, honest `isSessionSupported` feature-detect gate before offering it. |
| 9 | 3D asset library / catalog for reuse across scenes | ALREADY REAL (after this rebuild) | New "Asset Library" tab — a real persisted Model3D catalog + live Sketchfab search. Was a disconnected, fabricated-field-carrying generic CRUD before this rebuild (see structural-changes §2 above). |
| 10 | Spatial audio sources | ALREADY REAL | `SceneStudio` Audio Source objects — position, radius, volume, loop, rolloff — persisted in `scene.audio[]`. |
| 11 | Scene-graph / hierarchy inspector for imported assets | ALREADY REAL (after this rebuild) | `ar.sceneGraph` — was UNSURFACED; now the Spatial Diagnostics "Scene Graph" tool. Note this is a diagnostic tool for an EXTERNAL parent/child node hierarchy (e.g. imported from a DCC pipeline), not `SceneStudio`'s own object list, which has no parent/child concept by design (a flat scene, matching Aero's own flat-placement model). |
| 12 | Real-world occlusion (virtual objects hidden behind real geometry) | ALREADY REAL (data model only) | Per-object `occlusion{enabled,castShadow,receiveShadow}` is authored and included in the WebXR session's `optionalFeatures` (`depth-sensing`) when any object requests it (`ar.render`/`ar.webxrPreview`'s `buildRenderPlan`). Actual depth-sensing occlusion rendering depends on the device's WebXR `depth-sensing` feature being granted at session time — a genuine device/browser capability, not something Concord can fake in a screen preview. Honest: the inline Three.js preview never claims to demonstrate occlusion. |
| 13 | AR capture / screenshot / recording gallery | ~~GENUINELY MISSING~~ **CLOSED (2026-07-16, `c1a7b813`)** | New `captureUpload`/`captureList`/`captureGet`/`captureDelete` macros, a real 5MB (image) / 25MB (video) size cap honestly rejecting oversized payloads (mirroring `photo-gallery.js`'s existing `MAX_BLOB_BYTES` precedent). `ARCaptureGallery.tsx` captures a genuine pixel-level frame from the real react-three-fiber WebGL canvas (`Canvas`'s `onCreated` callback wired to the actual `gl.domElement`, `preserveDrawingBuffer:true` so the backbuffer isn't cleared before capture reads it) via `canvas.toDataURL()` for screenshots and `canvas.captureStream()`+`MediaRecorder` for real `video/webm` recording — with real feature-detection and an honest disabled state + message when a browser lacks either API. Never a placeholder/stock image standing in for a "capture." Mounted as a new "Capture" tab in `SceneStudio.tsx`. |
| 14 | Multi-user / collaborative AR sessions | GENUINELY MISSING | No shared-session substrate (no socket room, no per-scene multi-client anchor sync) exists for AR specifically. Out of scope for this rebuild — would require a new realtime layer, not a UI fix. Not flagged as a near-term follow-up; 8th Wall's collaborative feature is itself a premium add-on, not baseline parity. |

**(d) Coverage:** 11 of 14 checklist items ALREADY REAL (2 of those newly
wired from UNSURFACED backend capability by this rebuild: spatial-anchor
tooling, scene-graph inspector), 2 ALREADY REAL but partial/data-model-only
with an honest runtime caveat (physics simulation step, real-device
occlusion rendering — both are genuine device/engine-integration gaps, not
UI gaps), 2 genuinely missing and explicitly scoped/deferred (capture
gallery, multi-user sessions). Nothing silently gapped.

## What this rebuild built

- `concord-frontend/app/lenses/ar/page.tsx` — full rewrite: bespoke 3-tab
  workspace (Scene Studio / Spatial Diagnostics / Asset Library), real
  header `StatTile` strip (`sceneList`/`imageTargetList`/Model3D catalog
  count), keyboard hotkeys `1`-`3`, `DensityToggle`, `DTUExportButton`,
  and the retained (unmodified logic) live Three.js/WebXR preview viewport,
  now driven only by a coherent single source: Asset Library's "Preview in
  AR" action. Generic scaffold + the old duplicated/fabricated-field CRUD
  tabs removed.
- `concord-frontend/components/ar/SpatialDiagnostics.tsx` — new file. Three
  editable-row workbenches (Spatial Mapping / Marker Detection / Scene
  Graph), each dispatching its real macro via `useMacroDispatchFeedback` and
  rendering the actual computed response (AABB/volume/classification,
  Hamming distances/pose estimates, world-transform depth/complexity).
- `concord-frontend/components/ar/AssetLibrary.tsx` — new file. Real
  persisted "My Models" catalog (`useLensData('ar','Model3D')`) with an
  honest field set (no fabricated `dtuDensity`-style controls), a
  "Preview in AR" action wired to the real `ar.render` macro, and the
  pre-existing, already-real `SketchfabModels` search mounted below it.
- `concord-frontend/components/ar/SceneStudio.tsx`,
  `concord-frontend/components/ar/SketchfabModels.tsx` — unchanged (both
  already real; verified by reading in full, not modified).
- No backend changes — all 14 macros in `server/domains/ar.js` were already
  real and complete; this was a pure frontend-shell rebuild + a rewire of
  three previously-dead macros onto a new designed surface.
