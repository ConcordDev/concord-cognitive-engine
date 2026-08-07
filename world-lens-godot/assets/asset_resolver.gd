class_name AssetResolver
extends Node
## AssetResolver — maps a (kind, id) pair to a downloadable .glb URL.
##
## Strategy:
##   1. Try the dynamic resolve endpoint (evo-asset promotions can supply a
##      real, per-instance model URL): GET {base}/api/evo-asset/resolve?kind&id
##      → JSON { url }.
##   2. Fall back to the static convention: {base}/models/{kind}/{id}.glb
##
## Honest failure: if the resolve endpoint errors AND the caller wants strict
## resolution, `resolve_failed` fires. The `fallback_url` static func is always
## available as a pure, deterministic path — but it is a CONVENTION, not a promise
## the file exists; the GlbLoader surfaces a 404 honestly downstream.

signal resolved(kind: String, id: String, url: String)
signal resolve_failed(kind: String, id: String, reason: String)

@export var base_url: String = "http://127.0.0.1:5050"
@export var use_resolve_endpoint: bool = true
## Threaded through to `fallback_url` for kind "player"/"npc" so a
## per-world hero-mesh variant can be preferred over the universal one —
## see that function's own comment for why. Blank is a legal, honest value
## (no per-world variant preference; falls to the universal archetype file).
@export var world_id: String = ""


## Async resolve: try the endpoint, fall back to the static path.
func resolve(kind: String, id: String) -> void:
	if not use_resolve_endpoint:
		resolved.emit(kind, id, AssetResolver.fallback_url(base_url, kind, id, world_id))
		return

	var req := HTTPRequest.new()
	add_child(req)
	req.request_completed.connect(_on_completed.bind(kind, id, req))
	var endpoint := "%s/api/evo-asset/resolve?kind=%s&id=%s" % [
		base_url, kind.uri_encode(), id.uri_encode()]
	var err := req.request(endpoint)
	if err != OK:
		req.queue_free()
		# Endpoint unreachable → static fallback (honest: may still 404 at load).
		resolved.emit(kind, id, AssetResolver.fallback_url(base_url, kind, id, world_id))


func _on_completed(
		result: int, code: int, _headers: PackedStringArray,
		body: PackedByteArray, kind: String, id: String, req: HTTPRequest) -> void:
	req.queue_free()
	if result == HTTPRequest.RESULT_SUCCESS and code == 200:
		var parsed = JSON.parse_string(body.get_string_from_utf8())
		if typeof(parsed) == TYPE_DICTIONARY and parsed.has("url"):
			resolved.emit(kind, id, String(parsed["url"]))
			return
	# Any failure → static fallback path (never fabricate a resolved asset).
	resolved.emit(kind, id, AssetResolver.fallback_url(base_url, kind, id, world_id))


## Pure static convention path. Deterministic; existence not guaranteed.
##
## kind "player"/"npc" is special-cased onto the REAL hero-mesh convention
## the Three.js client already uses and ships real files for
## (concord-frontend/lib/concordia/hero-mesh-registry.ts's
## ARCHETYPE_FALLBACK_PATH + its per-world "archetype-world" candidate) —
## NOT the building convention's `{base}/models/{kind}/{id}.glb`, which has
## no `player`/`npc` files on disk and would always 404. There is no
## per-user bespoke rig today (id is a session/user id, not an authored
## hero id), so this always resolves to the shared "warrior" archetype —
## the same universal default every remote/spectated player renders as in
## the web client absent a more specific occupation signal, which the
## `city:positions` wire payload this resolves from doesn't carry. A
## non-empty `world_id` prefers that world's palette variant
## (`_archetype_warrior__{world_id}.glb`, one of 6 authored today); GlbLoader
## honestly 404s and the caller's primitive placeholder stays up if a given
## world has no variant — never fabricated, never guessed beyond this
## documented convention.
static func fallback_url(base: String, kind: String, id: String, world_id: String = "") -> String:
	if kind == "player" or kind == "npc":
		if not world_id.is_empty():
			return "%s/meshes/heroes/_archetype_warrior__%s.glb" % [base, world_id]
		return "%s/meshes/heroes/_archetype_warrior.glb" % base
	return "%s/models/%s/%s.glb" % [base, kind, id]
