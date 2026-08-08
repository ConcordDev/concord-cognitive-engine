class_name TestCreatureRig
extends RefCounted
## Pure-logic test for world/creature_rig.gd's Phase M3 asset-variant
## selection and placeholder-tint helpers.

const CreatureRig := preload("res://world/creature_rig.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_covered_topology_returns_real_variant(t)
	_test_uncovered_topology_returns_empty(t)
	_test_variant_pick_is_deterministic(t)
	_test_placeholder_color_valid_hex(t)
	_test_placeholder_color_invalid_hex_falls_back(t)
	return t


static func _test_covered_topology_returns_real_variant(t: TestUtils) -> void:
	var quadruped_id := CreatureRig.real_asset_id_for_topology("quadruped", "creature_abc")
	t.check(not quadruped_id.is_empty(), "quadruped is a covered topology and resolves to a real asset id")
	t.check(quadruped_id.begins_with("quadruped_"),
		"the resolved id is drawn from the real quadruped variant pool")

	var winged_id := CreatureRig.real_asset_id_for_topology("winged_biped", "creature_xyz")
	t.check_eq(winged_id, "winged_biped_01",
		"winged_biped has exactly one real variant today and resolves to it")


static func _test_uncovered_topology_returns_empty(t: TestUtils) -> void:
	for topology in ["serpentine", "eel", "shark", "fish", "cephalopod", "polyped", "amorphous", "humanoid"]:
		var id := CreatureRig.real_asset_id_for_topology(topology, "creature_1")
		t.check_eq(id, "",
			"%s has no real asset yet — an honest empty answer, never a guessed substitute" % topology)


static func _test_variant_pick_is_deterministic(t: TestUtils) -> void:
	var a := CreatureRig.real_asset_id_for_topology("quadruped", "same-creature-id")
	var b := CreatureRig.real_asset_id_for_topology("quadruped", "same-creature-id")
	t.check_eq(a, b, "the same creature_id always resolves to the same variant")


static func _test_placeholder_color_valid_hex(t: TestUtils) -> void:
	var c := CreatureRig.placeholder_color("#ff0000")
	t.check_almost(c.r, 1.0, "a valid hex coat color is parsed into a real Color (red channel)")
	t.check_almost(c.g, 0.0, "a valid hex coat color is parsed into a real Color (green channel)")
	t.check_almost(c.b, 0.0, "a valid hex coat color is parsed into a real Color (blue channel)")


static func _test_placeholder_color_invalid_hex_falls_back(t: TestUtils) -> void:
	var missing := CreatureRig.placeholder_color("")
	var malformed := CreatureRig.placeholder_color("not-a-color")
	var default_color := Color(0.5, 0.42, 0.32)
	t.check(missing.is_equal_approx(default_color),
		"a missing coat color falls back to the honest neutral default, never a fabricated hue")
	t.check(malformed.is_equal_approx(default_color),
		"a malformed coat color falls back to the same honest neutral default")
