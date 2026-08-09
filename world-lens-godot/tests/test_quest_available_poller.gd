class_name TestQuestAvailablePoller
extends RefCounted
## Pure-logic test for world/quest_available_poller.gd's translation layer —
## `quests_response_to_quests`, for the real `GET /api/worlds/:worldId/
## quests?status=available` response shape (server/routes/worlds.js,
## `getWorldQuests`/`world_quests` schema). The engine-gated
## HTTPRequest/Timer half is NOT covered here.

const QuestAvailablePoller := preload("res://world/quest_available_poller.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_basic_passthrough(t)
	_test_drops_entries_with_no_id(t)
	_test_drops_non_dictionary_entries(t)
	_test_empty_array(t)
	return t


static func _test_basic_passthrough(t: TestUtils) -> void:
	var raw := [
		{
			"id": "q1", "world_id": "concordia-hub", "title": "Gather Wildroot",
			"status": "available", "objectives": [{"type": "gather", "target": "wildroot"}],
			"reward": {"xp": 50},
		},
	]
	var quests := QuestAvailablePoller.quests_response_to_quests(raw)
	t.check_eq(quests.size(), 1, "one well-shaped available quest parses to one output entry")
	t.check_eq(quests[0]["id"], "q1", "id is passed through verbatim")
	t.check_eq(quests[0]["title"], "Gather Wildroot", "title is passed through verbatim")
	t.check_eq(quests[0]["objectives"], raw[0]["objectives"], "objectives blob is passed through verbatim")


static func _test_drops_entries_with_no_id(t: TestUtils) -> void:
	var raw := [
		{"title": "No id here", "status": "available"},
		{"id": "", "title": "Blank id", "status": "available"},
		{"id": "q2", "title": "Real one", "status": "available"},
	]
	var quests := QuestAvailablePoller.quests_response_to_quests(raw)
	t.check_eq(quests.size(), 1, "only the entry with a real non-blank id survives")
	t.check_eq(quests[0]["id"], "q2", "the surviving entry is the real one, not a fabricated substitute")


static func _test_drops_non_dictionary_entries(t: TestUtils) -> void:
	var raw: Array = ["not a dict", 42, null, {"id": "q3", "title": "Real"}]
	var quests := QuestAvailablePoller.quests_response_to_quests(raw)
	t.check_eq(quests.size(), 1, "non-Dictionary entries are dropped, never coerced into a fake quest")
	t.check_eq(quests[0]["id"], "q3", "the one real Dictionary entry survives")


static func _test_empty_array(t: TestUtils) -> void:
	var quests := QuestAvailablePoller.quests_response_to_quests([])
	t.check_eq(quests.size(), 0, "an empty response yields an empty result, never fabricated quests")
