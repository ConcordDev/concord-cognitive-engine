class_name CharacterController
extends CharacterBody3D
## CharacterController — CharacterBody3D movement mirroring the kinematic
## contract in concord-frontend/lib/world-lens/physics-world.ts +
## jump-forgiveness.ts EXACTLY (same numeric constants), so a Godot avatar
## feels identical to the Three.js/Rapier client for the same inputs.
##
## Netcode: interpolation-first, no client-side prediction for OTHER
## entities (docs/GODOT_INTEGRATION.md's stated Phase-2 plan). This
## controller predicts only the LOCAL player's own movement (standard for
## responsiveness) and streams intent to the server via `player:move`
## through the injected GatewayClient at <=30Hz — mirroring server.js's own
## `if (now - _moveRateState.last < 33) return;` ~30Hz accept-rate exactly,
## so the client never sends faster than the server bothers to read. On a
## `player:move:nack` (server-side rate-limit / speed-hack / teleport
## rejection) the controller snaps back to the server-supplied `prev`
## position on the NEXT physics step — it never disputes the server, and it
## never fabricates a position when `prev` is missing/malformed (falls back
## to the client's own current position instead).
##
## All movement MATH — gravity/glide/swim integration, jump forgiveness
## (coyote time + jump buffer + variable height), the 30Hz send-gate, and
## nack-snapback position selection — is PURE STATIC so it is unit-testable
## without a scene tree or a live CharacterBody3D (see tests/).
##
## ── Session-manager input gate (R5/E24) ──────────────────────────────────────
## Optional injected `session_manager` (session/session_manager.gd). When
## wired, `_physics_process` early-returns unless
## `session_manager.is_input_owner(SessionManager.InputOwner.CHARACTER)` is
## true — this is what keeps movement from firing while the client is in
## Design free-fly or viewing an FEA overlay, per SessionManager's own
## input-ownership rules. Left `null` (the default), this controller behaves
## exactly as it did before this unit — always active — so every existing
## pure-function test and any standalone use of this controller is
## unaffected.

signal move_rejected(snapped_to: Vector3)

const SessionManager := preload("res://session/session_manager.gd")

# ── Constants — mirrored 1:1 from physics-world.ts / jump-forgiveness.ts ────
const GRAVITY: float = 9.81
const JUMP_DEFAULT_VY: float = 7.5
## m/s; can't fall faster than this while gliding.
const GLIDE_DESCENT_CAP: float = -1.5
## +8% horizontal speed while gliding.
const GLIDE_HORIZ_BOOST: float = 0.08
## m/s upward force gradient toward the surface while submerged.
const SWIM_BUOYANCY: float = 4.5
## Reduced gravity while submerged.
const SWIM_GRAVITY: float = 1.2
const SWIM_VEL_MIN: float = -3.0
const SWIM_VEL_MAX: float = 3.5
const COYOTE_MS: int = 120
const JUMP_BUFFER_MS: int = 130
## Ascending velocity is multiplied by this on early jump-button release.
const JUMP_CUT_FACTOR: float = 0.45
## m/s walk speed. Client-feel only — the server is authoritative and this
## number does not need to match any server-side cap.
const MOVE_SPEED: float = 5.0
## Mirrors server.js's own `player:move` accept-rate cap
## (`if (now - _moveRateState.last < 33) return;`) so the client never
## sends faster than the server bothers to read.
const MOVE_SEND_MIN_INTERVAL_MS: int = 33

## Which world/city this controller reports movement for.
@export var world_id: String = "concordia-hub"
## Injected GatewayClient (net/gateway_client.gd) instance. Dependency
## injection, not an internal `preload`+`new` — mirrors the project's
## existing DI convention (see docs/GODOT_INTEGRATION.md's "Key decisions"
## table) so this controller stays unit-testable and mount-order-agnostic.
@export var gateway: Node = null
## Optional injected SessionManager (session/session_manager.gd) — see
## class doc "Session-manager input gate". Null means "always active", the
## pre-R5/E24 behavior.
@export var session_manager: Node = null

var vertical_vel: float = 0.0
var is_airborne: bool = false
var gliding: bool = false
var swimming: bool = false
var last_grounded_at_ms: int = 0
var jump_buffered_at_ms: int = 0
var jump_vy_pending: float = 0.0

var _last_move_sent_ms: int = 0
var _snap_target: Vector3 = Vector3.ZERO
var _pending_snap: bool = false


func _ready() -> void:
	if gateway != null and gateway.has_signal("event_received"):
		gateway.event_received.connect(_on_gateway_event)


func _physics_process(delta: float) -> void:
	# R5/E24 input gate — see class doc "Session-manager input gate". Duck-
	# typed exactly like this file's own `gateway` DI checks below (no
	# session_manager wired == always active, the pre-R5/E24 behavior).
	if session_manager != null and session_manager.has_method("is_input_owner"):
		if not session_manager.is_input_owner(SessionManager.InputOwner.CHARACTER):
			return

	var now_ms := Time.get_ticks_msec()

	if _pending_snap:
		global_position = _snap_target
		vertical_vel = 0.0
		is_airborne = false
		_pending_snap = false

	var input_dir := _read_input_direction()
	var desired_x := input_dir.x * MOVE_SPEED
	var desired_z := input_dir.y * MOVE_SPEED

	if swimming:
		vertical_vel = CharacterController.integrate_swim(vertical_vel, delta)
	else:
		vertical_vel = CharacterController.integrate_gravity(vertical_vel, delta, gliding)

	var boosted := CharacterController.glide_horizontal_boost(desired_x, desired_z, gliding)

	velocity = Vector3(boosted.x, vertical_vel, boosted.y)
	move_and_slide()

	_update_grounded_state(now_ms)

	if CharacterController.should_send_move(now_ms, _last_move_sent_ms):
		_last_move_sent_ms = now_ms
		_send_move_intent()


## Raw WASD polling — deliberately NOT routed through Godot's InputMap
## action system, since no action bindings are baked into project.godot in
## this skeleton yet (hand-authoring the InputMap's serialized InputEvent
## resource format without an engine to verify it against would be a
## fabricated-looking config nobody can confirm actually binds correctly —
## see VISUAL_QA.md). Raw keycodes need no project settings and are exact.
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


func _update_grounded_state(now_ms: int) -> void:
	if swimming:
		is_airborne = false
		return
	if is_on_floor():
		if vertical_vel <= 0.0:
			vertical_vel = 0.0
			is_airborne = false
			last_grounded_at_ms = now_ms
			if CharacterController.should_flush_buffer(jump_buffered_at_ms, now_ms):
				vertical_vel = jump_vy_pending if jump_vy_pending > 0.0 else JUMP_DEFAULT_VY
				is_airborne = true
			jump_buffered_at_ms = 0
	elif absf(vertical_vel) > 0.01:
		is_airborne = true


## Request a jump. Mirrors physicsWorld.requestJump: fires immediately if
## grounded or within the coyote window; otherwise queues a jump-buffer
## entry that fires on the next ground contact (if within JUMP_BUFFER_MS).
func request_jump(jump_vy: float = JUMP_DEFAULT_VY) -> bool:
	var now_ms := Time.get_ticks_msec()
	if not CharacterController.can_jump(is_airborne, swimming, last_grounded_at_ms, now_ms):
		jump_buffered_at_ms = now_ms
		jump_vy_pending = jump_vy
		return false
	vertical_vel = jump_vy
	is_airborne = true
	jump_buffered_at_ms = 0
	return true


## Variable jump height: releasing the jump button early cuts the ascent.
## No-op while already falling (mirrors physicsWorld.releaseJump).
func release_jump() -> void:
	if is_airborne:
		vertical_vel = CharacterController.cut_jump(vertical_vel)


## Toggle glide. No-op while grounded, matching physicsWorld.setGlide's
## guard against an accidental Space-press-while-running triggering glide.
func set_glide(on: bool) -> bool:
	if on and not is_airborne:
		return false
	gliding = on
	return true


## Toggle swim. Activating swim disables glide, matching physicsWorld.setSwim.
func set_swim(on: bool) -> bool:
	swimming = on
	if on:
		gliding = false
	return true


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
		"action": "idle" if velocity.length() < 0.05 else "walk",
	})


func _on_gateway_event(evt: String, data: Dictionary) -> void:
	if evt != "player:move:nack":
		return
	_snap_target = CharacterController.snapback_position(data, global_position)
	_pending_snap = true
	move_rejected.emit(_snap_target)


# ── Pure static movement math ────────────────────────────────────────────────

## Gravity + glide-clamp integration for one physics step. Mirrors
## physics-world.ts's `moveCharacter`'s non-swimming vertical branch exactly:
## `verticalVel -= GRAVITY * dt; if (gliding && verticalVel < GLIDE_DESCENT_CAP)
## verticalVel = GLIDE_DESCENT_CAP;`.
static func integrate_gravity(
		vertical_vel: float, dt: float, gliding: bool,
		gravity: float = GRAVITY, glide_cap: float = GLIDE_DESCENT_CAP) -> float:
	var v := vertical_vel - gravity * dt
	if gliding and v < glide_cap:
		v = glide_cap
	return v


## Buoyancy + reduced-gravity integration while submerged. Mirrors
## physics-world.ts's swimming branch exactly, including the same 0.85
## damping factor and [-3.0, 3.5] clamp band.
static func integrate_swim(
		vertical_vel: float, dt: float,
		buoyancy: float = SWIM_BUOYANCY, swim_gravity: float = SWIM_GRAVITY,
		min_v: float = SWIM_VEL_MIN, max_v: float = SWIM_VEL_MAX) -> float:
	var v := vertical_vel * 0.85 + (buoyancy * 0.6) * dt - swim_gravity * dt
	return clampf(v, min_v, max_v)


## Small forward push during glide so the silhouette keeps moving even with
## no input held. Mirrors physics-world.ts's glideBoostX/Z exactly
## (`desiredTranslation.{x,z} * GLIDE_HORIZ_BOOST`, added on top of input).
static func glide_horizontal_boost(
		desired_x: float, desired_z: float, gliding: bool,
		boost: float = GLIDE_HORIZ_BOOST) -> Vector2:
	if not gliding:
		return Vector2(desired_x, desired_z)
	return Vector2(desired_x * (1.0 + boost), desired_z * (1.0 + boost))


## Coyote-time jump gate: true if grounded, or within `coyote_ms` of the
## last ground contact. Mirrors jump-forgiveness.ts#canJump exactly
## (swimming characters can never coyote-jump).
static func can_jump(
		is_airborne: bool, swimming: bool, last_grounded_at_ms: int, now_ms: int,
		coyote_ms: int = COYOTE_MS) -> bool:
	if swimming:
		return false
	if not is_airborne:
		return true
	return now_ms - last_grounded_at_ms <= coyote_ms


## Jump-buffer flush gate: true if a jump was requested within `buffer_ms`
## before this ground contact. `jump_buffered_at_ms == 0` means "no
## buffered jump" and never flushes. Mirrors
## jump-forgiveness.ts#shouldFlushBuffer exactly.
static func should_flush_buffer(
		jump_buffered_at_ms: int, now_ms: int, buffer_ms: int = JUMP_BUFFER_MS) -> bool:
	return jump_buffered_at_ms != 0 and (now_ms - jump_buffered_at_ms) <= buffer_ms


## Variable jump height: cuts an ascending jump short on early release.
## No-op while already descending. Mirrors jump-forgiveness.ts#cutJump.
static func cut_jump(vertical_vel: float, factor: float = JUMP_CUT_FACTOR) -> float:
	if vertical_vel > 0.0:
		return vertical_vel * factor
	return vertical_vel


## <=30Hz send-throttle gate. Mirrors server.js's own `player:move`
## accept-rate cap so the client never wastes bandwidth sending frames the
## server will silently drop anyway.
static func should_send_move(
		now_ms: int, last_sent_ms: int, min_interval_ms: int = MOVE_SEND_MIN_INTERVAL_MS) -> bool:
	return (now_ms - last_sent_ms) >= min_interval_ms


## Select the snap-back position from a `player:move:nack` payload's `prev`
## field (`{x, y, z}` — see server.js's own nack emit shape). Falls back to
## `fallback` (the client's own current position) if the payload is
## missing/malformed — this NEVER fabricates a position, per the
## honest-by-construction invariant (CLAUDE.md).
static func snapback_position(nack_data: Dictionary, fallback: Vector3) -> Vector3:
	var prev = nack_data.get("prev", null)
	if typeof(prev) != TYPE_DICTIONARY:
		return fallback
	if not (prev.has("x") and prev.has("y") and prev.has("z")):
		return fallback
	return Vector3(float(prev["x"]), float(prev["y"]), float(prev["z"]))
