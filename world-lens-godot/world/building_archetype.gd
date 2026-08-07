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
## Real building meshes exist today for exactly 3 of the archetype's 5 values:
## market, tavern, archive (`has_real_mesh`). A building_type that resolves to
## "forge" or "tower" — or any building_type not covered by this port —
## resolves to a real archetype string same as the TS table (unmapped ->
## "market", the TS DEFAULT), so most unmapped types DO get a real mesh; only
## the genuinely forge/tower-mapped subset has no real Godot mesh yet and
## stays on the placeholder box (`scene_bootstrap.gd`'s existing, honest
## fallback — never fabricated).

const DEFAULT_ARCHETYPE := "market"

const REAL_MESH_ARCHETYPES := ["market", "tavern", "archive"]

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
