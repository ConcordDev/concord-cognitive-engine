class_name TestAssetResolver
extends RefCounted
## Pure-logic tests for assets/asset_resolver.gd#fallback_url — pins the
## kind "player"/"npc" special-case onto the REAL hero-mesh convention the
## Three.js client already uses and ships files for
## (concord-frontend/lib/concordia/hero-mesh-registry.ts), distinct from
## the building convention's `{base}/models/{kind}/{id}.glb` (which has no
## player/npc files on disk).

const AssetResolver := preload("res://assets/asset_resolver.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_building_kind_uses_the_models_convention(t)
	_test_player_kind_with_no_world_id_uses_the_universal_archetype(t)
	_test_player_kind_with_world_id_uses_the_per_world_variant(t)
	_test_npc_kind_follows_the_same_convention_as_player(t)
	_test_id_is_ignored_for_player_and_npc_kinds(t)
	_test_explicit_archetype_selects_its_own_mesh_file(t)
	_test_unknown_archetype_falls_back_to_warrior(t)
	_test_weapon_url_for_warrior(t)
	_test_weapon_url_for_legend_is_greatsword(t)
	_test_weapon_url_for_scholar_is_empty_not_fabricated(t)
	_test_weapon_url_for_unknown_archetype_is_empty(t)
	_test_undead_archetypes_resolve_to_their_own_mesh(t)
	_test_lich_carries_the_staff_weapon(t)
	_test_other_undead_archetypes_carry_no_weapon(t)
	_test_building_kind_with_world_id_prefers_the_per_world_variant(t)
	_test_building_kind_with_no_world_id_uses_the_universal_convention(t)
	_test_building_kind_with_empty_world_id_matches_no_world_id(t)
	_test_hub_kind_uses_the_models_convention(t)
	return t


static func _test_building_kind_uses_the_models_convention(t: TestUtils) -> void:
	t.check_eq(
		AssetResolver.fallback_url("http://host:3000", "building", "tavern"),
		"http://host:3000/models/building/tavern.glb",
		"building kind is untouched by the player/npc special-case")


static func _test_player_kind_with_no_world_id_uses_the_universal_archetype(t: TestUtils) -> void:
	t.check_eq(
		AssetResolver.fallback_url("http://host:3000", "player", "user-123"),
		"http://host:3000/meshes/heroes/_archetype_warrior.glb",
		"blank world_id falls to the universal warrior archetype file")


static func _test_player_kind_with_world_id_uses_the_per_world_variant(t: TestUtils) -> void:
	t.check_eq(
		AssetResolver.fallback_url("http://host:3000", "player", "user-123", "concordia-hub"),
		"http://host:3000/meshes/heroes/_archetype_warrior__concordia-hub.glb",
		"a non-empty world_id prefers that world's palette variant")


static func _test_npc_kind_follows_the_same_convention_as_player(t: TestUtils) -> void:
	t.check_eq(
		AssetResolver.fallback_url("http://host:3000", "npc", "npc-42", "fantasy"),
		"http://host:3000/meshes/heroes/_archetype_warrior__fantasy.glb",
		"npc kind shares the same hero-mesh convention as player")


static func _test_id_is_ignored_for_player_and_npc_kinds(t: TestUtils) -> void:
	var a := AssetResolver.fallback_url("http://host:3000", "player", "aaa")
	var b := AssetResolver.fallback_url("http://host:3000", "player", "bbb")
	t.check_eq(a, b, "id has no bearing on the resolved URL for player/npc (no per-user rig exists)")


static func _test_explicit_archetype_selects_its_own_mesh_file(t: TestUtils) -> void:
	t.check_eq(
		AssetResolver.fallback_url("http://host:3000", "player", "user-123", "", "mystic"),
		"http://host:3000/meshes/heroes/_archetype_mystic.glb",
		"a real archetype other than warrior resolves to its own mesh file")


static func _test_unknown_archetype_falls_back_to_warrior(t: TestUtils) -> void:
	t.check_eq(
		AssetResolver.fallback_url("http://host:3000", "player", "user-123", "", "not-a-real-archetype"),
		"http://host:3000/meshes/heroes/_archetype_warrior.glb",
		"an unrecognised archetype string falls to the honest warrior default, never a guaranteed-404 URL")


static func _test_weapon_url_for_warrior(t: TestUtils) -> void:
	t.check_eq(
		AssetResolver.weapon_url_for_archetype("http://host:3000", "warrior"),
		"http://host:3000/models/weapon/longsword.glb",
		"warrior resolves to the real longsword GLB")


static func _test_weapon_url_for_legend_is_greatsword(t: TestUtils) -> void:
	t.check_eq(
		AssetResolver.weapon_url_for_archetype("http://host:3000", "legend"),
		"http://host:3000/models/weapon/greatsword.glb",
		"legend resolves to greatsword, matching enhanced-avatar-builder.ts's one explicit archetype-conditioned weapon rule")


static func _test_weapon_url_for_scholar_is_empty_not_fabricated(t: TestUtils) -> void:
	t.check_eq(
		AssetResolver.weapon_url_for_archetype("http://host:3000", "scholar"),
		"",
		"scholar carries no real weapon GLB — empty is the honest answer, not a fabricated blade")


static func _test_weapon_url_for_unknown_archetype_is_empty(t: TestUtils) -> void:
	t.check_eq(
		AssetResolver.weapon_url_for_archetype("http://host:3000", "not-a-real-archetype"),
		"",
		"an archetype with no table entry resolves to no weapon, not a guess")


## Undead archetypes (2026-08-08) — pins that they resolve to their OWN
## mesh file, not silently falling back to "warrior" the way a genuinely
## unrecognised string does (the failure mode this section exists to catch:
## fallback_url's `arch` validity check reads ARCHETYPE_WEAPON, so an
## archetype missing from that table — even with a real body-mesh file on
## disk — would incorrectly fall back).
static func _test_undead_archetypes_resolve_to_their_own_mesh(t: TestUtils) -> void:
	t.check_eq(
		AssetResolver.fallback_url("http://host:3000", "npc", "npc-1", "", "wraith"),
		"http://host:3000/meshes/heroes/_archetype_wraith.glb",
		"wraith resolves to its own real mesh, not the warrior fallback")
	t.check_eq(
		AssetResolver.fallback_url("http://host:3000", "npc", "npc-2", "", "zombie"),
		"http://host:3000/meshes/heroes/_archetype_zombie.glb",
		"zombie resolves to its own real mesh")
	t.check_eq(
		AssetResolver.fallback_url("http://host:3000", "npc", "npc-3", "", "lich"),
		"http://host:3000/meshes/heroes/_archetype_lich.glb",
		"lich resolves to its own real mesh")
	t.check_eq(
		AssetResolver.fallback_url("http://host:3000", "npc", "npc-4", "", "undead"),
		"http://host:3000/meshes/heroes/_archetype_undead.glb",
		"undead resolves to its own real mesh")


static func _test_lich_carries_the_staff_weapon(t: TestUtils) -> void:
	t.check_eq(
		AssetResolver.weapon_url_for_archetype("http://host:3000", "lich"),
		"http://host:3000/models/weapon/staff.glb",
		"lich (a spellcaster boss) reuses the already-wired real staff asset")


static func _test_other_undead_archetypes_carry_no_weapon(t: TestUtils) -> void:
	t.check_eq(AssetResolver.weapon_url_for_archetype("http://host:3000", "undead"), "", "undead carries no weapon — an honest scope boundary, not an oversight")
	t.check_eq(AssetResolver.weapon_url_for_archetype("http://host:3000", "zombie"), "", "zombie carries no weapon")
	t.check_eq(AssetResolver.weapon_url_for_archetype("http://host:3000", "wraith"), "", "wraith carries no weapon")


## Building per-world variant (2026-08-08) — pins that fallback_url's
## "building" branch prefers `{id}__{world_id}.glb` whenever a world_id is
## given, matching the player/npc convention's own per-world preference.
## The retry-to-universal-on-404 behavior lives in scene_bootstrap.gd (a
## real network round trip, not a pure function) — see that file's own
## comment and tools/glb_load_probe.gd for the real-engine proof.
static func _test_building_kind_with_world_id_prefers_the_per_world_variant(t: TestUtils) -> void:
	t.check_eq(
		AssetResolver.fallback_url("http://host:3000", "building", "market", "crime"),
		"http://host:3000/models/building/market__crime.glb",
		"a building kind with a world_id prefers that world's variant filename")


static func _test_building_kind_with_no_world_id_uses_the_universal_convention(t: TestUtils) -> void:
	t.check_eq(
		AssetResolver.fallback_url("http://host:3000", "building", "market"),
		"http://host:3000/models/building/market.glb",
		"a building kind with no world_id falls to the pre-existing universal convention, unchanged")


static func _test_building_kind_with_empty_world_id_matches_no_world_id(t: TestUtils) -> void:
	t.check_eq(
		AssetResolver.fallback_url("http://host:3000", "building", "market", ""),
		AssetResolver.fallback_url("http://host:3000", "building", "market"),
		"an explicit empty-string world_id is equivalent to omitting it — scene_bootstrap.gd's per-world/universal equality check relies on this")


static func _test_hub_kind_uses_the_models_convention(t: TestUtils) -> void:
	t.check_eq(
		AssetResolver.fallback_url("http://host:3000", "hub", "tree_oak"),
		"http://host:3000/models/hub/tree_oak.glb",
		"Unburned Court hub kit is the generic models/{kind}/{id} path — no special-case needed")
