class_name PauseMenu
extends CanvasLayer
## PauseMenu — UI (2026-08-08). The client's first interactive menu:
## Escape toggles a real `Control` overlay (Resume / Master Volume / Quit to
## Desktop), reusing `SessionManager.pause_overlay_active` (see that file's
## own doc comment for why pause is a flag, not a `Mode`) to freeze every
## input-owning controller while open — `world/boot.gd` is the one that
## calls `session_manager.open_pause_overlay()`/`close_pause_overlay()` on
## Escape and connects this menu's own `resume_requested` signal back to
## `close_pause_overlay()`, mirroring the existing `fea_overlay_opened`/
## `_closed` reactive convention that file already uses for the FEA overlay.
##
## ── Why no main menu / title screen this pass ────────────────────────────────
## `world/boot.gd`'s `_ready()` connects to the gateway and spawns the local
## player unconditionally, immediately — there is no pre-connect "not yet
## playing" state anywhere in the client for a title screen to represent.
## Building one honestly means restructuring `_ready()` into an explicit
## state machine (idle -> connecting -> spawned), a real, separate
## architectural change bigger than this slice — not something a menu
## overlay can retrofit on top without either lying about a "Play" button
## that already happened, or deferring the real gateway connect until a
## button press (a change to this client's whole boot contract). Flagged as
## a real, named follow-up, not faked with a menu that has nothing behind it.
##
## Volume control is REAL, not decorative: the slider is bound live to the
## injected `SfxPlayer`'s own `master_volume` @export (`audio/sfx_player.gd`)
## — moving it immediately changes what plays.
##
## Quit is capability-gated, not merely hidden by convention:
## `OS.has_feature("web")` is true in a browser export, where
## `get_tree().quit()` is a documented no-op (no window/process for the
## engine to close there) — the button is only ever BUILT on a native
## target, never shown as grayed-out chrome pretending to work.

signal resume_requested()

## Optional injected SfxPlayer (audio/sfx_player.gd). Null means the volume
## slider still renders (starts at a sane 0.8 default) but has nothing real
## to control — same optional-DI convention as every other injected
## dependency in this client (never a hard requirement to construct).
@export var sfx_player: Node = null

var _panel: PanelContainer
var _volume_slider: HSlider


func _ready() -> void:
	# Above every other CanvasLayer this client mounts (target/quest HUD
	# both default to layer 1) so the overlay always wins visually.
	layer = 100
	visible = false

	var dim := ColorRect.new()
	dim.color = Color(0.0, 0.0, 0.0, 0.55)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	# STOP (not the default PASS) so clicking the dim background doesn't
	# leak input through to whatever's rendered behind it — the pause
	# overlay is meant to own the mouse while open.
	dim.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(dim)

	_panel = PanelContainer.new()
	# Same anchor-preset-then-explicit-position/size ordering already
	# proven working by world/boot.gd's `_setup_quest_hud` (PRESET_CENTER_TOP
	# there, PRESET_CENTER here) — real-engine-verified via
	# tools/pause_menu_probe.gd's centered-rect check, not assumed.
	_panel.set_anchors_preset(Control.PRESET_CENTER)
	_panel.position = Vector2(-140.0, -110.0)
	_panel.size = Vector2(280.0, 220.0)
	dim.add_child(_panel)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 12)
	_panel.add_child(vbox)

	var title := Label.new()
	title.text = "Paused"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	vbox.add_child(title)

	var volume_label := Label.new()
	volume_label.text = "Master Volume"
	vbox.add_child(volume_label)

	_volume_slider = HSlider.new()
	_volume_slider.min_value = 0.0
	_volume_slider.max_value = 1.0
	_volume_slider.step = 0.05
	_volume_slider.value = sfx_player.master_volume if sfx_player != null else 0.8
	_volume_slider.value_changed.connect(_on_volume_changed)
	vbox.add_child(_volume_slider)

	var resume_button := Button.new()
	resume_button.text = "Resume"
	resume_button.pressed.connect(func(): resume_requested.emit())
	vbox.add_child(resume_button)

	if not OS.has_feature("web"):
		var quit_button := Button.new()
		quit_button.text = "Quit to Desktop"
		quit_button.pressed.connect(func(): get_tree().quit())
		vbox.add_child(quit_button)


func _on_volume_changed(value: float) -> void:
	if sfx_player != null:
		sfx_player.master_volume = value


## Called by `world/boot.gd` in response to `SessionManager.
## pause_overlay_opened` — SessionManager stays the single source of truth
## for WHETHER the game is paused; this method only reflects that state
## into the visible UI (and re-syncs the slider, in case `master_volume`
## was changed by anything else while the menu was closed).
func open() -> void:
	visible = true
	if _volume_slider != null:
		_volume_slider.value = sfx_player.master_volume if sfx_player != null else _volume_slider.value


func close() -> void:
	visible = false
