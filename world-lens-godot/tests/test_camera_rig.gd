class_name TestCameraRig
extends RefCounted
## Pure-logic tests for session/camera_rig.gd's static transform math —
## R5/E24 "unified session/camera manager". ENGINE-GATED execution — see
## world-lens-godot/VISUAL_QA.md. Does NOT exercise `_process`/`_ready`
## (needs a live Camera3D + scene tree) — only the pure functions that feed
## them, mirroring this project's established convention (e.g.
## character_controller.gd's own pure-vs-engine split).

const CameraRig := preload("res://session/camera_rig.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_follow_transform_offset_and_look_direction(t)
	_test_follow_transform_rotates_offset_with_target_yaw(t)
	_test_orbit_transform_distance_from_focus(t)
	_test_orbit_transform_yaw_sweep(t)
	_test_free_fly_step_moves_in_look_direction(t)
	_test_free_fly_step_normalizes_diagonal_input(t)
	_test_smoothed_transform_interpolates_and_clamps(t)
	return t


static func _test_follow_transform_offset_and_look_direction(t: TestUtils) -> void:
	var xf := CameraRig.follow_transform(Vector3.ZERO, 0.0, Vector3(0, 3, 6))
	t.check(
		xf.origin.is_equal_approx(Vector3(0, 3, 6)),
		"with zero target yaw, the camera sits at exactly the raw offset from the target")

	# The camera must look back TOWARD the target — i.e. -Z (Godot's forward)
	# points from the camera position back at the origin.
	var to_target := (Vector3.ZERO - xf.origin).normalized()
	var forward := -xf.basis.z
	t.check(
		forward.is_equal_approx(to_target),
		"the follow camera's forward axis points at the target, not away from it")


static func _test_follow_transform_rotates_offset_with_target_yaw(t: TestUtils) -> void:
	var target_pos := Vector3(10, 0, 10)
	var offset := Vector3(0, 3, 6)

	var facing_zero := CameraRig.follow_transform(target_pos, 0.0, offset)
	var facing_half_turn := CameraRig.follow_transform(target_pos, PI, offset)

	t.check(
		not facing_zero.origin.is_equal_approx(facing_half_turn.origin),
		"turning the target 180 degrees moves the camera to the opposite side — the offset " +
			"rotates WITH the target, it isn't a fixed world-space offset")

	# A half-turn rotates the offset 180 degrees in the horizontal (X/Z)
	# plane only — height (Y) is unaffected by yaw, since yaw rotates around
	# the vertical axis.
	var offset_zero := facing_zero.origin - target_pos
	var offset_half := facing_half_turn.origin - target_pos
	t.check_almost(offset_zero.y, offset_half.y, "yaw rotation never changes the offset's height")
	t.check_almost(offset_zero.x, -offset_half.x, "a 180-degree yaw mirrors the offset's X component")
	t.check_almost(offset_zero.z, -offset_half.z, "a 180-degree yaw mirrors the offset's Z component")


static func _test_orbit_transform_distance_from_focus(t: TestUtils) -> void:
	var focus := Vector3(5, 5, 5)
	var xf := CameraRig.orbit_transform(focus, 0.4, 0.2, 12.0)
	t.check_almost(
		xf.origin.distance_to(focus), 12.0,
		"the orbit camera sits at exactly `distance` from the focus point regardless of angle")

	var forward := -xf.basis.z
	var to_focus := (focus - xf.origin).normalized()
	t.check(
		forward.is_equal_approx(to_focus),
		"the orbit camera always looks back at the focus point")


static func _test_orbit_transform_yaw_sweep(t: TestUtils) -> void:
	var focus := Vector3.ZERO
	var a := CameraRig.orbit_transform(focus, 0.0, 0.0, 10.0)
	var b := CameraRig.orbit_transform(focus, PI / 2.0, 0.0, 10.0)
	t.check(
		not a.origin.is_equal_approx(b.origin),
		"changing yaw actually moves the camera around the orbit sphere")
	t.check_almost(
		a.origin.distance_to(focus), b.origin.distance_to(focus),
		"distance from focus stays constant across a pure yaw sweep")


static func _test_free_fly_step_moves_in_look_direction(t: TestUtils) -> void:
	var identity_basis := Basis()
	var forward_input := Vector3(0, 0, -1)  # "forward" in local space
	var next := CameraRig.free_fly_step(Vector3.ZERO, identity_basis, forward_input, 8.0, 0.5)
	t.check(
		next.is_equal_approx(Vector3(0, 0, -4.0)),
		"one physics step of pure-forward input moves speed * delta along -Z at identity basis")

	var yawed_basis := Basis(Vector3.UP, PI / 2.0)
	var yawed_step := CameraRig.free_fly_step(Vector3.ZERO, yawed_basis, forward_input, 8.0, 0.5)
	t.check(
		not yawed_step.is_equal_approx(next),
		"the SAME local-forward input moves a different world direction once the basis is yawed " +
			"— movement is relative to where the camera is looking, not fixed world axes")


static func _test_free_fly_step_normalizes_diagonal_input(t: TestUtils) -> void:
	var identity_basis := Basis()
	var diagonal := Vector3(1, 0, -1)  # forward + right held together
	var straight := Vector3(0, 0, -1)  # forward only

	var diagonal_step := CameraRig.free_fly_step(Vector3.ZERO, identity_basis, diagonal, 8.0, 1.0)
	var straight_step := CameraRig.free_fly_step(Vector3.ZERO, identity_basis, straight, 8.0, 1.0)

	t.check_almost(
		diagonal_step.length(), straight_step.length(),
		"diagonal (two-axis) input travels the SAME distance per step as single-axis input " +
			"— input is normalized before scaling, so diagonal movement isn't faster")

	var zero_step := CameraRig.free_fly_step(Vector3.ZERO, identity_basis, Vector3.ZERO, 8.0, 1.0)
	t.check(
		zero_step.is_equal_approx(Vector3.ZERO),
		"no input held means no movement, never a fabricated drift")


static func _test_smoothed_transform_interpolates_and_clamps(t: TestUtils) -> void:
	var current := Transform3D(Basis(), Vector3.ZERO)
	var target := Transform3D(Basis(), Vector3(10, 0, 0))

	var half_step := CameraRig.smoothed_transform(current, target, 1.0, 0.5)
	t.check(
		half_step.origin.x > 0.0 and half_step.origin.x < 10.0,
		"a partial smoothing step lands strictly between current and target, never snapping")

	var huge_delta_step := CameraRig.smoothed_transform(current, target, 1000.0, 1.0)
	t.check(
		huge_delta_step.origin.is_equal_approx(target.origin),
		"an extreme smoothing*delta clamps at the target — a frame-rate hitch never overshoots past it")

	var zero_step := CameraRig.smoothed_transform(current, target, 0.0, 1.0)
	t.check(
		zero_step.origin.is_equal_approx(current.origin),
		"zero smoothing rate makes no progress toward the target in a single call")
