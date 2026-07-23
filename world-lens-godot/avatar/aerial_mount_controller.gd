class_name AerialMountController
extends CharacterBody3D
## AerialMountController — Godot client for C11 (master-spec "Aerial mounts &
## witch brooms"), built as a REUSE of the two controllers C10/C13 already
## shipped, not a third parallel physics system.
##
## ── The real flight-capable species (cited, not invented) ───────────────────
## `server/seeds/mount_species.json` seeds exactly 3 species with
## `"flight_capable": 1` (every other seeded species — warhorse, dire_wolf,
## chimera, giant_elk, salamander_mount — is `flight_capable: 0` and stays on
## `avatar/mount_controller.gd`'s ground-only path):
##   - `hippogriff`  — base_speed_mps 11.0 (mount_species.json:103)
##   - `gryphon`     — base_speed_mps 12.0 (mount_species.json:122)
##   - `juvenile_wyvern` — base_speed_mps 10.5 (mount_species.json:141)
## Their `turn_radius_m` (5.0 / 6.0 / 7.5 respectively, same file's `gait`
## blocks) is likewise real, per-species, DB-seeded data — never invented
## here. This controller is configured with whichever of the three (or any
## future flight_capable addition) the rider is actually mounted on; it does
## NOT hardcode a species table itself, matching `mount_controller.gd`'s own
## "the caller owns fetching the real payload" contract.
##
## ── Composition, not reimplementation ────────────────────────────────────────
## Ground movement while riding a flight-capable species on the ground is
## BYTE-IDENTICAL to `MountController`'s own arc-turn kinematics — this file
## calls `MountController.step_mount(...)` directly (via `preload`), the exact
## same pure static function C13 already ported and tested. Airborne movement
## calls `FlightController.step_flight(...)` directly (via `preload`) — the
## exact same pure aero state machine C10 already ported from
## `flight-physics.ts` and tested (bank→yaw drift, airspeed bleed/dive-gain,
## stall + nose-down recovery, glide-floor vertical velocity). Neither pure
## function is copied, forked, or reimplemented anywhere in this file — see
## `_physics_process` below, which is the only place either gets called, and
## `tests/test_aerial_mount_controller.gd`, which asserts this file's own
## glue (the post-flight-step velocity clamp) without re-deriving either
## controller's math a second time.
##
## ── Why airborne speed is capped at the MOUNT's real speed, not 45 m/s ──────
## `FlightController.FLIGHT_MAX_AIRSPEED_MPS = 45.0` mirrors the server's
## generic "fly" mode ceiling (`FLY_MAX_SPEED_MPS`, city-presence.js:101) —
## but a rider on a mount is NEVER tracked server-side in generic "fly" mode.
## `applyPlayerMode`'s `"mount:"` branch (server.js:8966-8979) is the ONLY
## mode a mounted rider (grounded OR airborne — the branch does not
## distinguish altitude) can legitimately be in, and it derives the speed cap
## from `payload.species.baseSpeedMps` — i.e. `modeSpeedCap("mount:<id>", {
## mountSpeedMps })` (city-presence.js's `modeSpeedCap`, ~line 117-124), which
## returns the species' OWN `base_speed_mps` (11.0/12.0/10.5 above), not 45.
## Worse: `updateUserPosition`'s anti-cheat distance check
## (city-presence.js:577, `Math.sqrt(dx*dx + dy*dy + dz*dz)`) is a full 3D
## Euclidean distance — it includes vertical climb/dive, not just horizontal
## airspeed. So this controller clamps the FULL 3D velocity vector's
## magnitude (not just the horizontal airspeed FlightController's own pure
## core returns) to the mount's real `base_speed_mps` after every
## `step_flight` call, via the pure static `clamp_velocity_to_species_cap`
## below — reusing `step_flight`'s output, never touching its internals or
## its own internal 45 m/s cap. Sending anything faster than the mount's real
## speed would earn an honest `player:move:nack{reason:"speed_hack_detected"}`
## from the server, exactly like C13's ground mount already respects.
##
## ── No new player:mode submode ───────────────────────────────────────────────
## Taking flight while mounted does NOT send a new mode string — there is no
## `"mount:<id>:fly"` (or similar) case anywhere in `applyPlayerMode`; sending
## one would just fail to match `payload.speciesId` and nack as
## `"not_mounted"`. This controller keeps sending the SAME
## `"mount:<speciesId>"` mode both grounded and airborne (mirroring
## `MountController.set_riding_active`'s existing request exactly); ascending/
## descending is a purely LOCAL client-side state (`set_airborne`) layered on
## top of the one real wire mode, not a second round-trip the server doesn't
## understand.
##
## ── gainFlightSeconds XP reporting ────────────────────────────────────────────
## `server/lib/companions-mount-evo.js#gainFlightSeconds(db, mountId, seconds)`
## (× `FLIGHT_XP_PER_SECOND = 0.5`, same file) is real, already-wired
## server-side substrate — reached via the real `mounts.gain_xp` macro
## (`server/domains/mounts.js:407-422`, `input.kind === "flight"` branch)
## through the SAME `POST /api/lens/run` HTTP pattern
## `world/dtu_prop_interaction.gd` already established for calling a macro
## from Godot (no gateway-envelope wiring needed — `docs/GODOT_PROTOCOL.md`
## §8 `query_state` explicitly names this REST pattern as the honest way a
## Godot client reaches an arbitrary macro today). `mount_id` reported here
## MUST be the rider's `player_companions.id` (the same id
## `getActiveMountPayload`'s `companion.id` field returns and
## `mounts.gain_xp`'s own `_ownsMount` ownership check validates against) —
## NOT the species id. This controller accumulates real elapsed airborne
## seconds and flushes them periodically + on landing; it never estimates or
## pads the reported duration.

signal move_rejected(snapped_to: Vector3)
signal ride_mode_rejected(reason: String)
signal flight_xp_reported(seconds: float, result: Dictionary)
signal flight_xp_report_failed(seconds: float, reason: String)

enum AltitudeMode { GROUND, AIRBORNE }

const MountController := preload("res://avatar/mount_controller.gd")
const FlightController := preload("res://avatar/flight_controller.gd")
const CharacterController := preload("res://player/character_controller.gd")

## Standard gravity, m/s^2 — same value every other controller in this
## project already cites (used only for the GROUND leg of this controller;
## airborne vertical motion comes from `FlightController.step_flight`'s own
## `vy`, which already models gravity via its stall-drop/glide-floor terms).
const GRAVITY: float = 9.81

## Division-by-near-zero guard for `turn_radius_m` — same reasoned safety
## floor `mount_controller.gd` uses (see that file's header).
const MIN_TURN_RADIUS_M: float = 0.1

## Mirrors server.js's `player:move` accept-rate cap, same constant every
## other controller in this project cites.
const MOVE_SEND_MIN_INTERVAL_MS: int = 33

## How often to flush accumulated flight seconds to `mounts.gain_xp` while
## continuously airborne (in addition to an always-on flush at landing).
## A reasoned client-side batching interval — NOT a server-cited number
## (`gain_xp`'s own `amount` cap of 5000 is server-side and unaffected by
## this choice); keeps network chatter low without losing much XP if the
## client disconnects mid-flight.
const FLIGHT_XP_REPORT_INTERVAL_S: float = 10.0

@export var world_id: String = "concordia-hub"
## Injected GatewayClient (net/gateway_client.gd) instance — same DI
## convention as MountController/FlightController.
@export var gateway: Node = null
@export var base_url: String = "http://127.0.0.1:5050"
@export var auth_token: String = ""

var species_id: String = ""
## The rider's `player_companions.id` — REQUIRED before flight XP can be
## reported (see header). Empty means "not configured", same honest-refusal
## posture `mount_controller.gd#configure` already uses for its own fields.
var mount_id: String = ""
## Real per-species value from `mount_species.base_speed_mps` — see header.
var base_speed_mps: float = 0.0
## Real per-species value from `mount_gait_profiles.turn_radius_m` — see
## header. Used for the GROUND leg only (arc-turn kinematics).
var turn_radius_m: float = 0.0
## Real per-species `flight_capable` flag — see header. Airborne is refused
## when this is false, exactly like a non-flight-capable mount in
## `mount_controller.gd` has no flight option at all.
var flight_capable: bool = false

var riding_active: bool = false
var altitude_mode: int = AltitudeMode.GROUND
var _heading: float = 0.0
var _vertical_vel: float = 0.0
var _flight_state: Dictionary = {}
var _flight_seconds_accum: float = 0.0
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

	if altitude_mode == AltitudeMode.AIRBORNE:
		_physics_process_airborne(delta)
	else:
		_physics_process_ground(delta)

	var now_ms := Time.get_ticks_msec()
	if CharacterController.should_send_move(now_ms, _last_move_sent_ms, MOVE_SEND_MIN_INTERVAL_MS):
		_last_move_sent_ms = now_ms
		_send_move_intent()


## GROUND leg — byte-identical delegation to `MountController.step_mount`
## (see header "Composition, not reimplementation").
func _physics_process_ground(delta: float) -> void:
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


## AIRBORNE leg — delegates the aero state machine to
## `FlightController.step_flight` (see header), then clamps the resulting
## 3D velocity to this mount's real `base_speed_mps` (see header "Why
## airborne speed is capped at the MOUNT's real speed, not 45 m/s").
func _physics_process_airborne(delta: float) -> void:
	var inputs := {
		"roll": _read_roll_input(),
		"pitch": _read_pitch_input(),
		"active": true,
	}
	# Honest zero — same posture flight_controller.gd's own header takes; no
	# Godot-side wind-sample fetch exists yet.
	var wind := {"wind": {"x": 0.0, "y": 0.0, "z": 0.0}, "lift": 0.0}

	_flight_state = FlightController.step_flight(_flight_state, inputs, wind, delta)

	var heading: float = _flight_state["heading"]
	var airspeed: float = _flight_state["airspeed"]
	var vy: float = _flight_state["vy"]
	var raw_velocity := Vector3(sin(heading) * airspeed, vy, cos(heading) * airspeed)

	velocity = AerialMountController.clamp_velocity_to_species_cap(raw_velocity, base_speed_mps)
	_heading = heading
	rotation.y = heading
	move_and_slide()

	_flight_seconds_accum += delta
	if _flight_seconds_accum >= FLIGHT_XP_REPORT_INTERVAL_S:
		_flush_flight_seconds()


## Set the real per-species data (from a live `getActiveMountPayload`-shaped
## response, e.g. via the `mounts.get_active_mount` macro) before activating.
## `mount_companion_id` is the rider's `player_companions.id` — required for
## `report_flight_xp`/the automatic in-flight flush to ever succeed; an empty
## value is honestly refused there rather than silently skipped.
func configure(
		new_species_id: String, mount_companion_id: String,
		new_base_speed_mps: float, new_turn_radius_m: float, new_flight_capable: bool) -> void:
	species_id = new_species_id
	mount_id = mount_companion_id
	base_speed_mps = new_base_speed_mps
	turn_radius_m = new_turn_radius_m
	flight_capable = new_flight_capable


## Start/stop riding. Same honest-refusal contract as
## `MountController.set_riding_active` (see that file's header) — refuses on
## unset/non-positive mount data, never falls back to a fabricated speed.
## Dismounting while airborne lands first (flushes flight XP, resets
## altitude_mode) so a rider can never dismount mid-air into an inconsistent
## local state.
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
		if altitude_mode == AltitudeMode.AIRBORNE:
			set_airborne(false)
		_request_mode("walk")
	riding_active = on
	return true


## Toggle airborne/grounded. LOCAL-only — see header "No new player:mode
## submode": no additional wire message is sent, the rider stays in the same
## `"mount:<speciesId>"` server mode the whole time. Refuses to go airborne
## on a non-flight-capable species or while not actively riding (honest
## gate, mirroring `set_riding_active`'s own refusal posture) — never
## silently lifts off a mount that has no real flight_capable flag.
func set_airborne(on: bool) -> bool:
	if on == (altitude_mode == AltitudeMode.AIRBORNE):
		return true
	if on:
		if not riding_active or not flight_capable:
			ride_mode_rejected.emit("not_flight_capable")
			return false
		_flight_state = FlightController.new_flight_state()
		altitude_mode = AltitudeMode.AIRBORNE
	else:
		altitude_mode = AltitudeMode.GROUND
		_flush_flight_seconds()
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


func _read_roll_input() -> float:
	var v := 0.0
	if Input.is_key_pressed(KEY_A):
		v -= 1.0
	if Input.is_key_pressed(KEY_D):
		v += 1.0
	return v


func _read_pitch_input() -> float:
	# Negative = nose down, matching flight_controller.gd's own contract.
	var v := 0.0
	if Input.is_key_pressed(KEY_W):
		v -= 1.0
	if Input.is_key_pressed(KEY_S):
		v += 1.0
	return v


func _request_mode(mode: String) -> void:
	if gateway == null or not gateway.has_method("send_event"):
		return
	gateway.send_event("player:mode", {"mode": mode})


func _send_move_intent() -> void:
	if gateway == null or not gateway.has_method("send_event"):
		return
	var action := "fly" if altitude_mode == AltitudeMode.AIRBORNE else "ride"
	gateway.send_event("player:move", {
		"cityId": world_id,
		"x": global_position.x,
		"y": global_position.y,
		"z": global_position.z,
		"direction": rotation.y,
		"rotation": rotation.y,
		"action": action,
		"currentAnimation": action,
	})


func _on_gateway_event(evt: String, data: Dictionary) -> void:
	if evt == "player:move:nack":
		_snap_target = CharacterController.snapback_position(data, global_position)
		_pending_snap = true
		move_rejected.emit(_snap_target)
		return
	if evt == "player:mode:nack" and riding_active:
		# Honest: the server said no — never keep riding/flying against its
		# say-so. Flush whatever flight seconds were genuinely accumulated
		# before dropping local state.
		if altitude_mode == AltitudeMode.AIRBORNE:
			_flush_flight_seconds()
		riding_active = false
		altitude_mode = AltitudeMode.GROUND
		ride_mode_rejected.emit(String(data.get("reason", "unknown")))


## Flush accumulated airborne seconds via `mounts.gain_xp` (see header
## "gainFlightSeconds XP reporting"). No-ops honestly (never fabricates a
## report) when there is nothing to report or `mount_id` isn't configured —
## the latter surfaces as `flight_xp_report_failed` so a caller can see the
## gap rather than silently losing XP.
func _flush_flight_seconds() -> void:
	if _flight_seconds_accum <= 0.0:
		return
	var seconds := _flight_seconds_accum
	_flight_seconds_accum = 0.0
	if mount_id == "":
		flight_xp_report_failed.emit(seconds, "not_configured")
		return
	report_flight_xp(mount_id, seconds)


## Dispatch a real `POST /api/lens/run` call reporting `seconds` of flight
## time for `mount_companion_id`, following the exact HTTPRequest pattern
## `world/dtu_prop_interaction.gd#send_interact` already established.
func report_flight_xp(mount_companion_id: String, seconds: float) -> void:
	var req := HTTPRequest.new()
	add_child(req)
	req.request_completed.connect(_on_flight_xp_completed.bind(req, seconds))

	var headers := PackedStringArray(["Content-Type: application/json"])
	if auth_token != "":
		headers.append("Authorization: Bearer %s" % auth_token)

	var payload := AerialMountController.build_flight_xp_request_body(mount_companion_id, seconds)
	var body := JSON.stringify(payload)
	var err := req.request("%s/api/lens/run" % base_url, headers, HTTPClient.METHOD_POST, body)
	if err != OK:
		req.queue_free()
		flight_xp_report_failed.emit(seconds, "request_error_%d" % err)


func _on_flight_xp_completed(
		result: int, code: int, _headers: PackedStringArray,
		response_body: PackedByteArray, req: HTTPRequest, seconds: float) -> void:
	req.queue_free()
	if result != HTTPRequest.RESULT_SUCCESS or code != 200:
		flight_xp_report_failed.emit(seconds, "http_%d_%d" % [result, code])
		return

	var parsed = JSON.parse_string(response_body.get_string_from_utf8())
	if typeof(parsed) != TYPE_DICTIONARY:
		flight_xp_report_failed.emit(seconds, "malformed_response")
		return

	if bool(parsed.get("ok", false)):
		flight_xp_reported.emit(seconds, parsed)
	else:
		# Forward the server's own honest reason (e.g. "not_owner",
		# "feature_disabled", "missing_args") — never paper over a real
		# rejection as success.
		flight_xp_report_failed.emit(seconds, String(parsed.get("reason", "unknown")))


# ── Pure static helpers (no engine calls) ────────────────────────────────────

## Rescale `raw_velocity` so its magnitude never exceeds `speed_cap_mps` —
## see header "Why airborne speed is capped at the MOUNT's real speed, not
## 45 m/s". A zero-or-negative cap or a zero-length vector is returned
## unchanged/zero rather than dividing by zero. Reuses `raw_velocity`
## verbatim (direction preserved) when already under the cap.
static func clamp_velocity_to_species_cap(raw_velocity: Vector3, speed_cap_mps: float) -> Vector3:
	if speed_cap_mps <= 0.0:
		return Vector3.ZERO
	var mag := raw_velocity.length()
	if mag <= speed_cap_mps or mag <= 0.0:
		return raw_velocity
	return raw_velocity * (speed_cap_mps / mag)


## Body for `POST /api/lens/run`, targeting the real `mounts.gain_xp` macro
## (`server/domains/mounts.js:407-422`) with `kind: "flight"` — the same
## input shape that macro's `input.kind === "flight"` branch reads before
## calling `gainFlightSeconds`.
static func build_flight_xp_request_body(mount_companion_id: String, seconds: float) -> Dictionary:
	return {
		"domain": "mounts",
		"name": "gain_xp",
		"input": {"mountId": mount_companion_id, "kind": "flight", "amount": seconds},
	}
