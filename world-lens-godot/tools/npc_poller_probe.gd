extends SceneTree
## npc_poller_probe.gd — real-engine verification for Phase N: does a REAL
## NpcPoller, pointed at an ALREADY-RUNNING real backend, actually fetch a
## real `GET /api/worlds/:worldId/npcs` response and feed it into a REAL
## AvatarManager, resulting in real AvatarRig nodes appearing in
## AvatarManager._rigs? Exercises the real HTTPRequest GET + auth-header
## path + JSON parse + `npcs_array_to_entities` translation +
## `AvatarManager.ingest_snapshot` wiring together — not mocks of any of
## them (see tests/test_npc_poller.gd for the translation layer pinned in
## isolation; this proves the WIRING actually fires against a real server,
## mirroring avatar_manager_probe.gd's own "prove the wiring, not just each
## piece standalone" framing).
##
## Requires an ALREADY-RUNNING server.js (this probe does not spawn/migrate
## one itself — same division of labor as every other probe in this
## directory, e.g. avatar_manager_probe.gd's own CONCORD_FRONTEND_URL
## requirement) with a real migrated + content-seeded world. The default,
## concordia-hub, ships 16 authored NPCs per CLAUDE.md's own inventory.
## `GET /:worldId/npcs` is `requireAuth`-gated (server/routes/worlds.js:856)
## — a real bearer token must be supplied for a genuine `ok:true` result; an
## unset/wrong token honestly reports a failed poll (auth failure), not a
## fabricated success.
##
## No CONCORD_FRONTEND_URL is required here (unlike avatar_manager_probe.gd)
## — this probe's claim is about the NPC FEED reaching AvatarManager, not
## rendered mesh fidelity. A GLB-resolve failure just leaves the honest
## primitive placeholder on each spawned rig, which is fine for this claim.
##
## Headless is sufficient — no rendering claim, only real object-state
## mutation from a real HTTP round trip:
##   CONCORD_BACKEND_URL=http://127.0.0.1:5050 \
##   CONCORD_NPC_PROBE_WORLD=concordia-hub \
##   CONCORD_NPC_PROBE_AUTH_TOKEN=<a real bearer token> \
##   .godot-runtime/bin/godot --headless --path world-lens-godot \
##     --script res://tools/npc_poller_probe.gd

const NpcPoller := preload("res://world/npc_poller.gd")
const AvatarManager := preload("res://avatar/avatar_manager.gd")

var _poller: NpcPoller
var _manager: AvatarManager
var _frame := 0
var _max_frames := 300  # real network I/O needs real wall-clock frames
var _settled := false
var _poll_result := {}


func _initialize() -> void:
	var backend_url := OS.get_environment("CONCORD_BACKEND_URL")
	if backend_url == "":
		push_error("[npc_poller_probe] CONCORD_BACKEND_URL not set")
		print("[npc_poller_probe] RESULT ", JSON.stringify({"ok": false, "reason": "no_backend_url"}))
		quit(2)
		return
	var world_id := OS.get_environment("CONCORD_NPC_PROBE_WORLD")
	if world_id == "":
		world_id = "concordia-hub"
	var auth_token := OS.get_environment("CONCORD_NPC_PROBE_AUTH_TOKEN")

	_manager = AvatarManager.new()
	_manager.base_url = backend_url
	_manager.world_id = world_id
	get_root().add_child(_manager)

	_poller = NpcPoller.new()
	_poller.base_url = backend_url
	_poller.world_id = world_id
	_poller.auth_token = auth_token
	_poller.avatar_manager = _manager
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

	# One more settle tick so AvatarManager's own `_process` (which spawns
	# rigs from whatever `ingest_snapshot` just staged into its
	# SnapshotBuffer) has genuinely run at least once after the poll
	# resolved — mirrors combat_target_probe.gd's own settle-frame pattern.
	if not _settled:
		_settled = true
		return false

	var rig_count := _manager._rigs.size() if _manager != null else 0
	# 2026-08-08 — real per-entity archetype threading proof: reports each
	# spawned rig's ACTUAL AvatarRig.archetype field (not the poller's
	# intermediate entity dict) so this probe proves the full chain
	# (REST occupation text -> archetype_for_occupation -> AvatarManager
	# ._archetypes -> AvatarRig.archetype) really lands, not just that a
	# rig exists.
	var archetypes := {}
	if _manager != null:
		for id in _manager._rigs.keys():
			var rig = _manager._rigs[id]
			if is_instance_valid(rig):
				archetypes[id] = rig.archetype
	var result := {
		"ok": _poll_result.get("outcome", "") == "succeeded",
		"poll_result": _poll_result,
		"rigs_spawned": rig_count,
		"rig_archetypes": archetypes,
		"frames_waited": _frame,
	}
	print("[npc_poller_probe] RESULT ", JSON.stringify(result))
	return true
