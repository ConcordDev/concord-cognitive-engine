class_name DtuPropRenderer
extends Node3D
## DtuPropRenderer — master-spec §3.3 (units B6-B9): renders DTUs as real,
## interactive world props (shelf/counter/window/rooftop/plaza).
##
## Fetches real placements from the backend (server/lib/dtu-props.js via the
## `dtu_props.list` macro, reached through `POST /api/lens/run`) and instances
## one node per placement: a real .glb via AssetResolver + GlbLoader when one
## resolves, otherwise a placeholder BoxMesh tinted by slot — NEVER a
## fabricated placement invented client-side. An `{ok:false}` response is
## surfaced via `placements_failed`, not silently swallowed into an empty
## (and misleadingly "nothing here") scene.
##
## Pure-logic parts (`placement_to_transform`, `slot_color`,
## `build_list_request_body`) are static so they're unit-testable without a
## scene tree — see world-lens-godot/tests/test_dtu_prop_renderer.gd.
##
## STATUS: like the rest of world-lens-godot (docs/GODOT_INTEGRATION.md), this
## has only been parse/lint validated (`gdparse` + `gdlint`), never opened in
## a real engine — see VISUAL_QA.md. It also depends on the `dtu_props`
## macro domain being wired into server.js's `register()` call table (see the
## honest caveat at the top of server/domains/dtu-props.js) and, separately,
## on the Godot gateway itself being mounted (Phase 1 status in
## docs/GODOT_INTEGRATION.md) OR a plain HTTP path to `/api/lens/run` being
## reachable — this renderer uses a plain HTTPRequest POST, so it does NOT
## require the WebSocket gateway to be mounted, only the HTTP macro route.

signal placements_ready(count: int)
signal placements_failed(reason: String)
signal prop_spawned(dtu_id: String, node: Node3D)

const AssetResolver := preload("res://assets/asset_resolver.gd")
const GlbLoader := preload("res://assets/glb_loader.gd")

@export var base_url: String = "http://127.0.0.1:5050"
@export var world_id: String = "concordia-hub"
@export var building_id: String = ""
@export var auth_token: String = ""
@export var use_glb_assets: bool = true

var _asset_resolver: AssetResolver
var _glb_loader: GlbLoader
var _spawned: Dictionary = {}  # dtuId -> Node3D


func _ready() -> void:
	if use_glb_assets:
		_asset_resolver = AssetResolver.new()
		_asset_resolver.base_url = base_url
		add_child(_asset_resolver)
		_glb_loader = GlbLoader.new()
		add_child(_glb_loader)


## Kick off a fetch of placements for `world_id` (+ optional `building_id`).
## Clears any previously spawned props first.
func fetch_placements() -> void:
	_clear()

	var req := HTTPRequest.new()
	add_child(req)
	req.request_completed.connect(_on_list_completed.bind(req))

	var headers := PackedStringArray(["Content-Type: application/json"])
	if auth_token != "":
		headers.append("Authorization: Bearer %s" % auth_token)

	var body := JSON.stringify(DtuPropRenderer.build_list_request_body(world_id, building_id))
	var err := req.request("%s/api/lens/run" % base_url, headers, HTTPClient.METHOD_POST, body)
	if err != OK:
		req.queue_free()
		placements_failed.emit("request_error_%d" % err)


func _on_list_completed(
		result: int, code: int, _headers: PackedStringArray,
		response_body: PackedByteArray, req: HTTPRequest) -> void:
	req.queue_free()
	if result != HTTPRequest.RESULT_SUCCESS or code != 200:
		placements_failed.emit("http_%d_%d" % [result, code])
		return

	var parsed = JSON.parse_string(response_body.get_string_from_utf8())
	if typeof(parsed) != TYPE_DICTIONARY or not bool(parsed.get("ok", false)):
		var reason := "malformed_response"
		if typeof(parsed) == TYPE_DICTIONARY:
			reason = String(parsed.get("reason", "unknown"))
		placements_failed.emit(reason)
		return

	var placements: Array = parsed.get("placements", [])
	for p in placements:
		if typeof(p) == TYPE_DICTIONARY:
			_spawn_prop(p)
	placements_ready.emit(_spawned.size())


func _spawn_prop(placement: Dictionary) -> void:
	var dtu_id := String(placement.get("dtuId", ""))
	if dtu_id == "" or _spawned.has(dtu_id):
		return

	var holder := Node3D.new()
	holder.name = "dtu_prop_%s" % dtu_id
	holder.set_meta("dtu_id", dtu_id)
	holder.set_meta("slot", String(placement.get("slot", "plaza")))
	holder.set_meta("title", String(placement.get("title", "Untitled")))
	holder.add_to_group("dtu_prop")
	holder.transform = DtuPropRenderer.placement_to_transform(placement)

	# Placeholder geometry now; a resolved .glb (if any) replaces it later.
	var placeholder := _build_placeholder(String(placement.get("slot", "plaza")))
	holder.add_child(placeholder)

	add_child(holder)
	_spawned[dtu_id] = holder
	prop_spawned.emit(dtu_id, holder)

	if use_glb_assets and _asset_resolver:
		var resolved_cb := _on_asset_resolved.bind(holder, placeholder)
		_asset_resolver.resolved.connect(resolved_cb, CONNECT_ONE_SHOT)
		_asset_resolver.resolve_failed.connect(_on_asset_resolve_failed, CONNECT_ONE_SHOT)
		_asset_resolver.resolve("dtu_prop", dtu_id)


func _on_asset_resolved(
		_kind: String, _id: String, url: String, holder: Node3D, placeholder: Node3D) -> void:
	if not is_instance_valid(holder):
		return
	_glb_loader.loaded.connect(_on_glb_loaded.bind(holder, placeholder), CONNECT_ONE_SHOT)
	# Honest: on failure the placeholder box simply stays — never fabricate a model.
	_glb_loader.load_failed.connect(func(_u, _r): pass, CONNECT_ONE_SHOT)
	_glb_loader.load_glb(url)


func _on_asset_resolve_failed(_kind: String, _id: String, _reason: String) -> void:
	pass  # placeholder box stays — never fabricate a model that doesn't exist.


func _on_glb_loaded(root: Node3D, holder: Node3D, placeholder: Node3D) -> void:
	if not is_instance_valid(holder):
		return
	if is_instance_valid(placeholder):
		placeholder.queue_free()
	holder.add_child(root)


func _build_placeholder(slot: String) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = DtuPropRenderer.placeholder_size_for_slot(slot)
	mi.mesh = mesh
	var mat := StandardMaterial3D.new()
	mat.albedo_color = DtuPropRenderer.slot_color(slot)
	mi.material_override = mat
	return mi


func _clear() -> void:
	for node in _spawned.values():
		if is_instance_valid(node):
			node.queue_free()
	_spawned.clear()


## The node currently spawned for a given DTU id, if any (used by
## DtuPropInteraction's raycast group lookup, and by tests).
func node_for(dtu_id: String) -> Node3D:
	return _spawned.get(dtu_id, null)


# ── Pure static helpers ──────────────────────────────────────────────────────

## Body for `POST /api/lens/run` — the exact envelope every macro call in
## this codebase uses (`{ domain, name, input }`).
static func build_list_request_body(world_id: String, building_id: String) -> Dictionary:
	var input := {"worldId": world_id}
	if building_id != "":
		input["buildingId"] = building_id
	return {"domain": "dtu_props", "name": "list", "input": input}


## Maps a placement's `{position:[x,y,z]}` (server/lib/dtu-props.js's
## normalizePosition shape) into a Transform3D. Missing/malformed position
## defaults to the origin, never a fabricated offset.
##
## `pos` is deliberately UNTYPED. It was previously declared `var pos: Array`,
## which made GDScript enforce the type at assignment — so a non-Array
## `position` (e.g. a string) threw "Trying to assign value of type 'String'
## to a variable of type 'Array'" one line BEFORE the `typeof()` check meant
## to handle exactly that case, rendering the defensive branch unreachable.
## The malformed-input path only appeared to work because the failed
## assignment left `pos` as an empty Array, which then fell through to the
## origin by accident rather than by the guard. Keeping it untyped lets the
## guard actually guard.
static func placement_to_transform(placement: Dictionary) -> Transform3D:
	var pos: Variant = placement.get("position", [0, 0, 0])
	var origin := Vector3.ZERO
	if typeof(pos) == TYPE_ARRAY and pos.size() >= 3:
		# Element-level check too: a well-shaped array carrying non-numeric
		# entries must degrade to the origin rather than throw on `float()`.
		if _is_number(pos[0]) and _is_number(pos[1]) and _is_number(pos[2]):
			origin = Vector3(float(pos[0]), float(pos[1]), float(pos[2]))
	return Transform3D(Basis(), origin)


## True only for real numeric scalars — deliberately NOT accepting strings,
## so a `"12"` in a position array reads as malformed input rather than being
## silently coerced into a coordinate the server never sent.
static func _is_number(v: Variant) -> bool:
	var tv := typeof(v)
	return tv == TYPE_INT or tv == TYPE_FLOAT


## Distinguishing (not "final art") placeholder tint per slot — purely so a
## shelf reads differently from a rooftop prop at a glance pre-GLB.
static func slot_color(slot: String) -> Color:
	match slot:
		"shelf":
			return Color(0.55, 0.35, 0.2)   # wood brown
		"counter":
			return Color(0.75, 0.7, 0.55)   # stone/counter tan
		"window":
			return Color(0.4, 0.7, 0.9)     # glass blue
		"rooftop":
			return Color(0.6, 0.2, 0.2)     # rooftop terracotta
		_:
			return Color(0.5, 0.5, 0.5)     # plaza neutral grey


static func placeholder_size_for_slot(slot: String) -> Vector3:
	match slot:
		"shelf":
			return Vector3(0.4, 0.5, 0.3)
		"counter":
			return Vector3(0.5, 0.9, 0.5)
		"window":
			return Vector3(0.1, 0.6, 0.6)
		"rooftop":
			return Vector3(0.6, 0.4, 0.6)
		_:
			return Vector3(0.5, 0.5, 0.5)
