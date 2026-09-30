# ConKay ↔ Unity (browser) — 2026-09-08 (build-intents LIVE · industrial mesh apply LIVE · free-text NLP CAD LIVE · load_glb LIVE · evo-asset→load_glb LIVE · ASSEMBLY LIVE · STL+BOM LIVE · Wave3 mates/materials LIVE · mates v2 LIVE · assembly undo/redo LIVE · set_transform player-LIVE · Wave4 suite LIVE · faceted STEP import/export LIVE · OCC advanced B-rep STEP LIVE · orthographic drawing SVG LIVE · no-marker happy-path LIVE · Overlay material picker LIVE · FULL SOLID WORLD CERTIFIED · INDUSTRIAL_CLASS CERTIFIED · industry verticals CERTIFIED · toolbar DTU mint LIVE)

## CURRENT STATUS (2026-09-08 ~09:30 ET) — read this first

**Supersedes historical honesty lines below that still say “faceted only / kinematic stubs only / NOT OCC”.** Those lines are kept as wave history; they describe what was true *at that wave*, not the tip.

| Tier | Status | Proof |
|------|--------|-------|
| SOLID WORLD (OCC feature tree / sketch / solid mates / geom verify) | **CERTIFIED** | `~/.zuko/remaining-work/conkay-solid-world-cert.json` |
| INDUSTRIAL_CLASS (multi-DOF mates / feature breadth / digital ASME Y14.5) | **CERTIFIED** | `~/.zuko/remaining-work/conkay-industrial-class-cert.json` |
| Industry verticals (molecular / hospital / prosthetics / studio / aero) | **CERTIFIED** (proxy/synthetic) | `~/.zuko/remaining-work/conkay-industry-verticals-cert.json` |
| Toolbar → mint locker DTUs | **LIVE** (API+mint; not browser click e2e) | `~/.zuko/remaining-work/conkay-toolbar-dtu-wire-proof.json` · tip `74dda10c3` |

**Still NOT claimed:** physical ISO CMM / FDA / 1:1 SolidWorks UI parity / ERP BOM / always-on A40 27B (Mac-copy failover LIVE — see `BRAIN_4LANE.md`).

Historical sections below remain for timeline; when they conflict with this block, **this block wins**.

## Vision (design target — not LIVE)
User: ConKay in browser drives Unity (WebGL / editor bridge) for blueprint→physics→mesh→live 3D.
Sequence sketched: ConKay intent → subconscious gate → deterministic physics → MCP plumbers → Unity mesh → Live 3D revision lens.

## LIVE now
- Five-Brain on A40 via Mac tunnel (`concord-brain-*`).
- ConKay persona: `conkay-persona.ts` + `concord-brain-conkay` on A40.
- Concordia SoT: Unity Setup Guide / ConcordiaHub (editor Play on Mac).
- WebGL served from `concord-frontend/public/concordia-webgl/` when
  `NEXT_PUBLIC_CONCORDIA_RENDERER=unity-webgl` + `NEXT_PUBLIC_UNITY_WEBGL_URL=/concordia-webgl/index.html`
  (`id="concordia-unity-webgl"` on world page).
- **Browser → Unity postMessage: LIVE** — `lib/conkay/unity-bridge.ts`
- **Round-trip hello/ping/ack: LIVE** (smoke ~13:06 ET).
- **Structured build intents (F0 markers): LIVE** (rebuild + smoke 2026-09-07 ~13:31 ET)
  - Cmds: `spawn_primitive` | `set_color` | `clear_temp` | `apply_mesh` | `spawn_from_spec`
  - Payload sketch: `{ kind:'cube'|'sphere', position?, scale?, color? }` · mesh `{ positions[], indices[], color?, id? }`
  - Unity: SoT `Assets/Concordia/Scripts/ConKayBrowserBridge.cs` spawns under `ConKayTemp`, events `spawned` / `mesh_applied` + `ack`
  - Frontend: Overlay **Drop marker** / **FEA beam** / **partMesh** / **clear** when iframe present
  - Helpers: `spawnPrimitive()`, `setPrimitiveColor()`, `clearTempPrimitives()`, `applyMesh()`, `spawnFromSpec()`
  - Build: side-copy `~/.zuko/concordia-webgl-project` → `ConcordiaWebGLBuild.Build` → `~/.zuko/concordia-webgl-out` → copied to `public/concordia-webgl/`
  - Proof: Playwright vs `http://127.0.0.1:3000/conkay-bridge-smoke.html` → events `ready`,`pong`,`ack`,`ack`,`spawned`,`ack`
    - Proof JSON: `~/.zuko/remaining-work/conkay-build-intents-proof.json`
    - IL2CPP: `ConKayBrowserBridge_HandleSpawn` in side-copy `Assembly-CSharp.cpp`


## Industrial slice v1 — FEA beam → world (2026-09-07)
- **Status: LIVE (proxy)** — proved 2026-09-07 ~13:47 ET. FEA_FRAME → `runFEA` → util≈0.125 band=`low` color=`#22c55e` → Unity `spawn_primitive` → events ready/pong/ack/spawned. Proof: `~/.zuko/remaining-work/conkay-industrial-slice-proof.json`.
- Band thresholds match server contour: low≤0.4 / moderate≤0.75 / high≤1.0 / overstressed>1.
  - FEA_FRAME maxUtilization ≈ 0.125 → **low** → `#22c55e` green.
- Frontend:
  - `lib/conkay/fea-util-color.ts` — `feaUtilToColor` / `utilizationBand`
  - `lib/conkay/fea-beam-to-world.ts` — `runFeaBeamToWorld()` (lensRun + spawn)
  - Overlay button **FEA beam → world** (`data-testid=ck-fea-beam-world`, Activity icon) when Unity iframe present (auth session for lens/run)
- Smoke: `concord-frontend/public/conkay-industrial-smoke.html`
- Proof: `concord-frontend/scripts/conkay-industrial-slice-proof.mjs` → `~/.zuko/remaining-work/conkay-industrial-slice-proof.json`

## Industrial mesh apply — partMesh → Unity MeshFilter (2026-09-07)
- **Status: LIVE** — `apply_mesh` / `spawn_from_spec` land triangle arrays on Unity `MeshFilter` under `ConKayTemp`; Unity acks `mesh_applied`.
- Source mesh: `engineering.partMesh` (`i-beam` / `tube` / …) positions+indices (or mirrored fixture in smoke). Optional FEA util tint.
- **NOT full CAD** / free-text blueprint→mesh. GLB URL path is separate cmd `load_glb` (LIVE).
- Frontend:
  - `lib/conkay/unity-bridge.ts` — cmds `apply_mesh` | `spawn_from_spec`; event `mesh_applied`; helpers `applyMesh()` / `spawnFromSpec()`
  - `lib/conkay/part-mesh-to-world.ts` — `runPartMeshToWorld()` (lensRun partMesh + optional runFEA color → apply_mesh)
  - Overlay button **partMesh → world** (`data-testid=ck-part-mesh-world`, Layers icon)
- Unity SoT: `ConKayBrowserBridge.cs` `HandleApplyMesh` → MeshFilter + MeshRenderer
- Smoke: `concord-frontend/public/conkay-apply-mesh-smoke.html`
- Proof: `concord-frontend/scripts/conkay-apply-mesh-proof.mjs` → `~/.zuko/remaining-work/conkay-apply-mesh-proof.json`
- WebGL rebuild: side-copy `~/.zuko/concordia-webgl-project` → `ConcordiaWebGLBuild.Build` → `~/.zuko/concordia-webgl-out` → `public/concordia-webgl/`


## Free-text NLP CAD (2026-09-07)
- **Status: LIVE** — free-text NLP intent → deterministic FEA/partMesh → Unity `apply_mesh` → `mesh_applied`.
- Honesty: **NLP intent → deterministic FEA/mesh → WebGL**. NOT an industrial CAD suite. **GLB load_glb LIVE separately** (URL→glTFast); NLP→GLB catalog not auto-wired.
- Parser: `concord-frontend/lib/conkay/nlp-design-intent.ts` (+ server mirror `server/lib/conkay/nlp-design-intent.js`) — regex/slot for beam/box/cylinder/tube/sphere; Zod schema `{ part, spans, loads, material, units, meshKind }`; fail closed. No LLM required for v1.
- Server: `POST /api/conkay/design` `{ text }` (auth) → `{ intent, fea?, mesh:{positions,indices}, utilColor }` via real `runFEA` + partMesh builder.
- Frontend: `lib/conkay/nlp-design-to-world.ts` — prefer API, fall back to parse → `runPartMeshToWorld` / lensRun.
- Overlay: text input (`ck-nlp-design-text`) + **Build in world** (`data-testid=ck-nlp-build-world`) when Unity iframe present.
- Smoke: `concord-frontend/public/conkay-nlp-cad-smoke.html`
- Proof: `concord-frontend/scripts/conkay-nlp-cad-proof.mjs` → `~/.zuko/remaining-work/conkay-nlp-cad-proof.json`
- Sample: `"simply supported steel I-beam 6m, 5kN midspan"` → i-beam mesh + FEA util tint → `mesh_applied`.



## GLB load_glb via glTFast (2026-09-07)
- **Status: LIVE** — proved 2026-09-07 ~14:24 ET. Browser `load_glb` `{ url, position?, scale?, name? }` → Unity WebGL fetches URL → **glTFast 6.14.1** `GltfImport.Load` + `InstantiateMainSceneAsync` under `ConKayTemp` → event `glb_loaded` `{ ok, name, url }` (+ ack). Fail closed with `error`.
- Honesty: **runtime URL fetch via glTFast**. Prefer absolute same-origin URLs. Sample prop: `http://127.0.0.1:3000/models/prop/furniture_table.glb`. Evo-asset generate→load_glb wired separately (see below).
- Frontend: `unity-bridge.ts` cmd `load_glb`, helper `loadGlb()`, event `glb_loaded`; Overlay **Load GLB** (`data-testid=ck-load-glb`) when iframe present.
- Unity SoT + side-copy: `ConKayBrowserBridge.cs` `HandleLoadGlbCoroutine`.
- Smoke: `concord-frontend/public/conkay-glb-smoke.html`
- Proof: `concord-frontend/scripts/conkay-glb-proof.mjs` → `~/.zuko/remaining-work/conkay-glb-load-proof.json`
- WebGL rebuild: side-copy `~/.zuko/concordia-webgl-project` → `ConcordiaWebGLBuild.Build` → `~/.zuko/concordia-webgl-out` → `public/concordia-webgl/`
- `apply_mesh` path unchanged.



## evo-asset.generate → resolve → load_glb (2026-09-07)
- **Status: LIVE (archetypes only)** — free-text with archetype keyword (sword/spear/staff/mace/shield) → `generateValidatedAsset` → register/promote → `/api/evo-asset/resolve` → absolute same-origin `http://127.0.0.1:3000/api/evo-asset/file/…` (Next rewrite) → Unity `load_glb` → `glb_loaded`.
- Honesty: **archetype parametric FEA→GLB→world**. NOT full free-text CAD / industrial suite. Fail closed if no archetype keyword.
- Server: `POST /api/conkay/design-glb` `{ text }` (auth) in `server/routes/conkay-design.js` — reuses `generateValidatedAsset` + `registerGeneratedAsset` (same pipeline as `evo-asset.generate` macro).
- Frontend: `lib/conkay/evo-glb-to-world.ts` → `runEvoGlbToWorld()`; Overlay **Evo GLB** (`data-testid=ck-evo-glb-world`, Sword icon) when iframe present.
- Same-origin: Next already rewrites `/api/*` → `:5050`; Unity WebGL fetches GLB on `:3000` (avoids CORS).
- Smoke: `concord-frontend/public/conkay-evo-glb-smoke.html`
- Proof: `concord-frontend/scripts/conkay-evo-glb-proof.mjs` → `~/.zuko/remaining-work/conkay-evo-glb-proof.json`



## Assembly multi-part + chat revise (2026-09-07)
- **Status: LIVE (Wave 1)** — proved 2026-09-07 ~15:01 ET. Server sqlite assembly store + CRUD/revise APIs; Overlay **Asm** chat revise; Unity ≥2 named meshes under ConKayTemp via `apply_mesh`; revise transform via API + clear/redraw (re-apply) / optional `set_transform` on disk.
- Honesty: **ASSEMBLY LIVE**. NOT full CAD suite (faceted STEP LIVE; Wave 2 STL+BOM LIVE; Wave 3 mates/materials LIVE; Wave 4 suite LIVE as chain — still not industrial solver).
- Server: `server/lib/conkay/assembly-store.js`, `assembly-nlp.js`, `server/routes/conkay-assembly.js` mounted `/api/conkay/assemblies*`.
- Frontend: `lib/conkay/assembly-to-world.ts`; Overlay `ck-assembly-revise`; `unity-bridge` cmd `set_transform` + event `transform_set`.
- Unity: side-copy + SoT `ConKayBrowserBridge.cs` — stable mesh ids, `HandleSetTransform` (**player-LIVE** after 2026-09-08 WebGL rebuild; see set_transform section).
- Smoke: `concord-frontend/public/conkay-assembly-smoke.html`
- Proof: `concord-frontend/scripts/conkay-assembly-proof.mjs` → `~/.zuko/remaining-work/conkay-cad-assembly-proof.json`




## set_transform player-LIVE (2026-09-08)
- **Status: LIVE** — proved 2026-09-08 ~06:38 ET. `apply_mesh` → `mesh_applied` → `set_transform` → event **`transform_set`** (not clear+redraw / re-apply_mesh).
- Unity SoT + side-copy already had `HandleSetTransform`; WebGL batchmode rebuild required for player.
- Build: side-copy `~/.zuko/concordia-webgl-project` → `ConcordiaWebGLBuild.Build` → `~/.zuko/concordia-webgl-out` → `public/concordia-webgl/` (IL2CPP includes `HandleSetTransform`).
- Frontend: `unity-bridge.ts` `setTransform()`; smoke `public/conkay-set-transform-smoke.html` (middleware allowlisted).
- Proof: `concord-frontend/scripts/conkay-set-transform-proof.mjs` → `~/.zuko/remaining-work/conkay-set-transform-proof.json`
- Events sample: ready, pong, ack, mesh_applied, transform_set.


## Assembly undo/redo history (2026-09-08)
- **Status: LIVE** — sqlite revision stack per assembly (parts+transforms snapshots on mutating ops).
- APIs: `POST /api/conkay/assemblies/:id/undo`, `POST …/redo`, `GET …/history`; chat revise accepts `undo`/`redo`.
- Overlay: **Undo** / **Redo** (`ck-assembly-undo`, `ck-assembly-redo`) + Asm chat.
- Honesty: NOT parametric CAD history / feature tree.
- Proof: `~/.zuko/remaining-work/conkay-cad-undo-proof.json`


## Mates v2 kinematic solve (2026-09-08)
- **Status: LIVE** — `distance` / `offset` / `align_axis` (+ legacy types) solve for **B given A** (`drive:'b'` default; `drive:'a'` legacy).
- Honesty (wave-at-time): kinematic stubs — **NOT industrial solver / OCC**.
  - **CURRENT (2026-09-08):** superseded for OCC path by **INDUSTRIAL_CLASS** (`mate-solve-dof` / `gp_Trsf` multi-DOF) + SOLID WORLD Gate C; mesh mates-v2 path remains kinematic. See CURRENT STATUS.
- Unit tests: `server/tests/conkay-assembly-mates-v2.test.js`
- Proof: `~/.zuko/remaining-work/conkay-cad-mates-v2-proof.json`


## STL export + BOM (2026-09-07)
- **Status: LIVE (Wave 2)** — binary STL part+assembly; BOM JSON; Overlay STL/BOM. Proof: `conkay-cad-export-bom-proof.json`.
- Honesty (wave-at-time): STL+BOM LIVE for triangle meshes. Faceted STEP also LIVE. NOT full B-rep suite.
  - **CURRENT (2026-09-08):** **OCC advanced B-rep STEP LIVE** + SOLID WORLD CERTIFIED — faceted STEP remains available; B-rep is no longer “faceted only”.


## Wave 3 mates + materials (2026-09-07 ~15:21 ET)
- **Status: LIVE (Wave 3)** — kinematic mate stubs (`fixed` / `coincident` / `offset`) write transforms; material library attach (steel/aluminum/concrete/timber/plastic).
- Honesty (wave-at-time): **mates stubs + material library LIVE**. NOT a full industrial constraint solver / CAD kernel.
  - **CURRENT (2026-09-08):** INDUSTRIAL_CLASS CERTIFIED supersedes “stubs only” for OCC multi-DOF mates; Wave-3 mesh stubs still exist for Unity apply path.
- Server: `server/lib/conkay/assembly-mates.js`, `material-library.js`; routes on `conkay-assembly.js` — `GET /api/conkay/materials`, `POST …/parts/:id/material`, `POST …/mates`, `GET /api/conkay/mate-types`.
- Proof: `concord-frontend/scripts/conkay-constraints-proof.mjs` → `~/.zuko/remaining-work/conkay-cad-constraints-proof.json` (`ok:true`, `status:LIVE`).

## Wave 4 suite e2e (2026-09-07 ~15:22 ET)
- **Status: LIVE (Wave 4 suite)** — chained free-text `/api/conkay/design` → assembly create → ≥2 parts → mate → material → STL+BOM → Unity `apply_mesh` (≥2 `mesh_applied` via assembly smoke).
- Honesty: **suite LIVE as a chain of Waves 1–3 + Unity apply**. Still **NOT** industrial constraint solver / full B-rep (faceted STEP LIVE) / full SolidWorks-class suite.
- Proof: `concord-frontend/scripts/conkay-suite-proof.mjs` → `~/.zuko/remaining-work/conkay-cad-suite-proof.json`.


## Faceted STEP import/export (2026-09-07/08)
- **Status: LIVE** — proof `~/.zuko/remaining-work/conkay-cad-step-proof.json` (ok:true).
- Export: `GET …/parts/:id/export.step` + `GET …/assemblies/:id/export.step` (ASCII AP214 faceted MANIFOLD_SOLID_BREP from triangle meshes).
- Import: `POST …/assemblies/:id/import.step` → triangle mesh part (POLY_LOOP round-trip).
- Overlay: STEP download control when wired (`ck-export-step` if present).
- Commit landed in tree as `63cc66516` (deploy land of CAD wave + STEP).
- Honesty: **faceted STEP from meshes**. NOT OpenCascade/cadquery B-rep / SolidWorks kernel / industrial mates solver.



## Orthographic drawing + dimensions + PDF pack (2026-09-08)
- **Status: LIVE** — SVG front/top/side with auto overall X/Y dims (extension lines/arrows) + optional user dims API; multi-page PDF pack (title block + BOM + 3 views).
- APIs: `GET …/drawing.json`, `GET …/drawing.svg`, `GET …/drawing.pdf`, `POST/GET/DELETE …/dimensions`.
- Overlay: **DWG** (`ck-export-drawing`), **PDF** (`ck-export-drawing-pdf`).
- Honesty: projected mesh lines + drafting-style dims — **NOT** industrial drafting CAD / CMM sheets.
- Proof: `~/.zuko/remaining-work/conkay-cad-drawing-dims-pdf-proof.json`

## Assembly explode view (2026-09-08)
- **Status: LIVE** — server computes deltas along part centroids from assembly COM; `POST …/explode { factor }` updates transforms (undoable via history); Overlay **Explode**; Unity via `set_transform` / clear+redraw.
- Honesty: geometric centroid explode — **NOT** physics / SolidWorks explode-table animation.
- Proof: `~/.zuko/remaining-work/conkay-cad-explode-proof.json`

## GD&T drafting annotations (2026-09-08)
- **Status: LIVE** — feature control frames (⊥ ∥ ⌖ ◎ etc + tolerance + datum refs) stored on assembly meta; rendered as SVG overlays on drawing; CRUD `…/gdt` (also embedded in `drawing.json`).
- Honesty: **drafting annotations on projected views — NOT CMM-certified GD&T solver**.
- Proof: `~/.zuko/remaining-work/conkay-cad-gdt-proof.json`

## NOT LIVE (do not claim)
- Full industrial / SolidWorks-class CAD suite (FEA→cube proxy LIVE; partMesh→apply_mesh LIVE; free-text NLP→apply_mesh LIVE; load_glb LIVE; evo-asset→load_glb archetypes LIVE; ASSEMBLY LIVE; STL+BOM LIVE; **Wave 3 mates/materials LIVE**; **Wave 4 suite chain LIVE**) — still **NOT**: industrial constraint solver / full B-rep kernel (faceted STEP import/export is LIVE), ERP BOM, full SolidWorks-class suite.
- substrate-finish.js "10 physics models" as ConKay industrial pipeline.
- MCP compiling CAD into Unity Editor from browser without WebGL/editor bridge.
- Linux standalone player module.
- CMM-certified GD&T solver / industrial drafting sheets (drafting overlays LIVE).
- Crowd/marble structural CAD from chat.

## Paths
- Frontend helper: `concord-frontend/lib/conkay/unity-bridge.ts`
- Overlay: `concord-frontend/components/conkay/ConKayOverlay.tsx`
- Smoke: `concord-frontend/public/conkay-bridge-smoke.html`
- SoT C#: `…/Setup Guide In-Editor Tutorial/Assets/Concordia/Scripts/ConKayBrowserBridge.cs` (Unity SoT not in git)
- jslib: `…/Assets/Concordia/Plugins/WebGL/ConKayBrowserBridge.jslib`
- Side-copy: `~/.zuko/concordia-webgl-project`
