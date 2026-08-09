class_name TestQuestPoller
extends RefCounted
## Pure-logic test for world/quest_poller.gd's translation layer —
## `quests_response_to_quests`, for the real `GET /api/worlds/:worldId/
## quests/active` response shape (server/routes/worlds.js:387). The
## engine-gated HTTPRequest/Timer half is NOT covered here.

const QuestPoller := preload("res://world/quest_poller.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_basic_passthrough(t)
	_test_drops_entries_with_no_id(t)
	_test_drops_non_dictionary_entries(t)
	_test_missing_progress_defaults_to_empty_array(t)
	_test_malformed_progress_is_replaced_not_kept(t)
	_test_empty_array(t)
	return t


static func _test_basic_passthrough(t: TestUtils) -> void:
	var raw := [
		{
			"id": "q1", "title": "Meet the Gatekeeper", "status": "active",
			"progress": [{"id": "obj1", "type": "talk_to", "target": "gatekeeper_orin", "current_count": 0, "obj_completed_at": null}],
		},
	]
	var quests := QuestPoller.quests_response_to_quests(raw)
	t.check_eq(quests.size(), 1, "one well-shaped quest parses to one output entry")
	t.check_eq(quests[0]["id"], "q1", "id is passed through verbatim")
	t.check_eq(quests[0]["title"], "Meet the Gatekeeper", "title is passed through verbatim")
	t.check_eq(
		quests[0]["progress"], raw[0]["progress"],
		"progress array is passed through verbatim, real server-computed objective rows")


static func _test_drops_entries_with_no_id(t: TestUtils) -> void:
	var raw := [
		{"title": "No id", "progress": []},
		{"id": "", "title": "Blank id", "progress": []},
		{"id": "real_quest", "title": "Real", "progress": []},
	]
	var quests := QuestPoller.quests_response_to_quests(raw)
	t.check_eq(quests.size(), 1, "a missing or blank id is dropped, never fabricated")
	t.check_eq(quests[0]["id"], "real_quest", "the one well-formed entry survives")


static func _test_drops_non_dictionary_entries(t: TestUtils) -> void:
	var raw: Array = ["not_a_dict", 42, null, {"id": "q2", "progress": []}]
	var quests := QuestPoller.quests_response_to_quests(raw)
	t.check_eq(quests.size(), 1, "non-Dictionary array entries are dropped, not crashed on")
	t.check_eq(quests[0]["id"], "q2", "the one well-formed entry survives alongside malformed siblings")


static func _test_missing_progress_defaults_to_empty_array(t: TestUtils) -> void:
	var raw := [{"id": "q3", "title": "No progress field"}]
	var quests := QuestPoller.quests_response_to_quests(raw)
	t.check_eq(quests[0]["progress"], [], "a missing progress field defaults to an empty array, not fabricated rows")


static func _test_malformed_progress_is_replaced_not_kept(t: TestUtils) -> void:
	var raw := [{"id": "q4", "title": "Bad progress", "progress": "not-an-array"}]
	var quests := QuestPoller.quests_response_to_quests(raw)
	t.check_eq(quests[0]["progress"], [], "a non-array progress field is replaced with an honest empty array")


static func _test_empty_array(t: TestUtils) -> void:
	var quests := QuestPoller.quests_response_to_quests([])
	t.check(quests.is_empty(), "an empty quests array yields an honestly empty result")
