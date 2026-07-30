class_name CameraRig
extends Node3D
## CameraRig — R5/E24. The ONE Camera3D shared by every session mode (World
## follow-cam, Design free-fly, FEA orbit) instead of each mode instantiating
## its own Camera3D.
##
## ── Why this needed building from scratch ───────────────────────────────────
## A repo-wide grep for `Camera3D`/`camera` across world-lens-godot before
## this unit turned up exactly one pattern: `world/dtu_prop_interaction.gd`
## expects an externally-provided camera via `@export var camera_path:
## NodePath` for raycast-picking, but never builds or owns one itself.
## `world/boot.gd`'s scene (`scenes/boot.tscn`) has no Camera3D node at all.
## So there was no existing rig to reuse or extend — this is genuinely new,
## not a refactor of prior camera code, and it is scoped to exactly what
## unifying World/Design/FEA needs (three behaviors), nothing more.
##
## Which RigMode is active is decided EXCLUSIVELY by
## `session/session_manager.gd`'s `camera_rig_mode_for` — this file never
## decides its own mode from local state. `set_rig_mode` is pushed to it by
## SessionManager whenever `mode`/`fea_overlay_active` changes.
##
## ── Three rig behaviors, one Camera3D ────────────────────────────────────────
##   - FOLLOW: third-person offset behind+above a target (World AND
##     Playtest — both are "playing", so both get the same follow
##     behavior; see session_manager.gd's `input_owner_for` for the same
##     World/Playtest pairing rationale).
##   - FREE_FLY: WASD+QE fly movement with mouse-look, unattached to any
##     target (Design edit — an author needs to fly around a level under
##     construction).
##   - ORBIT: fixed-distance orbit around a focus point, mouse-drag to
##     rotate, scroll to zoom (FEA viz — inspecting a static structure from
##     every angle; the focus point is the real structure's centroid, e.g.
##     FeaSceneBuilder.get_bounds_center(), never an assumed origin).
##
## All rig-mode transform MATH is pure/static (testable without an engine —
## see tests/test_camera_rig.gd); `_process` and the raw input readers are
## the only engine-dependent glue, following the SAME raw-keycode-polling
## convention every other controller in this project already uses
## (player/character_controller.gd, avatar/land_air_transition_controller.gd)
## — no InputMap actions, since none are bound in project.godot yet (see
## character_controller.gd's own note on why).
##
## ── R6 — mouse-look input wired (was the class doc's own "Honest gap") ──────
## FREE_FLY captures the mouse (`Input.MOUSE_MODE_CAPTURED`) the moment it
## becomes the active rig mode and releases it (`MOUSE_MODE_VISIBLE`) the
## moment it stops being active; `_unhandled_input` accumulates
## `InputEventMouseMotion.relative` while captured. ORBIT never captures the
## mouse (a spectator/FEA-viewer still needs to click UI) — it accumulates
## drag delta only while the left mouse button is held, and scroll wheel
## events call the ALREADY-EXISTING (previously uncalled) `zoom_orbit()`.
## `_read_mouse_look_delta`/`_read_mouse_drag_delta` drain-and-reset their
## respective accumulator each `_process` tick, same pattern
## `_read_free_fly_move_input` already used for raw keys. Still genuinely
## unverified: headless draws nothing and generates no real mouse events, so
## whether this FEELS right (sensitivity, whether captured-mouse UX is
## correct) is unexercised here — see VISUAL_QA.md. The math it feeds
## (`free_fly_step`, `orbit_transform`) was already real and tested before
## this unit; only the input source changed from "always zero" to "real
## accumulated motion."
##
## STATUS: compiles and its math is EXECUTED by a real Godot 4.4 (docs/GODOT_RUNTIME.md)
## (tests/test_camera_rig.gd). The unverified half IS the feature here —
## framing cannot be asserted by arithmetic; headless draws nothing. See world-lens-godot/VISUAL_QA.md for exactly what
## is genuinely unverified (does the follow-cam feel smooth at real avatar
## speeds, does orbit read correctly under default lighting, does free-fly
## feel controllable).

enum RigMode { FOLLOW, FREE_FLY, ORBIT }

## Follow-cam dials — design values, not measured against a real avatar
## (queued in VISUAL_QA.md).
@export var follow_offset: Vector3 = Vector3(0.0, 3.0, 6.0)
@export var follow_smoothing: float = 8.0

@export var free_fly_speed: float = 8.0
@export var free_fly_look_sensitivity: float = 0.005

@export var orbit_default_distance: float = 5.0
@export var orbit_min_distance: float = 1.0
@export var orbit_max_distance: float = 50.0
@export var orbit_look_sensitivity: float = 0.01
@export var orbit_zoom_step: float = 1.0

var rig_mode: int = RigMode.FOLLOW

var _camera: Camera3D

## FOLLOW target — injected, never owned. A null target holds the camera at
## its last transform rather than snapping to a fabricated position.
var _follow_target: Node3D = null

var _free_fly_yaw: float = 0.0
var _free_fly_pitch: float = 0.0

var _orbit_focus: Vector3 = Vector3.ZERO
var _orbit_yaw: float = 0.0
var _orbit_pitch: float = 0.3
var _orbit_distance: float = 5.0

## R6 — real mouse input accumulators, drained by
## _read_mouse_look_delta/_read_mouse_drag_delta each `_process` tick (see
## class doc's "mouse-look input wired" section).
var _mouse_look_accum: Vector2 = Vector2.ZERO
var _mouse_drag_accum: Vector2 = Vector2.ZERO
var _orbit_dragging: bool = false


func _ready() -> void:
	_camera = Camera3D.new()
	add_child(_camera)
	_orbit_distance = orbit_default_distance


## Pushed by SessionManager (never decided locally — see class doc). A
## caller that wants a specific rig mode outside SessionManager (e.g. a
## standalone preview scene) can still call this directly; it is a public
## method, not SessionManager-only, but SessionManager is the only intended
## production caller.
func set_rig_mode(mode: int) -> void:
	if mode == rig_mode:
		return
	rig_mode = mode
	if mode == RigMode.FREE_FLY:
		# Start free-fly from the camera's CURRENT orientation — never
		# snaps to a fabricated yaw/pitch.
		var euler := _camera.global_transform.basis.get_euler()
		_free_fly_yaw = euler.y
		_free_fly_pitch = euler.x
	elif mode == RigMode.ORBIT:
		_orbit_distance = orbit_default_distance
		_orbit_dragging = false
	# R6 — FREE_FLY is the only mode that captures the mouse (continuous
	# mouse-look, matching a first-person/spectator fly camera's usual
	# convention); ORBIT/FOLLOW leave the cursor free so UI/click-to-drag
	# still work. `Input` is a real engine singleton — a headless run with no
	# display server may no-op this harmlessly, but nothing here depends on
	# that; it's exercised only when a live SessionManager actually pushes a
	# rig-mode change, never during --import/--script compilation.
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED if mode == RigMode.FREE_FLY else Input.MOUSE_MODE_VISIBLE


## FOLLOW target — a real Node3D (typically the local player's
## CharacterBody3D), never fabricated. Passing null honestly freezes the
## follow-cam at its last transform.
func set_follow_target(target: Node3D) -> void:
	_follow_target = target


## ORBIT focus — a real world position (e.g.
## FeaSceneBuilder.get_bounds_center()), never an assumed origin.
func set_orbit_focus(focus: Vector3) -> void:
	_orbit_focus = focus


func zoom_orbit(delta_steps: float) -> void:
	_orbit_distance = clampf(
		_orbit_distance + delta_steps * orbit_zoom_step, orbit_min_distance, orbit_max_distance)


func _process(delta: float) -> void:
	match rig_mode:
		RigMode.FOLLOW:
			_process_follow(delta)
		RigMode.FREE_FLY:
			_process_free_fly(delta)
		RigMode.ORBIT:
			_process_orbit()


func _process_follow(delta: float) -> void:
	if _follow_target == null:
		return
	var desired := CameraRig.follow_transform(
		_follow_target.global_position, _follow_target.rotation.y, follow_offset)
	_camera.global_transform = CameraRig.smoothed_transform(
		_camera.global_transform, desired, follow_smoothing, delta)


func _process_free_fly(delta: float) -> void:
	var look := _read_mouse_look_delta()
	_free_fly_yaw -= look.x * free_fly_look_sensitivity
	_free_fly_pitch = clampf(_free_fly_pitch - look.y * free_fly_look_sensitivity, -1.5, 1.5)

	var basis := Basis(Vector3.UP, _free_fly_yaw) * Basis(Vector3.RIGHT, _free_fly_pitch)
	var move_input := _read_free_fly_move_input()
	_camera.global_position = CameraRig.free_fly_step(
		_camera.global_position, basis, move_input, free_fly_speed, delta)
	_camera.global_transform.basis = basis


func _process_orbit() -> void:
	var drag := _read_mouse_drag_delta()
	_orbit_yaw -= drag.x * orbit_look_sensitivity
	_orbit_pitch = clampf(_orbit_pitch - drag.y * orbit_look_sensitivity, -1.4, 1.4)
	_camera.global_transform = CameraRig.orbit_transform(
		_orbit_focus, _orbit_yaw, _orbit_pitch, _orbit_distance)


## R6 — real accumulator drain-and-reset (see class doc). Same "read once
## per tick, then zero it" shape `_read_free_fly_move_input` already uses
## for keys, just fed by `_unhandled_input`'s mouse-motion accumulation
## instead of a per-frame poll (mouse deltas arrive as discrete events, not
## a held-key state `Input.is_*_pressed` could sample directly).
func _read_mouse_look_delta() -> Vector2:
	var delta := _mouse_look_accum
	_mouse_look_accum = Vector2.ZERO
	return delta


func _read_mouse_drag_delta() -> Vector2:
	var delta := _mouse_drag_accum
	_mouse_drag_accum = Vector2.ZERO
	return delta


## R6 — accumulates real mouse input for whichever rig mode is currently
## active; a no-op for FOLLOW (nothing reads mouse deltas in that mode).
func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion:
		if rig_mode == RigMode.FREE_FLY and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
			_mouse_look_accum += event.relative
		elif rig_mode == RigMode.ORBIT and _orbit_dragging:
			_mouse_drag_accum += event.relative
	elif event is InputEventMouseButton:
		if rig_mode != RigMode.ORBIT:
			return
		if event.button_index == MOUSE_BUTTON_LEFT:
			_orbit_dragging = event.pressed
		elif event.pressed and event.button_index == MOUSE_BUTTON_WHEEL_UP:
			zoom_orbit(-1.0)
		elif event.pressed and event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			zoom_orbit(1.0)


func _read_free_fly_move_input() -> Vector3:
	var dir := Vector3.ZERO
	if Input.is_key_pressed(KEY_W):
		dir.z -= 1.0
	if Input.is_key_pressed(KEY_S):
		dir.z += 1.0
	if Input.is_key_pressed(KEY_A):
		dir.x -= 1.0
	if Input.is_key_pressed(KEY_D):
		dir.x += 1.0
	if Input.is_key_pressed(KEY_E):
		dir.y += 1.0
	if Input.is_key_pressed(KEY_Q):
		dir.y -= 1.0
	return dir


# ── Pure static helpers (no engine calls) ────────────────────────────────────

## Third-person follow transform: camera sits at `target_pos + (offset
## rotated by target_yaw)`, looking back at `target_pos`. Rotating the
## offset by the target's own yaw means the camera stays "behind" the
## target as it turns, rather than at a fixed world-space offset.
static func follow_transform(
		target_pos: Vector3, target_yaw: float, offset: Vector3) -> Transform3D:
	var rotated_offset := Basis(Vector3.UP, target_yaw) * offset
	var cam_pos := target_pos + rotated_offset
	return CameraRig._look_at_transform(cam_pos, target_pos)


## Fixed-distance orbit position on a sphere around `focus`, looking back at
## it. Standard spherical-to-Cartesian orbit-camera math: yaw sweeps around
## the vertical axis, pitch tilts up/down.
static func orbit_transform(
		focus: Vector3, yaw: float, pitch: float, distance: float) -> Transform3D:
	var direction := Vector3(cos(pitch) * sin(yaw), sin(pitch), cos(pitch) * cos(yaw))
	var cam_pos := focus + direction * distance
	return CameraRig._look_at_transform(cam_pos, focus)


## Shared look-at builder for both rig modes above. Reuses the SAME
## degenerate-parallel-up guard `conkay/conkay_pointing.gd#look_at_basis`
## already established (a view direction (near-)parallel to `up` has no
## well-defined "right" axis; Godot's own `Basis.looking_at()` pushes an
## error/undefined result there) rather than inventing a second guard
## pattern. Also handles `eye == target` (no well-defined direction at all)
## by falling back to an identity-facing transform at `eye` — never a NaN
## basis.
static func _look_at_transform(eye: Vector3, target: Vector3) -> Transform3D:
	var delta := target - eye
	if delta.length() < 0.0001:
		return Transform3D(Basis(), eye)
	var direction := delta.normalized()
	var up := Vector3.UP
	if absf(direction.dot(up)) > 0.999:
		up = Vector3.RIGHT
	return Transform3D(Basis.looking_at(direction, up), eye)


## One step of free-fly movement: input is interpreted in the camera's own
## look-basis (so "forward" always means "where you're looking"), normalized
## before scaling so diagonal movement isn't faster than axis-aligned.
static func free_fly_step(
		position: Vector3, basis: Basis, move_input: Vector3, speed: float, delta: float) -> Vector3:
	var normalized_input := move_input.normalized() if move_input.length() > 0.0 else move_input
	var world_move := basis * normalized_input
	return position + world_move * speed * delta


## Exponential-smoothing interpolation from `current` toward `target` —
## used by FOLLOW so the camera doesn't rigidly snap to the target's exact
## position every frame. `t` is clamped to [0, 1] so a very large
## `smoothing * delta` (e.g. a frame-rate hitch) still can't overshoot past
## `target`.
static func smoothed_transform(
		current: Transform3D, target: Transform3D, smoothing: float, delta: float) -> Transform3D:
	var t := clampf(smoothing * delta, 0.0, 1.0)
	var origin := current.origin.lerp(target.origin, t)
	var basis := current.basis.slerp(target.basis, t)
	return Transform3D(basis, origin)
