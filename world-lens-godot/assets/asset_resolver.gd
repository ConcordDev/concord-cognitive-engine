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


## Async resolve: try the endpoint, fall back to the static path.
func resolve(kind: String, id: String) -> void:
	if not use_resolve_endpoint:
		resolved.emit(kind, id, AssetResolver.fallback_url(base_url, kind, id))
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
		resolved.emit(kind, id, AssetResolver.fallback_url(base_url, kind, id))


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
	resolved.emit(kind, id, AssetResolver.fallback_url(base_url, kind, id))


## Pure static convention path. Deterministic; existence not guaranteed.
static func fallback_url(base: String, kind: String, id: String) -> String:
	return "%s/models/%s/%s.glb" % [base, kind, id]
