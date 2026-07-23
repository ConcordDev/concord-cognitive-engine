class_name TestDtuPropRenderer
extends RefCounted
## Pure-logic tests for world/dtu_prop_renderer.gd's static helpers.
## ENGINE-GATED execution — see world-lens-godot/VISUAL_QA.md.

const DtuPropRenderer := preload("res://world/dtu_prop_renderer.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_build_list_request_body(t)
	_test_placement_to_transform(t)
	_test_slot_color_and_size(t)
	return t


static func _test_build_list_request_body(t: TestUtils) -> void:
	var body := DtuPropRenderer.build_list_request_body("concordia-hub", "")
	t.check_eq(body["domain"], "dtu_props", "list body targets the dtu_props macro domain")
	t.check_eq(body["name"], "list", "list body calls the list macro")
	t.check_eq(body["input"]["worldId"], "concordia-hub", "worldId is forwarded")
	t.check(not body["input"].has("buildingId"), "empty buildingId is omitted, not sent as ''")

	var with_building := DtuPropRenderer.build_list_request_body("concordia-hub", "bldg_1")
	t.check_eq(with_building["input"]["buildingId"], "bldg_1", "non-empty buildingId forwarded")


static func _test_placement_to_transform(t: TestUtils) -> void:
	var xf := DtuPropRenderer.placement_to_transform({"position": [1.5, 0.0, -2.5]})
	t.check(
		xf.origin.is_equal_approx(Vector3(1.5, 0.0, -2.5)),
		"position array maps to Transform3D origin")

	var missing := DtuPropRenderer.placement_to_transform({})
	t.check(
		missing.origin.is_equal_approx(Vector3.ZERO),
		"missing position defaults to origin, not a fabricated offset")

	var malformed := DtuPropRenderer.placement_to_transform({"position": "not_an_array"})
	t.check(
		malformed.origin.is_equal_approx(Vector3.ZERO),
		"malformed position defaults to origin rather than crashing")


static func _test_slot_color_and_size(t: TestUtils) -> void:
	var slots := ["shelf", "counter", "window", "rooftop", "plaza", "unknown_slot"]
	var seen_colors: Dictionary = {}
	for slot in slots:
		var c: Color = DtuPropRenderer.slot_color(slot)
		seen_colors[c] = true
		var size: Vector3 = DtuPropRenderer.placeholder_size_for_slot(slot)
		t.check(
			size.x > 0.0 and size.y > 0.0 and size.z > 0.0,
			"%s placeholder size is non-degenerate" % slot)
	t.check(seen_colors.size() >= 5, "each real slot gets a visually distinct placeholder tint")

	var unknown_color := DtuPropRenderer.slot_color("unknown_slot")
	var plaza_color := DtuPropRenderer.slot_color("plaza")
	t.check_eq(unknown_color, plaza_color, "unrecognized slot falls back to the plaza tint")
