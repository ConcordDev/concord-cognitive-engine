# Concordia Asset Studio — design → live-in-world creation pipeline (design doc)

> STATUS: **Increment 1 SHIPPED (2026-07-17)** — see the Increments section.
> The rest remains DESIGN DOC / vision + scoped increments.
> Captured 2026-07-17 at the owner's direction. This is a **growth track**,
> distinct from the WAVE4 honesty close-out — it adds a net-new capability
> rather than closing an existing gap.
>
> **Audit correction (2026-07-17, before Increment 1):** a three-agent
> code audit found the "loop is ~70% built" claim below was optimistic — the
> honest figure was **~40–50%**. Every *hard primitive* existed and worked (the
> authoritative world-spawn insert, the royalty cascade, the pure standalone
> building renderer, the license-tier model) — but they were **never wired to
> each other**: `whiteboard.publish-as-blueprint` only produced interior decor,
> the real `/api/world/buildings/spawn` route had no producer/caller/test, the
> royalty rail was disconnected from every asset-publish path, and `dtu.create`
> writes the in-memory `STATE.dtus` map (invisible to the SQL `dtus` table the
> spawn route reads). Increment 1's real job was the connective tissue, which is
> exactly what shipped. Details preserved below for the historical record.

## The thesis (why this is the strongest moat)

Let people **truly design games inside Concord** — assets, levels, concept
work, mechanics — and have that work go **live in Concordia** (the owned 3D
world), with the creator **paid via perpetual royalties** every time a
descendant of their work is **sold** (royalties fire on a downstream sale, never
on mere use — you get paid when the next person gets paid, halving per
generation, ≤30% of the sale split across the cascade). That is a *creation
flywheel*: a competitor can copy
features, but cannot copy the accumulated, compounding library of creator-made
assets — especially when the creators are paid to keep making and remixing
them. The pro tools in this space (Unity/Unreal marketplaces, Substance,
ArtStation, gated asset stores) are paywalled and disjoint from the game
they feed. Concord's differentiator is that **the design tool, the storefront,
the live game, and the payout rail are one platform** — and creations reflect
live in the world.

The owner's framing: *imagine Bethesda built a platform where Skyrim is a
native "world," and creators designed upgrades/assets in the same platform
that builds the game, and their work reflected live in Skyrim.* That analogy
works precisely because Bethesda **owns the engine**. Concord has the same
relationship to **Concordia** — so the loop is genuinely real *there*, with no
third-party mod-API dependency. (Feeding a *third-party* game like real Skyrim
would require that game's mod API/engine integration — genuinely external, out
of scope; Concordia is the owned surface where the loop closes today.)

## What already exists (the loop is ~70% built — cite the real files)

This is not greenfield. The pipes are largely in place; the gap is authoring
UX + a clean creator-facing "publish → live" flow.

- **Design → blueprint → world spawn (already real):**
  `whiteboard.publish-as-blueprint` (`server/domains/whiteboard.js:1644`)
  registers a CRDT canvas design as an `evo_assets` row of kind `blueprint`
  (migration `202_evo_assets_blueprint_kind.js`), which
  `server/lib/gameplay-asset-bridge.js` instantiates into the world
  (`world_buildings`, migration `091`). A design already becomes a live world
  object today.
- **Evolving/fused asset substrate:** `server/lib/evo-asset/` (`registry.js`,
  `refinement-passes.js`, `quality-gate-bridge.js`) — assets that refine and
  fuse over time, with a quality gate. This is the "assets built on assets"
  engine the flywheel needs.
- **World-builder:** `server/lib/foundry/` (`compiler.js`, `rules.js`,
  `builder-extras.js`) — the Foundry compiles a worldspec into a playable
  world; the seed of level/scene design.
- **Creator economy / payout rail (already real):**
  `server/economy/royalty-cascade.js` — perpetual, cascading royalties that fire
  on a downstream **sale** of a descendant work (never on mere use; `registerCitation`
  records lineage on remix, `distributeRoyalties` pays on the descendant's sale —
  30% cap, halving per generation), plus the `rights-enforcement.js` license-tier
  model (download vs. usage/commercial/resale/source tiers) verified this session.
  This is the "creator gets paid when their asset is used or remixed" rail —
  already load-bearing.
- **3D renderers to make assets visible in-world:**
  `concord-frontend/lib/world-lens/` — `procedural-buildings.ts`,
  `creature-renderer.ts`, `crop-field-renderer.ts`, `building-silhouette.ts`,
  `attach-world-renderers.ts`. Assets render through Three.js today.
- **Real 2D drawing surface:** `concord-frontend/components/art/ArtCanvas.tsx`
  (real stroke system) — the honest home for concept art (NOT an image model).
- **The lens itself:** frontend `concord-frontend/app/lenses/game-design`,
  domain `server/domains/gamedesign.js` — the surface to build the studio into.
- **Substrate:** DTU knowledge fabric + marketplace + MCP agent-composability —
  every asset is already a first-class, pipeable, sellable DTU.

## The honest gaps (what's actually missing — no sugar-coating)

1. **No unified "asset studio" authoring UX** in the game-design lens. The
   pipes exist but there's no creator-facing surface that says "make an asset →
   preview it → publish it → it's live in Concordia → you earn on it."
2. **Raw 3D mesh/texture authoring is genuinely hard** (Blender/Substance-tier
   sculpting). This is NOT the day-one path. The tractable, on-brand path is
   **parametric/procedural asset design** (define an asset by real params →
   procedural geometry, exactly how the creature system already works) plus
   **composition of existing primitives/parts**. From-scratch mesh sculpting is
   a much later, much larger effort — name it honestly, don't pretend it's near.
3. **Concept art** must stay honest: the real `ArtCanvas` drawing tool, not a
   generated-image bluff (Concord deliberately doesn't fake images).
4. **Level design** needs a real scene/level editor UI on top of Foundry +
   the blueprint-spawn path.

## Architecture (the creator loop, end to end)

```
  game-design lens (Asset Studio UI)
        │  author a real asset (parametric params / composed primitives / a real drawing)
        ▼
  DTU + evo_asset row  (kind: blueprint / asset / level / concept)
        │  publish  (reuses whiteboard.publish-as-blueprint's proven path)
        ▼
  gameplay-asset-bridge → Concordia  (world_buildings / procedural renderers)
        │  the asset is now live + walkable in the owned 3D world
        ▼
  royalty-cascade  (creator paid when the asset is used / cited / remixed)
        │  rights-enforcement license tiers gate download vs. usage rights
        ▼
  evo-asset fusion / refinement  (others build on it → cascade repeats)  ← the flywheel
```

Every stage above except the **Asset Studio UI** and a couple of new asset
*kinds* already exists in the repo. The work is mostly surfacing + a real
authoring surface, not new substrate.

## Honesty invariants (specific to this track)

Same "honest by construction" law as the rest of Concord, applied here:
- **No fake asset previews.** An asset that can't render yet shows an honest
  "not renderable yet" state, never a stock/placeholder image passed off as the
  creation. (Mesh-unknown geometry returns null, per the robotics precedent.)
- **Every published asset is a real DTU** with real provenance — no phantom
  library items, no fabricated download counts, no invented "trending."
- **Parametric before sculpting.** Ship real parametric/composed authoring
  first; never ship a "3D modeler" that's actually a mockup.
- **Concept art is real strokes** (ArtCanvas), never a generated-image bluff.
- **Royalties are real ledger entries** through the existing cascade — a
  creator's earnings reflect actual use, not a fabricated number.

## Scoped increments (each independently shippable, verified like a WAVE4 unit)

1. **Increment 1 — Parametric building → live-in-Concordia + royalty-ready DTU.
   ✅ SHIPPED 2026-07-17** (commits `a42b44b3` Unit 3, `8624542a` Unit 1,
   `b4901a83` Unit 2, on branch `claude/handoff-verification-bwahm0`). A new
   "Asset Studio" tab (13th) in the game-design lens authors a **building** by
   real params — archetype (tavern/archive/forge/market/tower), width/height/
   depth in meters, iconic feature (dome/spire/colonnade/belfry), interior
   toggle — with a **live Three.js preview that calls the SAME pure
   `createBuilding()` the live world uses** and the identical
   `scale.set(w/10,h/8,d/8)` formula, so the preview is byte-faithful to what
   spawns (true WYSIWYG). Publish (`game-design.building-publish`) mints a
   **real creator-attributed blueprint DTU** (`owner_user_id`, `visibility=
   public`, `meta.type=blueprint`) and inserts a **live walkable
   `world_buildings` row** via the spawn route's own overlap-checked logic
   (migration 366 added nullable `archetype`/`feature` columns so the authored
   identity round-trips to `BuildingRenderer3D`), and a **cross-user remix
   registers a real `royalty_lineage` row** through the untouched
   `registerCitation` cascade. Honest failure states throughout (overlap,
   invalid input — the real reason reaches the UI). **Scope held honestly:**
   used the archetype vocabulary the renderer actually reads (not the dormant
   box-composite path); **colors/factionStyle deferred** (would preview a color
   the in-world mapping can't yet carry — a WYSIWYG lie); **paid marketplace
   listing deferred to Increment 4** — the asset is royalty-*eligible* and
   remix-lineage is real, but nothing implies it earns on sale yet; zero
   fabricated earnings/counts. **What this corrected vs. the original plan:**
   the loop did NOT reuse `publish-as-blueprint`/`evo_asset` (that path is
   decor-only + carries no creator column) — it mints a real SQL `dtus` row
   directly, because the spawn route reads the SQL `dtus` table while
   `dtu.create` writes only the in-memory `STATE.dtus` map. Verification: 14/14
   backend tests (real world row + creator-attributed DTU + real cross-user
   citation + honest zero-row rejections), 7/7 component tests, consolidated
   `tsc --noEmit` green, a cross-unit failure-field contract bug
   (`reason`→`error`) caught + fixed in orchestrator review. This is the
   proof-of-loop: design → live in the owned 3D world → creator-attributed,
   royalty-ready — genuinely closed end to end for the first time.
2. **Increment 2 — Level / scene design.** A real level editor on top of
   Foundry + blueprint-spawn: place authored assets into a scene, publish, and
   make it walkable in Concordia.
3. **Increment 3 — Concept board.** ArtCanvas-backed concept/design board
   attachable to an asset or level as its real design record (honest strokes).
4. **Increment 4 — Asset marketplace surface + license tiers.** Surface
   authored assets in the marketplace with the `rights-enforcement` tier model
   (download rights vs. purchased usage rights) — the same model the WAVE4
   marketplace-plugin unit uses.
5. **Increment 5 — Composition / remix (the flywheel).** Wire evo-asset fusion
   so creators build assets on others' assets, with royalties cascading up the
   lineage — the compounding moat, fully realized.

## Open decisions (for the owner, when this track starts)

- **Asset scope for Increment 1:** which asset class first — buildings/props
  (closest to the existing blueprint path) vs. creatures (closest to the
  procedural-creature system)? Buildings are the shortest path to a live loop.
- **Parametric vocabulary:** how expressive should the day-one parametric asset
  language be (a constrained template set vs. a freer composition grammar)?
- **Whether/when to invest in true mesh authoring** (the hard, large item) —
  or lean indefinitely on parametric + composition + imported user meshes.

## Relationship to current work

The WAVE4 honesty close-out (in progress, ~9 waves) is the **foundation** this
builds on: it's what guarantees every one of the 260 lenses — including
game-design — is honest and real, so an Asset Studio built on top isn't sitting
on fabricated substrate. Recommended sequencing: **finish the close-out, then
run Increment 1** as its own verified build (it's genuinely ~one wave of work
given the reuse). The owner has signaled additional vision beyond this;
capture those as sibling design docs as they're named.
