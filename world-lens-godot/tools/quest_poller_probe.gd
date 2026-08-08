extends SceneTree
## quest_poller_probe.gd — real-engine verification for Phase Q: does a REAL
## QuestPoller, pointed at an ALREADY-RUNNING real backend with a real
## authenticated player who has really accepted a real quest, actually fetch
## a real `GET /api/worlds/:worldId/quests/active` response and produce a
## real, non-fabricated breadcrumb line? Exercises the real HTTPRequest GET
## + auth-header path + JSON parse + `quests_response_to_quests`
## translation + `QuestBreadcrumb.pick_breadcrumb`/`breadcrumb_text` — not
## mocks of any of them (see tests/test_quest_poller.gd and
## tests/test_quest_breadcrumb.gd for those pinned in isolation; this proves
## the WIRING actually fires against a real server, same "prove the wiring"
## framing as npc_poller_probe.gd/avatar_manager_probe.gd).
##
## Also exercises `AvatarManager.npc_positions_snapshot()` end to end when a
## real NPC feed is available (same server), proving the FULL quest-POI
## resolution chain — `WayfindingMarkers.quest_pois(quests, npc_positions)`
## — against genuinely live data, not synthetic fixtures.
##
## Requires an ALREADY-RUNNING server.js with a fresh migrated DB, a real
## registered user (token supplied), AND that user having already accepted
## at least one real quest via a real
## `POST /:worldId/quests/:questId/accept` call BEFORE this probe runs
## (this script does not itself accept a quest — same "requires already-
## running, doesn't spawn/migrate/seed" division of labor every other probe
## in this directory keeps). A world with zero accepted quests for this
## user gives an honest `{"quests":[]}` — this probe distinguishes that from
## a genuine failure and reports it plainly rather than treating it as an
## error.
##
## Run:
##   CONCORD_BACKEND_URL=http://127.0.0.1:5050 \
##   CONCORD_QUEST_PROBE_WORLD=concordia-hub \
##   CONCORD_QUEST_PROBE_AUTH_TOKEN=<a real bearer token, already accepted a quest> \
##   .godot-runtime/bin/godot --headless --path world-lens-godot \
##     --script res://tools/quest_poller_probe.gd

const QuestPoller := preload("res://world/quest_poller.gd")
const QuestBreadcrumb := preload("res://world/quest_breadcrumb.gd")
const NpcPoller := preload("res://world/npc_poller.gd")
const AvatarManager := preload("res://avatar/avatar_manager.gd")
const WayfindingMarkers := preload("res://world/wayfinding_markers.gd")

var _quest_poller: QuestPoller
var _npc_poller: NpcPoller
var _avatar_manager: AvatarManager
var _frame := 0
var _max_frames := 300  # real network I/O needs real wall-clock frames
var _quest_poll_result := {}
var _npc_poll_result := {}
var _settled := false


func _initialize() -> void:
	var backend_url := OS.get_environment("CONCORD_BACKEND_URL")
	if backend_url == "":
		push_error("[quest_poller_probe] CONCORD_BACKEND_URL not set")
		print("[quest_poller_probe] RESULT ", JSON.stringify({"ok": false, "reason": "no_backend_url"}))
		quit(2)
		return
	var world_id := OS.get_environment("CONCORD_QUEST_PROBE_WORLD")
	if world_id == "":
		world_id = "concordia-hub"
	var auth_token := OS.get_environment("CONCORD_QUEST_PROBE_AUTH_TOKEN")

	_avatar_manager = AvatarManager.new()
	_avatar_manager.base_url = backend_url
	_avatar_manager.world_id = world_id
	get_root().add_child(_avatar_manager)

	_npc_poller = NpcPoller.new()
	_npc_poller.base_url = backend_url
	_npc_poller.world_id = world_id
	_npc_poller.auth_token = auth_token
	_npc_poller.avatar_manager = _avatar_manager
	_npc_poller.poll_succeeded.connect(func(count): _npc_poll_result = {"outcome": "succeeded", "count": count})
	_npc_poller.poll_failed.connect(func(reason): _npc_poll_result = {"outcome": "failed", "reason": reason})
	get_root().add_child(_npc_poller)

	_quest_poller = QuestPoller.new()
	_quest_poller.base_url = backend_url
	_quest_poller.world_id = world_id
	_quest_poller.auth_token = auth_token
	_quest_poller.poll_succeeded.connect(_on_quest_poll_succeeded)
	_quest_poller.poll_failed.connect(_on_quest_poll_failed)
	get_root().add_child(_quest_poller)


func _on_quest_poll_succeeded(count: int) -> void:
	if _quest_poll_result.is_empty():
		_quest_poll_result = {"outcome": "succeeded", "count": count}


func _on_quest_poll_failed(reason: String) -> void:
	if _quest_poll_result.is_empty():
		_quest_poll_result = {"outcome": "failed", "reason": reason}


func _process(_delta: float) -> bool:
	_frame += 1
	var both_settled := not _quest_poll_result.is_empty() and not _npc_poll_result.is_empty()
	if not both_settled and _frame < _max_frames:
		return false

	# One more settle tick so AvatarManager's own `_process` (which spawns
	# rigs from whatever `ingest_snapshot` just staged into its
	# SnapshotBuffer, real Node3D construction that does NOT happen
	# synchronously inside the HTTP signal handler) has genuinely run at
	# least once after the NPC poll resolved — same fix
	# npc_poller_probe.gd/avatar_manager_probe.gd already use.
	if not _settled:
		_settled = true
		return false

	var quests: Array = _quest_poller.get_quests() if _quest_poller != null else []
	var npc_positions: Dictionary = _avatar_manager.npc_positions_snapshot() if _avatar_manager != null else {}
	var pois := WayfindingMarkers.quest_pois(quests, npc_positions)
	var breadcrumb := QuestBreadcrumb.pick_breadcrumb(quests)
	var breadcrumb_text := ""
	if not breadcrumb.is_empty():
		breadcrumb_text = QuestBreadcrumb.breadcrumb_text(breadcrumb["quest"], breadcrumb["obj"])

	var result := {
		"ok": _quest_poll_result.get("outcome", "") == "succeeded",
		"quest_poll_result": _quest_poll_result,
		"npc_poll_result": _npc_poll_result,
		"quests_fetched": quests.size(),
		"npc_positions_known": npc_positions.size(),
		"quest_pois_resolved": pois.size(),
		"breadcrumb_text": breadcrumb_text,
		"frames_waited": _frame,
	}
	print("[quest_poller_probe] RESULT ", JSON.stringify(result))
	return true
