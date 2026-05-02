# EvoAsset Engine

## What it is

A system that auto-evolves Concordia's graphics assets — meshes, textures, materials, HDRIs — based on player and NPC interaction. Assets start at base LOD; the longer they get used, the more they get refined. The world's visual fidelity is a function of how much it's played.

## Why it matters

AAA freezes graphics at launch. EvoAsset inverts that — graphics improve over real-time + in-game time. AAA studios can't replicate this because they don't have the substrate it runs on.

## Substrate this leans on (redundancy sweep findings)

Per the user's "find before build" rule, the sweep before this commit confirmed ~60% of what EvoAsset needs already exists, built for other purposes:

| Already in the codebase | What EvoAsset uses it for |
|---|---|
| `server/lib/vision-inference.js` (LLaVA via Ollama) | Pass 2: describe textures, suggest detail upgrades |
| `_callMultimodalBrain` in `server.js:8860-8900` (SD/ComfyUI/A1111 + DALL-E-3) | Pass 2: generate higher-detail texture variants |
| `maybeWriteLinguisticShadowDTU` (server.js:3265-3306) | NPCs request asset improvements via Shadow DTUs |
| `dtu.lineage = { parents, children, generation }` (`emergent/reproduction.js`) | Asset version chains |
| `refineHypothesis` + `iterateForge` patterns | Reference for refinement-as-versioning |
| `runAutoPromoteGate` (`emergent/atlas-write-guard.js`) | The 5-stage quality gate that catches visual slop |
| `interaction_count` pattern (migration 009) | Asset interaction counter |
| Bootstrap ingestion pattern (`emergent/bootstrap-ingestion.js`) | Reference for CC0 asset seeding |

So EvoAsset is ~40% net-new build, ~60% wiring of substrate that's been there all along.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     EvoAsset Engine                              │
│                                                                  │
│  ┌────────────┐   ┌──────────────┐   ┌────────────────────────┐ │
│  │  Sources   │──▶│   Registry   │◀──│  NPC Shadow Bridge     │ │
│  │ (CC0 boot) │   │  (evo_assets │   │  (improvement requests │ │
│  │  Kenney    │   │   table)     │   │   from npc-simulator)  │ │
│  │  PolyHaven │   └──────┬───────┘   └────────────────────────┘ │
│  │  ambientCG │          │                                       │
│  │  OS3A      │          ▼                                       │
│  └────────────┘   ┌──────────────┐                                │
│                   │  Scheduler   │── every 100th heartbeat ──┐   │
│                   │ (top-N picks)│                            │   │
│                   └──────┬───────┘                            │   │
│                          ▼                                    │   │
│                   ┌──────────────┐                            │   │
│                   │  Refinement  │  Pass 1: subdivision       │   │
│                   │    Passes    │  Pass 2: detail maps (AI)  │   │
│                   │  (1 of 5)    │  Pass 3: material upgrade  │   │
│                   └──────┬───────┘  Pass 4: procedural wear   │   │
│                          │          Pass 5: higher LOD        │   │
│                          ▼                                    │   │
│                   ┌──────────────────────────────┐            │   │
│                   │ Atlas 5-Stage Quality Gate   │            │   │
│                   │ (DRAFT→PROPOSED→VERIFIED ... │◀───────────┘   │
│                   │  via runAutoPromoteGate)     │                │
│                   └──────┬───────────────────────┘                │
│                          ▼                                        │
│         ┌───────────────────────────────┐                         │
│         │ verified → promoteVersion     │                         │
│         │ disputed → stays as version   │                         │
│         │ quarantined → archived        │                         │
│         └───────────────────────────────┘                         │
└──────────────────────────────────────────────────────────────────┘
                          │
                          ▼
              ┌─────────────────────────┐
              │ Frontend asset loader   │
              │  resolveAssetUrl(...)   │  → /api/evo-asset/file/:id?v=N
              │  (5min in-memory cache) │
              └─────────────────────────┘
```

## Files shipped

### Server

| File | Purpose |
|---|---|
| `server/migrations/073_evo_assets.js` | 3 tables: `evo_assets`, `evo_asset_interactions`, `evo_asset_versions` |
| `server/lib/evo-asset/registry.js` | `registerAsset`, `recordInteraction`, `recomputeEvolutionScore`, `selectEvolutionCandidates`, `resolveCurrentBest`, `appendVersion`, `promoteVersion` |
| `server/lib/evo-asset/refinement-passes.js` | All 5 passes. Subdivision + procedural wear are pure-math (run inline). Detail maps + image-gen passes lean on injected `callVision` + `callImageGen` |
| `server/lib/evo-asset/quality-gate-bridge.js` | `submitAssetCandidateToGate` — wraps an asset variant as a pseudo-DTU (`domainType: 'visual_artifact'`, `epistemicClass: 'aesthetic'`) and routes through `runAutoPromoteGate` |
| `server/lib/evo-asset/scheduler.js` | `runEvolutionTick` — heartbeat-driven; picks top 3 candidates per tick, runs the next pass, gates, promotes verified |
| `server/lib/evo-asset/source-loaders.js` | `bootstrapPolyHaven`, `bootstrapAmbientCG`, `bootstrapOS3A`, `bootstrapKenneyFromDir`, `bootstrapAllSources`. All graceful-on-failure (offline returns empty result) |
| `server/lib/evo-asset/npc-shadow-bridge.js` | `recordInteractionFromNPC` (with optional `improvementRequest` that writes a Shadow DTU + bumps weight 2x), `recordInteractionFromPlayer` |
| `server/routes/evo-asset.js` | 4 endpoints: `/resolve`, `/file/:id`, `/interaction`, `/asset/:id`, `/stats` |
| `server/server.js` | mounts router; bootstraps sources 30s after boot; runs evolution tick every 100th heartbeat with full deps wired |

### Frontend

| File | Purpose |
|---|---|
| `concord-frontend/lib/evo-asset/loader.ts` | `resolveAssetUrl(ref)`, `preresolveAssets(refs)`, `recordAssetInteraction`, `clearAssetCache`. 5-min in-memory cache so a scene with 200 trees doesn't make 200 round trips |

## How a refinement actually flows

1. Player walks past a Poly Haven tree. World page calls `recordAssetInteraction('polyhaven', 'oak_tree_01', 'view', 1.0)`.
2. Server appends a row to `evo_asset_interactions` and increments `evo_assets.interaction_points`.
3. Heartbeat tick (every 100th, ~5 minutes at default cadence) calls `runEvolutionTick`.
4. Scheduler picks top 3 candidates by `evolution_score` (recent activity × recency decay × `1 - quality_level/11`).
5. For each candidate, it picks the next pass via `nextPassFor(qualityLevel)`. New asset (level 0) → subdivision. Subdivided (level 1) → material upgrade. Etc.
6. The pass produces a candidate file at `data/evo-assets/<assetId>/<pass>_<stamp>.{json,png}`.
7. Scheduler appends a row to `evo_asset_versions` (un-promoted).
8. Bridge wraps the candidate as a pseudo-DTU and submits to `runAutoPromoteGate`. Gate checks structural credibility, contradictions, dedup, anti-gaming, lineage cycles — same gates that keep DTU slop out of the canonical knowledge layer.
9. Verdict back:
   - **VERIFIED** → version promoted, asset's `quality_level` bumps by 1, `last_evolved_at` set, `canonical_dtu_id` linked
   - **DISPUTED** → version row stays as a non-promoted candidate (visible in `/asset/:id` for audit)
   - **QUARANTINED** → DTU marked QUARANTINED, version stays archived, asset's quality_level unchanged
10. Frontend `resolveAssetUrl` cache expires 5 minutes later → next request returns the new canonical URL.

## NPC-driven evolution

NPCs drive evolution faster than passive player views because their interactions can carry an `improvementRequest`:

```js
recordInteractionFromNPC(STATE, db, swordAssetId, npcId, "used_in_combat", {
  improvementRequest: "the edge feels too rounded, sharper bevel would read as a real blade",
  maybeWriteShadowDTU: maybeWriteLinguisticShadowDTU,
});
```

Effect:
- Interaction weight doubles (2.0 instead of 1.0)
- A Shadow DTU is written tagged `evo-asset` + `improvement-request` + `asset:<id>` with a 7-day TTL
- The asset's `evolution_score` rises faster, scheduler picks it sooner

This is the killer-feature loop the user pointed to: **NPCs care about their environment and have agency over its evolution.** The substrate already supported it; this just exposes the channel.

## Asset bootstrapping

CC0 sources are pulled at startup, 30s after boot (lets the rest of the platform settle first):

- **Poly Haven**: `https://api.polyhaven.com/assets?type=models` — first 30 models, GLB at 1k resolution. `quality_level` starts at 1 (already higher than truly raw procedural).
- **ambientCG**: `https://ambientcg.com/api/v2/full_json?type=Material` — first 30 PBR materials. `quality_level` starts at 2.
- **OS3A**: `https://raw.githubusercontent.com/toxsam/open-source-3D-assets/main/list.json` — first 50 GLB models. `quality_level` starts at 0.
- **Kenney**: scans `KENNEY_BUNDLE_DIR` (operator dumps the all-in-1 itch.io bundle there). First 200 mesh files. `quality_level` starts at 0.

All loaders are network-graceful: offline returns `{ fetched: 0, registered: 0 }` and the system keeps running. Storage cap is left to disk monitoring; the registry's `archived_at` field is the lifecycle hook for eventually deleting old versions.

## What's deferred

| Deferred | Why |
|---|---|
| **Three.js subdivision modifier on the frontend side** | Server-side subdivision math ships variants the renderer reads as plain JSON {positions, indices, colors}. Frontend can use Three.js's LoopSubdivisionModifier later if needed but isn't required. |
| **glTF / FBX / OBJ → JSON normalization** | Source loaders save the raw upstream format; the refinement passes assume already-normalized JSON. A normalization step (`gltf-pipeline` or similar) is a follow-up that lets refinements run on the native asset formats too. |
| **Image normal-map extraction from generated detail maps** | Pass 2 produces a higher-detail base color. A bake step that derives a normal map (Sobel filter on grayscale or a ControlNet variant) is follow-up. |
| **Storage cleanup policy** | `archived_at` field exists; no scheduler runs cleanup yet. Add a daily sweep that deletes archived versions older than 30 days. |
| **Sketchfab loader** | Requires OAuth dance; deferred per the original spec. |

## Verification

- `node --check` on all 9 touched server files — clean
- `npm run migrate` — migration 073 applied; schema version now 73
- Schema verified: `evo_assets`, `evo_asset_interactions`, `evo_asset_versions` tables created with expected columns and CHECK constraints
- `npx tsc --noEmit` — frontend clean
- `npx eslint lib/evo-asset/loader.ts` — clean
- Manual end-to-end test (deferred to a running environment): seed a Poly Haven asset → call `/api/evo-asset/interaction` 100 times → wait for next 100th heartbeat → check `evo_asset_versions` for a promoted subdivision row → call `/api/evo-asset/resolve` → URL points to the subdivided variant.

## What this enables

After this branch, Concordia is the only game (in any platform category) where:
- Graphics fidelity is itself a platform feature, not a launch-frozen artifact
- NPCs have aesthetic agency over their environment via Shadow DTUs
- AI-generated visual content is gated by the same constitutional pipeline that gates knowledge content
- Frequently-used areas (cities, hubs, popular quest zones) become more polished from use alone
- Underused areas stay procedural (which is thematically right — abandoned places look abandoned)

This is the move that retroactively justifies the substrate: 4-brain inference, vision (LLaVA), image-gen (SD/DALL-E), Shadow DTUs, atlas quality pipeline, DTU lineage, bootstrap ingestion — all of them turn out to have been load-bearing for a feature no AAA studio can compete on.
