class_name TestNpcPoller
extends RefCounted
## Pure-logic test for world/npc_poller.gd's Phase N translation layer —
## `npcs_array_to_entities`, the REST analogue of world/boot.gd
## #users_array_to_dict for the `GET /api/worlds/:worldId/npcs` response
## shape (server/routes/worlds.js:855). The engine-gated HTTPRequest/Timer
## half is NOT covered here — see tools/npc_poller_probe.gd for the
## real-engine proof against a real running backend.

const NpcPoller := preload("res://world/npc_poller.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_basic_shape(t)
	_test_skips_blank_or_missing_id(t)
	_test_skips_non_dictionary_entries(t)
	_test_missing_position_defaults_to_zero(t)
	_test_empty_array(t)
	_test_archetype_for_occupation(t)
	_test_archetype_threaded_through_entities(t)
	return t


static func _test_basic_shape(t: TestUtils) -> void:
	var npcs := [
		{"id": "npc_1", "position": {"x": 1.0, "y": 0.0, "z": 2.0}, "rotation": 1.57, "name": "Kel"},
	]
	var entities := NpcPoller.npcs_array_to_entities(npcs)
	t.check(entities.has("npc_1"), "a well-formed entry is keyed by its real id")
	var e: Dictionary = entities["npc_1"]
	t.check_almost(float(e["x"]), 1.0, "x is translated from position.x")
	t.check_almost(float(e["y"]), 0.0, "y is translated from position.y")
	t.check_almost(float(e["z"]), 2.0, "z is translated from position.z")
	t.check_almost(float(e["rotation"]), 1.57, "rotation is translated from the top-level rotation field")


static func _test_skips_blank_or_missing_id(t: TestUtils) -> void:
	var npcs := [
		{"id": "", "position": {"x": 1.0, "y": 0.0, "z": 1.0}},
		{"position": {"x": 2.0, "y": 0.0, "z": 2.0}},
		{"id": "real_npc", "position": {"x": 3.0, "y": 0.0, "z": 3.0}},
	]
	var entities := NpcPoller.npcs_array_to_entities(npcs)
	t.check_eq(entities.size(), 1, "a blank or missing id is dropped, never fabricated")
	t.check(entities.has("real_npc"), "the one well-formed entry still comes through")


static func _test_skips_non_dictionary_entries(t: TestUtils) -> void:
	var npcs: Array = ["not_a_dict", 42, null, {"id": "npc_2", "position": {"x": 0.0, "y": 0.0, "z": 0.0}}]
	var entities := NpcPoller.npcs_array_to_entities(npcs)
	t.check_eq(entities.size(), 1, "non-Dictionary array entries are dropped, not crashed on")
	t.check(entities.has("npc_2"), "the one well-formed entry survives alongside malformed siblings")


static func _test_missing_position_defaults_to_zero(t: TestUtils) -> void:
	var npcs := [{"id": "npc_3"}]
	var entities := NpcPoller.npcs_array_to_entities(npcs)
	var e: Dictionary = entities["npc_3"]
	t.check_almost(float(e["x"]), 0.0, "a missing position defaults x to 0.0, not a crash")
	t.check_almost(float(e["y"]), 0.0, "a missing position defaults y to 0.0, not a crash")
	t.check_almost(float(e["z"]), 0.0, "a missing position defaults z to 0.0, not a crash")
	t.check_almost(float(e["rotation"]), 0.0, "a missing rotation defaults to 0.0")


static func _test_empty_array(t: TestUtils) -> void:
	var entities := NpcPoller.npcs_array_to_entities([])
	t.check(entities.is_empty(), "an empty npcs array yields an honestly empty dict, not an error")


## Pins archetype_for_occupation against the hero-mesh-registry.ts source it
## was ported from — the undead-specific patterns (2026-08-08) plus a
## sample of the pre-existing living-archetype ones, to catch a future edit
## that breaks parity with the TS table.
static func _test_archetype_for_occupation(t: TestUtils) -> void:
	t.check_eq(NpcPoller.archetype_for_occupation(""), "", "empty occupation -> no confident match")
	t.check_eq(NpcPoller.archetype_for_occupation("lich_king"), "lich", "lich_king occupation text -> lich archetype")
	t.check_eq(NpcPoller.archetype_for_occupation("wraith"), "wraith", "wraith archetype-as-occupation -> wraith")
	t.check_eq(NpcPoller.archetype_for_occupation("zombie"), "zombie", "zombie archetype-as-occupation -> zombie")
	t.check_eq(NpcPoller.archetype_for_occupation("undead"), "undead", "undead archetype-as-occupation -> undead")
	t.check_eq(NpcPoller.archetype_for_occupation("wanderer"), "undead", "the shared undead-archetype occupation 'wanderer' -> undead")
	t.check_eq(NpcPoller.archetype_for_occupation("plague_bearer"), "undead", "plague_bearer -> undead (no distinct mesh sourced, honest reuse)")
	t.check_eq(NpcPoller.archetype_for_occupation("warrior"), "warrior", "the pre-existing 'warrior' self-match still works (undead patterns don't shadow it)")
	t.check_eq(NpcPoller.archetype_for_occupation("hedge-mage"), "mystic", "a pre-existing living-archetype match is unaffected by the new undead entries")
	t.check_eq(NpcPoller.archetype_for_occupation("lookout"), "guard", "a pre-existing keyword match still resolves correctly")
	t.check_eq(NpcPoller.archetype_for_occupation("some genuinely unmatched text"), "", "no match returns empty, never a guess")


## Confirms the field actually reaches npcs_array_to_entities's output, not
## just that the helper function works in isolation.
static func _test_archetype_threaded_through_entities(t: TestUtils) -> void:
	var npcs := [
		{"id": "npc_undead_1", "position": {"x": 0.0, "y": 0.0, "z": 0.0}, "occupation": "wraith"},
		{"id": "npc_living_1", "position": {"x": 0.0, "y": 0.0, "z": 0.0}, "occupation": "beat cop"},
		{"id": "npc_unmatched", "position": {"x": 0.0, "y": 0.0, "z": 0.0}, "occupation": "keeper of nothing genuinely categorizable"},
	]
	var entities := NpcPoller.npcs_array_to_entities(npcs)
	t.check_eq(String(entities["npc_undead_1"]["archetype"]), "wraith", "an undead NPC's real occupation resolves to the wraith archetype in the output entity")
	t.check_eq(String(entities["npc_living_1"]["archetype"]), "guard", "a living NPC's occupation still resolves correctly alongside undead entries")
	t.check_eq(String(entities["npc_unmatched"]["archetype"]), "", "an unmatched occupation resolves to an honest empty archetype, not a guess")
