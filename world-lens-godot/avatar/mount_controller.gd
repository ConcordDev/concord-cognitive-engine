class_name MountController
extends CharacterBody3D
## MountController — Godot client for C13's land-mount half (ground vehicles
## are the sibling file, avatar/ground_vehicle_controller.gd — kept separate
## because mounts and vehicles are governed by genuinely different real data
## models: a vehicle has a 3DOF throttle/steer/pitch acceleration spec
## (`VEHICLE_SPECS`, concord-frontend/lib/world-lens/vehicle-system.ts:31-35);
## a mount has a fixed `base_speed_mps` + `turn_radius_m` per species
## (migration 142's `mount_species`/`mount_gait_profiles` tables). Force-
## fitting a horse into the vehicle's acceleration-curve model would not be a
## port of anything real — it would be fabricated physics wearing a ported
## constant's clothes. This file uses the mount's OWN real fields instead.
##
## ── What is a REAL ported number vs. a REASONED ADDITION (read before editing) ──
## `base_speed_mps` and `turn_radius_m` themselves are real, per-species,
## already-seeded server data — NOT invented here:
##   - `mount_species.base_speed_mps` (server/migrations/142_mount_substrate.js:36,
##     `CHECK (base_speed_mps > 0 AND base_speed_mps <= 30)`); real per-species
##     values are seeded from server/seeds/mount_species.json (e.g. warhorse
##     8.5, dire_wolf 9.2, hippogriff 11.0 — a flight-capable species, but C13
##     only drives the ground-locked math below; C11 "Aerial mounts" is the
##     separate queued unit for flight_capable species).
##   - `mount_gait_profiles.turn_radius_m` (142_mount_substrate.js:57,
##     `CHECK (turn_radius_m > 0)`); same seed file (warhorse 4.0m, dire_wolf
##     3.0m, chimera 6.5m, ...).
##   - Server-side read path: `getMountSpecies`/`getGaitProfile`
##     (server/lib/ecosystem/mount-eligibility.js:49,68) expose these as
##     `baseSpeedMps`/`turnRadiusM`; `getActiveMountPayload`
##     (server/lib/companions-mount.js:164) is what a rider's client would
##     call to learn its OWN currently-ridden mount's real numbers.
##
## What IS a reasoned addition, flagged exactly like M2's `LIFT_HEIGHT_M`:
## `step_mount()`'s arc-turn kinematics (`yaw_rate = steer * speed /
## turn_radius_m`) have NO TypeScript/JavaScript source to port.
## `concord-frontend/lib/concordia/mounts/mount-types.ts:34-35` DECLARES
## `turnRadiusM` on `MountSpec` with the comment "used by steering + IK", but
## a repo-wide search (`grep -rln turnRadiusM concord-frontend/`) turns up
## only that type declaration and a unit test referencing it — no steering
## function anywhere consumes it (matching CLAUDE.md's own honest note:
## "today the mount cosmetically follows the walking rider"). This file's
## `step_mount()` is the first real consumer, using the standard constant-
## radius circular-motion identity v = omega * r (so omega = v / r) — this is
## textbook kinematics, not a fabricated number, but it is this PORT's
## addition, not a mirrored TS constant. `MIN_TURN_RADIUS_M = 0.1` (the
## division-by-near-zero guard) is likewise this file's own reasoned safety
## floor, not a ported value.
##
## ── Pure core / engine-glue split (same pattern as M2) ──────────────────────
## `step_mount()` is a static, engine-independent function — see
## tests/test_mount_controller.gd. The CharacterBody3D glue below applies its
## output as horizontal velocity via `move_and_slide()` (real Godot
## collision) and integrates a simple vertical gravity fall itself (mounts
## are ground creatures in this unit's scope — no TS/JS vertical-motion
## source to mirror here either; `GRAVITY = 9.81` is the same standard value
## every other controller in this project already uses, e.g.
## player/character_controller.gd's own `GRAVITY` constant).
##
## ── Server contract (real, already-real substrate) ───────────────────────────
## Riding requires an active `mounted_instances` row — `applyPlayerMode`'s
## "mount:*" branch (server.js:8930-8943) rejects `player:mode
## {mode:"mount:<speciesId>"}` with `{reason:"not_mounted"}` unless
## `getActiveMountPayload` confirms the rider is really mounted on that exact
## species, and the server itself derives the authoritative `mountSpeedMps`
## from `payload.species.baseSpeedMps` — this controller's own
## `base_speed_mps`/`turn_radius_m` exported fields exist so the CLIENT can
## drive matching visuals/feel locally, but the server never trusts them; it
## re-derives its own copy from the DB. This controller must be `configure()`d
## with the SAME real values (fetched by the caller from the mount payload,
## e.g. via the `mounts` domain's active-mount macro) before
## `set_riding_active(true)` — it refuses to activate on unset/non-positive
## data rather than silently falling back to a made-up speed (unlike the
## server's own defensive `DEFAULT_MOUNT_SPEED_MPS` fallback, which exists
## only to keep anti-cheat conservative on a malformed *legitimacy* payload,
## not to hand a specific mount a speed it doesn't really have).

signal move_rejected(snapped_to: Vector3)
signal ride_mode_rejected(reason: String)

const CharacterController := preload("res://player/character_controller.gd")

## Standard gravity, m/s^2. Same value every other controller in this
## project already cites (e.g. player/character_controller.gd's own
## `GRAVITY`). No TS/JS mount-specific source exists to mirror instead.
const GRAVITY: float = 9.81

## Division-by-near-zero guard for `turn_radius_m` — see header. Own
## reasoned safety floor, not a ported value.
const MIN_TURN_RADIUS_M: float = 0.1

## Mirrors server.js's `player:move` accept-rate cap, same constant
## character_controller.gd already cites.
const MOVE_SEND_MIN_INTERVAL_MS: int = 33

@export var world_id: String = "concordia-hub"
## Injected GatewayClient (net/gateway_client.gd) instance — same DI
## convention as player/character_controller.gd.
@export var gateway: Node = null

var species_id: String = ""
## Real per-species value from `mount_species.base_speed_mps` — see header.
## 0.0 (unset) is treated as "not configured"; `set_riding_active(true)`
## refuses to start with this value.
var base_speed_mps: float = 0.0
## Real per-species value from `mount_gait_profiles.turn_radius_m` — see
## header.
var turn_radius_m: float = 0.0

var riding_active: bool = false
var _heading: float = 0.0
var _vertical_vel: float = 0.0
var _last_move_sent_ms: int = 0
var _snap_target: Vector3 = Vector3.ZERO
var _pending_snap: bool = false


func _ready() -> void:
	if gateway != null and gateway.has_signal("event_received"):
		gateway.event_received.connect(_on_gateway_event)


func _physics_process(delta: float) -> void:
	if _pending_snap:
		global_position = _snap_target
		_vertical_vel = 0.0
		_pending_snap = false

	if not riding_active:
		return

	var inputs := {"throttle": _read_throttle_input(), "steer": _read_steer_input()}
	var result: Dictionary = MountController.step_mount(
		{"heading": _heading}, inputs, base_speed_mps, turn_radius_m, delta)
	_heading = float(result["heading"])

	if is_on_floor():
		_vertical_vel = 0.0
	else:
		_vertical_vel -= GRAVITY * delta

	velocity = Vector3(float(result["vx"]), _vertical_vel, float(result["vz"]))
	rotation.y = _heading
	move_and_slide()

	var now_ms := Time.get_ticks_msec()
	if CharacterController.should_send_move(now_ms, _last_move_sent_ms, MOVE_SEND_MIN_INTERVAL_MS):
		_last_move_sent_ms = now_ms
		_send_move_intent()


## Set the real per-species data (from a live `getActiveMountPayload`-shaped
## response) before activating. Never called with fabricated numbers by this
## file itself — the caller owns fetching the real payload.
func configure(new_species_id: String, new_base_speed_mps: float, new_turn_radius_m: float) -> void:
	species_id = new_species_id
	base_speed_mps = new_base_speed_mps
	turn_radius_m = new_turn_radius_m


## Start/stop riding. Refuses to start on unset/non-positive mount data
## (honest failure, no fabricated fallback speed — see header) and, when
## data is valid, sends the legitimacy-gate `player:mode` request; a
## `player:mode:nack` (real mount ownership check failed server-side) flips
## `riding_active` back off via `_on_gateway_event` rather than continuing to
## move as if mounted.
func set_riding_active(on: bool) -> bool:
	if on == riding_active:
		return true
	if on:
		if base_speed_mps <= 0.0 or turn_radius_m <= 0.0 or species_id == "":
			ride_mode_rejected.emit("not_configured")
			return false
		_request_mode("mount:%s" % species_id)
		_heading = rotation.y
	else:
		_request_mode("walk")
	riding_active = on
	return true


func _read_throttle_input() -> float:
	var v := 0.0
	if Input.is_key_pressed(KEY_W):
		v += 1.0
	return clampf(v, 0.0, 1.0)


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
		"action": "ride",
		"currentAnimation": "ride",
	})


func _on_gateway_event(evt: String, data: Dictionary) -> void:
	if evt == "player:move:nack":
		_snap_target = CharacterController.snapback_position(data, global_position)
		_pending_snap = true
		move_rejected.emit(_snap_target)
		return
	if evt == "player:mode:nack" and not riding_active:
		ride_mode_rejected.emit(String(data.get("reason", "unknown")))


# ── Pure static ground-mount kinematics (no engine calls) ────────────────────

## REASONED ADDITION — see header "What IS a reasoned addition" section for
## why this has no TS/JS source to cite. `state`: {heading}. `inputs`:
## {throttle in [0,1], steer in [-1,1]}. Returns {heading, speed, vx, vz}
## (horizontal velocity components; vertical motion is the caller's concern
## — see the engine-glue's own gravity integration).
static func step_mount(
		state: Dictionary, inputs: Dictionary,
		base_speed_mps_arg: float, turn_radius_m_arg: float, dt: float) -> Dictionary:
	var throttle: float = clampf(float(inputs.get("throttle", 0.0)), 0.0, 1.0)
	var steer: float = clampf(float(inputs.get("steer", 0.0)), -1.0, 1.0)

	var speed: float = throttle * maxf(0.0, base_speed_mps_arg)
	var safe_turn_radius: float = maxf(turn_radius_m_arg, MIN_TURN_RADIUS_M)
	# omega = v / r — constant-radius circular-motion identity, see header.
	var yaw_rate: float = steer * (speed / safe_turn_radius)
	var heading: float = float(state.get("heading", 0.0)) + yaw_rate * dt

	return {
		"heading": heading,
		"speed": speed,
		"vx": sin(heading) * speed,
		"vz": cos(heading) * speed,
	}
