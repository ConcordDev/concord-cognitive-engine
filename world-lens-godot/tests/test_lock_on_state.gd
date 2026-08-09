class_name TestLockOnState
extends RefCounted
## Pure-logic tests for player/lock_on_state.gd — Combat's lock-on Tab-
## cycle / T-hard-lock / release rule state machine. No engine/scene-tree
## dependency (LockOnState extends RefCounted with no Node references),
## mirroring the split test_session_manager.gd already established for
## SessionManager's instance-level pause-overlay gating.

const LockOnState := preload("res://player/lock_on_state.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_cycle_picks_first_candidate(t)
	_test_cycle_wraps_around(t)
	_test_cycle_honest_clear_on_empty(t)
	_test_toggle_hard_locks_nearest(t)
	_test_toggle_hard_clears_existing_lock(t)
	_test_toggle_hard_noop_on_empty_candidates(t)
	_test_clear_resets_everything(t)
	_test_release_soft_lock_out_of_range(t)
	_test_release_soft_lock_stays_in_range(t)
	_test_release_hard_lock_survives_out_of_cone_equivalent(t)
	_test_release_hard_lock_beyond_double_radius(t)
	_test_release_target_genuinely_gone(t)
	_test_release_noop_when_nothing_locked(t)
	return t


static func _test_cycle_picks_first_candidate(t: TestUtils) -> void:
	var s := LockOnState.new()
	s.cycle([{"id": "a"}, {"id": "b"}])
	t.check_eq(s.locked_id, "a", "the first Tab press locks the first (nearest) candidate, index 0")
	t.check_eq(s.lock_mode, "soft", "Tab always produces a soft lock")


static func _test_cycle_wraps_around(t: TestUtils) -> void:
	var s := LockOnState.new()
	var candidates := [{"id": "a"}, {"id": "b"}, {"id": "c"}]
	s.cycle(candidates)  # -> a (index 0)
	s.cycle(candidates)  # -> b (index 1)
	s.cycle(candidates)  # -> c (index 2)
	t.check_eq(s.locked_id, "c", "sanity: three presses over three candidates lands on the last one")
	s.cycle(candidates)  # -> wraps back to a (index 0)
	t.check_eq(s.locked_id, "a", "a fourth press wraps the cycle index back to the first candidate")


static func _test_cycle_honest_clear_on_empty(t: TestUtils) -> void:
	var s := LockOnState.new()
	s.cycle([{"id": "a"}])
	t.check_eq(s.locked_id, "a", "sanity: a lock is active before the empty-list press")
	s.cycle([])
	t.check_eq(s.locked_id, "", "Tab with zero candidates clears any active lock, mirroring the TS reference's own clearLockOnTarget() call")
	t.check_eq(s.lock_mode, "", "lock_mode is cleared alongside locked_id")


static func _test_toggle_hard_locks_nearest(t: TestUtils) -> void:
	var s := LockOnState.new()
	s.toggle_hard([{"id": "nearest"}, {"id": "farther"}])
	t.check_eq(s.locked_id, "nearest", "hard lock always takes index 0 of the already-sorted candidate list")
	t.check_eq(s.lock_mode, "hard", "toggle_hard produces a hard lock")


static func _test_toggle_hard_clears_existing_lock(t: TestUtils) -> void:
	var s := LockOnState.new()
	s.cycle([{"id": "a"}])
	t.check_eq(s.lock_mode, "soft", "sanity: a soft lock is active")
	s.toggle_hard([{"id": "a"}])
	t.check_eq(s.locked_id, "", "T with ANY active lock (soft included) toggles it OFF, mirroring the TS reference's toggle semantics")


static func _test_toggle_hard_noop_on_empty_candidates(t: TestUtils) -> void:
	var s := LockOnState.new()
	s.toggle_hard([])
	t.check_eq(s.locked_id, "", "T with no candidates and no existing lock is an honest no-op, never a fabricated lock")


static func _test_clear_resets_everything(t: TestUtils) -> void:
	var s := LockOnState.new()
	s.toggle_hard([{"id": "a"}])
	s.clear()
	t.check_eq(s.locked_id, "", "clear() resets locked_id")
	t.check_eq(s.lock_mode, "", "clear() resets lock_mode")
	# A cycle right after clear() should start from the FIRST candidate
	# again, proving _cycle_index was genuinely reset too, not just the
	# externally-visible fields.
	s.cycle([{"id": "x"}, {"id": "y"}])
	t.check_eq(s.locked_id, "x", "cycle index is genuinely reset by clear(), not just locked_id/lock_mode")


static func _test_release_soft_lock_out_of_range(t: TestUtils) -> void:
	var s := LockOnState.new()
	s.cycle([{"id": "a"}])
	s.update_release(false, 30.0, 25.0)
	t.check_eq(s.locked_id, "", "a soft lock releases the instant its target leaves the radius-filtered candidate set")


static func _test_release_soft_lock_stays_in_range(t: TestUtils) -> void:
	var s := LockOnState.new()
	s.cycle([{"id": "a"}])
	s.update_release(true, 10.0, 25.0)
	t.check_eq(s.locked_id, "a", "a soft lock holds while its target is still in the radius-filtered set")


static func _test_release_hard_lock_survives_out_of_cone_equivalent(t: TestUtils) -> void:
	var s := LockOnState.new()
	s.toggle_hard([{"id": "a"}])
	# still_in_range=false (analogous to "left the cone"/radius filter) but
	# real distance is well inside the hard-lock's wider tolerance — a hard
	# lock must hold through this, unlike a soft lock (see the test above).
	s.update_release(false, 30.0, 25.0)
	t.check_eq(s.locked_id, "a", "a hard lock holds even when the target left the radius-filtered set, as long as it's within 2x radius")


static func _test_release_hard_lock_beyond_double_radius(t: TestUtils) -> void:
	var s := LockOnState.new()
	s.toggle_hard([{"id": "a"}])
	s.update_release(false, 51.0, 25.0)
	t.check_eq(s.locked_id, "", "a hard lock releases once the target is genuinely beyond radius * HARD_LOCK_RELEASE_MULTIPLIER (2x)")


static func _test_release_target_genuinely_gone(t: TestUtils) -> void:
	var s := LockOnState.new()
	s.toggle_hard([{"id": "a"}])
	s.update_release(false, -1.0, 25.0)
	t.check_eq(s.locked_id, "", "a real -1.0 'unresolvable' distance (e.g. despawned) clears even a hard lock immediately")


static func _test_release_noop_when_nothing_locked(t: TestUtils) -> void:
	var s := LockOnState.new()
	s.update_release(false, -1.0, 25.0)
	t.check_eq(s.locked_id, "", "update_release with nothing locked stays a real no-op, not an error")
	t.check_eq(s.lock_mode, "", "lock_mode stays empty too")
