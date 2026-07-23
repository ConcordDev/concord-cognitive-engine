class_name TestDtuPropInteraction
extends RefCounted
## Pure-logic tests for world/dtu_prop_interaction.gd's static helpers.
## ENGINE-GATED execution — see world-lens-godot/VISUAL_QA.md.
##
## `find_prop_ancestor` is exercised against plain `Node.new()` trees built
## with `add_child`/`set_meta` — this works without a running SceneTree
## because meta + parent/child linkage are Node-local, not tree-dependent.

const DtuPropInteraction := preload("res://world/dtu_prop_interaction.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_build_interact_request_body(t)
	_test_find_prop_ancestor(t)
	return t


static func _test_build_interact_request_body(t: TestUtils) -> void:
	var inspect_body := DtuPropInteraction.build_interact_request_body("dtu_1", "inspect")
	t.check_eq(inspect_body["domain"], "dtu_props", "interact body targets the dtu_props macro domain")
	t.check_eq(inspect_body["input"]["dtuId"], "dtu_1", "dtuId is forwarded")
	t.check_eq(inspect_body["input"]["action"], "inspect", "action is forwarded")
	t.check(
		not inspect_body["input"].has("placement"),
		"non-arrange actions omit the placement field")

	var arrange_placement := {"slot": "shelf", "position": [1, 0, 1]}
	var arrange_body := DtuPropInteraction.build_interact_request_body(
		"dtu_2", "arrange", arrange_placement)
	t.check(arrange_body["input"].has("placement"), "arrange action includes the placement field")
	t.check_eq(
		arrange_body["input"]["placement"]["slot"], "shelf",
		"placement payload is forwarded verbatim")

	var arrange_empty := DtuPropInteraction.build_interact_request_body("dtu_3", "arrange", {})
	t.check(
		not arrange_empty["input"].has("placement"),
		"an empty placement dict is omitted rather than sent as {}")


static func _test_find_prop_ancestor(t: TestUtils) -> void:
	var root := Node.new()
	var holder := Node.new()
	holder.set_meta("dtu_id", "dtu_abc")
	holder.set_meta("title", "A Prop")
	var mesh_child := Node.new()
	var deep_child := Node.new()

	root.add_child(holder)
	holder.add_child(mesh_child)
	mesh_child.add_child(deep_child)

	var found := DtuPropInteraction.find_prop_ancestor(deep_child)
	t.check(found == holder, "walks up through multiple ancestors to find the tagged holder")

	var found_direct := DtuPropInteraction.find_prop_ancestor(holder)
	t.check(found_direct == holder, "a node that IS the holder is found immediately")

	var unrelated := Node.new()
	var not_found := DtuPropInteraction.find_prop_ancestor(unrelated)
	t.check(not_found == null, "a node with no dtu_id-tagged ancestor returns null, not a match")

	t.check(
		DtuPropInteraction.find_prop_ancestor(null) == null,
		"null input returns null rather than crashing")

	root.free()
	unrelated.free()
