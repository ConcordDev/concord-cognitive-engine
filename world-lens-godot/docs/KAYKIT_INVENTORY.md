# KayKit-Game-Assets — full inventory (2026-08-08)

## Status update — later same day: 2 more worlds wired, evo-asset registered

Per follow-up instruction to wire the two queued candidates and check the
existing content for more world/asset fits: both are now real and
verified, using the exact per-world building mechanism this doc's earlier
version proposed:
- **`sovereign-ruins`'s `archive` archetype** → `crypt.glb` from
  `KayKit-Halloween-Bits-1.0` (a real stone mausoleum/crypt facade,
  screenshot-verified — columns, dark doorway, funerary stonework), a
  direct fit for the "Sovereign Archive"/"collapse memorial" lore.
- **`concord-link-frontier`'s `tavern` archetype** → `basemodule_A.glb`
  from `KayKit-Space-Base-Bits-1.0` (a small dome-shaped waypoint module
  with a landing ramp, screenshot-verified), fitting "courier
  safehouses"/"link posts" better than the pack's larger industrial
  cargo-depot pieces, which were also screenshotted and considered.

**All 9 real assets sourced this session are now registered in the
evo-asset procedural pipeline** (`content/evo-seed/world-lens-manifest.json`
→ `server/lib/evo-asset/source-loaders.js#bootstrapWorldLensAssets`) —
forge/tower/market__crime/archive__sovereign-ruins/
tavern__concord-link-frontier + the 4 undead hero archetypes. This is the
real, already-existing "procedural asset engine" — `server/lib/evo-asset/
refinement-passes.js` runs real geometry subdivision, procedural wear
(age/interaction-density-driven), material upgrades, and LOD generation
against whatever's registered here, scheduled by `scheduler.js#
runEvolutionTick`. Registering these assets gives that scheduler real
material to run those passes against, instead of only the 3 CC0
primitive-placeholder seed meshes. Pinned by 2 new tests + updated counts
in `server/tests/integration/evo-asset-world-lens-seed.test.js` (14/14
green, up from 12 pre-existing).

All 10 repositories under the `KayKit-Game-Assets` GitHub org were cloned
this session (`git clone`, not `curl` — reaches public GitHub repos even
though this environment's general HTTPS egress policy blocks
kenney.nl/itch.io/opengameart.org/etc.), and every pack's own `LICENSE.txt`
was read directly (never assumed from a search summary): **all 10 are CC0**
("free to use in personal, educational and commercial projects", Kay
Lousberg / kaylousberg.com, attribution not mandatory).

Two packs are already wired into Concordia (see
`concord-frontend/public/models/CREDITS.md` for the per-file detail):
- **`KayKit-Character-Pack-Adventures-1.0`** — 11 melee/carry weapon
  meshes (`weapon/{staff,wand,dagger,shortsword,longsword,greatsword,axe,
  halberd,crossbow}.glb`) + the `dungeon`-adjacent... — sourced across an
  earlier session for `weapon-archetypes.ts`.
- **`KayKit-Medieval-Hexagon-Pack-1.0`** — `building/{forge,tower}.glb`,
  sourced and wired this session (commit `558c3aa4`).
- **`KayKit-Dungeon-Remastered-1.0`** — checked (a modular dungeon-prop
  kit, no standalone buildings), not used for buildings; not yet checked
  for anything else.

This doc inventories the remaining **7 unwired packs** so a future session
doesn't need to re-clone or re-verify licenses — just re-clone the repo
(fast, public, CC0) and go straight to wiring.

## Why these 7 aren't drop-in the way forge/tower was

`forge`/`tower` had a rare, ideal shape: a real, already-existing table
(`BuildingArchetype.REAL_MESH_ARCHETYPES`) with a proven one-mesh-per-slot
resolution convention, exactly two named slots sitting empty. Every
`asset-loader.ts`/`asset_resolver.gd` convention in this codebase resolves
to **exactly one file per (kind, id)** — there's no "pick one of several"
mechanism for buildings, and no real-GLB consumer wired at all yet for
`vehicle`/`prop` (both real, declared `AssetKind` values in
`asset-loader.ts` with zero real files behind them — `vehicle-renderer.ts`
exists but has no GLB resolution call in it today, confirmed by grep).
So landing these packs' content usefully needs one of:
(a) a small building-variety picker (deterministic hash-pick among N real
meshes per archetype, mirroring the seeded-pick pattern
`vegetation-scatter.js`/`creature-renderer.ts` already use), or
(b) wiring a real GLB path into an existing-but-unused `AssetKind` slot
(`vehicle`, `prop`), or
(c) a genuinely new visual archetype with no existing home (e.g. an
undead/hostile-NPC variant — `hero-mesh-registry.ts` has no
skeleton/undead slot today).

None of these are done this pass — flagging the decision rather than
guessing at 3-4 new subsystems' worth of design blind, especially after
this session's own City-Builder-Bits check just showed why guessing by
name/category is risky (see below).

## Per-pack inventory

### `KayKit-City-Builder-Bits-1.0` — 41 gltf, **thematically MODERN, not medieval**
Checked, not by filename alone: contains `trafficlight_A`, `car_taxi`,
`car_police`, `car_sedan`, `car_hatchback`, `car_stationwagon` alongside
`building_A`..`building_H` (each with a `_withoutBase` modular variant),
`bench`, `bush`, `box_A/B`. This is a **contemporary city pack** (traffic
lights, taxis, police cars) — the wrong art direction for Concordia's
grounded medieval-fantasy buildings (would repeat the exact mismatch this
session's own forge/tower search correctly avoided with the sci-fi
`Colony_Tower_Art` candidate). Real candidate use: if Concordia ever adds a
**modern/cyber sub-world street scene** (the `cyber` sub-world already
exists in `content/world/`), these buildings + cars could be a genuine fit
for THAT world's architecture — not for the medieval `concordia-hub`
buildings. Not wired.

### `KayKit-Furniture-Bits-1.0` — 53 gltf, real interior furniture
Beds (single/double, 2 styles each), chairs (3 styles + wood variants),
couches, cabinets, bookshelves + books, plus desert-flavored cacti props.
Grounded, could plausibly fit the medieval/fantasy palette (needs a visual
check, not assumed). `interior-decor.ts` exists but is **100% procedural**
today — canvas-texture-driven, no GLB-loading call in it at all (confirmed
by grep: no `resolveAssetReference`/`loadAsset` reference in that file).
Wiring real furniture means either extending `interior-decor.ts` with a
real-mesh-first path (mirroring `resource-node-renderer.ts`'s "real GLB
first, procedural fallback" pattern) or building a new placement renderer
for `building_rooms.furniture_layout_json` (the per-coord JSON substrate
mentioned in CLAUDE.md's Belonging-sprint invariants — houses already have
real furniture *placement* data, just no real furniture *mesh* rendering
yet). Not wired.

### `KayKit-Restaurant-Bits-1.0` — 144 gltf, the single largest pack
Full kitchen build-out: crates (8 named ingredients — buns/carrots/cheese/
ham/lettuce/onions/potatoes/steak/tomatoes), cookware, dishracks, doors,
kitchen flooring, extractor hoods, and (per the earlier partial listing)
almost certainly counters/stoves/plating stations beyond what was scanned.
Directly matches CLAUDE.md's documented Diner-Dash-style restaurant
mechanic (`RestaurantDashboard.tsx`, tip-timing constants
`TIP_FRACTION_FAST`/`TIP_FRACTION_OK`). Whether that system has ANY 3D
interior rendering today (vs. being a flat 2D/HUD minigame) was not
checked this pass — if it's 2D-only, these assets would need a new 3D
interior-rendering surface to matter, not just a mesh drop-in. Not wired.

### `KayKit-Prototype-Bits-1.0` — 72 gltf, generic props
Barrels, boxes, cans, coins, crates, doors, floor variants, pallets — a
generic "worldbuilding prop kit," genre-neutral by design (this is Kay
Lousberg's own stated purpose for a "prototype" pack — blockout geometry
meant to be genre-agnostic). Lower priority than the themed packs since
nothing in Concordia specifically needs generic blockout props; still
real, real CC0, could round out world dressing (crates/barrels near
market stalls, etc.) if wired the same variety-picker way as buildings.
Not wired.

### `KayKit-Halloween-Bits-1.0` — 63 gltf, graveyard/horror set
Graves, coffins (plain + decorated), a crypt, bone piles, candles (4
variants), broken/intact fences and gates, dirt-grave floor tiles, an
arch/gate. Real potential fit: the asymmetric-horror substrate
(`horror.js`, ghost/investigator sessions, `EVIDENCE_TO_WIN` mechanic
documented in CLAUDE.md) currently has **zero described visual asset
work** — this pack could plausibly furnish that mode's setting for real
instead of leaving it a bare/procedural space, but that mode's actual
rendering surface (does it even have a distinct 3D scene today?) wasn't
checked this pass. Also a plausible fit for the `sere`/`sovereign-ruins`
sub-worlds' tone (unverified — not checked against those worlds' actual
authored aesthetic). Not wired.

### `KayKit-Space-Base-Bits-1.0` — 57 gltf, sci-fi
Base modules (5 variants + a garage), cargo containers (2 styles ×
packed/stacked variants), cargo depots, drill structures, landers,
landing pads (large/small). Real candidate fit: the `cyber` sub-world
(same reasoning as City-Builder-Bits above) — genuinely sci-fi-themed
content, wrong for the medieval core but a plausible match for a
specifically sci-fi destination. Not wired.

### `KayKit-Character-Pack-Skeletons-1.0` — 4 real character bodies + 13 weapon/prop items
`Characters/gltf/{Skeleton_Warrior,Skeleton_Mage,Skeleton_Rogue,
Skeleton_Minion}.glb` — real, complete, rigged undead character meshes,
each ~the same production quality as the Adventurers pack's Barbarian/
Knight/Mage/Rogue bodies (not yet verified in a real render this pass —
unlike forge/tower, these were NOT screenshot-checked before this doc was
written; treat as "downloaded and license-clean" not "visually verified"
until that's done). Plus `Assets/gltf/Skeleton_{Arrow,Arrow_Broken,
Arrow_Broken_Half,Arrow_Half,Axe,Blade,Crossbow,Quiver,Shield_Large_A,
Shield_Large_B,Shield_Small_A,Shield_Small_B,Staff}.gltf` — skeleton-
themed weapon reskins. **No existing hero/NPC visual slot exists for
these** — `hero-mesh-registry.ts`/`asset_resolver.gd`'s archetype tables
are all living-humanoid-occupation-themed (warrior/scholar/trader/mystic/
hunter/legend/guard); there's no "undead"/"hostile"/"enemy" visual
archetype anywhere in the current system for these to slot into. Building
one is a real, scoped, plausible feature (an undead enemy visual variant
would materially help combat/horror content read as designed rather than
reusing friendly NPC skins for hostiles) but is a genuine new-feature
decision, not a same-pass asset drop. Not wired.

## Also checked, confirmed still genuinely absent
**`scimitar`** — the one remaining documented weapon gap in
`concord-frontend/public/models/CREDITS.md`'s Known Limitations — was
searched for across all 10 newly-cloned packs (`find . -iname
"*scimitar*"`, zero hits). Still procedural, still an honest gap; none of
these 10 packs close it.

## Where the clones live
All 10 repos remain cloned in this session's scratchpad
(`/tmp/claude-0/.../scratchpad/kaykit-all/`) for the remainder of this
session — not committed to the repo (per this project's established
discipline: source packs are re-packed into the specific convention-named
`.glb` slot that has a real consumer, never dumped in raw). A future
session picking this up should re-clone fresh rather than assume a stale
local copy still exists.
