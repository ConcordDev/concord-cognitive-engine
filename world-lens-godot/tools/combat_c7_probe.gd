extends SceneTree
## combat_c7_probe.gd — real-engine verification for hold-variants + combo
## chains + lock-on (2026-08-08). Constructs a REAL `CharacterController` +
## REAL `AvatarManager` + REAL `AvatarRig`s + REAL `SfxPlayer` in a real
## `SceneTree` (a minimal fake gateway records `send_event` calls without
## touching the network, same posture as tools/sfx_gameplay_wiring_probe.gd)
## and checks GENUINE engine state, not mocked returns.
##
## Run:
##   .godot-runtime/bin/godot --headless --path world-lens-godot \
##     --script res://tools/combat_c7_probe.gd

const CharacterController := preload("res://player/character_controller.gd")
const AvatarManager := preload("res://avatar/avatar_manager.gd")
const AvatarRig := preload("res://avatar/avatar_rig.gd")
const SfxPlayer := preload("res://audio/sfx_player.gd")

class FakeGateway extends Node:
	var sent: Array = []
	func send_event(evt: String, data: Dictionary) -> void:
		sent.append({"evt": evt, "data": data})


var _gateway: FakeGateway
var _sfx: SfxPlayer
var _avatar_manager: AvatarManager
var _controller: CharacterController
var _rig_near: AvatarRig
var _rig_far: AvatarRig
var _frame := 0
var _result := {}


func _find_sent_all(evt: String) -> Array:
	var out := []
	for s in _gateway.sent:
		if s["evt"] == evt:
			out.append(s)
	return out


func _initialize() -> void:
	_gateway = FakeGateway.new()
	get_root().add_child(_gateway)

	_sfx = SfxPlayer.new()
	get_root().add_child(_sfx)

	_avatar_manager = AvatarManager.new()
	get_root().add_child(_avatar_manager)

	# A rig 5m away (inside LOCK_ON_RADIUS_M=25 and outside melee
	# ATTACK_RANGE_M=3, so auto-nearest picks nothing but lock-on candidates
	# still finds it) and a rig 15m away, both real AvatarRigs with a
	# primitive placeholder body (no HTTP resolve needed for this probe).
	_rig_near = AvatarRig.new()
	_rig_near.kind = "player"
	_rig_near.rig_id = "combat-c7-near"
	_rig_near.base_url = "http://127.0.0.1:1"
	get_root().add_child(_rig_near)
	_rig_near.global_position = Vector3(5.0, 0.0, 0.0)
	_avatar_manager._rigs["remote-near"] = _rig_near

	_rig_far = AvatarRig.new()
	_rig_far.kind = "player"
	_rig_far.rig_id = "combat-c7-far"
	_rig_far.base_url = "http://127.0.0.1:1"
	get_root().add_child(_rig_far)
	_rig_far.global_position = Vector3(15.0, 0.0, 0.0)
	_avatar_manager._rigs["remote-far"] = _rig_far

	_controller = CharacterController.new()
	_controller.gateway = _gateway
	_controller.sfx_player = _sfx
	_controller.avatar_manager = _avatar_manager
	get_root().add_child(_controller)
	_controller._current_target_id = "npc-probe-target"


func _process(_delta: float) -> bool:
	_frame += 1

	if _frame == 3:
		# `_controller` is a REAL node, so its own `_physics_process` (which
		# calls `_update_target()` every physics tick) has already been
		# running between `_initialize()` and this frame — with
		# `avatar_manager` wired and both rigs beyond ATTACK_RANGE_M=3.0, the
		# auto-nearest pick legitimately clears the fixture's manually-set
		# target. Re-stamp it right before each direct call below (same
		# "no real GDScript privacy" convention this probe already uses
		# elsewhere) so these unit-style calls test what they intend to,
		# same discipline tools/sfx_gameplay_wiring_probe.gd established.
		_controller._current_target_id = "npc-probe-target"

		# 1. Combo chain: two attacks close together share a chainId with
		# incrementing stepIndex.
		_controller._try_attack(1000)
		_controller._try_attack(1200)  # 200ms later, well inside the 1500ms window
		var attacks := _find_sent_all("combat:attack")
		_result["combo_two_attacks_sent"] = attacks.size() == 2
		if attacks.size() == 2:
			var c0 = attacks[0]["data"]
			var c1 = attacks[1]["data"]
			_result["combo_same_chain_id"] = c0.get("chainId") == c1.get("chainId") and String(c0.get("chainId", "")) != ""
			_result["combo_step_increments"] = c0.get("stepIndex") == 0 and c1.get("stepIndex") == 1
		return false

	if _frame == 4:
		_controller._current_target_id = "npc-probe-target"
		# A big time gap (3800ms later, past the 1500ms window) starts a
		# genuinely NEW chain.
		_gateway.sent.clear()
		_controller._try_attack(5000)
		var attacks := _find_sent_all("combat:attack")
		_result["combo_new_chain_after_gap"] = (
			attacks.size() == 1 and attacks[0]["data"].get("stepIndex") == 0
			and String(attacks[0]["data"].get("chainId", "")) == "chain:5000")
		return false

	if _frame == 5:
		_controller._current_target_id = "npc-probe-target"
		# 2. Heavy attack (E-hold) — real, distinguishing baseDamage (unlike
		# tap, which omits it) so "hold for heavy" has a genuine effect.
		_gateway.sent.clear()
		for p in _sfx._pool:
			p.stop()
		_controller._try_attack_heavy(6000)
		var heavies := _find_sent_all("combat:attack")
		_result["heavy_sent"] = (
			heavies.size() == 1 and heavies[0]["data"].get("heavy") == true
			and heavies[0]["data"].get("baseDamage") == 18
			and heavies[0]["data"].get("style") == "attack-heavy")
		var any_playing := false
		for p in _sfx._pool:
			if p.playing:
				any_playing = true
		_result["heavy_sfx_played"] = any_playing
		return false

	if _frame == 6:
		_controller._current_target_id = "npc-probe-target"
		# 3. Grab (F-hold) — targeted, actionOverride 'grapple'.
		_gateway.sent.clear()
		_controller._try_grab(7000)
		var grabs := _find_sent_all("combat:attack")
		_result["grab_sent"] = (
			grabs.size() == 1 and grabs[0]["data"].get("actionOverride") == "grapple"
			and grabs[0]["data"].get("baseDamage") == 12
			and grabs[0]["data"].get("range") == 2
			and grabs[0]["data"].get("style") == "grab")
		return false

	if _frame == 7:
		# 4. Heavy/grab are honest no-ops with no target — never a fabricated
		# request.
		_gateway.sent.clear()
		_controller._current_target_id = ""
		_controller._try_attack_heavy(8000)
		_controller._try_grab(8000)
		_result["heavy_grab_honest_noop_no_target"] = _gateway.sent.is_empty()
		_controller._current_target_id = "npc-probe-target"
		return false

	if _frame == 8:
		# 5. Lock-on: Tab-cycle picks the nearest in-radius candidate
		# (5m rig), and _update_target() honors the lock OVER the
		# auto-nearest pick (which would find NOTHING — both rigs are
		# beyond ATTACK_RANGE_M=3.0).
		var candidates: Array = _avatar_manager.candidates_in_range(
			_controller.global_position, CharacterController.LOCK_ON_RADIUS_M)
		_result["lock_candidates_found"] = candidates.size() == 2
		_controller._lock.cycle(candidates)
		_result["lock_soft_locked_nearest"] = (
			_controller._lock.locked_id == "remote-near" and _controller._lock.lock_mode == "soft")
		_controller._update_target()
		_result["update_target_honors_lock"] = _controller.get_current_target_id() == "remote-near"
		_result["has_active_lock_true"] = _controller.has_active_lock()
		_result["get_lock_mode_soft"] = _controller.get_lock_mode() == "soft"
		return false

	if _frame == 9:
		# 6. Toggling hard-lock while a lock is active CLEARS it (TS
		# reference's own toggle semantics) — real LockOnState instance
		# method call, same direct-access convention this probe already
		# uses for `_lock.cycle` above.
		var candidates: Array = _avatar_manager.candidates_in_range(
			_controller.global_position, CharacterController.LOCK_ON_RADIUS_M)
		_controller._lock.toggle_hard(candidates)
		_result["toggle_clears_existing_lock"] = not _controller.has_active_lock()
		return false

	if _frame == 10:
		# 7. clear_lock() (the Escape-precedence path boot.gd calls) really
		# clears an active lock.
		var candidates: Array = _avatar_manager.candidates_in_range(
			_controller.global_position, CharacterController.LOCK_ON_RADIUS_M)
		_controller._lock.cycle(candidates)
		_result["lock_active_before_clear"] = _controller.has_active_lock()
		_controller.clear_lock()
		_result["lock_cleared_by_clear_lock"] = not _controller.has_active_lock()
		return false

	if _frame == 11:
		# 8. Soft-lock auto-release: move the locked rig beyond
		# LOCK_ON_RADIUS_M and confirm the NEXT _update_target() call
		# genuinely releases it (real distance-based release, not a
		# fabricated timeout).
		var candidates: Array = _avatar_manager.candidates_in_range(
			_controller.global_position, CharacterController.LOCK_ON_RADIUS_M)
		_controller._lock.cycle(candidates)
		_result["lock_active_before_moving_away"] = _controller.has_active_lock()
		_rig_near.global_position = Vector3(500.0, 0.0, 0.0)  # far beyond 25m
		_controller._update_target()
		_result["soft_lock_auto_released_when_out_of_range"] = not _controller.has_active_lock()

		_result["ok"] = true
		print("[combat_c7_probe] RESULT ", JSON.stringify(_result))
		return true

	return false
