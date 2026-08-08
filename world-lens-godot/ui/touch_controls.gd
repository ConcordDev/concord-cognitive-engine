class_name TouchControls
extends CanvasLayer
## TouchControls — on-screen movement joystick + action buttons for
## touch/mobile play (2026-08-08, "Gamepad + touch input" unit).
##
## No TS reference exists for touch controls anywhere in this codebase
## (confirmed by grep across concord-frontend/) — this is an ORIGINAL
## design, not a port, built from Godot's own real `TouchScreenButton` node
## (a genuine engine feature purpose-built for exactly this — real tap
## detection, no hand-rolled event plumbing needed) plus a hand-built
## virtual-joystick `Control`, since Godot has no stock joystick node.
##
## ── Scoped to the ESSENTIAL subset ───────────────────────────────────────
## Movement + attack + parry + dodge + kick only. Heavy attack, grab,
## lock-on cycle, hard-lock, and sprint deliberately have NO touch button
## this pass — a real mobile screen has finite space for on-screen chrome,
## and these five are gamepad/keyboard-only for now: a real, named
## follow-up, not silently dropped (see player/character_controller.gd's
## own class doc "Gamepad + touch input" section for the full input-source
## precedence rules these buttons feed into).
##
## ── Virtual joystick ──────────────────────────────────────────────────────
## Tracked via `_input()` (not `_gui_input()` on a Control) so a drag can
## travel outside the base's own visual rect without losing tracking — the
## standard virtual-joystick technique. Accepts BOTH `InputEventScreenTouch`/
## `InputEventScreenDrag` (real touch) and `InputEventMouseButton`/
## `InputEventMouseMotion` (so the logic is exercisable with a desktop mouse
## too, e.g. this sandbox's headless probes — harmless on a real touch
## device since touch and mouse events don't fire for the same physical
## input on any platform Godot targets). `clamp_offset` is pure and
## unit-testable without a scene tree.
##
## `character_controller.gd` reads `get_move_vector()` + the 4 exported
## `TouchScreenButton` references directly (duck-typed DI, same convention
## as `sfx_player`) — this class owns no combat logic itself, only input
## capture and a minimal visible affordance (plain colour rects + labels,
## no fabricated icon assets).

signal joystick_changed(vector: Vector2)

const JOYSTICK_RADIUS_PX := 60.0
const KNOB_SIZE_PX := 44.0
const ACTION_BUTTON_SIZE_PX := 72.0

var attack_button: TouchScreenButton
var parry_button: TouchScreenButton
var dodge_button: TouchScreenButton
var kick_button: TouchScreenButton

var _joystick_base: Control
var _joystick_knob: Control
var _joystick_touch_index: int = -2  # -2 = none; -1 reserved for mouse
var _joystick_origin: Vector2 = Vector2.ZERO
var _joystick_vector: Vector2 = Vector2.ZERO


func _ready() -> void:
	layer = 5  # above the world, below nothing else currently mounted here
	_build_joystick()
	_build_action_buttons()


func get_move_vector() -> Vector2:
	return _joystick_vector


## Pure. `point - origin`, scaled by `max_radius` into a -1..1-ish vector,
## magnitude capped at 1.0 — same output shape `CharacterController.
## gamepad_move_vector` returns, so both fallback tiers in `_read_input_
## direction()` feed identically-shaped Vector2s.
static func clamp_offset(origin: Vector2, point: Vector2, max_radius: float) -> Vector2:
	if max_radius <= 0.0:
		return Vector2.ZERO
	return ((point - origin) / max_radius).limit_length(1.0)


func _build_joystick() -> void:
	var base := Control.new()
	base.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	base.position = Vector2(48, -48 - JOYSTICK_RADIUS_PX * 2)
	base.size = Vector2(JOYSTICK_RADIUS_PX * 2, JOYSTICK_RADIUS_PX * 2)
	base.mouse_filter = Control.MOUSE_FILTER_IGNORE  # tracked via _input(), not _gui_input()
	add_child(base)
	_joystick_base = base

	var base_visual := ColorRect.new()
	base_visual.color = Color(1, 1, 1, 0.15)
	base_visual.size = base.size
	base_visual.mouse_filter = Control.MOUSE_FILTER_IGNORE
	base.add_child(base_visual)

	var knob := ColorRect.new()
	knob.color = Color(1, 1, 1, 0.35)
	knob.size = Vector2(KNOB_SIZE_PX, KNOB_SIZE_PX)
	knob.mouse_filter = Control.MOUSE_FILTER_IGNORE
	base.add_child(knob)
	_joystick_knob = knob
	_update_knob_position()


func _build_action_buttons() -> void:
	attack_button = _make_action_button("E", Color(0.75, 0.2, 0.2, 0.65), Vector2(-260, -160))
	parry_button = _make_action_button("F", Color(0.2, 0.4, 0.75, 0.65), Vector2(-180, -220))
	dodge_button = _make_action_button("Q", Color(0.2, 0.6, 0.3, 0.65), Vector2(-180, -100))
	kick_button = _make_action_button("R", Color(0.7, 0.55, 0.15, 0.65), Vector2(-100, -160))


## One button = one real `TouchScreenButton` (real tap detection, via a
## `RectangleShape2D` tap region matching the visible size) + a plain
## `ColorRect`+`Label` child for honest visible affordance (no fabricated
## icon texture — a coloured rect with the real bound keyboard letter is
## what's actually true about this button).
##
## `TouchScreenButton` extends `Node2D`, NOT `Control` — found live, not
## assumed: `set_anchors_preset` genuinely doesn't exist on it (a real
## engine run threw "Invalid call. Nonexistent function 'set_anchors_
## preset'"). Its `position` is a plain top-left-origin 2D offset, so a
## bottom-right anchor has to be computed by hand from the real viewport
## size rather than requested via Control's anchor system.
func _make_action_button(label_text: String, color: Color, offset_from_bottom_right: Vector2) -> TouchScreenButton:
	var btn := TouchScreenButton.new()
	var viewport_size := get_viewport().get_visible_rect().size
	btn.position = viewport_size + offset_from_bottom_right
	var shape := RectangleShape2D.new()
	shape.size = Vector2(ACTION_BUTTON_SIZE_PX, ACTION_BUTTON_SIZE_PX)
	btn.shape = shape
	btn.shape_centered = false
	add_child(btn)

	var visual := ColorRect.new()
	visual.color = color
	visual.size = Vector2(ACTION_BUTTON_SIZE_PX, ACTION_BUTTON_SIZE_PX)
	visual.mouse_filter = Control.MOUSE_FILTER_IGNORE
	btn.add_child(visual)

	var label := Label.new()
	label.text = label_text
	label.size = visual.size
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	btn.add_child(label)

	return btn


func _update_knob_position() -> void:
	if _joystick_knob == null or _joystick_base == null:
		return
	var center := (_joystick_base.size - _joystick_knob.size) / 2.0
	_joystick_knob.position = center + _joystick_vector * JOYSTICK_RADIUS_PX * 0.5


func _joystick_base_global_rect() -> Rect2:
	return Rect2(_joystick_base.global_position, _joystick_base.size)


func _start_joystick(index: int, at: Vector2) -> void:
	_joystick_touch_index = index
	_joystick_origin = at
	_joystick_vector = Vector2.ZERO
	_update_knob_position()
	joystick_changed.emit(_joystick_vector)


func _drag_joystick(index: int, at: Vector2) -> void:
	if index != _joystick_touch_index:
		return
	_joystick_vector = clamp_offset(_joystick_origin, at, JOYSTICK_RADIUS_PX)
	_update_knob_position()
	joystick_changed.emit(_joystick_vector)


func _end_joystick(index: int) -> void:
	if index != _joystick_touch_index:
		return
	_joystick_touch_index = -2
	_joystick_vector = Vector2.ZERO
	_update_knob_position()
	joystick_changed.emit(_joystick_vector)


func _input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		var t := event as InputEventScreenTouch
		if t.pressed:
			if _joystick_touch_index == -2 and _joystick_base_global_rect().has_point(t.position):
				_start_joystick(t.index, t.position)
		else:
			_end_joystick(t.index)
	elif event is InputEventScreenDrag:
		var d := event as InputEventScreenDrag
		_drag_joystick(d.index, d.position)
	elif event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_LEFT:
			if mb.pressed:
				if _joystick_touch_index == -2 and _joystick_base_global_rect().has_point(mb.position):
					_start_joystick(-1, mb.position)
			else:
				_end_joystick(-1)
	elif event is InputEventMouseMotion:
		var mm := event as InputEventMouseMotion
		_drag_joystick(-1, mm.position)
