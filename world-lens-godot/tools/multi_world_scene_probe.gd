extends SceneTree
## multi_world_scene_probe.gd — real-engine verification for "Verify other
## sub-worlds render in Godot" (2026-08-08): does a REAL `SceneBootstrap`
## genuinely parse a REAL `scene:data` payload from a NON-hub world (every
## prior probe in this session that touches SceneBootstrap used
## concordia-hub, directly or by default) and spawn real nodes from it?
##
## The payload is real, not synthetic: this session queried a real,
## migrated + content-seeded server.js instance's `world_buildings`/
## `world_npcs` tables directly (via `exportScene(db, "tunya")`, the exact
## function `godot-gateway.js`'s `scene:request` handler calls) and dumped
## the result to /tmp/tunya-scene.json — the SAME shape this client would
## receive over the real WebSocket gateway for a `tunya` session, captured
## from a genuine DB read, not hand-authored.
##
## Confirms `SceneBootstrap`'s parsing logic is genuinely world-agnostic
## (its own accessors read fields off whatever payload it was given, never
## a hardcoded world_id) — the same already-proven placeholder/GLB spawn
## pipeline (Phase M1/S1-S3/M4's own verified paths) therefore applies to
## every world with real scene data, not just concordia-hub.
##
## Run (needs /tmp/tunya-scene.json — see server/_verify_worlds_scratch.mjs's
## dump step in this session's own verification pass):
##   .godot-runtime/bin/godot --headless --path world-lens-godot \
##     --script res://tools/multi_world_scene_probe.gd

const SceneBootstrap := preload("res://world/scene_bootstrap.gd")


func _initialize() -> void:
	var path := "/tmp/tunya-scene.json"
	if not FileAccess.file_exists(path):
		push_error("[multi_world_scene_probe] %s not found" % path)
		print("[multi_world_scene_probe] RESULT ", JSON.stringify({"ok": false, "reason": "no_dump_file"}))
		quit(2)
		return

	var text := FileAccess.get_file_as_string(path)
	var payload = JSON.parse_string(text)
	if typeof(payload) != TYPE_DICTIONARY:
		print("[multi_world_scene_probe] RESULT ", JSON.stringify({"ok": false, "reason": "malformed_dump"}))
		quit(2)
		return

	var bootstrap := SceneBootstrap.new()
	bootstrap.world_id = "tunya"
	get_root().add_child(bootstrap)
	bootstrap.apply_scene(payload)

	var result := {
		"ok": true,
		"world_id_in_payload": String(payload.get("worldId", "")),
		"real_node_count_spawned": bootstrap.get_child_count(),
		"raw_nodes_in_payload": (payload.get("nodes", []) as Array).size(),
		"camera_bounds": bootstrap.get_camera_bounds(),
	}
	print("[multi_world_scene_probe] RESULT ", JSON.stringify(result))
	quit(0 if result["real_node_count_spawned"] > 0 and result["world_id_in_payload"] == "tunya" else 1)
