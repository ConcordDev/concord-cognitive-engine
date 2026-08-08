class_name GlbLoader
extends Node
## GlbLoader — downloads a .glb over HTTP and parses it into a Node3D via
## GLTFDocument.append_from_buffer. Results are cached in-memory by URL.
##
## Honest failure: on any HTTP error or non-200, `load_failed` fires and no node
## is returned — nothing is fabricated. A GLB that fails to parse is likewise an
## honest failure, not a silent empty scene.
##
## Phase M4 (2026-08-07) — the cache is `static`, shared across EVERY
## GlbLoader instance's whole process lifetime, not per-instance. Found by
## reading real call sites: `scene_bootstrap.gd` avoids the N-instance
## problem itself (one GlbLoader per building ARCHETYPE, fanned out to every
## pending building of that type via `_pending_upgrade`), but
## `avatar_rig.gd` creates a fresh `GlbLoader.new()` per AVATAR for both the
## body and weapon fetch — with a per-instance cache, N simultaneously-
## visible avatars resolving the same URL (today: always true, every avatar
## defaults to the "warrior" archetype) would each independently download +
## parse the identical multi-MB file. A static cache turns the steady-state
## case (avatars appearing one at a time — the common case) into "first one
## fetches for real, everyone after gets an instant hit." Safe because these
## URLs serve static assets that don't change at runtime.
##
## Phase (2026-08-08) — the "thundering herd" case above IS now fixed:
## `_inflight` tracks one real HTTPRequest per URL, and every OTHER caller
## for that same URL while it's still in flight piggybacks as a subscriber
## instead of firing a redundant fetch. Found to matter far more than the
## Phase M4 comment above assumed, by an actual browser load against a real
## scene: every avatar in Concordia defaults to the identical "warrior"
## hero-mesh URL (no per-NPC archetype signal exists on the wire), so with
## ~56 NPCs + the local player all spawning at once, this ISN'T a rare
## edge case — it's the guaranteed common case, every single load. Measured
## before this fix: 20+ literally-identical concurrent requests for the same
## hero-mesh URL, all competing for Chromium's small per-origin connection
## limit, starving even the LOCAL PLAYER's own body-mesh fetch for 30+ real
## seconds (it visibly never got a connection slot in that window). Design:
## the first caller for a not-yet-cached, not-yet-in-flight URL becomes the
## sole fetcher and registers itself as `_inflight[url][0]`; every later
## caller for the same URL appends itself and returns without touching the
## network. On completion, every subscriber gets its own `loaded`/
## `load_failed` emission — the owner gets the live `root` node directly,
## every other subscriber gets its own `packed.instantiate()` copy (Godot
## nodes can't be shared as a child of more than one parent). If packing
## the result failed, only the owner gets the live node; every other
## subscriber gets an honest `load_failed` rather than a fabricated share of
## a node it can never actually receive.

signal loaded(url: String, root: Node3D)
signal load_failed(url: String, reason: String)

static var _cache: Dictionary = {}  # url -> PackedScene (or a cached Node3D template), SHARED across every instance
static var _inflight: Dictionary = {}  # url -> Array[GlbLoader] of instances waiting on this URL's in-flight fetch


func load_glb(url: String) -> void:
	if _cache.has(url):
		var cached: PackedScene = _cache[url]
		var inst := cached.instantiate()
		loaded.emit(url, inst)
		return

	if _inflight.has(url):
		# Piggyback on the fetch already in flight for this exact URL —
		# see this file's header comment for why this matters in practice.
		_inflight[url].append(self)
		return
	_inflight[url] = [self]

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
		_fail_all_subscribers(url, "request_error_%d" % err)
		req.queue_free()


## Fans a failure out to every subscriber waiting on `url` (the owner and
## anyone that piggybacked while the fetch was in flight — see this file's
## header comment), then clears the in-flight entry. `is_instance_valid`
## guards against a subscriber (e.g. an NPC's AvatarRig) having been freed
## between subscribing and this fetch resolving.
func _fail_all_subscribers(url: String, reason: String) -> void:
	var subscribers: Array = _inflight.get(url, [self])
	_inflight.erase(url)
	for s in subscribers:
		if is_instance_valid(s):
			s.load_failed.emit(url, reason)


func _on_completed(
		result: int, code: int, _headers: PackedStringArray,
		body: PackedByteArray, url: String, req: HTTPRequest) -> void:
	req.queue_free()
	if result != HTTPRequest.RESULT_SUCCESS:
		_fail_all_subscribers(url, "http_result_%d" % result)
		return
	if code != 200:
		_fail_all_subscribers(url, "http_status_%d" % code)
		return

	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	var base_path := url.get_base_dir()
	var perr := doc.append_from_buffer(body, base_path, state)
	if perr != OK:
		_fail_all_subscribers(url, "gltf_parse_%d" % perr)
		return
	var root := doc.generate_scene(state)
	if root == null:
		_fail_all_subscribers(url, "gltf_no_scene")
		return

	# Cache a packed copy so repeat loads don't re-download.
	var packed := PackedScene.new()
	var pack_ok := packed.pack(root) == OK
	if pack_ok:
		_cache[url] = packed

	# Fan out to every subscriber that piggybacked on this fetch (see this
	# file's header comment). The owner (self) gets the live `root` node
	# directly; every other subscriber gets its own `packed.instantiate()`
	# copy — Godot nodes can't be shared as a child of more than one parent.
	# If packing failed, only the owner can honestly receive a real node;
	# every other subscriber gets `load_failed` rather than a fabricated share.
	var subscribers: Array = _inflight.get(url, [self])
	_inflight.erase(url)
	for s in subscribers:
		if not is_instance_valid(s):
			continue
		if s == self:
			s.loaded.emit(url, root)
		elif pack_ok:
			s.loaded.emit(url, packed.instantiate())
		else:
			s.load_failed.emit(url, "pack_failed_no_shareable_copy")


func clear_cache() -> void:
	_cache.clear()
	_inflight.clear()
