class_name LandAirTransitionController
extends CharacterBody3D
## LandAirTransitionController — Godot client for C14 (master-spec "land↔air
## transition: stations, pads, state changes").
##
## ── What already existed before this unit ────────────────────────────────────
## C10 (`avatar/flight_controller.gd`) and C13
## (`avatar/mount_controller.gd`/`avatar/ground_vehicle_controller.gd`) each
## ship a full movement controller that a CALLER manually turns on/off
## (`set_flight_active(true)`, `set_riding_active(true)`, ...). C11/C12
## (`avatar/aerial_mount_controller.gd`) composes two of those pure cores
## (`MountController.step_mount` + `FlightController.step_flight`) into one
## rider body, but STILL requires an external caller to decide WHEN to flip
## `set_airborne()`. None of them contain a state machine that decides, from
## real input + real world data, when a transition should happen at all.
## That decision layer is this unit's entire scope — it does not reimplement
## any movement math FlightController/CharacterController/AerialMountController
## already own.
##
## ── Composition, not reimplementation (same pattern as C11/C12) ─────────────
## The GROUND leg (unmounted) reuses `CharacterController.integrate_gravity`
## + the real `CharacterController.MOVE_SPEED`/`JUMP_DEFAULT_VY` constants
## (via direct `preload`, exactly like `aerial_mount_controller.gd` reuses
## `MountController`/`FlightController`'s statics). The AIRBORNE leg
## (unmounted) reuses `FlightController.new_flight_state`/`step_flight`
## verbatim. The MOUNTED case does not run this controller's own physics at
## all — see `_process_mounted_transitions` — it only calls
## `AerialMountController.set_airborne()`, the real, already-shipped public
## API from C11/C12, with no separate wire message (that file's own header,
## "No new player:mode submode", already establishes altitude toggling while
## mounted is LOCAL-only).
##
## ── Server-authoritative, never client-authoritative (per the task brief) ───
## Exactly like every sibling controller: a transition is applied
## OPTIMISTICALLY on the client the instant a real trigger fires (perceived
## sub-100ms response — CLAUDE.md's Fluidity invariant), a real
## `player:mode` request is sent immediately after
## (`build_mode_request_payload` → `docs/GODOT_PROTOCOL.md`'s real
## `player:mode` wire shape, `_onGodotClientMessage`/`applyPlayerMode`,
## server.js:8981-8995), and the server's response reconciles that optimism:
## `player:mode:ack` is a quiet settle (the state already applied, nothing
## visibly changes), `player:mode:nack` is a VISIBLE, honest rollback via
## `resolve_mode_transition` — never a silent desync, never pretending a
## rejected transition succeeded. This mirrors FlightController/
## MountController/AerialMountController's own nack-revert pattern exactly,
## made explicit as its own testable pure function because this unit's brief
## calls out ack/nack handling by name.
##
## ── Honest gap: flight legitimacy is not server-gated (unmounted case) ──────
## `applyPlayerMode`'s "fly" branch (server.js:8992-8995) accepts ANY
## authenticated player's `{mode:"fly"}` request unconditionally — there is
## no server-side capability check yet (flight_controller.gd's own header
## already documents this as a TODO(Phase 3b) gap, not something this unit
## invents or hides). `flight_capable` on THIS controller is therefore a
## purely LOCAL, client-side design knob (default true) — it gates when the
## trigger-detection functions below FIRE, not what the server will accept.
## Do not read `flight_capable` as a real anti-cheat boundary; the real
## anti-cheat is the speed cap `cityPresence.updateUserPosition` enforces
## once "fly" mode is active (FLY_MAX_SPEED_MPS=45, already respected by
## FlightController's own step_flight ceiling — see that file's header).
##
## ── Honest design choice: "ground-height threshold" == a real is_on_floor() ──
## The task brief names "crossing a ground-height threshold while
## descending" as a landing trigger. This controller does NOT invent a
## fabricated fixed-altitude constant for that threshold (no TS/JS source
## defines one, and CharacterController/MountController/GroundVehicleController
## all already treat `is_on_floor()` — real Godot collision — as the ground-
## crossing signal, never a hardcoded height). `should_land()` below takes
## `is_grounded` (the caller's real `is_on_floor()` reading) + `vertical_vel`
## (to distinguish "just touched down" from "still ascending off a slope")
## as its ground-crossing proof, consistent with every sibling controller's
## own existing convention.
##
## ── Landing pads are a real gameplay anchor, not "fly anywhere" ─────────────
## `should_launch_from_pad`/`should_land`'s pad branch use REAL pad data —
## `content/world/concordia-hub/city-layout.json`'s `landingPads` array
## (3 authored pads: Plaza Skydock, Riverside Skydock, Industrial Skydock),
## surfaced server-side via `landingPadsForWorld` (server/lib/
## building-purpose.js) and carried in every `scene:request` →
## `scene:data` payload's `landingPads` field (server/lib/scene-export.js).
## `world/scene_bootstrap.gd` was extended by THIS unit (small, additive —
## see that file's own diff) to parse + expose that field via
## `get_landing_pads()`; `wire_landing_pads_from_scene_bootstrap()` below is
## the one-line DI hookup a caller uses after `scene:data` arrives. A
## takeoff/landing that happens near a real pad is intentional (per the
## master-spec §4 "purposeful" design intent); one that happens via the
## jump-then-sustained-ascend / natural-descent triggers is the "superhero
## flight anywhere" path C10 already ships — both are real, neither is
## fabricated, and this controller does not claim the pad path is
## server-enforced (see the honest-gap note above).

signal move_rejected(snapped_to: Vector3)
signal transition_requested(to_airborne: bool)
signal transition_confirmed(is_airborne: bool)
signal transition_rejected(reason: String)

enum Mode { GROUND, AIRBORNE }

const CharacterController := preload("res://player/character_controller.gd")
const FlightController := preload("res://avatar/flight_controller.gd")
const AerialMountController := preload("res://avatar/aerial_mount_controller.gd")
const SessionManager := preload("res://session/session_manager.gd")

## Mirrors server.js's `player:move` accept-rate cap, same constant every
## other controller in this project cites.
const MOVE_SEND_MIN_INTERVAL_MS: int = 33

## REASONED ADDITION (client-feel only, no TS/JS/server source to cite — same
## honest posture as MountController's own MIN_TURN_RADIUS_M or
## AerialMountController's FLIGHT_XP_REPORT_INTERVAL_S): how long the ascend
## input must be held, while genuinely rising off the ground, before a
## jump reads as "launch into flight" rather than "an ordinary jump."
const ASCEND_LAUNCH_THRESHOLD_MS: float = 350.0

@export var world_id: String = "concordia-hub"
## Injected GatewayClient (net/gateway_client.gd) instance — same DI
## convention as every sibling controller.
@export var gateway: Node = null
## Optional injected AerialMountController — when set AND currently
## `riding_active`, this controller stops running its own physics and
## instead supplies trigger-detection for THAT mount's altitude state (see
## header "Composition, not reimplementation"). Null (default) means the
## player has no active aerial mount and this controller drives their own
## unmounted land/air transitions.
@export var aerial_mount: AerialMountController = null
## LOCAL, client-side gate on the unmounted flight triggers — see header
## "Honest gap: flight legitimacy is not server-gated". Not a real
## anti-cheat boundary.
@export var flight_capable: bool = true
## Optional injected SessionManager (session/session_manager.gd, R5/E24) —
## when wired, `_physics_process` early-returns unless this controller
## currently owns input (SessionManager.InputOwner.CHARACTER) — e.g. while
## the client is in Design free-fly or an FEA overlay is open, this
## controller (and the mounted avatar it drives) simply stops simulating.
## Null (default) means "always active", the pre-R5/E24 behavior — every
## existing pure-function test and any standalone use of this controller is
## unaffected.
@export var session_manager: Node = null

## Real pad data — see `wire_landing_pads_from_scene_bootstrap()`. Each
## entry is expected to be a Dictionary shaped like
## `content/world/concordia-hub/city-layout.json`'s `landingPads` array:
## `{id, position:{x,z}, radius_m, elevation_m}`. Empty by default — an
## unwired controller never fabricates a pad.
var landing_pads: Array = []

var mode: int = Mode.GROUND
var _vertical_vel: float = 0.0
var _sustained_ascend_ms: float = 0.0
var _mount_sustained_ascend_ms: float = 0.0
var _flight_state: Dictionary = {}

var _transition_pending: bool = false
var _pending_to_airborne: bool = false
var _prev_mode: int = Mode.GROUND

var _last_move_sent_ms: int = 0
var _snap_target: Vector3 = Vector3.ZERO
var _pending_snap: bool = false


func _ready() -> void:
	if gateway != null and gateway.has_signal("event_received"):
		gateway.event_received.connect(_on_gateway_event)


func _physics_process(delta: float) -> void:
	# R5/E24 input gate — see the `session_manager` export's own doc.
	if session_manager != null and session_manager.has_method("is_input_owner"):
		if not session_manager.is_input_owner(SessionManager.InputOwner.CHARACTER):
			return

	if _pending_snap:
		global_position = _snap_target
		_vertical_vel = 0.0
		_pending_snap = false

	var now_ms := Time.get_ticks_msec()
	var ascend_held := Input.is_key_pressed(KEY_SPACE)

	if aerial_mount != null and aerial_mount.riding_active:
		_process_mounted_transitions(delta, ascend_held)
		return

	if mode == Mode.GROUND:
		_process_ground(delta, ascend_held, now_ms)
	else:
		_process_airborne(delta, now_ms)


## Unmounted GROUND leg — gravity integration reuses
## `CharacterController.integrate_gravity`; horizontal move speed reuses the
## real `CharacterController.MOVE_SPEED` constant. A minimal jump-on-ascend
## (NOT the full coyote-time/jump-buffer system in `character_controller.gd`
## — out of scope here, this file only needs a real "left the ground, still
## rising" precondition for `should_launch_flight` to ever be reachable)
## fires off the real `CharacterController.JUMP_DEFAULT_VY` constant, so a
## fresh press of the ascend input from a standstill behaves like an
## ordinary jump unless it's held long enough to read as a launch. Checks
## both unmounted launch triggers (jump-then-sustained-ascend, pad takeoff)
## every step.
func _process_ground(delta: float, ascend_held: bool, now_ms: int) -> void:
	var grounded := is_on_floor()
	if grounded:
		_vertical_vel = CharacterController.JUMP_DEFAULT_VY if ascend_held else 0.0
		_sustained_ascend_ms = 0.0
	else:
		_vertical_vel = CharacterController.integrate_gravity(_vertical_vel, delta, false)
		var still_rising := _vertical_vel > 0.0
		_sustained_ascend_ms = LandAirTransitionController.accumulate_ascend_ms(
			_sustained_ascend_ms, delta * 1000.0, ascend_held and still_rising)

	var dir := _read_input_direction()
	velocity = Vector3(
		dir.x * CharacterController.MOVE_SPEED, _vertical_vel, dir.y * CharacterController.MOVE_SPEED)
	move_and_slide()

	var pad := LandAirTransitionController.nearest_landing_pad(global_position, landing_pads)
	var near_pad := (
		not pad.is_empty() and LandAirTransitionController.is_within_landing_pad(global_position, pad))

	if LandAirTransitionController.should_launch_flight(
			grounded, _vertical_vel, ascend_held, _sustained_ascend_ms,
			ASCEND_LAUNCH_THRESHOLD_MS, flight_capable):
		_begin_transition(true)
	elif LandAirTransitionController.should_launch_from_pad(
			grounded, near_pad, ascend_held, flight_capable):
		_begin_transition(true)

	if CharacterController.should_send_move(now_ms, _last_move_sent_ms, MOVE_SEND_MIN_INTERVAL_MS):
		_last_move_sent_ms = now_ms
		_send_move_intent("idle" if velocity.length() < 0.05 else "walk")


## Unmounted AIRBORNE leg — delegates the aero state machine to
## `FlightController.step_flight` verbatim (same call shape
## `flight_controller.gd#_physics_process` itself uses), then checks the
## landing trigger every step.
func _process_airborne(delta: float, now_ms: int) -> void:
	var inputs := {"roll": _read_roll_input(), "pitch": _read_pitch_input(), "active": true}
	# Honest zero — same posture flight_controller.gd's own header takes; no
	# Godot-side wind-sample fetch exists yet.
	var wind := {"wind": {"x": 0.0, "y": 0.0, "z": 0.0}, "lift": 0.0}

	_flight_state = FlightController.step_flight(_flight_state, inputs, wind, delta)

	var heading: float = _flight_state["heading"]
	var airspeed: float = _flight_state["airspeed"]
	var vy: float = _flight_state["vy"]
	velocity = Vector3(sin(heading) * airspeed, vy, cos(heading) * airspeed)
	rotation.y = heading
	move_and_slide()

	var grounded := is_on_floor()
	var pad := LandAirTransitionController.nearest_landing_pad(global_position, landing_pads)
	var near_pad := (
		not pad.is_empty() and LandAirTransitionController.is_within_landing_pad(global_position, pad))

	if LandAirTransitionController.should_land(grounded, vy, near_pad):
		_begin_transition(false)

	if CharacterController.should_send_move(now_ms, _last_move_sent_ms, MOVE_SEND_MIN_INTERVAL_MS):
		_last_move_sent_ms = now_ms
		_send_move_intent("fly")


## MOUNTED case — see header "Composition, not reimplementation". This
## controller runs NO physics of its own here; `aerial_mount` (a real
## AerialMountController) already owns movement. `should_launch_mounted` is
## used instead of `should_launch_flight` because MountController has no
## jump mechanic at all (ground-only arc-turn kinematics — see that file's
## own header), so "already airborne and still rising" has no meaning for a
## mount; a flight-capable mount lifts off directly from a standstill.
func _process_mounted_transitions(delta: float, ascend_held: bool) -> void:
	var grounded := aerial_mount.is_on_floor()
	var pos: Vector3 = aerial_mount.global_position
	var pad := LandAirTransitionController.nearest_landing_pad(pos, landing_pads)
	var near_pad := not pad.is_empty() and LandAirTransitionController.is_within_landing_pad(pos, pad)
	var mount_flight_capable: bool = aerial_mount.flight_capable

	if aerial_mount.altitude_mode == AerialMountController.AltitudeMode.GROUND:
		_mount_sustained_ascend_ms = LandAirTransitionController.accumulate_ascend_ms(
			_mount_sustained_ascend_ms, delta * 1000.0, grounded and ascend_held)
		var launch := (
			LandAirTransitionController.should_launch_from_pad(
				grounded, near_pad, ascend_held, mount_flight_capable)
			or LandAirTransitionController.should_launch_mounted(
				grounded, ascend_held, _mount_sustained_ascend_ms,
				ASCEND_LAUNCH_THRESHOLD_MS, mount_flight_capable))
		if launch:
			aerial_mount.set_airborne(true)
			_mount_sustained_ascend_ms = 0.0
	else:
		_mount_sustained_ascend_ms = 0.0
		if LandAirTransitionController.should_land(grounded, 0.0, near_pad):
			aerial_mount.set_airborne(false)


## One-line DI hookup: pulls the real `landingPads` array a `scene:request`
## already delivered, once `world/scene_bootstrap.gd` (extended by this
## unit) has parsed it. No-ops honestly if `bootstrap` hasn't received a
## scene yet (an empty array is a real, honest "no pads known yet" state,
## never fabricated).
func wire_landing_pads_from_scene_bootstrap(bootstrap: Node) -> void:
	if bootstrap != null and bootstrap.has_method("get_landing_pads"):
		landing_pads = bootstrap.get_landing_pads()


func _read_input_direction() -> Vector2:
	var dir := Vector2.ZERO
	if Input.is_key_pressed(KEY_W):
		dir.y -= 1.0
	if Input.is_key_pressed(KEY_S):
		dir.y += 1.0
	if Input.is_key_pressed(KEY_A):
		dir.x -= 1.0
	if Input.is_key_pressed(KEY_D):
		dir.x += 1.0
	return dir.normalized() if dir.length() > 0.0 else dir


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


## Fires the OPTIMISTIC local mode flip + the real `player:mode` request —
## see header "Server-authoritative, never client-authoritative". Refuses to
## start a second transition while one is already pending (no racing
## requests; the in-flight one must resolve via ack/nack first).
func _begin_transition(to_airborne: bool) -> void:
	if _transition_pending:
		return
	_prev_mode = mode
	_pending_to_airborne = to_airborne
	_transition_pending = true
	mode = Mode.AIRBORNE if to_airborne else Mode.GROUND
	if to_airborne:
		_flight_state = FlightController.new_flight_state()
	else:
		_vertical_vel = 0.0
	transition_requested.emit(to_airborne)

	if gateway == null or not gateway.has_method("send_event"):
		return
	var payload := LandAirTransitionController.build_mode_request_payload(
		"fly" if to_airborne else "walk")
	gateway.send_event("player:mode", payload)


func _send_move_intent(action: String) -> void:
	if gateway == null or not gateway.has_method("send_event"):
		return
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

	if evt == "player:mode:ack" and _transition_pending:
		# Quiet settle — the optimistic apply in _begin_transition already
		# happened; ack just confirms it, nothing visibly changes.
		_transition_pending = false
		transition_confirmed.emit(mode == Mode.AIRBORNE)
		return

	if evt == "player:mode:nack" and _transition_pending:
		# Visible, honest rollback — never keep the optimistic state against
		# the server's real say-so.
		mode = LandAirTransitionController.resolve_mode_transition(
			_pending_to_airborne, false, _prev_mode)
		_transition_pending = false
		if mode == Mode.GROUND:
			_vertical_vel = 0.0
		transition_rejected.emit(String(data.get("reason", "unknown")))


# ── Pure static helpers (no engine calls) ────────────────────────────────────

## Trigger 1 — launching into flight via jump-then-sustained-ascend. The
## player must already be airborne (left the ground via a normal jump) AND
## still rising (vertical_vel > 0 — distinguishes "mid-jump" from "falling/
## gliding") AND holding the ascend input continuously for at least
## `threshold_ms`. `flight_capable` is an honest external gate the caller
## owns — see header "Honest gap" — this function never fabricates
## capability, it only reads what was passed in.
static func should_launch_flight(
		is_grounded: bool, vertical_vel: float, ascend_held: bool,
		sustained_ascend_ms: float, threshold_ms: float, flight_capable: bool) -> bool:
	if is_grounded or not flight_capable or not ascend_held:
		return false
	return vertical_vel > 0.0 and sustained_ascend_ms >= threshold_ms


## Trigger 2 — deliberate takeoff from a landing pad. Grounded, standing
## within a real pad's radius (see is_within_landing_pad), and holding the
## ascend input — matches the master-spec's "purposeful" pad design intent
## (§4): flight from a pad is an intentional action, not automatic.
static func should_launch_from_pad(
		is_grounded: bool, near_pad: bool, ascend_held: bool, flight_capable: bool) -> bool:
	return is_grounded and near_pad and ascend_held and flight_capable


## Trigger for a MOUNTED creature — see `_process_mounted_transitions`'s own
## comment for why this is distinct from `should_launch_flight` (mounts have
## no jump mechanic; liftoff is a standstill ascend-hold, not a jump apex).
static func should_launch_mounted(
		is_grounded: bool, ascend_held: bool, sustained_ascend_ms: float,
		threshold_ms: float, flight_capable: bool) -> bool:
	if not is_grounded or not flight_capable or not ascend_held:
		return false
	return sustained_ascend_ms >= threshold_ms


## Trigger 3 — landing. Either the flyer has physically reached the ground
## while descending (is_grounded reflects a real is_on_floor() collision;
## vertical_vel <= 0 distinguishes "just landed" from "still ascending off a
## slope"), OR they are within a landing pad's radius (a pad allows an
## early, intentional landing before ground contact — mirrors takeoff's own
## intentionality).
static func should_land(is_grounded: bool, vertical_vel: float, near_pad: bool) -> bool:
	if near_pad:
		return true
	return is_grounded and vertical_vel <= 0.0


## Horizontal-only proximity check (pads are open-air platforms at a fixed
## elevation, not volumetric zones) — mirrors the real pad data shape from
## `content/world/concordia-hub/city-layout.json`'s `landingPads` array via
## `server/lib/building-purpose.js#landingPadsForWorld`:
## `{id, position:{x,z}, radius_m, elevation_m}`. A malformed pad (missing
## position/radius_m, or a non-positive radius) is honestly treated as "not
## near" rather than crashing or guessing a radius.
static func is_within_landing_pad(position: Vector3, pad: Dictionary) -> bool:
	if not (pad.has("position") and pad.has("radius_m")):
		return false
	var pos = pad["position"]
	if typeof(pos) != TYPE_DICTIONARY or not (pos.has("x") and pos.has("z")):
		return false
	var radius := float(pad["radius_m"])
	if radius <= 0.0:
		return false
	var dx: float = position.x - float(pos["x"])
	var dz: float = position.z - float(pos["z"])
	return (dx * dx + dz * dz) <= (radius * radius)


## Nearest real pad to `position`, or `{}` if `pads` is empty/entirely
## malformed. Distance is horizontal-only, matching `is_within_landing_pad`.
static func nearest_landing_pad(position: Vector3, pads: Array) -> Dictionary:
	var best: Dictionary = {}
	var best_dist_sq: float = INF
	for pad in pads:
		if typeof(pad) != TYPE_DICTIONARY or not pad.has("position"):
			continue
		var pos = pad["position"]
		if typeof(pos) != TYPE_DICTIONARY or not (pos.has("x") and pos.has("z")):
			continue
		var dx: float = position.x - float(pos["x"])
		var dz: float = position.z - float(pos["z"])
		var dist_sq: float = dx * dx + dz * dz
		if dist_sq < best_dist_sq:
			best_dist_sq = dist_sq
			best = pad
	return best


## Ascend-hold timer accumulation feeding `should_launch_flight`/
## `should_launch_mounted`'s `sustained_ascend_ms` input. Resets to 0 the
## instant `should_accumulate` is false (grounded, released the input, or no
## longer rising) rather than ever letting a stale hold-duration leak into a
## later, unrelated jump.
static func accumulate_ascend_ms(current_ms: float, dt_ms: float, should_accumulate: bool) -> float:
	if not should_accumulate:
		return 0.0
	return current_ms + maxf(0.0, dt_ms)


## Wire shape for the `player:mode` request — matches every sibling
## controller's own `_request_mode` payload (`{"mode": mode}`) and the real
## server-side `applyPlayerMode` handler's expected `data.mode` field
## (server.js:8984).
static func build_mode_request_payload(mode_string: String) -> Dictionary:
	return {"mode": mode_string}


## Resolves the LOCAL mode after a `player:mode:ack`/`:nack` response.
## `accepted=true` confirms the optimistically-applied
## `requested_mode_is_airborne` transition (quiet settle — it already
## happened, nothing changes). `accepted=false` rolls back to
## `previous_mode` (visible, honest revert — never keeps pretending a
## rejected transition succeeded). See header "Server-authoritative, never
## client-authoritative".
static func resolve_mode_transition(
		requested_mode_is_airborne: bool, accepted: bool, previous_mode: int) -> int:
	if accepted:
		return Mode.AIRBORNE if requested_mode_is_airborne else Mode.GROUND
	return previous_mode
