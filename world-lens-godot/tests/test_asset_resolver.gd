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
