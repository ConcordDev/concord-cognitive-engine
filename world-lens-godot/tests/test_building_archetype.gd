class_name TestBuildingArchetype
extends RefCounted
## Pure-logic tests for world/building_archetype.gd — pins the ported
## subset against the Three.js source-of-truth table
## (concord-frontend/lib/world-lens/building-silhouette.ts) so a future
## edit to either file that breaks parity is caught here, not discovered
## live in a scene.

const BuildingArchetype := preload("res://world/building_archetype.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_known_mappings_match_the_ts_table(t)
	_test_unmapped_type_falls_back_to_default(t)
	_test_empty_type_falls_back_to_default(t)
	_test_has_real_mesh_true_for_market_tavern_archive_only(t)
	return t


static func _test_known_mappings_match_the_ts_table(t: TestUtils) -> void:
	t.check_eq(BuildingArchetype.archetype_for_type("tavern"), "tavern", "tavern -> tavern")
	t.check_eq(BuildingArchetype.archetype_for_type("inn"), "tavern", "inn -> tavern")
	t.check_eq(BuildingArchetype.archetype_for_type("market"), "market", "market -> market")
	t.check_eq(BuildingArchetype.archetype_for_type("warehouse"), "market", "warehouse -> market")
	t.check_eq(BuildingArchetype.archetype_for_type("courthouse"), "archive", "courthouse -> archive")
	t.check_eq(BuildingArchetype.archetype_for_type("archive_hall"), "archive", "archive_hall -> archive")
	t.check_eq(BuildingArchetype.archetype_for_type("forge"), "forge", "forge -> forge")
	t.check_eq(BuildingArchetype.archetype_for_type("tower"), "tower", "tower -> tower")
	t.check_eq(BuildingArchetype.archetype_for_type("observatory"), "tower", "observatory -> tower")


static func _test_unmapped_type_falls_back_to_default(t: TestUtils) -> void:
	t.check_eq(
		BuildingArchetype.archetype_for_type("some_unknown_future_building_type"),
		"market",
		"unmapped type falls back to DEFAULT_ARCHETYPE (market), matching the TS DEFAULT")


static func _test_empty_type_falls_back_to_default(t: TestUtils) -> void:
	t.check_eq(BuildingArchetype.archetype_for_type(""), "market", "empty type falls back to market")


static func _test_has_real_mesh_true_for_market_tavern_archive_only(t: TestUtils) -> void:
	t.check(BuildingArchetype.has_real_mesh("market"), "market has a real mesh")
	t.check(BuildingArchetype.has_real_mesh("tavern"), "tavern has a real mesh")
	t.check(BuildingArchetype.has_real_mesh("archive"), "archive has a real mesh")
	t.check(not BuildingArchetype.has_real_mesh("forge"), "forge has NO real mesh (verified absent across the whole trusted CC0 source; honest fallback stays a box)")
	t.check(not BuildingArchetype.has_real_mesh("tower"), "tower has NO real mesh (2026-08-08: real candidates exist but are either incomplete modular pieces or thematically-mismatched sci-fi assemblies; shipping either would violate honest-labeling discipline — see VISUAL_QA.md)")
