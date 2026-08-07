class_name GlbLoader
extends Node
## GlbLoader — downloads a .glb over HTTP and parses it into a Node3D via
## GLTFDocument.append_from_buffer. Results are cached in-memory by URL.
##
## Honest failure: on any HTTP error or non-200, `load_failed` fires and no node
## is returned — nothing is fabricated. A GLB that fails to parse is likewise an
## honest failure, not a silent empty scene.

signal loaded(url: String, root: Node3D)
signal load_failed(url: String, reason: String)

var _cache: Dictionary = {}  # url -> PackedScene (or a cached Node3D template)


func load_glb(url: String) -> void:
	if _cache.has(url):
		var cached: PackedScene = _cache[url]
		var inst := cached.instantiate()
		loaded.emit(url, inst)
		return

	var req := HTTPRequest.new()
	add_child(req)
	# `accept_gzip` defaults to true (Godot sends `Accept-Encoding: gzip` and
	# auto-decompresses). Found broken with a real server: Next.js's dev
	# server compresses `/models/building/*.glb` responses, and Godot's
	# stream_peer_gzip decoder failed mid-stream on them
	# ("Condition 'err != 0 && err != 1' is true" in core/io/
	# stream_peer_gzip.cpp) — every real building-mesh fetch failed with
	# `http_result_*` below as a direct result, honestly reported (never a
	# corrupted/partial mesh) but never actually loading. Disabling gzip
	# trades a larger uncompressed transfer for a working transfer; for a
	# multi-MB GLB fetched once and cached (see `_cache` above) that trade is
	# clearly worth it over silently never loading real building art.
	req.accept_gzip = false
	req.request_completed.connect(_on_completed.bind(url, req))
	var err := req.request(url)
	if err != OK:
		load_failed.emit(url, "request_error_%d" % err)
		req.queue_free()


func _on_completed(
		result: int, code: int, _headers: PackedStringArray,
		body: PackedByteArray, url: String, req: HTTPRequest) -> void:
	req.queue_free()
	if result != HTTPRequest.RESULT_SUCCESS:
		load_failed.emit(url, "http_result_%d" % result)
		return
	if code != 200:
		load_failed.emit(url, "http_status_%d" % code)
		return

	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	var base_path := url.get_base_dir()
	var perr := doc.append_from_buffer(body, base_path, state)
	if perr != OK:
		load_failed.emit(url, "gltf_parse_%d" % perr)
		return
	var root := doc.generate_scene(state)
	if root == null:
		load_failed.emit(url, "gltf_no_scene")
		return

	# Cache a packed copy so repeat loads don't re-download.
	var packed := PackedScene.new()
	if packed.pack(root) == OK:
		_cache[url] = packed
	loaded.emit(url, root)


func clear_cache() -> void:
	_cache.clear()
