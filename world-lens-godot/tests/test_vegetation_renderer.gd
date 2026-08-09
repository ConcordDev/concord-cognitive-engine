class_name TestVegetationRenderer
extends RefCounted
## Pure-logic tests for world/vegetation_renderer.gd's static helpers
## (Phase M2 — deterministic, district-bounded vegetation scatter,
## server/lib/vegetation-scatter.js).
##
## Verified: `entry_to_transform` (position/rotation/scale math) and
## `placeholder_color_for_species` (each real species id gets a distinct
## tint, unknown species falls back to an honest neutral default).
##
## NOT verified: real spawn/despawn/GLB-upgrade behavior on screen — that
## needs a real-engine probe (tools/vegetation_renderer_probe.gd), not a
## pure-logic test. Headless installs RasterizerDummy and draws nothing.

const VegetationRenderer := preload("res://world/vegetation_renderer.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_entry_to_transform(t)
	_test_placeholder_color_for_species(t)
	return t


static func _test_entry_to_transform(t: TestUtils) -> void:
	var xf := VegetationRenderer.entry_to_transform({
		"x": 12.5, "y": 0.0, "z": -30.25, "rotationY": 0.0, "scale": 1.0,
	})
	t.check(
		xf.origin.is_equal_approx(Vector3(12.5, 0.0, -30.25)),
		"x/y/z map to Transform3D origin")

	var missing := VegetationRenderer.entry_to_transform({})
	t.check(
		missing.origin.is_equal_approx(Vector3.ZERO),
		"missing x/y/z defaults to origin, not a fabricated offset")
	t.check_almost(
		missing.basis.x.length(), 1.0,
		"missing scale defaults to 1.0, not zero/degenerate")

	var scaled := VegetationRenderer.entry_to_transform({"x": 0, "y": 0, "z": 0, "scale": 2.0})
	t.check_almost(scaled.basis.x.length(), 2.0, "scale is applied to the transform basis")

	var rotated := VegetationRenderer.entry_to_transform({"x": 0, "y": 0, "z": 0, "rotationY": PI / 2.0})
	t.check(
		not rotated.basis.is_equal_approx(Basis.IDENTITY),
		"a non-zero rotationY genuinely rotates the basis away from identity")


static func _test_placeholder_color_for_species(t: TestUtils) -> void:
	var species := ["tree_01", "tree_02", "tree_03", "tree_04", "bush_01", "flower_01"]
	var seen_colors: Dictionary = {}
	for s in species:
		var c: Color = VegetationRenderer.placeholder_color_for_species(s)
		seen_colors[c] = true
	t.check(seen_colors.size() == species.size(), "every real species id gets a visually distinct tint")

	var unknown := VegetationRenderer.placeholder_color_for_species("not_a_real_species")
	t.check(
		unknown != Color(0, 0, 0, 0),
		"an unrecognized species id gets an honest neutral default, never a crash")
