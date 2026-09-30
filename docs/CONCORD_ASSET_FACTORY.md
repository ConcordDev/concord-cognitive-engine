# Concord Asset Factory — plan (2026-09-24)

Where this came from: the owner ran a repo audit of Concordia plus research
on open-world production pipelines (procedural geography, 3D generation,
rigging, animation, foliage, biomes, VFX, audio) and proposed a
"Canon → Asset → Validation → Unity" factory sitting on the new A40 pipeline
(`docs/CONCORD_ORGANIC_ASSET_PIPELINE.md`). This doc is that plan, with every
load-bearing claim checked against the actual repo and the actual licenses
before anything gets built on top of it — three of the original claims didn't
hold, and are corrected below rather than carried forward silently.

## The thesis (agreed, unchanged)

Concord stays the authority. AI models don't decide what Concordia is — they
manufacture the physical representation of what Concord's canon/simulation
already says exists. A mine exists because geology → settlement economy →
miners → construction → faction ownership, not because a prompt said "mine."
The organic pipeline (bible → concept → mesh → LOD → registry → Unity) is the
first working slice of this; the griffin is the existence proof.

## What the audit got right (verified in the repo, 2026-09-24)

- **One elevation function.** `server/lib/terrain-deformation.js#baseElevation`
  → `renderedElevationAt` is the single source of truth (client has a
  hand-kept-in-sync copy — a real drift risk, not fixed by this plan).
  Deformations persist as relative deltas (migration `281_terrain_deformation.js`).
- **Real local hydrology.** `server/lib/terrain-water.js`: a deterministic
  cellular-automaton flow solver moves water to the lowest adjacent cell each
  tick, conserves total volume, pools in low ground. Pure-functional core,
  `node --test`-able. Driven by `emergent/water-flow-cycle.js`.
- **Settlements that populate themselves.** `server/lib/procgen-settlements.js`
  (`spawnSettlementForRegion`, `listSettlementNpcsForWorld`) ties population/
  occupation data to a spawned settlement.
- **UniRig fits the hardware.** MIT license, rigs animals (not just
  humanoids), predicts skinning weights, needs ≥8 GB VRAM — the A40 (46 GB)
  clears that easily.
- **ConKay is a real second pipeline** for the "must obey engineering
  constraints" class of asset (weapons, mechanisms), distinct from and
  complementary to the "must look like canon" organic pipeline.

## What the audit overstated — corrected

1. **Terrain is not canon-driven yet.** `baseElevation` is a fixed noise
   formula (a sine series), not derived from the world bible's geography
   (continents, mountain chains, kingdom shapes). A "World Builder" that
   reads canon and produces a heightmap is **new work**, not wiring-up.
2. **The hydrology is local, not river-scale.** `terrain-water.js` solves
   flow between adjacent cells (dig a ditch, it floods) — it has no concept
   of a drainage network, a river course, or a lake basin. World-scale rivers
   need a new generator (e.g. flow-accumulation over the heightmap) that
   *outputs into* the existing water-cell substrate, which can then simulate
   what that generator produces. The existing system is the runtime, not the
   author.
3. **"OpenX Clay" does not appear to exist** under that name. The closest
   matches researched are `CLAY-3D/OpenCLAY` (a 3D-asset generation research
   model, license unconfirmed) and `OpenX-Inc/flow` (a video pipeline,
   unrelated). Not adopted until a real link is found and audited.
4. **HY-Motion (Tencent) has the same license problem as Hunyuan3D-2.1**:
   the Tencent Hunyuan Community License excludes the EU, UK, and South
   Korea. Not safe for a global-release game without a legal call from the
   owner. MotionGPT's license has not yet been checked — do not use it
   either until it has.
5. **The pod runs TRELLIS v1 today, not TRELLIS.2.** TRELLIS.2 (the newer,
   higher-fidelity engine) is fully installed and switches on automatically
   the moment `facebook/dinov3-vitl16-pretrain-lvd1689m` access is approved
   (manual review by Meta, requested 2026-09-24). Until then every mesh is
   TRELLIS-image-large + DINOv2 (both unrestricted MIT/Apache-2.0) — proven
   working end-to-end on `mon_sunder_griffin` (209s, 39,944 raw tris).

## One change to the audit's own proposed order

The audit put validation last (Phase F). It goes **first**, inside Phase A,
not after. The basilisk concept (Sept 24) already proved why: the generator
made a beautiful, coherent image that violated two explicit canon
constraints ("hood as a single diamond" → literal gemstone; "no chicken
legs" → clawed legs anyway). A factory that generates at volume before it
can catch that is a factory for confidently-wrong assets. Concretely: no
automated batch mesh run without a human or an automated fidelity check
approving the concept first (see Phase A2 below) — this is already how the
monster batch runs, by hand, as of this session.

## Phase plan

### Phase A — finish what's proven (in progress)
- A1: 14 B4 monsters through the organic pipeline (concept → review → mesh →
  LOD → registry). Multi-seed concepts (3/id), reviewed against the bible's
  `silhouette_notes` before any mesh spend.
- A2: automate the fidelity check that A1 is currently doing by hand — a
  vision pass over the concept image against the bible's negative
  constraints ("no chicken legs" etc.) before a mesh is generated. This was
  G3 in `CONCORD_ORGANIC_ASSET_PIPELINE.md`; promoted here because Phase A
  isn't "done" without it.
- A3: UniRig on the pod → rig the griffin (or a monster) as proof. Turns a
  static mesh into an animatable one; directly unblocks gameplay per the
  owner's audit.

### Phase B — Environment Factory (new work, not started)
World bible → heightmap generator (continents/mountains/kingdom shapes) →
flow-accumulation river/lake generator feeding the existing water-cell
substrate → biome kits (terrain material + flora + fauna + weather + sky per
region, distributed by elevation/slope/moisture/proximity-to-water) →
vegetation (procedural placement + occasional TRELLIS hero trees, GPU
instancing in Unity for the rest).

### Phase C — Civilization Factory (new work, not started)
Settlement sim data (population/occupation/wealth/resources, already real in
`procgen-settlements.js`) → road network → parcels/districts → modular
building placement → NPC occupation of the result. AI used sparingly here:
concept/facade variants and hero buildings only; streets, parcels and
placement stay deterministic/procedural, per the audit's own
"don't over-AI this" framing, which is correct.

### Phase D — Character Factory (new work, not started)
NPC identity (world/kingdom/faction/occupation/wealth/culture, already real
in the society backend) → appearance spec → generated clothing/armor/props →
rig → animation → voice, so a generated NPC's look is derived from actual
simulation state, not random.

### Phase E — Presentation Factory (new work, not started)
Skill descriptors → a deterministic VFX *grammar* (not a fresh AI generation
per fireball) with the A40 used for textures/masks/flipbooks/material maps
only. Same principle for weather → atmosphere and for audio (SFX/music/VO
generation feeding Unity audio events, keyed to NPC identity/context — this
can stay API-backed and does not need to move to the pod first).

### Phase F — Universal QA (partially exists, needs closing)
Every asset — organic, environment, building, character, VFX — ends in one
gate: canon requirements → generated asset → validator (topology,
dimensions, limb count, orientation, skeleton, LOD, bounds, collision,
semantic checks against the bible) → promote/reject. The evo_assets registry
+ quality gate already do part of this for meshes; the semantic/canon layer
(A2) is the missing piece, generalized to every future generator.

## Status

Only Phase A is started. Nothing in B–F is built; they're the roadmap this
session's organic-pipeline work unlocked, written down so future sessions
don't have to re-derive the shape or re-fall for the same three corrections.
