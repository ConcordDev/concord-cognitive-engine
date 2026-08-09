extends SceneTree
## quest_actions_probe.gd — real-engine verification for the Quest
## interaction slice: does a REAL QuestActions, pointed at an ALREADY-RUNNING
## real backend, genuinely resolve an action from two REAL polled feeds
## (quests/active + quests?status=available) and genuinely POST a real
## accept/claim-reward request that the server accepts? Exercises the real
## HTTPRequest POST + auth-header path + JSON parse — not a mock of any of
## it (mirrors quest_poller_probe.gd's "prove the wiring" framing).
##
## Requires an ALREADY-RUNNING server.js with a fresh migrated DB and a real
## registered user (token supplied) — same "requires already-running,
## doesn't spawn/migrate/seed" division of labor every probe in this
## directory keeps. Does NOT require the user to have pre-accepted
## anything: a world with zero active AND zero available quests gives an
## honest "nothing to do" result, reported plainly, not as an error.
##
## Run:
##   CONCORD_BACKEND_URL=http://127.0.0.1:5050 \
##   CONCORD_QUEST_ACTIONS_PROBE_WORLD=concordia-hub \
##   CONCORD_QUEST_ACTIONS_PROBE_AUTH_TOKEN=<a real bearer token> \
##   .godot-runtime/bin/godot --headless --path world-lens-godot \
##     --script res://tools/quest_actions_probe.gd

const QuestPoller := preload("res://world/quest_poller.gd")
const QuestAvailablePoller := preload("res://world/quest_available_poller.gd")
const QuestActions := preload("res://world/quest_actions.gd")

var _quest_poller: QuestPoller
var _available_poller: QuestAvailablePoller
var _quest_actions: QuestActions
var _frame := 0
var _max_frames := 300
var _quest_poll_result := {}
var _available_poll_result := {}
var _action_result := {}
var _action_fired := false


func _initialize() -> void:
	var backend_url := OS.get_environment("CONCORD_BACKEND_URL")
	if backend_url == "":
		print("[quest_actions_probe] RESULT ", JSON.stringify({"ok": false, "reason": "no_backend_url"}))
		quit(2)
		return
	var world_id := OS.get_environment("CONCORD_QUEST_ACTIONS_PROBE_WORLD")
	if world_id == "":
		world_id = "concordia-hub"
	var auth_token := OS.get_environment("CONCORD_QUEST_ACTIONS_PROBE_AUTH_TOKEN")

	_quest_poller = QuestPoller.new()
	_quest_poller.base_url = backend_url
	_quest_poller.world_id = world_id
	_quest_poller.auth_token = auth_token
	_quest_poller.poll_succeeded.connect(func(c): _quest_poll_result = {"outcome": "succeeded", "count": c})
	_quest_poller.poll_failed.connect(func(r): _quest_poll_result = {"outcome": "failed", "reason": r})
	get_root().add_child(_quest_poller)

	_available_poller = QuestAvailablePoller.new()
	_available_poller.base_url = backend_url
	_available_poller.world_id = world_id
	_available_poller.auth_token = auth_token
	_available_poller.poll_succeeded.connect(func(c): _available_poll_result = {"outcome": "succeeded", "count": c})
	_available_poller.poll_failed.connect(func(r): _available_poll_result = {"outcome": "failed", "reason": r})
	get_root().add_child(_available_poller)

	_quest_actions = QuestActions.new()
	_quest_actions.base_url = backend_url
	_quest_actions.world_id = world_id
	_quest_actions.auth_token = auth_token
	_quest_actions.quest_poller = _quest_poller
	_quest_actions.available_poller = _available_poller
	_quest_actions.action_succeeded.connect(func(kind, qid, result):
		_action_result = {"outcome": "succeeded", "kind": kind, "questId": qid, "result": result})
	_quest_actions.action_failed.connect(func(kind, qid, reason):
		_action_result = {"outcome": "failed", "kind": kind, "questId": qid, "reason": reason})
	get_root().add_child(_quest_actions)


func _process(_delta: float) -> bool:
	_frame += 1
	var both_polled := not _quest_poll_result.is_empty() and not _available_poll_result.is_empty()

	if not both_polled and _frame < _max_frames:
		return false

	if not _action_fired:
		_action_fired = true
		var action := QuestActions.resolve_action(
			_quest_poller.get_quests(), _available_poller.get_available_quests())
		if action.is_empty():
			_action_result = {"outcome": "nothing_to_do"}
			return false
		_quest_actions.try_action()
		return false  # give the POST a chance to land before checking again

	if _action_result.get("outcome", "") == "" and _frame < _max_frames:
		return false

	var result := {
		"ok": true,
		"quest_poll_result": _quest_poll_result,
		"available_poll_result": _available_poll_result,
		"active_quests_fetched": _quest_poller.get_quests().size(),
		"available_quests_fetched": _available_poller.get_available_quests().size(),
		"action_result": _action_result,
		"frames_waited": _frame,
	}
	print("[quest_actions_probe] RESULT ", JSON.stringify(result))
	return true
