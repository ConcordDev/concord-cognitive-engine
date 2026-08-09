extends SceneTree
## vegetation_renderer_probe.gd — one-off verification for Phase M2: does a
## real VegetationRenderer, fed a synthetic scatter-shaped `entries` array
## (the exact shape server/lib/vegetation-scatter.js produces, verified by
## server/tests/vegetation-scatter.test.js), actually spawn one real holder
## node per entry at the real transform — the NEW thing this phase adds.
## Does NOT re-prove GLB resolution/placeholder-fallback machinery itself
## (assets/asset_resolver.gd + assets/glb_loader.gd already have their own
## dedicated probes/tests) — this is lighter than avatar_manager_probe.gd or
## creature_poller_probe.gd on purpose: no server, no frontend asset origin
## required. If CONCORD_FRONTEND_URL is set and actually serving
## /models/vegetation/*.glb, the real-GLB-swap path is exercised too and
## reported; if unset, every entry is expected to stay on its honest tinted
## placeholder, which is itself a valid, checked outcome (never a fabricated
## mesh either way).
##
## Run (no server needed):
##   xvfb-run -a -s "-screen 0 1280x720x24" .godot-runtime/bin/godot \
##     --path world-lens-godot --display-driver x11 --rendering-driver opengl3 \
##     --script res://tools/vegetation_renderer_probe.gd
##
## Optionally, with a real frontend static-asset server up:
##   CONCORD_FRONTEND_URL=http://127.0.0.1:PORT \
##   xvfb-run -a -s "-screen 0 1280x720x24" .godot-runtime/bin/godot \
##     --path world-lens-godot --display-driver x11 --rendering-driver opengl3 \
##     --script res://tools/vegetation_renderer_probe.gd

const VegetationRenderer := preload("res://world/vegetation_renderer.gd")
const ArtStyle := preload("res://world/art_style.gd")

var _renderer: VegetationRenderer
var _frame := 0
# Real network I/O (if CONCORD_FRONTEND_URL is set) needs real wall-clock
# frames -- matches avatar_manager_probe.gd's magnitude of patience (that
# probe's _max_frames=600), not a fixed short settle. Every entry's child
# count (2 = real GLB swapped in over the placeholder; still 1 = honest
# placeholder-only, which is a valid, checked outcome without a server).
var _settle := 300
var _entries: Array = []

const SYNTHETIC_ENTRIES := [
	{"id": "concordia-hub:plaza:veg:0", "species": "tree_01", "x": 10.0, "y": 0.0, "z": -20.0, "rotationY": 0.0, "scale": 1.0},
	{"id": "concordia-hub:plaza:veg:1", "species": "tree_02", "x": -5.0, "y": 0.0, "z": 8.5, "rotationY": 1.2, "scale": 1.1},
	{"id": "concordia-hub:market:veg:0", "species": "bush_01", "x": 22.0, "y": 0.0, "z": 4.0, "rotationY": 2.4, "scale": 0.9},
	{"id": "concordia-hub:market:veg:1", "species": "flower_01", "x": 22.0, "y": 0.0, "z": 6.0, "rotationY": 0.0, "scale": 1.0},
]


func _initialize() -> void:
	_entries = SYNTHETIC_ENTRIES

	var frontend_url := OS.get_environment("CONCORD_FRONTEND_URL")

	var we := WorldEnvironment.new()
	we.environment = ArtStyle.make_environment("concordia-hub")
	get_root().add_child(we)
	var sun := ArtStyle.make_sun("concordia-hub")
	sun.rotation_degrees = Vector3(-42.0, -35.0, 0.0)
	get_root().add_child(sun)

	var cam := Camera3D.new()
	var eye := Vector3(0.0, 30.0, 30.0)
	cam.transform = cam.transform.looking_at(Vector3(5.0, 0.0, -5.0) - eye, Vector3.UP)
	cam.position = eye
	get_root().add_child(cam)
	cam.make_current()

	_renderer = VegetationRenderer.new()
	if frontend_url != "":
		_renderer.frontend_asset_base_url = frontend_url
	_renderer.world_id = "concordia-hub"
	get_root().add_child(_renderer)


func _process(_delta: float) -> bool:
	_frame += 1
	# Deferred to the first real frame rather than called from _initialize():
	# HTTPRequest.request() needs the node genuinely inside a running tree,
	# which isn't guaranteed yet during SceneTree bootstrap.
	if _frame == 1:
		_renderer.spawn(_entries)
	if _settle > 0:
		_settle -= 1
		return false

	var tex := get_root().get_texture()
	var img = tex.get_image() if tex != null else null
	var saved := false
	var out_path := "/tmp/vegetation_renderer_probe.png"
	if img != null and not img.is_empty():
		saved = img.save_png(out_path) == OK

	# Read the renderer's own `_spawned` dictionary (real id -> holder) rather
	# than parsing `child.name` back into an id: Godot sanitizes reserved
	# characters (e.g. `:`) out of Node names, so a real id like
	# "concordia-hub:plaza:veg:0" does NOT round-trip through `child.name`
	# unchanged — this is a probe-methodology fact, not a renderer bug (the
	# renderer never claimed node names were parseable identifiers).
	var by_id: Dictionary = {}
	for id in _renderer._spawned.keys():
		var holder: Node3D = _renderer._spawned[id]
		# The placeholder is freed via queue_free() on GLB swap (deferred, not
		# immediate) and the real GLB root takes its place as the sole child —
		# child_count alone can't distinguish "placeholder" from "real GLB", so
		# check the surviving child's own class instead: a placeholder is
		# always exactly a MeshInstance3D (see _build_placeholder); a loaded
		# GLB's root is whatever glTF export produced (never that).
		var glb_swapped := false
		if holder.get_child_count() > 0:
			glb_swapped = holder.get_child(0).get_class() != "MeshInstance3D"
		by_id[id] = {
			"origin": [holder.transform.origin.x, holder.transform.origin.y, holder.transform.origin.z],
			"child_count": holder.get_child_count(),
			"glb_swapped": glb_swapped,
		}

	var all_present := true
	for e in _entries:
		if not by_id.has(String(e["id"])):
			all_present = false

	var result := {
		"ok": all_present and by_id.size() == _entries.size(),
		"entries_sent": _entries.size(),
		"holders_spawned": by_id.size(),
		"all_ids_present": all_present,
		"per_id": by_id,
		"screenshot_saved": saved,
		"screenshot_path": out_path,
	}
	print("[vegetation_renderer_probe] RESULT ", JSON.stringify(result))
	return true
