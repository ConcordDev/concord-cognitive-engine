extends SceneTree
## hit_flash_probe.gd — real-engine verification for Combat's remote-target
## hit feedback (2026-08-08): does a REAL `AvatarRig.flash_hit()` actually
## drive a real `Tween` that mutates `.scale` and settles back to
## `Vector3.ONE`; does `AvatarManager.flash_hit(target_id)` correctly route
## to the right rig when tracked, and honestly no-op (return false, mutate
## nothing) for an untracked id — e.g. the local player's own id, which
## AvatarManager never tracks (remote avatars only).
##
## Run:
##   .godot-runtime/bin/godot --headless --path world-lens-godot \
##     --script res://tools/hit_flash_probe.gd

const AvatarRig := preload("res://avatar/avatar_rig.gd")
const AvatarManager := preload("res://avatar/avatar_manager.gd")

var _rig: AvatarRig
var _manager: AvatarManager
var _frame := 0
var _result := {}


func _initialize() -> void:
	# Real AvatarRig with a made-up id/base_url — no HTTP resolve needed for
	# this probe: flash_hit() only touches `scale`, never body/weapon GLB
	# state, so the primitive-placeholder path (no network at all) is
	# sufficient and keeps this probe self-contained.
	_rig = AvatarRig.new()
	_rig.kind = "player"
	_rig.rig_id = "hit-flash-probe-target"
	_rig.base_url = "http://127.0.0.1:1"  # deliberately unreachable; irrelevant to this probe
	get_root().add_child(_rig)

	_manager = AvatarManager.new()
	get_root().add_child(_manager)


func _process(_delta: float) -> bool:
	_frame += 1

	if _frame == 3:
		# 1. Direct AvatarRig.flash_hit() — real Tween genuinely animates a
		# real `scale` property away from Vector3.ONE.
		_result["scale_before"] = [_rig.scale.x, _rig.scale.y, _rig.scale.z]
		_rig.flash_hit()
		return false

	if _frame == 5:
		# A couple frames into the tween's first leg (punch-up phase) —
		# scale should have genuinely moved off 1.0 by now.
		_result["scale_mid_flash"] = [_rig.scale.x, _rig.scale.y, _rig.scale.z]
		_result["scale_changed_from_rest"] = not _rig.scale.is_equal_approx(Vector3.ONE)
		return false

	if _frame == 60:
		# The tween (duration 0.16s total) has had many real frames to
		# finish and settle back to rest.
		_result["scale_settled"] = [_rig.scale.x, _rig.scale.y, _rig.scale.z]
		_result["scale_returned_to_rest"] = _rig.scale.is_equal_approx(Vector3.ONE)

		# 2. AvatarManager.flash_hit routes correctly through _rigs.
		_manager._rigs["remote-1"] = _rig
		_rig.scale = Vector3.ONE
		var routed := _manager.flash_hit("remote-1")
		_result["manager_routes_to_tracked_rig"] = routed
		return false

	if _frame == 63:
		_result["scale_after_manager_route"] = [_rig.scale.x, _rig.scale.y, _rig.scale.z]
		_result["manager_route_actually_flashed"] = not _rig.scale.is_equal_approx(Vector3.ONE)

		# 3. Honest no-op for an untracked id (e.g. a local player id that
		# was never added to _rigs — AvatarManager only tracks REMOTE
		# avatars, confirmed by this exact absence).
		var pool_before := [_rig.scale.x, _rig.scale.y, _rig.scale.z]
		var routed_unknown := _manager.flash_hit("some-id-never-tracked")
		_result["manager_honest_false_for_untracked_id"] = not routed_unknown
		_result["untracked_call_did_not_touch_tracked_rig"] = (
			[_rig.scale.x, _rig.scale.y, _rig.scale.z] == pool_before)

		_result["ok"] = true
		print("[hit_flash_probe] RESULT ", JSON.stringify(_result))
		return true

	return false
