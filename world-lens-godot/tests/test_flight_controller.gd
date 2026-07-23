class_name TestFlightController
extends RefCounted
## Pure-logic tests for avatar/flight_controller.gd's ported aero core
## (`new_flight_state`/`step_flight`). ENGINE-GATED execution — see
## world-lens-godot/VISUAL_QA.md. Calls static functions directly; no
## CharacterBody3D or scene tree needed, same pattern as
## tests/test_character_controller.gd.

const FlightController := preload("res://avatar/flight_controller.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_new_state_defaults(t)
	_test_inactive_clamps_vy_only(t)
	_test_roll_drives_yaw_drift(t)
	_test_level_flight_bleeds_airspeed(t)
	_test_dive_gains_airspeed(t)
	_test_airspeed_caps_at_flight_max(t)
	_test_stall_enters_and_recovers(t)
	_test_roll_and_pitch_slew_rate_limited(t)
	return t


static func _test_new_state_defaults(t: TestUtils) -> void:
	var s: Dictionary = FlightController.new_flight_state()
	t.check_almost(s["airspeed"], 10.0, "new_flight_state starts at 10 m/s airspeed")
	t.check_almost(
		s["vy"], FlightController.GLIDE_DESCENT_CAP,
		"new_flight_state starts at the glide-descent floor")
	t.check(not s["stalled"], "new_flight_state is not stalled")


static func _test_inactive_clamps_vy_only(t: TestUtils) -> void:
	var s: Dictionary = FlightController.new_flight_state()
	s["vy"] = 3.0
	var inputs := {"roll": 0.0, "pitch": 0.0, "active": false}
	var next: Dictionary = FlightController.step_flight(s, inputs, {}, 0.1)
	t.check_almost(
		next["vy"], 0.0, "inactive flight clamps a climbing vy down to 0 (the idle ceiling)")
	t.check_almost(next["airspeed"], s["airspeed"], "inactive flight does not touch airspeed")

	var s2: Dictionary = FlightController.new_flight_state()
	s2["vy"] = -5.0
	var next2: Dictionary = FlightController.step_flight(s2, inputs, {}, 0.1)
	t.check_almost(
		next2["vy"], FlightController.GLIDE_DESCENT_CAP,
		"inactive flight clamps a fast descent up to GLIDE_DESCENT_CAP")


static func _test_roll_drives_yaw_drift(t: TestUtils) -> void:
	var s: Dictionary = FlightController.new_flight_state()
	var inputs := {"roll": 1.0, "pitch": 0.0, "active": true}
	var wind := {"wind": {"x": 0.0, "y": 0.0, "z": 0.0}, "lift": 0.0}
	var next: Dictionary = FlightController.step_flight(s, inputs, wind, 0.5)
	t.check(next["heading"] > 0.0, "full-right roll drifts heading positive after half a second")
	t.check(next["roll_rad"] > 0.0, "roll_rad approaches the roll target, not still zero")

	var s2: Dictionary = FlightController.new_flight_state()
	var inputs_left := {"roll": -1.0, "pitch": 0.0, "active": true}
	var next_left: Dictionary = FlightController.step_flight(s2, inputs_left, wind, 0.5)
	t.check(next_left["heading"] < 0.0, "full-left roll drifts heading negative")


static func _test_level_flight_bleeds_airspeed(t: TestUtils) -> void:
	var s: Dictionary = FlightController.new_flight_state()
	var inputs := {"roll": 0.0, "pitch": 0.0, "active": true}
	var wind := {"wind": {"x": 0.0, "y": 0.0, "z": 0.0}, "lift": 0.0}
	var next: Dictionary = FlightController.step_flight(s, inputs, wind, 1.0)
	var expected: float = s["airspeed"] - FlightController.AIRSPEED_BLEED * 1.0
	t.check_almost(
		next["airspeed"], expected, "level flight bleeds airspeed at AIRSPEED_BLEED per second")


static func _test_dive_gains_airspeed(t: TestUtils) -> void:
	var s: Dictionary = FlightController.new_flight_state()
	# Pitch fully nose-down and hold long enough for pitch_rad to actually
	# reach past -0.5 rad (slew-rate limited), then measure one more step.
	var inputs := {"roll": 0.0, "pitch": -1.0, "active": true}
	var wind := {"wind": {"x": 0.0, "y": 0.0, "z": 0.0}, "lift": 0.0}
	var state: Dictionary = s
	for _i in range(10):
		state = FlightController.step_flight(state, inputs, wind, 0.1)
	t.check(
		state["pitch_rad"] < -0.5, "sustained full nose-down input reaches past the dive threshold")

	var before_airspeed: float = state["airspeed"]
	var next: Dictionary = FlightController.step_flight(state, inputs, wind, 0.1)
	t.check(
		next["airspeed"] > before_airspeed,
		"airspeed increases while diving past the -0.5 rad pitch threshold")


static func _test_airspeed_caps_at_flight_max(t: TestUtils) -> void:
	var s: Dictionary = FlightController.new_flight_state()
	s["airspeed"] = 1000.0
	var inputs := {"roll": 0.0, "pitch": -1.0, "active": true}
	var wind := {"wind": {"x": 0.0, "y": 0.0, "z": 0.0}, "lift": 0.0}
	var next: Dictionary = FlightController.step_flight(s, inputs, wind, 0.1)
	t.check(
		next["airspeed"] <= FlightController.FLIGHT_MAX_AIRSPEED_MPS,
		"airspeed never exceeds FLIGHT_MAX_AIRSPEED_MPS (45 m/s), matching the server cap")


static func _test_stall_enters_and_recovers(t: TestUtils) -> void:
	var s: Dictionary = FlightController.new_flight_state()
	s["airspeed"] = 1.0
	s["pitch_rad"] = 0.5
	var inputs := {"roll": 0.0, "pitch": 1.0, "active": true}
	var wind := {"wind": {"x": 0.0, "y": 0.0, "z": 0.0}, "lift": 0.0}
	var next: Dictionary = FlightController.step_flight(s, inputs, wind, 0.05)
	t.check(next["stalled"], "high AoA + low airspeed enters a stall")

	# Recovery requires sustained nose-down for STALL_RECOVERY_MS.
	var recovering := next
	var recover_inputs := {"roll": 0.0, "pitch": -1.0, "active": true}
	var still_stalled_after_short := false
	for _i in range(5):
		recovering = FlightController.step_flight(recovering, recover_inputs, wind, 0.1)
	still_stalled_after_short = recovering["stalled"]
	t.check(
		still_stalled_after_short,
		"stall does not clear before STALL_RECOVERY_MS of nose-down has accumulated")

	for _i in range(30):
		recovering = FlightController.step_flight(recovering, recover_inputs, wind, 0.1)
	t.check(
		not recovering["stalled"],
		"sustained nose-down for STALL_RECOVERY_MS clears the stall")


static func _test_roll_and_pitch_slew_rate_limited(t: TestUtils) -> void:
	var s: Dictionary = FlightController.new_flight_state()
	var inputs := {"roll": 1.0, "pitch": 0.0, "active": true}
	var wind := {"wind": {"x": 0.0, "y": 0.0, "z": 0.0}, "lift": 0.0}
	# One tiny step should not already be at the full roll target (PI/2) —
	# ROLL_SLEW_RAD_S caps how fast roll_rad can approach it.
	var next: Dictionary = FlightController.step_flight(s, inputs, wind, 0.01)
	t.check(
		next["roll_rad"] < PI / 2.0, "roll approaches its target gradually, capped by ROLL_SLEW_RAD_S")
	t.check(next["roll_rad"] > 0.0, "roll_rad has moved toward the target after one step")
