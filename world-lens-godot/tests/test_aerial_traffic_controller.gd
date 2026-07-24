class_name TestAerialTrafficController
extends RefCounted
## Pure-logic tests for world/aerial_traffic_controller.gd's static helpers
## (C16 — ambient aerial traffic). ENGINE-GATED execution — see
## world-lens-godot/VISUAL_QA.md. Does not exercise SnapshotBuffer itself
## (already covered by its own test suite) — only the parse/gate logic this
## unit adds.

const AerialTrafficController := preload("res://world/aerial_traffic_controller.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_entities_to_states_happy_path(t)
	_test_entities_to_states_drops_malformed_without_crashing(t)
	_test_entities_to_states_empty_is_honest_empty(t)
	_test_should_prune_gate(t)
	return t


static func _test_entities_to_states_happy_path(t: TestUtils) -> void:
	var e0 := {"id": "aerial:concordia-hub:0:1000", "kind": "crosswind-courier"}
	e0["x"] = 1.0; e0["y"] = 60.0; e0["z"] = 2.0; e0["heading"] = 0.5
	var e1 := {"id": "aerial:concordia-hub:1:1000", "kind": "crosswind-courier"}
	e1["x"] = -3.0; e1["y"] = 60.0; e1["z"] = 4.0; e1["heading"] = -1.2
	var entities := [e0, e1]
	var parsed := AerialTrafficController.entities_to_states(entities)
	var states: Dictionary = parsed["states"]
	var kinds: Dictionary = parsed["kinds"]

	t.check_eq(states.size(), 2, "two well-shaped entities parse to two state entries")
	t.check_eq(
		states["aerial:concordia-hub:0:1000"], [1.0, 60.0, 2.0, 0.5],
		"state array is [x,y,z,heading] in that exact order — the shape SnapshotBuffer.ingest expects")
	t.check_eq(
		kinds["aerial:concordia-hub:0:1000"], "crosswind-courier",
		"kind is tracked per id, separately from the SnapshotBuffer position state")


static func _test_entities_to_states_drops_malformed_without_crashing(t: TestUtils) -> void:
	var entities := [
		{"kind": "crosswind-courier", "x": 1.0, "y": 60.0, "z": 2.0},  # no id
		"not-even-a-dict",
		{"id": "", "x": 1.0, "y": 60.0, "z": 2.0},  # empty id
		{"id": "well-shaped", "kind": "crosswind-courier", "x": 5.0, "y": 60.0, "z": 6.0, "heading": 0.0},
	]
	var parsed := AerialTrafficController.entities_to_states(entities)
	var states: Dictionary = parsed["states"]
	t.check_eq(
		states.size(), 1,
		"only the one well-shaped entry survives — malformed entries are dropped, never fabricated")
	t.check(states.has("well-shaped"), "the surviving entry is the genuinely well-shaped one")


static func _test_entities_to_states_empty_is_honest_empty(t: TestUtils) -> void:
	var parsed := AerialTrafficController.entities_to_states([])
	var states: Dictionary = parsed["states"]
	var kinds: Dictionary = parsed["kinds"]
	t.check(states.is_empty(), "an empty entities array yields an empty states dict")
	t.check(kinds.is_empty(), "an empty entities array yields an empty kinds dict")


static func _test_should_prune_gate(t: TestUtils) -> void:
	t.check_eq(
		AerialTrafficController.should_prune(0, 50_000, 90_000), false,
		"an id seen 50s ago is still within the 90s stale window")
	t.check_eq(
		AerialTrafficController.should_prune(0, 90_001, 90_000), true,
		"an id seen 90.001s ago has aged past the stale window")
	t.check_eq(
		AerialTrafficController.should_prune(0, 90_000, 90_000), false,
		"exactly at the timeout boundary is not yet stale (strict greater-than)")
