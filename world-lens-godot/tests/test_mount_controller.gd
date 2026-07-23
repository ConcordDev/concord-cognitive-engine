class_name TestMountController
extends RefCounted
## Pure-logic tests for avatar/mount_controller.gd's `step_mount()` arc-turn
## kinematics — a REASONED ADDITION (no TS/JS source; see that file's
## header). ENGINE-GATED execution — see world-lens-godot/VISUAL_QA.md.
## Calls the static function directly; no CharacterBody3D or scene tree
## needed.

const MountController := preload("res://avatar/mount_controller.gd")
const TestUtils := preload("res://tests/test_utils.gd")

## Real seeded values from server/seeds/mount_species.json (warhorse).
const WARHORSE_SPEED_MPS: float = 8.5
const WARHORSE_TURN_RADIUS_M: float = 4.0


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_full_throttle_reaches_base_speed(t)
	_test_zero_throttle_is_stationary(t)
	_test_throttle_scales_speed_linearly(t)
	_test_full_steer_yaws_at_speed_over_radius(t)
	_test_stationary_mount_does_not_yaw_even_with_steer(t)
	_test_no_steer_holds_heading(t)
	_test_tighter_turn_radius_yaws_faster_at_same_speed(t)
	_test_velocity_components_match_heading(t)
	return t


static func _test_full_throttle_reaches_base_speed(t: TestUtils) -> void:
	var state := {"heading": 0.0}
	var inputs := {"throttle": 1.0, "steer": 0.0}
	var next: Dictionary = MountController.step_mount(
		state, inputs, WARHORSE_SPEED_MPS, WARHORSE_TURN_RADIUS_M, 0.1)
	t.check_almost(
		next["speed"], WARHORSE_SPEED_MPS, "full throttle reaches the mount's real base_speed_mps")


static func _test_zero_throttle_is_stationary(t: TestUtils) -> void:
	var state := {"heading": 0.0}
	var inputs := {"throttle": 0.0, "steer": 1.0}
	var next: Dictionary = MountController.step_mount(
		state, inputs, WARHORSE_SPEED_MPS, WARHORSE_TURN_RADIUS_M, 0.1)
	t.check_almost(next["speed"], 0.0, "zero throttle produces zero speed")
	t.check_almost(next["heading"], 0.0, "a stationary mount does not turn even at full steer")


static func _test_throttle_scales_speed_linearly(t: TestUtils) -> void:
	var state := {"heading": 0.0}
	var half := MountController.step_mount(
		state, {"throttle": 0.5, "steer": 0.0}, WARHORSE_SPEED_MPS, WARHORSE_TURN_RADIUS_M, 0.1)
	t.check_almost(half["speed"], WARHORSE_SPEED_MPS * 0.5, "half throttle produces half base speed")


static func _test_full_steer_yaws_at_speed_over_radius(t: TestUtils) -> void:
	var state := {"heading": 0.0}
	var inputs := {"throttle": 1.0, "steer": 1.0}
	var next: Dictionary = MountController.step_mount(
		state, inputs, WARHORSE_SPEED_MPS, WARHORSE_TURN_RADIUS_M, 1.0)
	# omega = v / r = 8.5 / 4.0 = 2.125 rad/s; over dt=1.0s, heading += 2.125.
	var expected_yaw_rate: float = WARHORSE_SPEED_MPS / WARHORSE_TURN_RADIUS_M
	t.check_almost(
		next["heading"], expected_yaw_rate, "yaw rate matches the v/r arc-turn identity")


static func _test_stationary_mount_does_not_yaw_even_with_steer(t: TestUtils) -> void:
	var state := {"heading": 0.5}
	var inputs := {"throttle": 0.0, "steer": 1.0}
	var next: Dictionary = MountController.step_mount(
		state, inputs, WARHORSE_SPEED_MPS, WARHORSE_TURN_RADIUS_M, 1.0)
	t.check_almost(
		next["heading"], 0.5, "no forward speed means no turning, regardless of steer input")


static func _test_no_steer_holds_heading(t: TestUtils) -> void:
	var state := {"heading": 1.0}
	var inputs := {"throttle": 1.0, "steer": 0.0}
	var next: Dictionary = MountController.step_mount(
		state, inputs, WARHORSE_SPEED_MPS, WARHORSE_TURN_RADIUS_M, 1.0)
	t.check_almost(next["heading"], 1.0, "riding straight (no steer) holds heading constant")


static func _test_tighter_turn_radius_yaws_faster_at_same_speed(t: TestUtils) -> void:
	var state := {"heading": 0.0}
	var inputs := {"throttle": 1.0, "steer": 1.0}
	# Dire wolf: base_speed_mps 9.2, turn_radius_m 3.0 (tighter than warhorse's 4.0).
	var tight: Dictionary = MountController.step_mount(state, inputs, 9.2, 3.0, 1.0)
	var wide: Dictionary = MountController.step_mount(state, inputs, 9.2, 6.5, 1.0)
	t.check(
		tight["heading"] > wide["heading"],
		"a smaller turn_radius_m yaws faster at the same speed and steer input")


static func _test_velocity_components_match_heading(t: TestUtils) -> void:
	var state := {"heading": PI / 2.0}
	var inputs := {"throttle": 1.0, "steer": 0.0}
	var next: Dictionary = MountController.step_mount(
		state, inputs, WARHORSE_SPEED_MPS, WARHORSE_TURN_RADIUS_M, 0.01)
	# At heading = PI/2 (facing +x), horizontal velocity should be almost
	# entirely +x with near-zero z.
	t.check(
		next["vx"] > WARHORSE_SPEED_MPS * 0.9, "velocity x-component matches sin(heading)*speed")
	t.check(
		absf(next["vz"]) < 0.01, "velocity z-component matches cos(heading)*speed near zero at PI/2")
