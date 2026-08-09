extends SceneTree
## creature_poller_probe.gd — real-engine verification for Phase M3: does a
## REAL CreaturePoller, pointed at an ALREADY-RUNNING real backend, actually
## fetch a real `POST /api/lens/run {domain:"creatures", name:"for_world"}`
## response and feed it into a REAL CreatureManager, resulting in real
## CreatureRig nodes appearing in CreatureManager._rigs? Exercises the real
## HTTPRequest POST + macro-envelope body + double-`ok` unwrap +
## `creatures_array_to_entities` translation + `CreatureManager.
## ingest_snapshot` wiring together — not mocks of any of them (mirrors
## tools/npc_poller_probe.gd's exact "spawn a real server.js, real round
## trip, assert real rig spawn" pattern). The double-`ok` envelope unwrap in
## particular is exactly the class of bug (silent zero-creatures) only a
## live round trip catches, not a pinned-input unit test.
##
## Requires an ALREADY-RUNNING server.js (this probe does not spawn/migrate
## one itself) with a real migrated + fauna-seeded world. `creatures.
## for_world` is NOT `requireAuth`-gated the way `GET /:worldId/npcs` is —
## it only forbids anonymous callers in production with AUTH_MODE != public
## (`_lensActionForbiddenForAnon`, server.js:7625) — but a real bearer token
## is still supplied here for parity with every other authenticated probe in
## this directory.
##
## Headless is sufficient — no rendering claim, only real object-state
## mutation from a real HTTP round trip:
##   CONCORD_BACKEND_URL=http://127.0.0.1:5050 \
##   CONCORD_CREATURE_PROBE_WORLD=concordia-hub \
##   CONCORD_CREATURE_PROBE_AUTH_TOKEN=<a real bearer token, optional> \
##   .godot-runtime/bin/godot --headless --path world-lens-godot \
##     --script res://tools/creature_poller_probe.gd

const CreatureManager := preload("res://world/creature_manager.gd")
const CreaturePoller := preload("res://world/creature_poller.gd")

var _poller: CreaturePoller
var _manager: CreatureManager
var _frame := 0
var _max_frames := 300  # real network I/O needs real wall-clock frames
var _settled := false
var _poll_result := {}


func _initialize() -> void:
	var backend_url := OS.get_environment("CONCORD_BACKEND_URL")
	if backend_url == "":
		push_error("[creature_poller_probe] CONCORD_BACKEND_URL not set")
		print("[creature_poller_probe] RESULT ", JSON.stringify({"ok": false, "reason": "no_backend_url"}))
		quit(2)
		return
	var world_id := OS.get_environment("CONCORD_CREATURE_PROBE_WORLD")
	if world_id == "":
		world_id = "concordia-hub"
	var auth_token := OS.get_environment("CONCORD_CREATURE_PROBE_AUTH_TOKEN")

	_manager = CreatureManager.new()
	_manager.base_url = backend_url
	_manager.world_id = world_id
	get_root().add_child(_manager)

	_poller = CreaturePoller.new()
	_poller.base_url = backend_url
	_poller.world_id = world_id
	_poller.auth_token = auth_token
	_poller.creature_manager = _manager
	_poller.poll_succeeded.connect(_on_poll_succeeded)
	_poller.poll_failed.connect(_on_poll_failed)
	get_root().add_child(_poller)


func _on_poll_succeeded(count: int) -> void:
	if _poll_result.is_empty():
		_poll_result = {"outcome": "succeeded", "count": count}


func _on_poll_failed(reason: String) -> void:
	if _poll_result.is_empty():
		_poll_result = {"outcome": "failed", "reason": reason}


func _process(_delta: float) -> bool:
	_frame += 1
	if _poll_result.is_empty() and _frame < _max_frames:
		return false

	if not _settled:
		_settled = true
		return false

	var rig_count := _manager._rigs.size() if _manager != null else 0
	var result := {
		"ok": _poll_result.get("outcome", "") == "succeeded",
		"poll_result": _poll_result,
		"rigs_spawned": rig_count,
		"frames_waited": _frame,
	}
	print("[creature_poller_probe] RESULT ", JSON.stringify(result))
	return true
