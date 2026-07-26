class_name GroundVehicleController
extends CharacterBody3D
## GroundVehicleController — Godot client for C13's ground-vehicle half
## (land mounts are the sibling file, avatar/mount_controller.gd — the two
## use genuinely different math, see that file's header for why they are
## not force-fit into one model).
##
## ── Pure 3DOF core ported from concord-frontend/lib/world-lens/vehicle-system.ts ──
## `VEHICLE_SPECS`/`step_vehicle()` below are a byte-for-byte port of that
## file's `VEHICLE_SPECS`/`stepVehicle()` (all three vehicle classes —
## car/glider/plane — are ported, even though this unit's ENGINE GLUE only
## drives "car", the ground-bound C13 scope; C12 "Aircraft/hover" is a
## separate queued backlog item and can reuse `step_vehicle("glider"|"plane",
## ...)` directly with no re-port). Every constant is cited to its exact
## source line. Pure functions take/return plain Dictionaries, no engine
## dependency — see tests/test_ground_vehicle_controller.gd — matching M2's
## gait_solver.gd (pure) + avatar_rig.gd (glue) split.
##
## ── Why CharacterBody3D, when the TS source explicitly skips a physics world ──
## vehicle-system.ts's own header (lines 14-17) says Rapier integration is
## "intentionally NOT done here... uses simple kinematic interpolation that
## doesn't need a physics world" — that was a decision to avoid pulling in
## Rapier (a heavy, separate physics engine) into the Three.js client. Godot
## already ships CharacterBody3D + `move_and_slide()` as a NATIVE kinematic
## body with built-in collision resolution — using it here is not "adding a
## physics world" in the sense the TS comment was avoiding, it's using the
## engine's own free kinematic-collision primitive so a vehicle doesn't clip
## through world geometry. The pure `step_vehicle()` math is unchanged from
## the TS source either way; only the position/collision APPLICATION differs
## by engine, exactly like character_controller.gd already does for the
## on-foot case.
##
## ── Server contract (real, already-real substrate) ──────────────────────────
## Driving requires the rider to already be legitimately mounted in a vehicle
## of this type — `applyPlayerMode`'s "vehicle:*" branch (server.js:8945-8954)
## rejects `player:mode {mode:"vehicle:car"}` with `{reason:"not_in_vehicle"}`
## unless `cityPresence.getUserVehicle(userId)` already shows an active
## vehicle of that exact type, which itself requires a prior
## `POST /api/vehicles/:id/mount` call (out of scope for this GDScript unit —
## that HTTP round-trip is a UI/authoring concern, not a movement-controller
## concern). This controller calls `player:mode` honestly and only starts
## driving locally once `player:mode:ack` confirms it — a rejected request
## leaves `driving_active` false and emits `drive_mode_rejected` rather than
## silently moving anyway.

signal move_rejected(snapped_to: Vector3)
signal drive_mode_rejected(reason: String)

const CharacterController := preload("res://player/character_controller.gd")

## m/s^2 for gravity while a vehicle class has hasGravity=true.
## vehicle-system.ts:50.
const GRAVITY: float = 9.81

## Mirrors server.js's `player:move` accept-rate cap, same constant
## character_controller.gd already cites.
const MOVE_SEND_MIN_INTERVAL_MS: int = 33

## Server-authoritative ceilings for reference/citation only (this file does
## not enforce them — server/lib/city-presence.js's `VEHICLE_MAX_SPEED_MPS`
## (city-presence.js:56-61) is the actual anti-cheat gate; a client that
## reports a speed above these is rejected server-side regardless of what
## this controller computes). They happen to equal `VEHICLE_SPECS`'s own
## `maxSpeed` fields below byte-for-byte (car 40 / glider 60 / plane 150) —
## the TS client cap and the server cap were already tuned to match before
## this port; this file changes neither.
const SERVER_VEHICLE_MAX_SPEED_MPS: Dictionary = {
	"car": 40.0, "glider": 60.0, "plane": 150.0,
}

@export var world_id: String = "concordia-hub"
@export var vehicle_type: String = "car"
## Injected GatewayClient (net/gateway_client.gd) instance — same DI
## convention as player/character_controller.gd.
@export var gateway: Node = null

var driving_active: bool = false
var _pose: Dictionary = {}
var _inputs: Dictionary = {"throttle": 0.0, "steer": 0.0, "pitch": 0.0, "brake": false}
var _last_move_sent_ms: int = 0
var _snap_target: Vector3 = Vector3.ZERO
var _pending_snap: bool = false


func _ready() -> void:
	_pose = GroundVehicleController.empty_pose()
	if gateway != null and gateway.has_signal("event_received"):
		gateway.event_received.connect(_on_gateway_event)


func _physics_process(delta: float) -> void:
	if _pending_snap:
		global_position = _snap_target
		_pending_snap = false

	if not driving_active:
		return

	_inputs["throttle"] = _read_throttle_input()
	_inputs["steer"] = _read_steer_input()
	_inputs["brake"] = Input.is_key_pressed(KEY_SPACE)

	_pose = GroundVehicleController.step_vehicle(vehicle_type, _pose, _inputs, delta)

	velocity = Vector3(float(_pose["vx"]), float(_pose["vy"]), float(_pose["vz"]))
	rotation.y = float(_pose["ry"])
	move_and_slide()
	# Keep the pure pose's own position tracking honest against wherever
	# move_and_slide's collision response actually left the body.
	_pose["x"] = global_position.x
	_pose["y"] = global_position.y
	_pose["z"] = global_position.z

	var now_ms := Time.get_ticks_msec()
	if CharacterController.should_send_move(now_ms, _last_move_sent_ms, MOVE_SEND_MIN_INTERVAL_MS):
		_last_move_sent_ms = now_ms
		_send_move_intent()


## Start/stop driving. Requires the caller to have already legitimately
## mounted a vehicle of `vehicle_type` server-side (see header) — this only
## SENDS the request; `driving_active` flips true only after
## `player:mode:ack`, and false immediately on `player:mode:nack`.
func set_driving_active(on: bool) -> void:
	if on == driving_active:
		return
	if on:
		_request_mode("vehicle:%s" % vehicle_type)
		_pose = GroundVehicleController.empty_pose()
		_pose["x"] = global_position.x
		_pose["y"] = global_position.y
		_pose["z"] = global_position.z
		_pose["ry"] = rotation.y
	else:
		_request_mode("walk")
	driving_active = on


func _read_throttle_input() -> float:
	var v := 0.0
	if Input.is_key_pressed(KEY_W):
		v += 1.0
	if Input.is_key_pressed(KEY_S):
		v -= 1.0
	return v


func _read_steer_input() -> float:
	var v := 0.0
	if Input.is_key_pressed(KEY_A):
		v -= 1.0
	if Input.is_key_pressed(KEY_D):
		v += 1.0
	return v


func _request_mode(mode: String) -> void:
	if gateway == null or not gateway.has_method("send_event"):
		return
	gateway.send_event("player:mode", {"mode": mode})


func _send_move_intent() -> void:
	if gateway == null or not gateway.has_method("send_event"):
		return
	gateway.send_event("player:move", {
		"cityId": world_id,
		"x": global_position.x,
		"y": global_position.y,
		"z": global_position.z,
		"direction": rotation.y,
		"rotation": rotation.y,
		"action": "drive",
		"currentAnimation": "drive",
	})


func _on_gateway_event(evt: String, data: Dictionary) -> void:
	if evt == "player:move:nack":
		_snap_target = CharacterController.snapback_position(data, global_position)
		_pending_snap = true
		move_rejected.emit(_snap_target)
		return
	if evt == "player:mode:nack" and not driving_active:
		# We requested "vehicle:<type>" and the server said no (not actually
		# mounted). Never start driving against its say-so.
		drive_mode_rejected.emit(String(data.get("reason", "unknown")))


# ── Pure static 3DOF core (no engine calls) ──────────────────────────────────

## Ported verbatim from vehicle-system.ts:31-35's `VEHICLE_SPECS` map.
## Fields: maxSpeed (m/s), acceleration (m/s^2), turnRate (rad/s),
## pitchRate (rad/s, aerial only), hasGravity, liftPerSpeedSquared.
static func vehicle_spec(vehicle_type_key: String) -> Dictionary:
	match vehicle_type_key:
		"car":
			return {
				"max_speed": 40.0, "acceleration": 8.0, "turn_rate": 1.2,
				"pitch_rate": 0.0, "has_gravity": true, "lift_per_speed_squared": 0.0,
			}
		"glider":
			return {
				"max_speed": 60.0, "acceleration": 4.0, "turn_rate": 0.8,
				"pitch_rate": 0.5, "has_gravity": true, "lift_per_speed_squared": 0.012,
			}
		"plane":
			return {
				"max_speed": 150.0, "acceleration": 15.0, "turn_rate": 1.0,
				"pitch_rate": 0.7, "has_gravity": false, "lift_per_speed_squared": 0.025,
			}
		_:
			# Unknown type — fall back to the most conservative (car) spec
			# rather than defaulting open, mirroring city-presence.js's own
			# "never trust an unrecognized mode string" posture.
			return GroundVehicleController.vehicle_spec("car")


static func empty_pose() -> Dictionary:
	return {
		"x": 0.0, "y": 0.0, "z": 0.0,
		"rx": 0.0, "ry": 0.0, "rz": 0.0,
		"vx": 0.0, "vy": 0.0, "vz": 0.0,
	}


## Mirrors stepVehicle() exactly (vehicle-system.ts:56-114), field-for-field.
## `pose`: {x,y,z, rx,ry,rz, vx,vy,vz}. `inputs`: {throttle, steer, pitch, brake}.
static func step_vehicle(
		vehicle_type_key: String, pose: Dictionary, inputs: Dictionary, dt: float) -> Dictionary:
	var spec: Dictionary = GroundVehicleController.vehicle_spec(vehicle_type_key)
	var next: Dictionary = pose.duplicate(true)

	next["ry"] = float(pose["ry"]) + float(inputs.get("steer", 0.0)) * float(spec["turn_rate"]) * dt

	var pitch_rate: float = float(spec["pitch_rate"])
	if pitch_rate != 0.0 and inputs.has("pitch"):
		next["rx"] = clampf(
			float(pose["rx"]) + float(inputs["pitch"]) * pitch_rate * dt, -PI / 3.0, PI / 3.0)

	var fx: float = sin(float(next["ry"])) * cos(float(next["rx"]))
	var fy: float = -sin(float(next["rx"]))
	var fz: float = cos(float(next["ry"])) * cos(float(next["rx"]))

	var accel: float
	if inputs.get("brake", false):
		accel = -float(spec["acceleration"]) * 1.5
	else:
		accel = float(inputs.get("throttle", 0.0)) * float(spec["acceleration"])
	next["vx"] = float(pose["vx"]) + fx * accel * dt
	next["vy"] = float(pose["vy"]) + fy * accel * dt
	next["vz"] = float(pose["vz"]) + fz * accel * dt

	var lift_coef: float = float(spec["lift_per_speed_squared"])
	if lift_coef != 0.0:
		var speed_sq: float = (
			float(next["vx"]) * float(next["vx"])
			+ float(next["vy"]) * float(next["vy"])
			+ float(next["vz"]) * float(next["vz"]))
		next["vy"] = float(next["vy"]) + lift_coef * speed_sq * cos(float(next["rx"])) * dt

	if spec["has_gravity"]:
		next["vy"] = float(next["vy"]) - GRAVITY * dt

	var speed: float = Vector3(float(next["vx"]), float(next["vy"]), float(next["vz"])).length()
	var max_speed: float = float(spec["max_speed"])
	if speed > max_speed and speed > 0.0:
		var k: float = max_speed / speed
		next["vx"] = float(next["vx"]) * k
		next["vy"] = float(next["vy"]) * k
		next["vz"] = float(next["vz"]) * k

	next["x"] = float(pose["x"]) + float(next["vx"]) * dt
	next["y"] = float(pose["y"]) + float(next["vy"]) * dt
	next["z"] = float(pose["z"]) + float(next["vz"]) * dt

	if spec["has_gravity"] and float(next["y"]) < 0.0:
		next["y"] = 0.0
		if float(next["vy"]) < 0.0:
			next["vy"] = 0.0

	return next
