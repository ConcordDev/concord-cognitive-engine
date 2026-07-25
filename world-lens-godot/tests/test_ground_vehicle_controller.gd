class_name TestGroundVehicleController
extends RefCounted
## Pure-logic tests for avatar/ground_vehicle_controller.gd's ported 3DOF
## core (`vehicle_spec`/`empty_pose`/`step_vehicle`).
##
## ENGINE-EXECUTED (2026-07-25). A real Godot 4.4 headless binary now lives
## at `./.godot-runtime/bin/godot` (see docs/GODOT_RUNTIME.md), and
## `--script tests/run_all.gd` compiles and RUNS this suite — its 16 checks
## are asserted on every run. Calls static functions directly; no
## CharacterBody3D or scene tree needed.
##
## Verified: the byte-for-byte port of vehicle-system.ts's spec table and
## `stepVehicle` integration — throttle/steer response, speed clamping, and
## pose advancement now produce the numbers the TS source produces.
##
## NOT verified: driving feel, and the `_physics_process` glue that applies
## the stepped pose to a real CharacterBody3D (so collision, slope handling
## and any visible jitter are all untested). Headless installs
## RasterizerDummy and draws nothing — queued in
## world-lens-godot/VISUAL_QA.md.

const GroundVehicleController := preload("res://avatar/ground_vehicle_controller.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_vehicle_specs_match_ported_values(t)
	_test_unknown_type_falls_back_to_car(t)
	_test_car_accelerates_forward_and_gravity_grounds_it(t)
	_test_car_speed_caps_at_max_speed(t)
	_test_car_brake_decelerates_harder_than_throttle_release(t)
	_test_steer_changes_heading(t)
	_test_glider_lift_offsets_gravity_at_speed(t)
	_test_plane_has_no_gravity(t)
	return t


static func _test_vehicle_specs_match_ported_values(t: TestUtils) -> void:
	# vehicle-system.ts:32-34 — byte-for-byte.
	var car: Dictionary = GroundVehicleController.vehicle_spec("car")
	t.check_almost(car["max_speed"], 40.0, "car maxSpeed matches vehicle-system.ts:32")
	t.check_almost(car["acceleration"], 8.0, "car acceleration matches vehicle-system.ts:32")
	t.check_almost(car["turn_rate"], 1.2, "car turnRate matches vehicle-system.ts:32")
	t.check(car["has_gravity"], "car hasGravity matches vehicle-system.ts:32")

	var glider: Dictionary = GroundVehicleController.vehicle_spec("glider")
	t.check_almost(glider["max_speed"], 60.0, "glider maxSpeed matches vehicle-system.ts:33")
	t.check_almost(
		glider["lift_per_speed_squared"], 0.012, "glider lift coef matches vehicle-system.ts:33")

	var plane: Dictionary = GroundVehicleController.vehicle_spec("plane")
	t.check_almost(plane["max_speed"], 150.0, "plane maxSpeed matches vehicle-system.ts:34")
	t.check(not plane["has_gravity"], "plane hasGravity=false matches vehicle-system.ts:34")


static func _test_unknown_type_falls_back_to_car(t: TestUtils) -> void:
	var unknown: Dictionary = GroundVehicleController.vehicle_spec("hovercraft")
	var car: Dictionary = GroundVehicleController.vehicle_spec("car")
	t.check_eq(unknown["max_speed"], car["max_speed"], "an unknown vehicle type falls back to car")


static func _test_car_accelerates_forward_and_gravity_grounds_it(t: TestUtils) -> void:
	var pose: Dictionary = GroundVehicleController.empty_pose()
	var inputs := {"throttle": 1.0, "steer": 0.0, "brake": false}
	var next: Dictionary = GroundVehicleController.step_vehicle("car", pose, inputs, 0.1)
	t.check(next["vz"] > 0.0, "full throttle at heading 0 accelerates along +z")
	t.check_almost(next["y"], 0.0, "car with hasGravity stays clamped to the ground plane at y=0")


static func _test_car_speed_caps_at_max_speed(t: TestUtils) -> void:
	var pose: Dictionary = GroundVehicleController.empty_pose()
	pose["vz"] = 1000.0
	var inputs := {"throttle": 1.0, "steer": 0.0, "brake": false}
	var next: Dictionary = GroundVehicleController.step_vehicle("car", pose, inputs, 0.1)
	var speed: float = Vector3(next["vx"], next["vy"], next["vz"]).length()
	t.check(speed <= 40.0 + 0.001, "car speed never exceeds its 40 m/s maxSpeed")


static func _test_car_brake_decelerates_harder_than_throttle_release(t: TestUtils) -> void:
	var pose: Dictionary = GroundVehicleController.empty_pose()
	pose["vz"] = 20.0
	var released := {"throttle": 0.0, "steer": 0.0, "brake": false}
	var braked := {"throttle": 0.0, "steer": 0.0, "brake": true}
	var next_released: Dictionary = GroundVehicleController.step_vehicle("car", pose, released, 0.1)
	var next_braked: Dictionary = GroundVehicleController.step_vehicle("car", pose, braked, 0.1)
	t.check(
		next_braked["vz"] < next_released["vz"],
		"braking decelerates strictly faster than coasting with throttle released")


static func _test_steer_changes_heading(t: TestUtils) -> void:
	var pose: Dictionary = GroundVehicleController.empty_pose()
	var inputs := {"throttle": 0.0, "steer": 1.0, "brake": false}
	var next: Dictionary = GroundVehicleController.step_vehicle("car", pose, inputs, 1.0)
	t.check_almost(next["ry"], 1.2, "full-right steer for 1s at turnRate=1.2 turns heading by 1.2 rad")


static func _test_glider_lift_offsets_gravity_at_speed(t: TestUtils) -> void:
	var pose: Dictionary = GroundVehicleController.empty_pose()
	pose["vz"] = 60.0
	pose["y"] = 50.0
	var inputs := {"throttle": 0.0, "steer": 0.0, "pitch": 0.0, "brake": false}
	var next: Dictionary = GroundVehicleController.step_vehicle("glider", pose, inputs, 0.1)
	# liftPerSpeedSquared * speed^2 = 0.012 * 3600 = 43.2, vs gravity*dt = 0.981
	# — lift should dominate at this speed, net vy positive before capping.
	t.check(next["vy"] > -GroundVehicleController.GRAVITY * 0.1, "lift at high speed offsets gravity")


static func _test_plane_has_no_gravity(t: TestUtils) -> void:
	var pose: Dictionary = GroundVehicleController.empty_pose()
	pose["vz"] = 100.0
	pose["y"] = 200.0
	var inputs := {"throttle": 0.0, "steer": 0.0, "pitch": 0.0, "brake": false}
	var next: Dictionary = GroundVehicleController.step_vehicle("plane", pose, inputs, 1.0)
	t.check(
		next["y"] >= pose["y"] - 0.01,
		"a plane (hasGravity=false) does not fall under its own gravity term")
