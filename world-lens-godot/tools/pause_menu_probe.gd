extends SceneTree
## pause_menu_probe.gd — real-engine verification for the pause menu (UI,
## 2026-08-08): does a REAL `PauseMenu`, mounted in a real `SceneTree`,
## actually build a real, correctly-centered `Control` tree; does its
## volume slider genuinely mutate a real injected `SfxPlayer.master_volume`
## (not just move a slider handle); does `open()`/`close()` toggle real
## `visible` state and re-sync the slider from the real current volume; and
## does the "Quit to Desktop" button exist on a native target (this probe
## itself IS a native run, so `OS.has_feature("web")` is false here — the
## web-hidden case is pure-logic-obvious from the source and not worth a
## second real-engine run to re-prove).
##
## Run:
##   .godot-runtime/bin/godot --headless --path world-lens-godot \
##     --script res://tools/pause_menu_probe.gd

const PauseMenu := preload("res://ui/pause_menu.gd")
const SfxPlayer := preload("res://audio/sfx_player.gd")

var _menu: PauseMenu
var _sfx: SfxPlayer
var _frame := 0


func _find_button(root: Node, text: String) -> Button:
	if root is Button and root.text == text:
		return root
	for c in root.get_children():
		var found := _find_button(c, text)
		if found != null:
			return found
	return null


func _find_slider(root: Node) -> HSlider:
	if root is HSlider:
		return root
	for c in root.get_children():
		var found := _find_slider(c)
		if found != null:
			return found
	return null


func _initialize() -> void:
	_sfx = SfxPlayer.new()
	# A value that's an exact multiple of the slider's own `step = 0.05`
	# (see ui/pause_menu.gd) — HSlider quantizes `.value` to its step grid,
	# so a non-aligned value like 0.42 would get silently rounded and make
	# the "did open() really sync from the live volume" check ambiguous.
	_sfx.master_volume = 0.40
	get_root().add_child(_sfx)

	_menu = PauseMenu.new()
	_menu.sfx_player = _sfx
	get_root().add_child(_menu)


func _process(_delta: float) -> bool:
	_frame += 1
	if _frame < 3:
		return false

	var result := {}

	# 1. Starts hidden — a pause menu must never be visible before Escape
	# has genuinely been pressed once.
	result["starts_hidden"] = not _menu.visible

	# 2. Real centered layout — the panel's global rect center should sit at
	# the real viewport's center, not an eyeballed/assumed value.
	var viewport_size := get_root().get_visible_rect().size
	var panel_rect: Rect2 = _menu._panel.get_global_rect()
	var panel_center := panel_rect.position + panel_rect.size / 2.0
	var viewport_center := viewport_size / 2.0
	result["panel_centered"] = (
		absf(panel_center.x - viewport_center.x) < 2.0
		and absf(panel_center.y - viewport_center.y) < 2.0)
	result["panel_size"] = [panel_rect.size.x, panel_rect.size.y]

	# 3. open() shows the menu and re-syncs the slider from the REAL current
	# sfx_player.master_volume (0.40, set above) — not a stale/default value.
	# Change master_volume AFTER _ready() already ran its own initial sync,
	# so this genuinely exercises open()'s re-sync, not just the one in
	# _ready().
	_sfx.master_volume = 0.65
	var slider := _find_slider(_menu)
	result["slider_found"] = slider != null
	_menu.open()
	result["visible_after_open"] = _menu.visible
	result["slider_synced_on_open"] = slider != null and is_equal_approx(slider.value, 0.65)

	# 4. Moving the slider genuinely mutates the real SfxPlayer, proving the
	# binding is live, not decorative — set .value (a real Range node emits
	# value_changed on a programmatic set, same as user drag) and check the
	# injected SfxPlayer's actual field changed.
	if slider != null:
		slider.value = 0.15
	result["volume_live_bound"] = is_equal_approx(_sfx.master_volume, 0.15)

	# 5. close() hides it again.
	_menu.close()
	result["visible_after_close"] = _menu.visible

	# 6. resume_requested actually fires when Resume is pressed (simulated
	# via a real Button.pressed.emit(), not a direct method call bypassing
	# the UI).
	# GDScript lambdas capture an outer local `bool` by VALUE at creation
	# time, so a plain `var resume_fired := false` mutated inside the lambda
	# would silently mutate only the lambda's own snapshot — an Array (a
	# reference type) sidesteps that and is the correct pattern for a
	# closure that needs to report back to the caller.
	var resume_fired := [false]
	_menu.resume_requested.connect(func(): resume_fired[0] = true)
	var resume_button := _find_button(_menu, "Resume")
	result["resume_button_found"] = resume_button != null
	if resume_button != null:
		resume_button.pressed.emit()
	result["resume_signal_fired"] = resume_fired[0]

	# 7. Quit to Desktop exists on this (native) run — the web-hidden branch
	# is the mirror-image `if not OS.has_feature("web")` guard, verified by
	# source read rather than a second (unreachable, in this sandbox) web
	# export run.
	result["quit_button_present_native"] = _find_button(_menu, "Quit to Desktop") != null
	result["is_web_build"] = OS.has_feature("web")

	result["ok"] = true
	print("[pause_menu_probe] RESULT ", JSON.stringify(result))
	return true
