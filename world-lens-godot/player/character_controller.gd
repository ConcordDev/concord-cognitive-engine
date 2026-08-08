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
##
## ── Combat Phase C — first slice (E = attack only) ───────────────────────────
## Deliberately narrow scope, ported from the Three.js reference
## (`CombatInputController.tsx`'s E/F/R/Q/Shift scheme) rather than
## redesigned: this unit ports ONLY the E-key light-attack path.
## F/R/Q/Shift (parry/kick/dodge/modifier), combo chains, and lock-on camera
## behavior are explicitly deferred, real follow-up work — not silently
## implied as done.
##
## ── Combat C6 (2026-08-08) — F/R/Q tap actions added ──────────────────────────
## Extends Combat Phase C with the rest of the GROUND-context tap row from
## `CombatInputController.tsx`'s `CONTEXT_KEYMAP.ground` — F=parry, R=kick,
## Q=dodge. Deliberately still narrow: only the GROUND context exists here
## (no aerial/vehicle/hacker/underwater combat contexts in this client), only
## TAP variants (no hold-vs-tap distinction, so F never fires 'grab' — that's
## `CONTEXT_KEYMAP.ground.F.hold`, a real, separate follow-up), no double-tap
## finisher, no client-prediction swing animation, no whiff-cancel windows.
## Shift stays bound to sprint (see MOVE_SPEED/RUN_SPEED above) — the TS
## reference's `modifier-boost` (Shift as a combat modifier flag) is NOT
## ported; overloading an already-bound movement key for combat would be a
## real, separate design decision, not a mechanical port.
##
## Parry (F) and dodge (Q) are UNTARGETED — mirrors `CombatInputController
## .tsx`'s `parry`/`dodge` cases exactly (no `targetId` field in their
## `combat:dodge` payload at all): they fire regardless of `_current_target_id`.
## Kick (R) IS targeted, same as the existing E-attack (`combat:attack` with
## `targetId`, `actionOverride: 'attack-heavy'`, `style: 'kick'` — mirrors
## the TS `kick`/`dismount-kick` case's exact payload shape) — honest no-op
## with no target in range, same discipline as `_try_attack`.
##
## Server-side: `combat:attack` (kick's transport) already had Godot-gateway
## dispatch since Combat Phase C. `combat:dodge` (parry/dodge's transport)
## did NOT — `_onGodotClientMessage`'s switch had no case for it before this
## unit; added server-side alongside this client change
## (`_dispatchGodotCombatDodge`, server.js), reusing the SAME `_attemptDodge`/
## `_grantIFrames`/`recordCombatFlow` primitives the socket.io `combat:dodge`
## handler already resolves through — not a second implementation.
##
## Target selection is a query over `avatar_manager`'s already-live `_rigs`
## (optional injected `avatar/avatar_manager.gd`, same DI convention as
## `gateway`/`session_manager` above) — re-run every physics frame so the HUD
## can honestly show "no target"/"target in range" even before an attack is
## thrown. `_try_attack()` sends a deliberately minimal `combat:attack`
## payload (targetId + weapon + style only) — no client-asserted
## baseDamage/range: the server (`_dispatchGodotCombatAttack`,
## server.js:68748) is authoritative and clamps its own defaults, matching
## every other anti-cheat gate in this codebase. No target in range is an
## honest no-op, never a wasted/fabricated request.
##
## `combat:hit`/`combat:impact` already arrive for free over the open gateway
## connection (`realtimeEmit` mirrors into Godot gateway rooms — confirmed at
## server.js:9256/9337/9360 — no new backend wiring needed for this slice).
## Hit-feel (knockback) is applied ONLY when `local_user_id` (set by
## world/boot.gd from the real `authenticated` user id) matches the event's
## `targetId` — i.e. only when the LOCAL player was hit. Remote-target visual
## feedback (an attacker seeing their OWN hit land on someone else's rig) is
## a real, separate follow-up: AvatarRig's positions are snapshot-interpolated
## from server broadcasts, and a local knockback nudge there would just be
## overwritten by the next incoming sample — deferred, not attempted here.

signal move_rejected(snapped_to: Vector3)
signal target_acquired(target_id: String)
signal target_lost()
signal target_health_updated(target_id: String, health: float, max_health: float)

const SessionManager := preload("res://session/session_manager.gd")
const AssetResolver := preload("res://assets/asset_resolver.gd")

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
## number does not need to match any server-side cap. Mirrors
## concord-frontend/components/world-lens/AvatarSystem3D.tsx:362
## (`const MOVE_SPEED = 5.0; // m/s walking`) exactly.
const MOVE_SPEED: float = 5.0
## m/s run/sprint speed, held Shift. Mirrors AvatarSystem3D.tsx:363
## (`const RUN_SPEED = 12.0; // m/s running`) exactly — this controller had
## no sprint input at all before this unit (R5 continuation: real locomotion
## state for `player:move`), so a Godot player could never move faster than
## MOVE_SPEED and therefore could never be seen "running" by anyone.
const RUN_SPEED: float = 12.0
## m/s. The idle/walk classification boundary this controller's own outgoing
## `action` field uses. Mirrors AnimationStateMachine.IDLE_MAX_SPEED
## (avatar/animation_state_machine.gd) and server/lib/city-presence.js's
## `LOCOMOTION_IDLE_MAX_SPEED_MPS` exactly, so this controller's self-report
## agrees with how the server independently re-derives the same speed.
const LOCOMOTION_IDLE_MAX_SPEED: float = 0.05
## m/s. The walk/run classification boundary. Mirrors
## AnimationStateMachine.RUN_MIN_SPEED and server/lib/city-presence.js's
## `LOCOMOTION_RUN_MIN_SPEED_MPS` exactly — the documented "honest midpoint"
## between MOVE_SPEED and RUN_SPEED ((5.0 + 12.0) / 2 = 8.5).
const LOCOMOTION_RUN_MIN_SPEED: float = 8.5
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
## Optional injected AvatarManager (avatar/avatar_manager.gd) — see class doc
## "Combat Phase C". Null means target selection never runs (no combat
## input), matching every other optional-DI field here: this controller
## stays fully functional (movement-only) with nothing wired.
@export var avatar_manager: Node = null
## The LOCAL player's real user id, set by world/boot.gd once
## GatewayClient.authenticated fires (see boot.gd's `_on_authenticated`).
## Blank until then — `_on_combat_impact` treats blank as "can't possibly be
## me" and never applies hit-feel from an unresolved identity.
@export var local_user_id: String = ""
## Which of the 7 hero archetypes this controller's own weapon-in-hand
## resolves to (assets/asset_resolver.gd#ARCHETYPE_WEAPON) — mirrors the
## honest "warrior" default every other archetype-driven resolve in this
## client uses absent a real per-avatar archetype signal on the wire.
@export var archetype: String = "warrior"
## Max distance (m) `_update_target()` will select a target within. A
## client-side intent value only — the server's own `clampAttackRange`
## (server/lib/combat-limits.js) is the real, authoritative cap.
const ATTACK_RANGE_M: float = 3.0

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
var _current_target_id: String = ""
var _attack_key_was_down: bool = false
var _parry_key_was_down: bool = false
var _dodge_key_was_down: bool = false
var _kick_key_was_down: bool = false


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
	# R5 continuation — real sprint input (Shift), mirroring
	# AvatarSystem3D.tsx's `isRunning = keys.has('shift')` exactly. Before
	# this unit there was no way for a Godot player to move faster than
	# MOVE_SPEED at all.
	var is_running := Input.is_key_pressed(KEY_SHIFT)
	var move_speed := RUN_SPEED if is_running else MOVE_SPEED
	var desired_x := input_dir.x * move_speed
	var desired_z := input_dir.y * move_speed

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

	_update_target()
	var attack_down := Input.is_key_pressed(KEY_E)
	if attack_down and not _attack_key_was_down:
		_try_attack()
	_attack_key_was_down = attack_down

	var parry_down := Input.is_key_pressed(KEY_F)
	if parry_down and not _parry_key_was_down:
		_try_parry()
	_parry_key_was_down = parry_down

	var dodge_down := Input.is_key_pressed(KEY_Q)
	if dodge_down and not _dodge_key_was_down:
		_try_dodge()
	_dodge_key_was_down = dodge_down

	var kick_down := Input.is_key_pressed(KEY_R)
	if kick_down and not _kick_key_was_down:
		_try_kick()
	_kick_key_was_down = kick_down


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
	# R5 continuation — `action` now reports a real idle/walk/run
	# classification of this frame's actual HORIZONTAL speed (excludes
	# vertical_vel, unlike the pre-this-unit `velocity.length()` check, which
	# would have misclassified a fall/jump as "walk"). This is the client's
	# own honest self-report; the server independently re-derives the same
	# classification from position deltas over server wall-clock time
	# (city-presence.js#classifyLocomotion) and never trusts this field for
	# anything server-authoritative (anti-cheat, broadcast to other clients).
	var horizontal_speed := Vector2(velocity.x, velocity.z).length()
	gateway.send_event("player:move", {
		"cityId": world_id,
		"x": global_position.x,
		"y": global_position.y,
		"z": global_position.z,
		"direction": rotation.y,
		"rotation": rotation.y,
		"action": CharacterController.classify_action(horizontal_speed),
	})


## Re-run every physics frame so a HUD can honestly reflect "no target"/
## "target in range" even before an attack is ever thrown, not just at the
## moment of attack. No-op (never selects/clears a target) when no
## AvatarManager is wired — see the `avatar_manager` export's own doc.
func _update_target() -> void:
	if avatar_manager == null or not avatar_manager.has_method("nearest_target"):
		return
	var found: String = avatar_manager.nearest_target(global_position, ATTACK_RANGE_M)
	if found == _current_target_id:
		return
	_current_target_id = found
	if found.is_empty():
		target_lost.emit()
	else:
		target_acquired.emit(found)


func get_current_target_id() -> String:
	return _current_target_id


## E-key light attack. Honest no-op with no target in range or no gateway
## wired — never fabricates a wasted request. Sends a deliberately minimal
## payload (no client-asserted baseDamage/range) — see class doc "Combat
## Phase C".
func _try_attack() -> void:
	if _current_target_id.is_empty():
		return
	if gateway == null or not gateway.has_method("send_event"):
		return
	var weapon_id: String = AssetResolver.ARCHETYPE_WEAPON.get(archetype, "")
	gateway.send_event("combat:attack", {
		"targetId": _current_target_id,
		"weapon": weapon_id if weapon_id != "" else "fist",
		"style": "attack-light",
	})


## F-key parry (Combat C6). Untargeted — mirrors CombatInputController.tsx's
## `parry` case exactly (no `targetId`). Honest no-op only when no gateway is
## wired; unlike attack/kick this never depends on `_current_target_id`.
func _try_parry() -> void:
	if gateway == null or not gateway.has_method("send_event"):
		return
	gateway.send_event("combat:dodge", {
		"direction": "back",
		"wasParry": true,
		"style": "parry",
	})


## Q-key dodge (Combat C6). Untargeted, same shape as parry with
## `wasParry: false` — mirrors CombatInputController.tsx's `dodge` case.
func _try_dodge() -> void:
	if gateway == null or not gateway.has_method("send_event"):
		return
	gateway.send_event("combat:dodge", {
		"direction": "back",
		"wasParry": false,
		"style": "dodge",
	})


## R-key kick (Combat C6). TARGETED, same honest-no-op-with-no-target
## discipline as `_try_attack` — mirrors CombatInputController.tsx's `kick`
## case exactly, including reusing `combat:attack` as the transport (the TS
## reference's own comment: "No dedicated server event yet"). No `weapon`
## field — the TS payload omits it for kick (barehanded regardless of
## loadout), unlike `_try_attack`'s weapon-in-hand lookup.
func _try_kick() -> void:
	if _current_target_id.is_empty():
		return
	if gateway == null or not gateway.has_method("send_event"):
		return
	gateway.send_event("combat:attack", {
		"targetId": _current_target_id,
		"baseDamage": 14,
		"range": 3,
		"armorPierce": 0,
		"heavy": false,
		"style": "kick",
		"actionOverride": "attack-heavy",
	})


func _on_gateway_event(evt: String, data: Dictionary) -> void:
	match evt:
		"player:move:nack":
			_snap_target = CharacterController.snapback_position(data, global_position)
			_pending_snap = true
			move_rejected.emit(_snap_target)
		"combat:hit":
			_on_combat_hit(data)
		"combat:impact":
			_on_combat_impact(data)


## `combat:hit` (server.js:68839) carries the resolved damage/health numbers.
## Only relevant to THIS controller's HUD when it's about the target we're
## actively tracking — a hit on some other pair in the same world is real
## data, just not ours to display.
func _on_combat_hit(data: Dictionary) -> void:
	var target_id := String(data.get("targetId", ""))
	if target_id.is_empty() or target_id != _current_target_id:
		return
	target_health_updated.emit(
		target_id, float(data.get("targetHealth", 0.0)), float(data.get("targetMaxHealth", 0.0)))


## `combat:impact` (server/lib/combat/impact-feel.js#buildImpactPayload)
## carries the server-authoritative hit-feel. Applied ONLY when the LOCAL
## player is the one who got hit (`local_user_id` matches `targetId`) — see
## class doc for why remote-target feedback is deferred. `local_user_id ==
## ""` (not yet authenticated) can never match a real targetId, so this is
## already a safe no-op before boot.gd wires it.
func _on_combat_impact(data: Dictionary) -> void:
	if local_user_id.is_empty():
		return
	if String(data.get("targetId", "")) != local_user_id:
		return
	var feel: Dictionary = data.get("feel", {})
	var impulse := CharacterController.knockback_impulse(
		global_position, data.get("attackerPosition", null), float(feel.get("knockback", 0.0)))
	if impulse != Vector3.ZERO:
		velocity += impulse


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


## Classify a HORIZONTAL speed into this controller's outgoing `action`
## string. Mirrors AnimationStateMachine._locomotion_label
## (avatar/animation_state_machine.gd) and server/lib/city-presence.js's
## classifyLocomotion exactly (same two boundaries: idle below
## LOCOMOTION_IDLE_MAX_SPEED, run at/above LOCOMOTION_RUN_MIN_SPEED) — this
## is the LOCAL player's own honest self-report of its own real velocity, not
## a self-declared flag; the server independently re-derives the same label
## server-side from position deltas and never trusts this field for anything
## authoritative. No hysteresis here (unlike the server/receiving-side
## classifiers): this runs on the controller's own continuous, non-network
## velocity every physics frame, driven by deliberate key transitions rather
## than packet jitter, so there is no flapping risk to guard against.
static func classify_action(horizontal_speed: float) -> String:
	if horizontal_speed < LOCOMOTION_IDLE_MAX_SPEED:
		return "idle"
	if horizontal_speed < LOCOMOTION_RUN_MIN_SPEED:
		return "walk"
	return "run"


## Combat Phase C — derive a knockback velocity impulse from a `combat:impact`
## payload's `feel.knockback` magnitude (server/lib/combat/impact-feel.js) and
## a real or missing `attackerPosition`. Direction is away from the attacker
## in the XZ plane (target_pos.y is preserved — this never launches a target
## vertically); a missing/malformed `attacker_pos` (untyped `Variant`, since
## it comes straight off a decoded JSON payload — may legitimately be `null`)
## falls back to a fixed +Z push rather than fabricating a direction from
## nothing. `knockback <= 0` (severity "none"/"flinch" per SEVERITY_FEEL)
## returns Vector3.ZERO honestly — no impulse, not a tiny fabricated one.
static func knockback_impulse(target_pos: Vector3, attacker_pos, knockback: float) -> Vector3:
	if knockback <= 0.0:
		return Vector3.ZERO
	var dir := Vector3(0.0, 0.0, 1.0)
	if typeof(attacker_pos) == TYPE_DICTIONARY and attacker_pos.has("x") and attacker_pos.has("z"):
		var away := target_pos - Vector3(float(attacker_pos["x"]), target_pos.y, float(attacker_pos["z"]))
		if away.length() > 0.01:
			dir = away.normalized()
	return dir * knockback


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
