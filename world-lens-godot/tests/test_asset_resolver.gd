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
