class_name TestQuestBreadcrumb
extends RefCounted
## Pure-logic tests for world/quest_breadcrumb.gd — a port of
## concord-frontend/components/world/QuestTracker.tsx's `pickBreadcrumb`/
## `VERB_FOR`/breadcrumb-line logic.

const QuestBreadcrumb := preload("res://world/quest_breadcrumb.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_quest_all_done(t)
	_test_pick_breadcrumb_prefers_ready_quest(t)
	_test_pick_breadcrumb_first_incomplete(t)
	_test_pick_breadcrumb_empty_cases(t)
	_test_breadcrumb_text(t)
	return t


static func _talk_obj(completed: bool = false) -> Dictionary:
	return {
		"id": "obj1", "type": "talk_to", "target": "gatekeeper_orin",
		"required_count": 1, "description": "Speak with the gatekeeper",
		"current_count": 0, "obj_completed_at": (1234 if completed else null),
	}


static func _test_quest_all_done(t: TestUtils) -> void:
	t.check(
		QuestBreadcrumb.quest_all_done({"progress": [_talk_obj(true)]}),
		"a quest whose every objective is completed is all-done")
	t.check(
		not QuestBreadcrumb.quest_all_done({"progress": [_talk_obj(false)]}),
		"a quest with an incomplete objective is not all-done")
	t.check(
		not QuestBreadcrumb.quest_all_done({"progress": []}),
		"an empty progress array is honestly NOT all-done (nothing to claim)")
	t.check(
		not QuestBreadcrumb.quest_all_done({}),
		"a missing progress array is honestly NOT all-done")


static func _test_pick_breadcrumb_prefers_ready_quest(t: TestUtils) -> void:
	var ready_quest := {"id": "q1", "title": "Ready Quest", "progress": [_talk_obj(true)]}
	var pending_quest := {"id": "q2", "title": "Pending Quest", "progress": [_talk_obj(false)]}
	var picked := QuestBreadcrumb.pick_breadcrumb([pending_quest, ready_quest])
	t.check_eq(
		picked["quest"]["id"], "q1",
		"an all-done quest is preferred for the breadcrumb, even listed second — mirrors pickBreadcrumb's .find()")
	t.check_eq(
		picked["obj"], _talk_obj(true),
		"the ready-quest breadcrumb points at the LAST progress entry, mirroring the TS source")


static func _test_pick_breadcrumb_first_incomplete(t: TestUtils) -> void:
	var mixed_quest := {"id": "q2", "title": "Mixed", "progress": [_talk_obj(false)]}
	var picked := QuestBreadcrumb.pick_breadcrumb([mixed_quest])
	t.check_eq(picked["quest"]["id"], "q2", "falls through to the first quest with an incomplete objective")
	t.check_eq(picked["obj"]["id"], "obj1", "points at that quest's incomplete objective")


static func _test_pick_breadcrumb_empty_cases(t: TestUtils) -> void:
	t.check(QuestBreadcrumb.pick_breadcrumb([]).is_empty(), "no quests -> an honest empty result")
	t.check(
		QuestBreadcrumb.pick_breadcrumb([{"id": "q1", "title": "No progress", "progress": []}]).is_empty(),
		"a quest with an empty progress array contributes nothing to pick from")
	t.check(
		QuestBreadcrumb.pick_breadcrumb(["not-a-dict"]).is_empty(),
		"a malformed quest entry is skipped, never crashes")


static func _test_breadcrumb_text(t: TestUtils) -> void:
	t.check_eq(
		QuestBreadcrumb.breadcrumb_text({"title": "Meet the Gatekeeper", "progress": [_talk_obj(true)]}, _talk_obj(true)),
		"Meet the Gatekeeper — Reward ready",
		"an all-done quest's breadcrumb reads '$title — Reward ready'")

	t.check_eq(
		QuestBreadcrumb.breadcrumb_text({"title": "Meet the Gatekeeper", "progress": [_talk_obj(false)]}, _talk_obj(false)),
		"Speak with the gatekeeper",
		"an objective's own description wins over the generated verb text")

	var no_desc := {"id": "obj2", "type": "gather", "target": "Wildroot", "required_count": 1, "current_count": 0, "obj_completed_at": null}
	t.check_eq(
		QuestBreadcrumb.breadcrumb_text({"title": "T", "progress": [no_desc]}, no_desc),
		"Gather: Wildroot",
		"no description falls back to '$Verb: $target' via VERB_FOR")

	var unknown_type := {"id": "obj3", "type": "some_future_type", "target": "X", "required_count": 1, "current_count": 0, "obj_completed_at": null}
	t.check_eq(
		QuestBreadcrumb.breadcrumb_text({"title": "T", "progress": [unknown_type]}, unknown_type),
		"Do: X",
		"an unrecognized objective type falls back to VERB_FOR's own 'Do' default")

	var multi := {"id": "obj4", "type": "kill", "target": "Ember Sprite", "required_count": 3, "current_count": 1, "obj_completed_at": null}
	t.check_eq(
		QuestBreadcrumb.breadcrumb_text({"title": "T", "progress": [multi]}, multi),
		"Defeat: Ember Sprite (1/3)",
		"a required_count > 1 appends a '(current/required)' progress suffix")

	t.check_eq(
		QuestBreadcrumb.breadcrumb_text({}, {}), "",
		"an empty quest or objective yields an honest empty string, never a malformed line")
