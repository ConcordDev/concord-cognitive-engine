# Concord organic asset pipeline — gap audit (2026-09-24)

**Question:** can the running Concord generate *organic* game-quality 3D content (creatures, monsters, mounts) on its own, the way Meshy did for the 33 assets in `Assets/Concordia/Models/Meshy/`?

**Answer:** not yet — but every stage now has a proven path. Two stages already run inside Concord, two are proven against free external models from this Mac, and the rest is engineering plus one account.

Everything below was run against the live server or live external services on 2026-09-24, not inferred from docs.

## The chain, stage by stage

| # | Stage | Status | Evidence |
|---|---|---|---|
| A | Text → concept image | **Concord's path fails; free FLUX passes** | Concord's `lib/pollinations-image.js` (anonymous Pollinations, model = Sana per EXIF): asked for a griffin, returned a winged lion, then a plain eagle, both watermarked despite `nologo=true`. The helper's `HEAD` reachability check also reported `reachable:true` for a request whose `GET` returned 0 bytes. FLUX.1-schnell (Apache-2.0) via the public HF Space: correct eagle-head/lion-body griffin, clean white background, no watermark, 5 s. |
| B | Image → textured 3D | **Proven free, quota-bound** | `trellis-community/TRELLIS` Space, anonymous: Meshy wolf thumbnail → coherent 4-sided wolf GLB in 24 s (5,819 tris, UV + one albedo PNG; no normal/ORM maps). Second job hit `ZeroGPU quota exceeded`. `microsoft/TRELLIS.2`, `tencent/Hunyuan3D-2.1`, `tencent/Hunyuan3D-2` Spaces are also live with callable APIs (Hunyuan accepts front/back/left/right views). |
| C | Rigging | **Humanoid only today** | Meshy's rigging API is humanoid-only (quote: "only works well with standard humanoid (bipedal) assets"). UniRig (MIT, rigs animals/dragons, predicts skin weights) needs CUDA ≥ 8 GB — runs on the A40, not the M2. |
| D | LODs + registry | **Done (this session)** | `server/lib/evo-asset/game-lod.js` + `server/scripts/register-external-assets.mjs`. All 33 Meshy assets registered (`source='meshy'`) with LOD0/1/2 in one GLB sharing one texture set; 12 Tripo assets registered (`source='tripo'`, FBX, no LODs). |
| E | Fidelity gate | **Missing** | 4 of 5 Meshy bosses drifted into generic archetypes (dragon, skeleton, mech trooper) against explicit bible silhouette notes. Nothing checks a generation against its spec before it's accepted. |
| F | Reference/style anchoring | **Assets exist, not wired** | 33 accepted Meshy GLBs + thumbnails + `MESHY_MANIFEST.json` (exact prompts, seeds, task ids). Usable as: Meshy `texture_image_url` style reference; multi-view input for TRELLIS/Hunyuan; style anchor for concept images. |

## Why the Mac can't do B or C locally

Apple M2, 8-core GPU, 16 GB unified memory. Hunyuan3D-2.1 needs ~24 GB for shape alone (~29 GB with texture); TRELLIS/TRELLIS.2 and UniRig need CUDA. TripoSR fits (~6 GB) but is clearly below the bar. The A40 pod (48 GB) fits all of them.

## Gaps to close, by class

| Gap | Class | What it takes |
|---|---|---|
| **G1 HF account token** | ✅ Done 2026-09-24 (free tier) | Stored at `~/.zuko/secrets/huggingface.env` (`HF_TOKEN`, chmod 600). Free account ≈ 3.5–5 GPU-min/day; PRO $9/mo ≈ 25–40 min/day plus $1 per 10 extra GPU-min. Proven: FLUX griffin → TRELLIS.2 → GLB in 53 s (94,932 tris, normals, base-color + metallic-roughness WebP textures, no normal map). The token is a write token; a read-only one is enough. |
| **G1b TRELLIS.2 output ingest** | ✅ Built 2026-09-24 — `lib/asset-gen/organic/glb-normalize.js` + `game-lod.js` `lod0MaxTris` | TRELLIS.2 GLBs declare `EXT_texture_webp` as *required*, so `@gltf-transform/core` (and likely Unity's importer) refuse them. Ingest must rewrite WebP → PNG (installed `sharp` 0.35.4 decodes WebP) and decimate LOD0 to the bible budget (extract minimum is 100k faces; monsters budget 15–20k). |
| **G2 Concord organic provider** | ✅ Built 2026-09-24 — see "Status" below | Built with the `hf-space` provider only (FLUX.1-schnell → TRELLIS.2, falling back to TRELLIS), via a Python CLI on the `gradio_client` package — the same execFile pattern as ConKay's OCC bridge, chosen so no new npm dependency was needed (an `npm install` in server/ prunes `pg`). Still to add: a `meshy` provider (image-to-3D with `texture_image_url` style refs) and a `local-gpu` provider for the A40. |
| **G3 Fidelity gate** | Engineering | Before accepting a generation: render/thumbnail → vision check against the bible's `silhouette_notes` (e.g. "no wings", "crest is the only vertical", "not a western dragon"). Reject + re-roll with a sharpened prompt. This is the check that would have caught the 4 generic bosses. |
| **G4 Reference anchoring** | Engineering | Feed accepted Meshy assets as style references (Meshy `texture_image_url`; multi-view inputs from the turntable renders) so new generations match the existing 33. |
| **G5 A40 local generation** | Hardware (NEED_DUTCH) | Pod back up → run TRELLIS.2 + Hunyuan3D-2.1 + UniRig as a sidecar like the other `engines/`. No quota, no per-asset cost, full PBR texturing, and animal rigging. |
| **G6 Quadruped rigging** | Engineering + G5 | UniRig on the A40. Interim: Concord's `lib/procedural-creature.js` already produces a physics-valid body plan (part tree, attach points, gait); map it to a bone template and use automatic skin weights. |
| **G7 Pollinations helper honesty** | Engineering (small) | `generatePollinationsImage` should verify a non-empty image body, not a `HEAD`; label output as watermarked/Sana. Keep only as a last-resort fallback. |
| **G8 ConKay OCC venv deleted** | ✅ Fixed 2026-09-24 | `com.concord.occ-daemon` ran from `~/.zuko/venvs/cad-occ`, deleted (with its uv Python 3.11.15) while the process stayed alive from 2026-09-13. Rebuilt: uv Python 3.11.16 + `cadquery-ocp==7.7.2` (same OCCT 7.7.2 the daemon was built against; not 8.0). No VTK needed (no code references it). Daemon restarted via `launchctl kickstart`, healthy in 6 s; STEP round trip through the socket returns an advanced B-rep solid. Note: the old daemon had served 0 requests in 10.5 days — nothing currently routes CAD work to it (opt-in per its README). |

## What was fixed while auditing (2026-09-24)

- **Migration 450** — migration 448 left `evo_asset_versions` FK'd to the dropped `evo_assets_v4`, so `evo-asset.generate` and `POST /api/conkay/design-glb` had failed on every call since 2026-09-13. Applied live; regression test reproduces the exact live error.
- **Migration 451** — admits `meshy` / `tripo` as `evo_assets` sources. The first draft reproduced a latent 448 hazard: inside the migration transaction `PRAGMA foreign_keys=OFF` is a no-op, so dropping the renamed parent cascade-deleted child rows (caught in a dry run on a copy of the live tables). Fixed by re-pointing children before the drop; also normalizes rows written under 448's loosened `evo_asset_interactions` schema. Applied live: 846/846 asset rows and the version row byte-identical, 0 FK violations.
- **`game-lod.js`** — Concord's existing refinement passes subdivide *up* and drop UVs; this decimates *down* for far bands with textures intact. Meshy UV atlases are ~60% seam vertices, so it uses meshoptimizer's `Permissive` mode; without it decimation stalls at ~52%.
- **Dependency incident** — adding `@gltf-transform/functions` via `npm install` silently removed the optional `pg` from `server/node_modules` and the lockfile (npm 11 kept pruning it only inside this project). Restored `pg@8.23.0` from the registry tarball, verified against the lockfile's integrity hash, and dropped `@gltf-transform/functions` (it would also have made `sharp` a hard dependency). Net lockfile change: `meshoptimizer` added, nothing removed.

## Recommended order

1. **G8** now — CAD is one restart from dark.
2. **G1** (free token first) → **G2** with the `hf-space` provider → prove one bible monster end to end (the 14 B4 monsters Meshy never reached are the natural test set).
3. **G3** fidelity gate before generating at volume.
4. **G5/G6** when the A40 is back — removes the quota ceiling and unlocks animal rigging.

## Status (2026-09-24, end of session)

**Built:** `server/lib/asset-gen/organic/` (`prompts.js`, `providers.js`, `glb-normalize.js`, `generate-organic.js`, `jobs.js`), `server/scripts/organic_gen_cli.py` (venv `~/.zuko/venvs/concord-gen`), macros `evo-asset.generate-organic` / `evo-asset.organic-job` (live after the next server restart), batch runner `server/scripts/generate-organic-assets.mjs`, migration 452 (`trellis` source) on the shared `migrations/_evo-assets-source-rebuild.js` helper. Tests: `tests/asset-gen-organic.test.js` (normalize, alpha rule, budget LOD0, prompts, no-network end-to-end ingest).

**Delivered:** `mon_sunder_griffin` — FLUX concept → TRELLIS.2 → 94,932 → 14,784 / 7,332 / 2,916 tris, 1.7 MB, `Assets/Concordia/Models/Generated/monsters/`, registered `source='trellis'`. Its forward axis is flipped relative to the Meshy assets (Unity import side).

**Quota reality (measured):** TRELLIS.2 reserves 120 GPU-seconds per call; the free tier's daily ZeroGPU allowance covers about **2 meshes/day**. FLUX concepts cost ~5 GPU-s. The 14-monster batch stopped cleanly at the first monster with `quota_exhausted` and wrote nothing to Unity.

**Concept-first is required, not optional:** the basilisk's concept (`data/evo-assets/organic/mon_sunder_basilisk/concept_0.png`) rendered "diamond hood" as a literal gemstone and gave it two clawed legs despite "no chicken legs". Run `--concept-only` first, review each concept against the bible, then mesh only approved ones (`conceptImage` option). This is the G3 gate done by hand until it's automated.

**Resume:** `cd server && node scripts/generate-organic-assets.mjs --batch B4_monsters --concept-only`, review, then mesh the approved ids (≈2/day free, ≈12/day with HF PRO).
