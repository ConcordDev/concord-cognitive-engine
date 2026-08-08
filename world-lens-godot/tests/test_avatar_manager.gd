class_name TestAvatarManager
extends RefCounted
## Pure-logic test for avatar/avatar_manager.gd's Combat Phase C1 addition —
## `nearest_target_id`, the selection RULE the local player's E-key attack
## input (player/character_controller.gd) queries every physics frame. The
## instance-level `nearest_target()` wrapper (reads live `AvatarRig` nodes'
## `global_position` out of `_rigs`) is engine-gated and NOT covered here —
## see tools/ for the real-engine probe that exercises it against actual
## spawned nodes; this file pins the underlying selection math in isolation.

const AvatarManager := preload("res://avatar/avatar_manager.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_picks_nearest_in_range(t)
	_test_ignores_out_of_range(t)
	_test_honest_empty_on_no_candidates(t)
	_test_range_is_inclusive(t)
	_test_skips_blank_id(t)
	_test_stale_timeout_player_vs_npc(t)
	return t


static func _test_picks_nearest_in_range(t: TestUtils) -> void:
	var candidates := [
		{"id": "far", "position": Vector3(0, 0, 5)},
		{"id": "near", "position": Vector3(0, 0, 1)},
		{"id": "mid", "position": Vector3(0, 0, 3)},
	]
	var found := AvatarManager.nearest_target_id(candidates, Vector3.ZERO, 10.0)
	t.check_eq(found, "near", "the closest in-range candidate wins, regardless of array order")


static func _test_ignores_out_of_range(t: TestUtils) -> void:
	var candidates := [
		{"id": "too-far", "position": Vector3(0, 0, 50)},
	]
	var found := AvatarManager.nearest_target_id(candidates, Vector3.ZERO, 3.0)
	t.check_eq(found, "", "a candidate beyond max_range is never selected, even if it's the only one")


static func _test_honest_empty_on_no_candidates(t: TestUtils) -> void:
	var found := AvatarManager.nearest_target_id([], Vector3.ZERO, 100.0)
	t.check_eq(found, "", "an empty candidate list returns a real, honest empty string, not a fabricated id")


static func _test_range_is_inclusive(t: TestUtils) -> void:
	var candidates := [{"id": "edge", "position": Vector3(0, 0, 3)}]
	var found := AvatarManager.nearest_target_id(candidates, Vector3.ZERO, 3.0)
	t.check_eq(found, "edge", "a candidate exactly at max_range is in range, not excluded")


static func _test_skips_blank_id(t: TestUtils) -> void:
	var candidates := [
		{"id": "", "position": Vector3(0, 0, 0.5)},
		{"id": "real", "position": Vector3(0, 0, 2.0)},
	]
	var found := AvatarManager.nearest_target_id(candidates, Vector3.ZERO, 10.0)
	t.check_eq(found, "real",
		"a candidate with a blank id is skipped even when it would otherwise be nearest")


## Phase N — NPCs are fed by npc_poller.gd's 10s REST poll, not players'
## ~100ms broadcast cadence; a single shared stale-despawn timeout would
## flicker-despawn every NPC between poll cycles (see stale_timeout_for_kind's
## own doc comment in avatar_manager.gd for the full reasoning).
static func _test_stale_timeout_player_vs_npc(t: TestUtils) -> void:
	t.check_eq(AvatarManager.stale_timeout_for_kind("player"), AvatarManager.STALE_TIMEOUT_MS_PLAYER,
		"player kind uses the tight, broadcast-cadence-matched timeout")
	t.check_eq(AvatarManager.stale_timeout_for_kind("npc"), AvatarManager.STALE_TIMEOUT_MS_NPC,
		"npc kind uses a longer timeout sized for the 10s REST poll cadence, not the 100ms player broadcast cadence")
	t.check(AvatarManager.STALE_TIMEOUT_MS_NPC > AvatarManager.STALE_TIMEOUT_MS_PLAYER,
		"the NPC timeout must genuinely exceed the player timeout, or the flicker bug this exists to fix isn't actually fixed")
	t.check_eq(AvatarManager.stale_timeout_for_kind("unknown_kind"), AvatarManager.STALE_TIMEOUT_MS_PLAYER,
		"an unrecognized kind falls back to the tighter player timeout rather than silently going stale-tolerant")
