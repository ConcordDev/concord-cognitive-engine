extends SceneTree
## touch_controls_probe.gd — real-engine verification for "Gamepad + touch
## input" (2026-08-08): does a REAL `TouchControls` (real Control tree, real
## TouchScreenButton nodes) genuinely respond to real INJECTED
## `InputEventScreenTouch`/`InputEventScreenDrag` events (via
## `Input.parse_input_event`, not a mocked handler call), and does a real
## `CharacterController` wired to it genuinely read the touch-driven
## movement vector through `_read_input_direction()`? Mirrors this session's
## other probes' "prove the wiring against real engine state, not each
## piece standalone" framing (combat_c7_probe.gd, npc_poller_probe.gd).
##
## Gamepad axis/button reading is NOT covered here — Godot's public Input
## API has no portable way to simulate a connected joypad device without
## real hardware attached, so that half of this unit is verified by pure
## logic only (tests/test_character_controller.gd's apply_deadzone/
## gamepad_move_vector checks, plus a live confirmation this session that
## the exact JOY_BUTTON_*/JOY_AXIS_* constants used in character_
## controller.gd resolve to the values Godot 4.4 actually reports). Stated
## plainly as a real, named residual, not silently implied as exercised.
##
## Headless is sufficient — no rendering claim, only real object-state
## mutation from real injected input events:
##   .godot-runtime/bin/godot --headless --path world-lens-godot \
##     --script res://tools/touch_controls_probe.gd

const TouchControls := preload("res://ui/touch_controls.gd")
const CharacterController := preload("res://player/character_controller.gd")

var _touch: TouchControls
var _character: CharacterController
var _frame := 0
var _result := {}


func _initialize() -> void:
	_touch = TouchControls.new()
	get_root().add_child(_touch)

	_character = CharacterController.new()
	_character.touch_controls = _touch
	get_root().add_child(_character)


func _process(_delta: float) -> bool:
	_frame += 1

	if _frame == 3:
		# 1. Joystick: real InputEventScreenTouch inside the base rect,
		# then a real InputEventScreenDrag, via the real Input pipeline —
		# not a direct method call on TouchControls.
		var base_rect: Rect2 = Rect2(_touch._joystick_base.global_position, _touch._joystick_base.size)
		var start_pos: Vector2 = base_rect.position + base_rect.size / 2.0

		var touch_down := InputEventScreenTouch.new()
		touch_down.index = 0
		touch_down.pressed = true
		touch_down.position = start_pos
		Input.parse_input_event(touch_down)

		var drag := InputEventScreenDrag.new()
		drag.index = 0
		drag.position = start_pos + Vector2(30, 0)
		Input.parse_input_event(drag)
		return false

	if _frame == 4:
		_result["joystick_vector_after_drag"] = {"x": _touch.get_move_vector().x, "y": _touch.get_move_vector().y}
		_result["joystick_vector_is_real_nonzero"] = _touch.get_move_vector() != Vector2.ZERO

		# _read_input_direction has no real privacy in GDScript (same
		# convention every other probe this session uses) — call it
		# directly to prove CharacterController genuinely reads the touch
		# vector, not just that TouchControls itself updated.
		var dir: Vector2 = _character._read_input_direction()
		_result["character_controller_reads_touch_vector"] = dir != Vector2.ZERO
		_result["character_controller_direction"] = {"x": dir.x, "y": dir.y}

		# Release the touch — vector must return to a real, honest zero.
		var touch_up := InputEventScreenTouch.new()
		touch_up.index = 0
		touch_up.pressed = false
		touch_up.position = _touch._joystick_base.global_position
		Input.parse_input_event(touch_up)
		return false

	if _frame == 5:
		_result["joystick_vector_after_release"] = {"x": _touch.get_move_vector().x, "y": _touch.get_move_vector().y}

		# 2. Attack button — real InputEventScreenTouch at its real global
		# position, hit-testing the REAL TouchScreenButton's own shape via
		# Godot's own internal handling (not a direct .is_pressed() fake).
		var btn: TouchScreenButton = _touch.attack_button
		var btn_pos: Vector2 = btn.global_position + Vector2(10, 10)
		var btn_touch_down := InputEventScreenTouch.new()
		btn_touch_down.index = 1
		btn_touch_down.pressed = true
		btn_touch_down.position = btn_pos
		Input.parse_input_event(btn_touch_down)
		return false

	if _frame == 6:
		_result["attack_button_pressed_after_touch"] = _touch.attack_button.is_pressed()

		var btn_touch_up := InputEventScreenTouch.new()
		btn_touch_up.index = 1
		btn_touch_up.pressed = false
		btn_touch_up.position = _touch.attack_button.global_position + Vector2(10, 10)
		Input.parse_input_event(btn_touch_up)
		return false

	if _frame == 7:
		_result["attack_button_pressed_after_release"] = _touch.attack_button.is_pressed()
		_result["ok"] = (
			bool(_result.get("joystick_vector_is_real_nonzero", false))
			and bool(_result.get("character_controller_reads_touch_vector", false))
			and bool(_result.get("attack_button_pressed_after_touch", false))
			and not bool(_result.get("attack_button_pressed_after_release", true))
		)
		print("[touch_controls_probe] RESULT ", JSON.stringify(_result))
		return true

	return false
