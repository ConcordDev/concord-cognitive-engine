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
	_test_parses_rooftop_buildings_from_nodes(t)
	_test_rooftop_parsing_drops_non_rooftop_and_malformed_nodes(t)
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


## F26 — real node shape from server/lib/scene-export.js (`extras.levels`
## naming a "rooftop" entry, exactly like "station-observatory" in
## content/world/concordia-hub/city-layout.json), reduced to the flat
## descriptor `rooftop_access_controller.gd` consumes.
static func _test_parses_rooftop_buildings_from_nodes(t: TestUtils) -> void:
	var nodes := [
		{
			"id": "station-observatory", "name": "The Observatory",
			"transform": {"translation": [-192.0, 0.0, 4.0], "rotationY": 0.0, "scale": [16.0, 12.0, 16.0]},
			"extras": {
				"lens": "astronomy",
				"levels": {"ground": "main floor", "mid": "gallery", "rooftop": "rooftop deck"},
			},
		},
	]
	var parsed := SceneBootstrap.parse_rooftop_buildings(nodes)
	t.check_eq(parsed.size(), 1, "one rooftop-tagged node parses to one rooftop descriptor")
	t.check_eq(parsed[0]["id"], "station-observatory", "id is passed through")
	t.check_eq(parsed[0]["x"], -192.0, "x comes from the real transform.translation")
	t.check_eq(parsed[0]["z"], 4.0, "z comes from the real transform.translation")
	t.check_eq(parsed[0]["half_w"], 8.0, "half_w is HALF of the real transform.scale.x (16/2)")
	t.check_eq(parsed[0]["half_d"], 8.0, "half_d is HALF of the real transform.scale.z (16/2)")
	t.check_eq(
		parsed[0]["roof_y"], 12.0,
		"roof_y is translation.y + scale.y (0 + 12) — the real roofline")
	t.check_eq(
		parsed[0]["purpose"], "rooftop deck",
		"purpose is the real authored levels.rooftop string")


static func _test_rooftop_parsing_drops_non_rooftop_and_malformed_nodes(t: TestUtils) -> void:
	var nodes := [
		{
			"id": "no-rooftop-level",
			"transform": {"translation": [0.0, 0.0, 0.0], "scale": [10.0, 8.0, 10.0]},
			"extras": {"levels": {"ground": "main floor"}},
		},
		{
			"id": "no-extras",
			"transform": {"translation": [0.0, 0.0, 0.0], "scale": [10.0, 8.0, 10.0]},
		},
		{
			"id": "no-transform",
			"extras": {"levels": {"rooftop": "roof"}},
		},
		"not-even-a-dict",
		{
			"id": "well-shaped-rooftop",
			"transform": {"translation": [1.0, 2.0, 3.0], "scale": [4.0, 5.0, 6.0]},
			"extras": {"levels": {"rooftop": "a real roof"}},
		},
	]
	var parsed := SceneBootstrap.parse_rooftop_buildings(nodes)
	t.check_eq(
		parsed.size(), 1,
		"only the one genuinely rooftop-tagged, well-shaped node survives")
	t.check_eq(
		parsed[0]["id"], "well-shaped-rooftop",
		"the surviving entry is the genuinely well-shaped one")
