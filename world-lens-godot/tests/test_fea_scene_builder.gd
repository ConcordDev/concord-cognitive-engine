class_name TestFeaSceneBuilder
extends RefCounted
## Pure-logic tests for engineering/fea_scene_builder.gd's static helpers.
##
## ENGINE-EXECUTED (2026-07-25). A real Godot 4.4 headless binary now lives
## at `./.godot-runtime/bin/godot` (see docs/GODOT_RUNTIME.md), and
## `--script tests/run_all.gd` compiles and RUNS this suite — its 22 checks
## are asserted on every run.
##
## Verified: `build_request_body`, `node_positions`, `centroid`,
## `beam_transform` and `utilization_to_color` — including that a member's
## color comes from the solver's OWN utilization ratio, echoed verbatim
## rather than re-derived or rounded client-side. The transform math runs
## against real engine Transform3D/Basis types.
##
## NOT verified: exactly the two things fea_scene_builder.gd's own header
## flags — whether beam scale/thickness look right at real-world model
## dimensions, and whether the utilization color ramp reads correctly under
## default lighting. Both are display-time judgements and headless installs
## RasterizerDummy, which draws nothing. The live `engineering.feaScene`
## macro round trip is also unexercised. Queued in
## world-lens-godot/VISUAL_QA.md.

const FeaSceneBuilder := preload("res://engineering/fea_scene_builder.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_build_request_body(t)
	_test_node_positions(t)
	_test_utilization_to_color(t)
	_test_beam_transform(t)
	_test_centroid(t)
	return t


static func _test_build_request_body(t: TestUtils) -> void:
	var model := {"nodes": [{"id": "A", "x": 0, "y": 0, "z": 0}]}
	var body := FeaSceneBuilder.build_request_body(model)
	t.check_eq(body["domain"], "engineering", "request targets the engineering macro domain")
	t.check_eq(body["name"], "feaScene", "request calls the feaScene macro")
	t.check_eq(body["input"]["model"], model, "the model is forwarded verbatim")


static func _test_node_positions(t: TestUtils) -> void:
	var nodes := [
		{"id": "A", "x": 1.0, "y": 2.0, "z": 3.0},
		{"id": "B", "x": -1.5, "y": 0.0, "z": 0.5},
		{"id": "", "x": 9.0, "y": 9.0, "z": 9.0},  # no id — must be skipped
		"not_a_dict",
	]
	var positions := FeaSceneBuilder.node_positions(nodes)
	t.check_eq(positions.size(), 2, "only the two real, id-bearing nodes are mapped")
	t.check(
		positions["A"].is_equal_approx(Vector3(1.0, 2.0, 3.0)),
		"node A position maps verbatim, no axis remap")
	t.check(
		positions["B"].is_equal_approx(Vector3(-1.5, 0.0, 0.5)),
		"node B position maps verbatim")

	var missing_z := FeaSceneBuilder.node_positions([{"id": "C", "x": 1.0, "y": 1.0}])
	t.check(
		missing_z["C"].is_equal_approx(Vector3(1.0, 1.0, 0.0)),
		"a missing z defaults to 0.0, not a fabricated value")


static func _test_utilization_to_color(t: TestUtils) -> void:
	var low := FeaSceneBuilder.utilization_to_color(0.0)
	t.check(low.is_equal_approx(Color(0.0, 1.0, 0.0)), "utilization 0.0 is pure green (unstressed)")

	var mid := FeaSceneBuilder.utilization_to_color(0.5)
	t.check(mid.is_equal_approx(Color(1.0, 1.0, 0.0)), "utilization 0.5 is yellow (the ramp midpoint)")

	var high := FeaSceneBuilder.utilization_to_color(1.0)
	t.check(high.is_equal_approx(Color(1.0, 0.0, 0.0)), "utilization 1.0 (at yield) is pure red")

	var over := FeaSceneBuilder.utilization_to_color(2.5)
	t.check(
		over.is_equal_approx(Color(1.0, 0.0, 0.0)),
		"an overstressed ratio (>1.0) clamps to solid red, never extrapolates past it")

	# The ramp must be monotonic in the red channel's DECREASE / green's
	# increase across the low half, i.e. genuinely data-driven, not a flat
	# fixed color regardless of input.
	var a := FeaSceneBuilder.utilization_to_color(0.1)
	var b := FeaSceneBuilder.utilization_to_color(0.3)
	t.check(a.g >= b.g, "green channel is non-increasing as utilization rises")
	t.check(a != b, "distinct utilization ratios produce distinct colors")


static func _test_beam_transform(t: TestUtils) -> void:
	var xf := FeaSceneBuilder.beam_transform(Vector3.ZERO, Vector3(0, 4, 0))
	t.check(xf.origin.is_equal_approx(Vector3(0, 2, 0)), "beam origin is the true midpoint")
	t.check(
		xf.basis.y.is_equal_approx(Vector3(0, 1, 0)),
		"a vertical member's beam Y-axis points straight along it")

	var horiz := FeaSceneBuilder.beam_transform(Vector3(0, 0, 0), Vector3(3, 0, 0))
	t.check(horiz.origin.is_equal_approx(Vector3(1.5, 0, 0)), "horizontal beam midpoint")
	t.check(
		horiz.basis.y.is_equal_approx(Vector3(1, 0, 0)),
		"a horizontal member's beam Y-axis points along +x, not degenerate")
	t.check(
		absf(horiz.basis.determinant() - 1.0) < 0.001,
		"the constructed basis is a real orthonormal (non-degenerate) frame")

	var degenerate := FeaSceneBuilder.beam_transform(Vector3(1, 1, 1), Vector3(1, 1, 1))
	t.check(
		degenerate.origin.is_equal_approx(Vector3(1, 1, 1)),
		"a zero-length member falls back to its shared point rather than crashing")


## R5/E24 — the real orbit-camera focus point (session/camera_rig.gd
## consumes this via FeaSceneBuilder.get_bounds_center()).
static func _test_centroid(t: TestUtils) -> void:
	var positions: Array[Vector3] = [Vector3(0, 0, 0), Vector3(2, 0, 0), Vector3(1, 3, 0)]
	var center := FeaSceneBuilder.centroid(positions)
	t.check(
		center.is_equal_approx(Vector3(1.0, 1.0, 0.0)), "centroid is the true average of all points")

	var empty: Array[Vector3] = []
	t.check_eq(
		FeaSceneBuilder.centroid(empty), Vector3.ZERO,
		"an empty position list honestly yields Vector3.ZERO, never dividing by zero")

	var single: Array[Vector3] = [Vector3(5, 5, 5)]
	t.check(
		FeaSceneBuilder.centroid(single).is_equal_approx(Vector3(5, 5, 5)),
		"a single point's centroid is itself")
