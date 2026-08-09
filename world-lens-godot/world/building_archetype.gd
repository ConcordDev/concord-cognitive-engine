class_name BuildingArchetype
extends RefCounted
## BuildingArchetype — building_type -> archetype lookup, ported from the
## Three.js client's source-of-truth table
## (`concord-frontend/lib/world-lens/building-silhouette.ts#SILHOUETTE`).
##
## This is a PARTIAL, HONEST port: it carries the same building_type -> archetype
## assignments as the TS table (so a "tavern" in Godot means the same thing a
## "tavern" means in the browser client), but drops the `feature` field
## (dome/spire/colonnade/belfry compositing — `addIconicFeature` has no Godot
## equivalent yet) and is a hand-copied duplicate, not a shared source — it CAN
## drift if the TS table changes and nobody updates this file. Treat the TS file
## as canonical; this exists only so Godot can pick the right REAL GLB
## (see `concord-frontend/public/models/building/*.glb`) instead of a box.
##
## Real building meshes exist today for all 5 archetype values: market,
## tavern, archive, forge, tower (`has_real_mesh`) — every building_type this
## table can resolve to now gets a real GLB instead of the placeholder box.
##
## forge/tower history (kept for context — both eventually closed):
## 2026-08-08, first attempt: exhaustively searched the trusted Polygonal
## Mind CC0 source (17 sub-collections, via the ToxSam open-source-3D-assets
## registry — the source market/tavern/archive came from) for forge/
## furnace/smith/anvil/kiln/workshop/foundry-named assets; none exist. Its
## `towers` sub-collection turned out to be surreal sci-fi monuments
## (BlockChain/Colony/MemeFactory-prefixed) with either incomplete modular
## base pieces or thematically-mismatched complete assemblies (a UFO-over-
## a-floating-island "Colony_Tower_Art") — neither an honest fit. Also
## checked KayKit-Dungeon-Remastered-1.0 (used for weapons): a modular
## dungeon-prop kit with no standalone building of any kind. Closed as a
## genuine gap that session, not shipped.
##
## 2026-08-08, later same day: a DIFFERENT KayKit source closed both.
## `KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0` (CC0, Kay
## Lousberg) ships `building_blacksmith_<color>.gltf` and
## `building_tower_A_<color>.gltf` — real, complete, grounded medieval
## buildings (a stone furnace with a lit hearth and an anvil-adjacent
## lean-to for the blacksmith; a round windowed stone tower with a conical
## roof for the tower), verified by loading both in a real Godot instance
## and inspecting the actual screenshot, not by filename. The `blue` color
## variant was used (the pack ships 4 team-color palettes; no neutral
## variant exists for these two building types specifically, only for
## terrain/wall/bridge pieces) — re-packed into self-contained `.glb` via
## `gltf-transform copy`, same technique this project's other re-packed
## CC0 assets use. See `concord-frontend/public/models/CREDITS.md` for full
## attribution and VISUAL_QA.md for the verification record (both search
## passes).

## Per-world building variants (2026-08-08) — `assets/asset_resolver.gd`'s
## `fallback_url` now also special-cases `kind == "building"` with a
## non-empty `world_id`, preferring `{archetype}__{world_id}.glb` before
## the universal `{archetype}.glb` — the same convention player/npc hero
## meshes already use, extended to buildings. `world/scene_bootstrap.gd`'s
## `_start_loading_archetype` does the real two-stage retry (per-world,
## then universal, then placeholder) so a world with no authored variant
## for a given archetype is unaffected — only `market` in the `crime`
## world has a real per-world file today
## (`concord-frontend/public/models/building/market__crime.glb`, a real
## grounded modern storefront from KayKit-City-Builder-Bits-1.0, CC0 —
## crime's own authored lore controls literal "dockside_warehouses"/
## "abandoned_subway_lines" districts, a much better fit than the
## universal Polygonal Mind market stall). See CREDITS.md +
## docs/KAYKIT_INVENTORY.md for the sourcing record and the other
## strongly-lore-matched candidates queued for the same mechanism
## (concord-link-frontier + Space-Base-Bits' cargo/landing infrastructure;
## sovereign-ruins + Halloween-Bits' grave/crypt/memorial set).

const DEFAULT_ARCHETYPE := "market"

const REAL_MESH_ARCHETYPES := ["market", "tavern", "archive", "forge", "tower"]

const TABLE := {
	# Core seed city
	"inn": "tavern", "tavern": "tavern", "house": "tavern",
	"market": "market", "warehouse": "market", "well": "market",
	"forge": "forge", "mine": "forge",
	"tower": "tower",
	"dock": "market", "farm": "tavern",
	# Civic & governance
	"courthouse": "archive", "assembly_hall": "archive", "council_chamber": "archive",
	"ethics_hall": "archive", "watch_house": "tower",
	# Knowledge & science
	"cartographer_table": "tower", "observatory": "tower", "code_terminal": "tower",
	"laboratory": "forge", "archive_hall": "archive", "physics_hall": "archive",
	"calcularium": "archive", "philosophy_porch": "archive",
	# Commerce & economy
	"trading_floor": "market", "ledger_desk": "archive", "bank_house": "archive",
	"auction_house": "market",
	# Arts & creative
	"music_booth": "tavern", "atelier": "tavern", "writers_room": "tavern",
	"gallery_hall": "archive",
	# Craft & industry
	"workshop": "forge", "engineers_hall": "forge", "mill": "forge",
	"depot": "market", "powerhouse": "forge", "site_office": "market",
	# Care & wellbeing
	"clinic": "archive", "sanctuary": "archive", "counsel_room": "tavern",
	"gymnasium": "market",
	# Communication & social
	"post_office": "market", "forum_hall": "archive", "newsroom": "market",
	"agora": "archive",
	# Learning
	"schoolhouse": "tavern", "academy": "archive",
	# Nature & world
	"grange": "tavern", "foresters_lodge": "tavern", "mineshaft": "forge",
	"tide_station": "market", "survey_camp": "tavern",
}


## Resolve a building_type to its archetype string. Unmapped/empty ->
## DEFAULT_ARCHETYPE ("market"), matching the TS table's DEFAULT exactly.
static func archetype_for_type(building_type: String) -> String:
	if building_type == "":
		return DEFAULT_ARCHETYPE
	return TABLE.get(building_type, DEFAULT_ARCHETYPE)


## True when a real (non-placeholder) GLB exists for this archetype today.
static func has_real_mesh(archetype: String) -> bool:
	return REAL_MESH_ARCHETYPES.has(archetype)
