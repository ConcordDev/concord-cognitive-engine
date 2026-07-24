class_name TestSceneBootstrap
extends RefCounted
## Pure-logic tests for world/scene_bootstrap.gd's `parse_landing_pads`
## (added by C14 — land↔air transition — so
## avatar/land_air_transition_controller.gd has a real source of pad data
## from a `scene:data` payload instead of requiring pads to be hand-wired).
## ENGINE-GATED execution — see world-lens-godot/VISUAL_QA.md. Does NOT
## re-test `node_to_transform` (no change made to it by this unit).

const SceneBootstrap := preload("res://world/scene_bootstrap.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_parses_well_shaped_pads_verbatim(t)
	_test_drops_malformed_entries_without_crashing(t)
	_test_empty_or_missing_field_yields_empty_array(t)
	return t


static func _test_parses_well_shaped_pads_verbatim(t: TestUtils) -> void:
	var raw := [
		{
			"id": "landing-pad-plaza-north", "district_id": "concordia-hub:plaza",
			"name": "Plaza Skydock", "position": {"x": 0, "z": 280}, "radius_m": 14, "elevation_m": 0,
		},
	]
	var parsed := SceneBootstrap.parse_landing_pads(raw)
	t.check_eq(parsed.size(), 1, "one well-shaped pad entry parses to one output entry")
	t.check_eq(parsed[0]["id"], "landing-pad-plaza-north", "id is passed through verbatim")
	t.check_eq(parsed[0]["radius_m"], 14, "radius_m is passed through verbatim, not recomputed")
	t.check_eq(
		parsed[0]["position"], {"x": 0, "z": 280},
		"position dict is passed through verbatim, real server-authored coordinates")


static func _test_drops_malformed_entries_without_crashing(t: TestUtils) -> void:
	var raw := [
		{"id": "no-position", "radius_m": 14},
		{"id": "no-radius", "position": {"x": 0, "z": 0}},
		{"id": "position-missing-z", "position": {"x": 0}, "radius_m": 14},
		"not-even-a-dict",
		{"id": "well-shaped", "position": {"x": 1, "z": 2}, "radius_m": 5},
	]
	var parsed := SceneBootstrap.parse_landing_pads(raw)
	t.check_eq(
		parsed.size(), 1,
		"only the one well-shaped entry survives — malformed entries are dropped, never fabricated")
	t.check_eq(parsed[0]["id"], "well-shaped", "the surviving entry is the genuinely well-shaped one")


static func _test_empty_or_missing_field_yields_empty_array(t: TestUtils) -> void:
	t.check(
		SceneBootstrap.parse_landing_pads([]).is_empty(),
		"an empty raw array yields an empty result — honest 'no pads' for worlds with none authored")
