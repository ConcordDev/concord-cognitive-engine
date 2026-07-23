class_name FlightController
extends CharacterBody3D
## FlightController — Godot client for C10 (master-spec superhero flight).
##
## Server-side substrate (Godot Phase 3a, ALREADY REAL): a player who has
## legitimately switched to "fly" mode is speed-capped at
## `FLY_MAX_SPEED_MPS = 45` m/s in server/lib/city-presence.js:101
## (`modeSpeedCap("fly")` returns this constant, city-presence.js:121). This
## file is the missing GDScript CLIENT half — no flight controller existed
## before this unit (see CLAUDE.md's Godot Phase 3 note: "No GDScript CLIENT
## controller exists yet for flight or ground-vehicle/mount movement").
##
## ── Pure aero core ported from concord-frontend/lib/concordia/flight-physics.ts ──
## Every constant and the full `stepFlight` state machine (banking → yaw
## drift, airspeed bleed/dive-gain, stall + nose-down recovery, glide-floor
## vertical velocity) is ported byte-for-byte below, with the TS source line
## cited next to each constant. `step_flight()` takes/returns a plain
## Dictionary (not this class's own instance state) so it is callable and
## testable with no scene tree — see tests/test_flight_controller.gd — same
## "pure-function core, engine-gated glue on top" split M2 used for
## avatar/gait_solver.gd (pure) + avatar/avatar_rig.gd (CharacterBody3D-
## adjacent glue).
##
## ── The one constant that is BOTH a ported number and a cross-check ──────────
## `FLIGHT_MAX_AIRSPEED_MPS = 45.0` mirrors flight-physics.ts:133
## (`airspeed = Math.min(45, airspeed);`) — the TS source's own airspeed
## ceiling — and that literal 45 is ALSO the exact value of the server's
## authoritative `FLY_MAX_SPEED_MPS` (city-presence.js:101). This is not a
## coincidence this file invented: it means the client-side aero model
## already flies within the server's anti-cheat envelope by construction, as
## long as this controller never scales airspeed by anything extra before
## reporting position. Do not raise this constant without raising the
## server-side cap in lockstep, or every `player:move` frame at max airspeed
## will be rejected by `_validateCombatReach`... no — by
## `cityPresence.updateUserPosition`'s speed check (`speedMps > maxSpeed` at
## city-presence.js:578) as `speed_hack_detected`.
##
## ── Engine-gated glue (CharacterBody3D velocity application) ────────────────
## `_physics_process` reads raw roll/pitch input (same raw-keycode approach as
## player/character_controller.gd — no InputMap actions are baked into
## project.godot in this skeleton; see that file's own comment on why), steps
## the pure aero model, converts the resulting horizontal `airspeed`+`heading`
## scalar/yaw pair plus vertical `vy` into a CharacterBody3D `velocity`, and
## calls `move_and_slide()` — collision with world geometry is real Godot
## physics, not simulated here. Movement INTENT is streamed to the server via
## the SAME `player:move` message + <=30Hz send-gate + nack-snapback contract
## `player/character_controller.gd` already established (this file calls that
## class's static `should_send_move`/`snapback_position` helpers directly via
## `preload`, rather than re-deriving byte-identical logic a second time).
## Entering/leaving flight sends `player:mode` with `{mode:"fly"}` /
## `{mode:"walk"}` first — mirroring the legitimacy-gate contract
## `applyPlayerMode` (server.js:8925-8928) already defines for "fly" (no
## external capability gate yet server-side — see that function's own
## TODO(Phase 3b) comment — but the client still asks, honestly, rather than
## silently switching movement math without telling the server).
##
## ── Wind / thermals — HONEST ZERO, not fabricated ───────────────────────────
## flight-physics.ts's `stepFlight` accepts a `WindSample` (wind drift + lift)
## sourced server-side from `server/lib/embodied/wind-currents.js`. No Godot-
## side fetch of that data exists yet (no HTTP wiring for it in this
## skeleton) — this glue passes a constant zero sample
## (`{wind: {x:0,y:0,z:0}, lift:0.0}`) rather than inventing plausible-looking
## wind. Flying always feels "still air" until a future unit wires a real
## wind-sample request. See VISUAL_QA.md.

signal move_rejected(snapped_to: Vector3)
signal flight_mode_rejected(reason: String)

const CharacterController := preload("res://player/character_controller.gd")

# ── Pure aero constants — ported from flight-physics.ts (cite lines) ────────
## rad-yaw per unit-roll per second. flight-physics.ts:46.
const BANK_TO_YAW: float = 1.4
## m/s lost per second to drag. flight-physics.ts:47.
const AIRSPEED_BLEED: float = 0.4
## m/s gained per second in dive (pitch < -0.5). flight-physics.ts:48.
const AIRSPEED_GAIN_DIVE: float = 6.0
## m/s below this AND high AoA -> stall. flight-physics.ts:49.
const STALL_AIRSPEED: float = 4.0
## ~18 degrees. flight-physics.ts:50.
const AOA_STALL_RAD: float = 0.31
## ms of nose-down to recover from stall. flight-physics.ts:51.
const STALL_RECOVERY_MS: float = 1500.0
## max roll rate, rad/s. flight-physics.ts:52.
const ROLL_SLEW_RAD_S: float = 2.4
## max pitch rate, rad/s. flight-physics.ts:53.
const PITCH_SLEW_RAD_S: float = 2.0
## flight-physics.ts:54 (used as the stall vertical-drop coefficient).
const GRAVITY_FALLBACK: float = 9.81
## m/s; glide descent floor, can be reversed by lift. flight-physics.ts:55.
const GLIDE_DESCENT_CAP: float = -1.5
## flight-physics.ts:133's `Math.min(45, airspeed)` ceiling — SEE HEADER: this
## is also the server's authoritative FLY_MAX_SPEED_MPS
## (server/lib/city-presence.js:101).
const FLIGHT_MAX_AIRSPEED_MPS: float = 45.0

## Mirrors server.js's `player:move` accept-rate cap, same constant
## character_controller.gd already cites (server.js's
## `if (now - _moveRateState.last < 33) return;`).
const MOVE_SEND_MIN_INTERVAL_MS: int = 33

@export var world_id: String = "concordia-hub"
## Injected GatewayClient (net/gateway_client.gd) instance — same DI
## convention as player/character_controller.gd.
@export var gateway: Node = null

var flight_active: bool = false
var _state: Dictionary = {}
var _last_move_sent_ms: int = 0
var _snap_target: Vector3 = Vector3.ZERO
var _pending_snap: bool = false


func _ready() -> void:
	_state = FlightController.new_flight_state()
	if gateway != null and gateway.has_signal("event_received"):
		gateway.event_received.connect(_on_gateway_event)


func _physics_process(delta: float) -> void:
	if _pending_snap:
		global_position = _snap_target
		_pending_snap = false

	if not flight_active:
		return

	var inputs := {
		"roll": _read_roll_input(),
		"pitch": _read_pitch_input(),
		"active": true,
	}
	# Honest zero — see header "Wind / thermals" note.
	var wind := {"wind": {"x": 0.0, "y": 0.0, "z": 0.0}, "lift": 0.0}

	_state = FlightController.step_flight(_state, inputs, wind, delta)

	var heading: float = _state["heading"]
	var airspeed: float = _state["airspeed"]
	var vy: float = _state["vy"]
	velocity = Vector3(sin(heading) * airspeed, vy, cos(heading) * airspeed)
	rotation.y = heading
	move_and_slide()

	var now_ms := Time.get_ticks_msec()
	if CharacterController.should_send_move(now_ms, _last_move_sent_ms, MOVE_SEND_MIN_INTERVAL_MS):
		_last_move_sent_ms = now_ms
		_send_move_intent()


## Toggle flight. Sends the legitimacy-gate `player:mode` request first
## (matches applyPlayerMode's contract for "fly"/"walk" — server.js:8925-8928)
## and only flips the local flag; a `player:mode:nack` (should the server ever
## start gating flight — see the TODO(Phase 3b) cited in the header) reverts
## it via `_on_gateway_event`.
func set_flight_active(on: bool) -> void:
	if on == flight_active:
		return
	_request_mode("fly" if on else "walk")
	flight_active = on
	if on:
		_state = FlightController.new_flight_state()


func _read_roll_input() -> float:
	var v := 0.0
	if Input.is_key_pressed(KEY_A):
		v -= 1.0
	if Input.is_key_pressed(KEY_D):
		v += 1.0
	return v


func _read_pitch_input() -> float:
	# Negative = nose down, matching flight-physics.ts:26's own contract.
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
	gateway.send_event("player:move", {
		"cityId": world_id,
		"x": global_position.x,
		"y": global_position.y,
		"z": global_position.z,
		"direction": rotation.y,
		"rotation": rotation.y,
		"action": "fly",
		"currentAnimation": "fly",
	})


func _on_gateway_event(evt: String, data: Dictionary) -> void:
	if evt == "player:move:nack":
		_snap_target = CharacterController.snapback_position(data, global_position)
		_pending_snap = true
		move_rejected.emit(_snap_target)
		return
	if evt == "player:mode:nack" and flight_active:
		# Honest: the server said no — never keep flying against its say-so.
		flight_active = false
		flight_mode_rejected.emit(String(data.get("reason", "unknown")))


# ── Pure static aero core (no engine calls) ──────────────────────────────────

## Mirrors newFlightState() exactly (flight-physics.ts:61-71).
static func new_flight_state() -> Dictionary:
	return {
		"airspeed": 10.0,
		"heading": 0.0,
		"roll_rad": 0.0,
		"pitch_rad": 0.0,
		"vy": GLIDE_DESCENT_CAP,
		"stalled": false,
		"stall_timer_ms": 0.0,
	}


## Mirrors stepFlight() exactly (flight-physics.ts:79-136), field-for-field.
## `state`: {airspeed, heading, roll_rad, pitch_rad, vy, stalled, stall_timer_ms}
## `inputs`: {roll, pitch, active}
## `wind`: {wind: {x,y,z}, lift}
static func step_flight(
		state: Dictionary, inputs: Dictionary, wind: Dictionary, dt_seconds: float) -> Dictionary:
	if not inputs.get("active", false):
		var idle_vy: float = clampf(float(state["vy"]), GLIDE_DESCENT_CAP, 0.0)
		var idle := state.duplicate(true)
		idle["vy"] = idle_vy
		return idle

	var dt: float = clampf(dt_seconds, 0.0001, 0.25)

	var roll_target: float = clampf(float(inputs.get("roll", 0.0)), -1.0, 1.0) * PI / 2.0
	var pitch_target: float = clampf(float(inputs.get("pitch", 0.0)), -1.0, 1.0) * PI / 3.0
	var roll_rad: float = _approach(float(state["roll_rad"]), roll_target, ROLL_SLEW_RAD_S * dt)
	var pitch_rad: float = _approach(float(state["pitch_rad"]), pitch_target, PITCH_SLEW_RAD_S * dt)

	var yaw_rate: float = sin(roll_rad) * BANK_TO_YAW
	var heading: float = float(state["heading"]) + yaw_rate * dt

	var dive_factor: float = 0.0
	if pitch_rad < -0.5:
		dive_factor = AIRSPEED_GAIN_DIVE * (absf(pitch_rad) - 0.5)
	var airspeed: float = maxf(0.0, float(state["airspeed"]) - AIRSPEED_BLEED * dt + dive_factor * dt)

	var stalled: bool = bool(state["stalled"])
	var stall_timer_ms: float = float(state["stall_timer_ms"])
	var aoa: float = maxf(0.0, pitch_rad)
	if not stalled:
		if aoa > AOA_STALL_RAD and airspeed < STALL_AIRSPEED:
			stalled = true
			stall_timer_ms = 0.0
	else:
		if pitch_rad < -0.05:
			stall_timer_ms += dt * 1000.0
			if stall_timer_ms >= STALL_RECOVERY_MS:
				stalled = false
				stall_timer_ms = 0.0
		else:
			stall_timer_ms = 0.0

	var lift: float = 0.0
	if wind.has("lift"):
		lift = float(wind["lift"])
	var stall_drop: float = (GRAVITY_FALLBACK * 0.5 * dt) if stalled else 0.0
	var vy_floor: float = -GRAVITY_FALLBACK if stalled else GLIDE_DESCENT_CAP
	var vy: float = clampf(float(state["vy"]) + lift * dt - stall_drop, vy_floor, 4.0)

	airspeed = minf(FLIGHT_MAX_AIRSPEED_MPS, airspeed)

	return {
		"airspeed": airspeed,
		"heading": heading,
		"roll_rad": roll_rad,
		"pitch_rad": pitch_rad,
		"vy": vy,
		"stalled": stalled,
		"stall_timer_ms": stall_timer_ms,
	}


## Mirrors the TS module-local `approach()` helper (flight-physics.ts:138-142).
static func _approach(current: float, target: float, max_step: float) -> float:
	var delta: float = target - current
	if absf(delta) <= max_step:
		return target
	return current + signf(delta) * max_step
