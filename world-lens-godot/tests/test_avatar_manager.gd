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
	_test_candidates_in_radius_sorted_nearest_first(t)
	_test_candidates_in_radius_excludes_out_of_range(t)
	_test_candidates_in_radius_inclusive_at_boundary(t)
	_test_candidates_in_radius_skips_blank_id(t)
	_test_candidates_in_radius_honest_empty(t)
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


## Combat, lock-on (2026-08-08) — `candidates_in_radius` (Tab-cycle's data
## source) is the "ALL in-range, sorted" sibling of `nearest_target_id`
## (which is just its index-0). Same range/blank-id/empty-list contract,
## verified independently since the return shape differs (a sorted list,
## not a single id).
static func _test_candidates_in_radius_sorted_nearest_first(t: TestUtils) -> void:
	var candidates := [
		{"id": "far", "position": Vector3(0, 0, 5)},
		{"id": "near", "position": Vector3(0, 0, 1)},
		{"id": "mid", "position": Vector3(0, 0, 3)},
	]
	var out := AvatarManager.candidates_in_radius(candidates, Vector3.ZERO, 10.0)
	t.check_eq(out.size(), 3, "all three in-range candidates are returned")
	t.check_eq(String(out[0]["id"]), "near", "sorted nearest-first: index 0 is the closest")
	t.check_eq(String(out[1]["id"]), "mid", "sorted nearest-first: index 1 is the middle")
	t.check_eq(String(out[2]["id"]), "far", "sorted nearest-first: index 2 is the farthest")


static func _test_candidates_in_radius_excludes_out_of_range(t: TestUtils) -> void:
	var candidates := [
		{"id": "in", "position": Vector3(0, 0, 2)},
		{"id": "out", "position": Vector3(0, 0, 50)},
	]
	var out := AvatarManager.candidates_in_radius(candidates, Vector3.ZERO, 10.0)
	t.check_eq(out.size(), 1, "a beyond-radius candidate is excluded entirely, not just sorted last")
	t.check_eq(String(out[0]["id"]), "in", "the in-range candidate is the only one returned")


static func _test_candidates_in_radius_inclusive_at_boundary(t: TestUtils) -> void:
	var candidates := [{"id": "edge", "position": Vector3(0, 0, 3)}]
	var out := AvatarManager.candidates_in_radius(candidates, Vector3.ZERO, 3.0)
	t.check_eq(out.size(), 1, "a candidate exactly AT the radius is included, not excluded")


static func _test_candidates_in_radius_skips_blank_id(t: TestUtils) -> void:
	var candidates := [
		{"id": "", "position": Vector3(0, 0, 0.5)},
		{"id": "real", "position": Vector3(0, 0, 2.0)},
	]
	var out := AvatarManager.candidates_in_radius(candidates, Vector3.ZERO, 10.0)
	t.check_eq(out.size(), 1, "a blank-id candidate is skipped even though it's real position data")
	t.check_eq(String(out[0]["id"]), "real", "the remaining candidate is the one with a real id")


static func _test_candidates_in_radius_honest_empty(t: TestUtils) -> void:
	var out := AvatarManager.candidates_in_radius([], Vector3.ZERO, 100.0)
	t.check_eq(out.size(), 0, "an empty candidate list returns a real, honest empty array")
