class_name TestTouchControls
extends RefCounted
## Pure-logic test for ui/touch_controls.gd's virtual-joystick offset math —
## the one part of that file with no scene-tree/touch-device dependency.
## See tools/touch_controls_probe.gd for the real-engine wiring proof
## (real TouchScreenButton nodes, real InputEventScreenTouch/Drag delivery).

const TouchControls := preload("res://ui/touch_controls.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_clamp_offset_zero_at_origin(t)
	_test_clamp_offset_scales_by_radius(t)
	_test_clamp_offset_clamps_beyond_radius(t)
	_test_clamp_offset_direction_preserved(t)
	_test_clamp_offset_honest_zero_on_invalid_radius(t)
	return t


static func _test_clamp_offset_zero_at_origin(t: TestUtils) -> void:
	var v := TouchControls.clamp_offset(Vector2(100, 100), Vector2(100, 100), 60.0)
	t.check_eq(v, Vector2.ZERO, "a touch/drag point exactly at the origin gives a real zero vector")


static func _test_clamp_offset_scales_by_radius(t: TestUtils) -> void:
	# Half the radius, straight right -> x should read ~0.5, not 1.0 or the
	# raw pixel delta.
	var v := TouchControls.clamp_offset(Vector2(0, 0), Vector2(30, 0), 60.0)
	t.check_almost(v.x, 0.5, "a drag half the joystick radius away reads as half magnitude")
	t.check_almost(v.y, 0.0, "no y contribution from a pure-x drag")


static func _test_clamp_offset_clamps_beyond_radius(t: TestUtils) -> void:
	# A drag point WAY beyond max_radius must still clamp to exactly 1.0
	# magnitude, not the raw (huge) scaled value.
	var v := TouchControls.clamp_offset(Vector2(0, 0), Vector2(600, 0), 60.0)
	t.check_almost(v.length(), 1.0, "a drag far beyond the joystick radius clamps to magnitude 1.0")
	t.check_almost(v.x, 1.0, "clamped direction is preserved (full +x)")


static func _test_clamp_offset_direction_preserved(t: TestUtils) -> void:
	# A diagonal drag within radius should preserve its real direction, not
	# snap to an axis.
	var v := TouchControls.clamp_offset(Vector2(0, 0), Vector2(21.2, 21.2), 60.0)
	t.check(v.x > 0.0 and v.y > 0.0, "a diagonal drag preserves both real axis components")
	t.check_almost(v.x, v.y, "a symmetric diagonal drag keeps x and y equal")


static func _test_clamp_offset_honest_zero_on_invalid_radius(t: TestUtils) -> void:
	var v := TouchControls.clamp_offset(Vector2.ZERO, Vector2(50, 50), 0.0)
	t.check_eq(v, Vector2.ZERO, "a zero/invalid max_radius returns an honest zero vector, never a divide-by-zero crash")
