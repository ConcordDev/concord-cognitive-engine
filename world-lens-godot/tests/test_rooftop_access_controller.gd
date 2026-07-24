class_name TestRooftopAccessController
extends RefCounted
## Pure-logic tests for world/rooftop_access_controller.gd — F26 (rooftop as
## first-class space). ENGINE-GATED execution — see
## world-lens-godot/VISUAL_QA.md.

const RooftopAccessController := preload("res://world/rooftop_access_controller.gd")
const TestUtils := preload("res://tests/test_utils.gd")

## Real authored shape from content/world/concordia-hub/city-layout.json's
## "station-observatory" entry (position x=-192, z=4) — the one building
## with a real authored `levels.rooftop` entry today. Footprint/roofline
## values here are representative fixture numbers (not asserted to be the
## exact live-seeded world_buildings dimensions), matching the real wire
## shape `scene_bootstrap.gd#parse_rooftop_buildings` produces.
const OBSERVATORY := {
	"id": "station-observatory", "name": "The Observatory", "lens": "astronomy",
	"purpose": "The Observatory — rooftop deck.",
	"x": -192.0, "z": 4.0, "half_w": 8.0, "half_d": 8.0, "roof_y": 12.0,
}
const ALL_BUILDINGS := [OBSERVATORY]


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_is_over_footprint_gating(t)
	_test_rooftop_state_requires_both_horizontal_and_vertical(t)
	_test_rooftop_state_honest_empty_when_nothing_matches(t)
	_test_nearest_rooftop_building_picks_closest_and_handles_empty(t)
	return t


static func _test_is_over_footprint_gating(t: TestUtils) -> void:
	t.check(
		RooftopAccessController.is_over_footprint(-192.0, 4.0, OBSERVATORY),
		"the building's own center is over its own footprint")
	t.check(
		RooftopAccessController.is_over_footprint(-186.0, 10.0, OBSERVATORY),
		"a point within the half-extents is over the footprint")
	t.check(
		not RooftopAccessController.is_over_footprint(0.0, 0.0, OBSERVATORY),
		"a point far outside the footprint is not over it")
	t.check(
		not RooftopAccessController.is_over_footprint(0.0, 0.0, {}),
		"a malformed/empty building is honestly 'not over it', never a crash")
	var degenerate := {"x": 0.0, "z": 0.0, "half_w": 0.0, "half_d": 5.0}
	t.check(
		not RooftopAccessController.is_over_footprint(0.0, 0.0, degenerate),
		"a non-positive half-extent is honestly 'not over it', never a degenerate always-true footprint")


static func _test_rooftop_state_requires_both_horizontal_and_vertical(t: TestUtils) -> void:
	# Over the footprint AND within the standing tolerance of the roofline.
	var on_roof := RooftopAccessController.rooftop_state(
		Vector3(-192.0, 12.5, 4.0), ALL_BUILDINGS, 2.0)
	t.check(on_roof["on_rooftop"], "standing over the footprint at roof height reads as on-rooftop")
	t.check_eq(
		on_roof["building"].get("id", ""), "station-observatory",
		"the matched building is the real one")

	# Over the footprint but way too high (still flying, hasn't landed).
	var flying_over := RooftopAccessController.rooftop_state(
		Vector3(-192.0, 60.0, 4.0), ALL_BUILDINGS, 2.0)
	t.check(
		not flying_over["on_rooftop"],
		"flying high above the footprint is NOT on-rooftop — hasn't landed")

	# Over the footprint but below the roofline (inside the building, not on top of it).
	var inside_building := RooftopAccessController.rooftop_state(
		Vector3(-192.0, 2.0, 4.0), ALL_BUILDINGS, 2.0)
	t.check(
		not inside_building["on_rooftop"], "standing inside/below the building is NOT on-rooftop")

	# At roof height but off to the side (not over the footprint at all).
	var beside_building := RooftopAccessController.rooftop_state(
		Vector3(0.0, 12.0, 0.0), ALL_BUILDINGS, 2.0)
	t.check(
		not beside_building["on_rooftop"], "at roof altitude but off the footprint is NOT on-rooftop")


static func _test_rooftop_state_honest_empty_when_nothing_matches(t: TestUtils) -> void:
	var state := RooftopAccessController.rooftop_state(Vector3(0.0, 0.0, 0.0), [], 2.0)
	t.check(not state["on_rooftop"], "no known rooftop buildings means honestly never on-rooftop")
	t.check(state["building"].is_empty(), "no building match is an empty dict, never fabricated")


static func _test_nearest_rooftop_building_picks_closest_and_handles_empty(t: TestUtils) -> void:
	var second := {
		"id": "far-away", "x": 500.0, "z": 500.0, "half_w": 5.0, "half_d": 5.0, "roof_y": 10.0,
	}
	var both := [OBSERVATORY, second]
	var nearest := RooftopAccessController.nearest_rooftop_building(Vector3(-190.0, 0.0, 4.0), both)
	t.check_eq(
		nearest.get("id", ""), "station-observatory",
		"the closer building by horizontal distance wins")

	t.check(
		RooftopAccessController.nearest_rooftop_building(Vector3.ZERO, []).is_empty(),
		"no known buildings yields {}, never a crash or a guessed building")
