class_name TestCreaturePoller
extends RefCounted
## Pure-logic test for world/creature_poller.gd's Phase M3 request-body
## builder and translation layer — the analogue of tests/test_npc_poller.gd
## for the `creatures.for_world` macro's flat x/y/z, no-heading shape.

const CreaturePoller := preload("res://world/creature_poller.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_request_body_shape(t)
	_test_basic_translation(t)
	_test_skips_blank_or_missing_id(t)
	_test_skips_non_dictionary_entries(t)
	_test_missing_fields_default_honestly(t)
	_test_empty_array(t)
	return t


static func _test_request_body_shape(t: TestUtils) -> void:
	var body := CreaturePoller.build_for_world_request_body("concordia-hub", 250)
	t.check_eq(String(body.get("domain", "")), "creatures",
		"request body targets the creatures domain")
	t.check_eq(String(body.get("name", "")), "for_world",
		"request body targets the for_world action")
	var input: Dictionary = body.get("input", {})
	t.check_eq(String(input.get("worldId", "")), "concordia-hub",
		"worldId is threaded into the input payload")
	t.check_eq(int(input.get("limit", 0)), 250, "limit is threaded into the input payload")


static func _test_basic_translation(t: TestUtils) -> void:
	var creatures := [
		{"id": "creature_1", "species_id": "wolf", "x": 3.0, "y": 0.5, "z": -2.0,
			"topology": "quadruped", "coatColor": "#8b5e3c"},
	]
	var entities := CreaturePoller.creatures_array_to_entities(creatures)
	t.check(entities.has("creature_1"), "a well-formed entry is keyed by its real id")
	var e: Dictionary = entities["creature_1"]
	t.check_almost(float(e["x"]), 3.0, "x is translated directly, no position wrapper")
	t.check_almost(float(e["y"]), 0.5, "y is translated directly")
	t.check_almost(float(e["z"]), -2.0, "z is translated directly")
	t.check_eq(String(e["topology"]), "quadruped", "topology is passed through")
	t.check_eq(String(e["species_id"]), "wolf", "species_id is passed through")
	t.check_eq(String(e["coatColor"]), "#8b5e3c", "coatColor is passed through")


static func _test_skips_blank_or_missing_id(t: TestUtils) -> void:
	var creatures := [
		{"id": "", "x": 1.0, "y": 0.0, "z": 1.0},
		{"x": 2.0, "y": 0.0, "z": 2.0},
		{"id": "real_creature", "x": 3.0, "y": 0.0, "z": 3.0},
	]
	var entities := CreaturePoller.creatures_array_to_entities(creatures)
	t.check_eq(entities.size(), 1, "a blank or missing id is dropped, never fabricated")
	t.check(entities.has("real_creature"), "the one well-formed entry still comes through")


static func _test_skips_non_dictionary_entries(t: TestUtils) -> void:
	var creatures: Array = ["not_a_dict", 42, null, {"id": "creature_2", "x": 0.0, "y": 0.0, "z": 0.0}]
	var entities := CreaturePoller.creatures_array_to_entities(creatures)
	t.check_eq(entities.size(), 1, "non-Dictionary array entries are dropped, not crashed on")
	t.check(entities.has("creature_2"), "the one well-formed entry survives alongside malformed siblings")


static func _test_missing_fields_default_honestly(t: TestUtils) -> void:
	var creatures := [{"id": "creature_3"}]
	var entities := CreaturePoller.creatures_array_to_entities(creatures)
	var e: Dictionary = entities["creature_3"]
	t.check_almost(float(e["x"]), 0.0, "a missing x defaults to 0.0, not a crash")
	t.check_almost(float(e["y"]), 0.0, "a missing y defaults to 0.0, not a crash")
	t.check_almost(float(e["z"]), 0.0, "a missing z defaults to 0.0, not a crash")
	t.check_eq(String(e["topology"]), "quadruped",
		"a missing topology defaults to the real, covered 'quadruped' value, not an empty string")
	t.check_eq(String(e["species_id"]), "", "a missing species_id defaults to an honest empty string")
	t.check_eq(String(e["coatColor"]), "", "a missing coatColor defaults to an honest empty string")


static func _test_empty_array(t: TestUtils) -> void:
	var entities := CreaturePoller.creatures_array_to_entities([])
	t.check(entities.is_empty(), "an empty creatures array yields an honestly empty dict, not an error")
