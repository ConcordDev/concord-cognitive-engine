class_name TestQuestActions
extends RefCounted
## Pure-logic test for world/quest_actions.gd's `resolve_action` — the
## single rule deciding what the K-key does: claim a completed quest,
## accept the first offerable one, or honestly do nothing. No HTTP/scene
## tree involved.

const QuestActions := preload("res://world/quest_actions.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_claims_an_all_done_active_quest(t)
	_test_claim_takes_priority_even_when_not_first_in_list(t)
	_test_accepts_first_available_when_no_active_quests(t)
	_test_no_accept_while_a_quest_is_still_active(t)
	_test_nothing_to_do_returns_empty(t)
	_test_skips_malformed_available_entries(t)
	_test_skips_non_dictionary_active_entries(t)
	return t


static func _all_done_quest(id: String, title: String) -> Dictionary:
	return {
		"id": id, "title": title,
		"progress": [{"id": "o1", "obj_completed_at": 12345}],
	}


static func _incomplete_quest(id: String, title: String) -> Dictionary:
	return {
		"id": id, "title": title,
		"progress": [{"id": "o1", "obj_completed_at": null}],
	}


static func _test_claims_an_all_done_active_quest(t: TestUtils) -> void:
	var active := [_all_done_quest("q1", "Cook a Meal")]
	var action := QuestActions.resolve_action(active, [])
	t.check_eq(action.get("kind", ""), "claim", "an all-done active quest resolves to a claim action")
	t.check_eq(action.get("questId", ""), "q1", "the claim targets the real all-done quest's id")
	t.check_eq(action.get("label", ""), "Claim Reward: Cook a Meal", "the label names the real quest title")


static func _test_claim_takes_priority_even_when_not_first_in_list(t: TestUtils) -> void:
	var active := [_incomplete_quest("q1", "Still Going"), _all_done_quest("q2", "Finally Done")]
	var action := QuestActions.resolve_action(active, [])
	t.check_eq(action.get("kind", ""), "claim", "a done quest anywhere in the list is found, not just the first")
	t.check_eq(action.get("questId", ""), "q2", "the SECOND quest (the done one) is targeted, not the first")


static func _test_accepts_first_available_when_no_active_quests(t: TestUtils) -> void:
	var available := [
		{"id": "avail1", "title": "Gather Wildroot"},
		{"id": "avail2", "title": "Talk to the Gatekeeper"},
	]
	var action := QuestActions.resolve_action([], available)
	t.check_eq(action.get("kind", ""), "accept", "no active quests + a real offerable one resolves to accept")
	t.check_eq(action.get("questId", ""), "avail1", "the FIRST available quest is targeted")
	t.check_eq(action.get("label", ""), "Accept: Gather Wildroot", "the label names the real quest title")


static func _test_no_accept_while_a_quest_is_still_active(t: TestUtils) -> void:
	var active := [_incomplete_quest("q1", "Mid Quest")]
	var available := [{"id": "avail1", "title": "Another One"}]
	var action := QuestActions.resolve_action(active, available)
	t.check(action.is_empty(),
		"a real offerable quest is never auto-accepted while one is still mid-progress")


static func _test_nothing_to_do_returns_empty(t: TestUtils) -> void:
	var action := QuestActions.resolve_action([], [])
	t.check(action.is_empty(), "no active and no available quests -> genuinely nothing to do, not a fabricated action")


static func _test_skips_malformed_available_entries(t: TestUtils) -> void:
	var available := [
		"not a dict", {"id": "", "title": "Blank id"}, {"id": "real1", "title": "Real One"},
	]
	var action := QuestActions.resolve_action([], available)
	t.check_eq(action.get("kind", ""), "accept", "malformed/blank-id entries are skipped, not offered")
	t.check_eq(action.get("questId", ""), "real1", "the first REAL entry is targeted, never a fabricated one")


static func _test_skips_non_dictionary_active_entries(t: TestUtils) -> void:
	var active: Array = ["not a dict", 42, _all_done_quest("q1", "Real Quest")]
	var action := QuestActions.resolve_action(active, [])
	t.check_eq(action.get("kind", ""), "claim", "non-Dictionary active entries are skipped without crashing")
	t.check_eq(action.get("questId", ""), "q1", "the one real all-done entry is still found")
