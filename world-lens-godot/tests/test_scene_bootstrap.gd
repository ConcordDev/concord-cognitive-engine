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
	_test_parses_well_shaped_districts_verbatim(t)
	_test_drops_malformed_districts_without_crashing(t)
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


## C15 — same verbatim-passthrough-or-drop coverage as the pad tests above,
## for the additive `districts` field (server/lib/districts.js,
## migration 374, consumed downstream by world/air_legibility.gd).
static func _test_parses_well_shaped_districts_verbatim(t: TestUtils) -> void:
	var raw := [
		{
			"id": "concordia-hub:plaza", "worldId": "concordia-hub", "name": "The Concord Plaza",
			"boundary": [{"x": -70, "z": -70}, {"x": 70, "z": -70}, {"x": 70, "z": 70}, {"x": -70, "z": 70}],
			"palette": {"primary": "#d9c9a3", "secondary": "#8b7355", "accent": "#f2c14e"},
			"lightingTag": "warm_day", "elevationHint": 0,
		},
	]
	var parsed := SceneBootstrap.parse_districts(raw)
	t.check_eq(parsed.size(), 1, "one well-shaped district entry parses to one output entry")
	t.check_eq(parsed[0]["id"], "concordia-hub:plaza", "id is passed through verbatim")
	t.check_eq(
		parsed[0]["palette"], {"primary": "#d9c9a3", "secondary": "#8b7355", "accent": "#f2c14e"},
		"palette dict is passed through verbatim, real server-authored hex colors")


static func _test_drops_malformed_districts_without_crashing(t: TestUtils) -> void:
	var raw := [
		{"id": "no-palette", "name": "X"},
		{"palette": {"primary": "#ffffff"}},  # no id
		{"id": "empty-palette", "palette": {}},  # palette present but no primary
		"not-even-a-dict",
		{"id": "well-shaped", "palette": {"primary": "#5c5c5c"}},
	]
	var parsed := SceneBootstrap.parse_districts(raw)
	t.check_eq(
		parsed.size(), 1,
		"only the one well-shaped entry survives — malformed entries are dropped, never fabricated")
	t.check_eq(parsed[0]["id"], "well-shaped", "the surviving entry is the genuinely well-shaped one")
