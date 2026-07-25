class_name TestFlightController
extends RefCounted
## Pure-logic tests for avatar/flight_controller.gd's ported aero core
## (`new_flight_state`/`step_flight`).
##
## ENGINE-EXECUTED (2026-07-25). A real Godot 4.4 headless binary now lives
## at `./.godot-runtime/bin/godot` (see docs/GODOT_RUNTIME.md), and
## `--script tests/run_all.gd` compiles and RUNS this suite — its 20 checks
## are asserted on every run. Calls static functions directly; no
## CharacterBody3D or scene tree needed, same pattern as
## tests/test_character_controller.gd.
##
## Verified: the ported state machine's arithmetic — bank→yaw drift, airspeed
## bleed and dive-gain, stall onset and nose-down recovery, the glide-floor
## vertical velocity, and that airspeed never exceeds the 45 m/s ceiling that
## also happens to be the server's authoritative FLY_MAX_SPEED_MPS. That last
## one is a real anti-cheat-envelope check and it genuinely holds.
##
## NOT verified: how flying FEELS, which is most of what this controller is
## for. Also unexercised here: the `_physics_process` glue that converts the
## pure state into a CharacterBody3D velocity and calls `move_and_slide()`,
## so real collision response is untested, and the honest-zero wind sample
## means "still air" is all anything has ever flown through. Headless
## installs RasterizerDummy and draws nothing — queued in
## world-lens-godot/VISUAL_QA.md.

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
	# `step_flight` clamps its own timestep to a 0.25s maximum — a deliberate
	# spiral-of-death guard carried over verbatim from the authoritative
	# source (`concord-frontend/lib/concordia/flight-physics.ts`'s
	# `const dt = Math.max(0.0001, Math.min(0.25, dtSeconds))`). So a single
	# call with dt=1.0 does NOT advance a full second of simulation; it
	# advances 0.25s and bleeds 0.1 m/s. To measure the genuine per-second
	# rate, accumulate one real second out of legal sub-clamp timesteps.
	var s: Dictionary = FlightController.new_flight_state()
	var inputs := {"roll": 0.0, "pitch": 0.0, "active": true}
	var wind := {"wind": {"x": 0.0, "y": 0.0, "z": 0.0}, "lift": 0.0}
	var state: Dictionary = s
	for _i in range(5):
		state = FlightController.step_flight(state, inputs, wind, 0.2)
	# Level flight: pitch never leaves 0, so no dive gain and no stall. One
	# second of pure drag => exactly AIRSPEED_BLEED m/s lost.
	var expected: float = float(s["airspeed"]) - FlightController.AIRSPEED_BLEED * 1.0
	t.check_almost(
		state["airspeed"], expected, "level flight bleeds airspeed at AIRSPEED_BLEED per second")

	# Pin the timestep clamp itself, so the behaviour that made the old
	# single-call expectation wrong is now covered rather than surprising.
	var one_big_step: Dictionary = FlightController.step_flight(s, inputs, wind, 1.0)
	var clamped: Dictionary = FlightController.step_flight(s, inputs, wind, 0.25)
	t.check_almost(
		one_big_step["airspeed"], clamped["airspeed"],
		"an over-long dt is clamped to 0.25s, matching flight-physics.ts")
	t.check_almost(
		one_big_step["airspeed"], float(s["airspeed"]) - FlightController.AIRSPEED_BLEED * 0.25,
		"the clamped step bleeds exactly 0.25s worth of drag")


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
