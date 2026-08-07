class_name TestGlbLoader
extends RefCounted
## Pure-logic test for assets/glb_loader.gd's Phase M4 fix — the cache is
## `static`, so a URL cached by ONE GlbLoader instance is a hit for every
## OTHER instance too, not just the one that fetched it. No real network
## call is exercised here (that needs a live server — see
## tools/glb_load_probe.gd / tools/weapon_attach_probe.gd for the real-fetch
## proof); this pins the cache-sharing contract in isolation, deterministically.

const GlbLoader := preload("res://assets/glb_loader.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	# Leave the static cache clean before AND after this suite runs, so a
	# later suite in the same `run_all.gd` process never sees leftover
	# state from this one (the cache is process-lifetime shared, by design).
	GlbLoader.new().clear_cache()
	_test_a_url_cached_by_one_instance_is_a_hit_on_another(t)
	_test_an_uncached_url_is_honestly_absent_on_a_fresh_instance(t)
	GlbLoader.new().clear_cache()
	return t


static func _fake_packed_scene() -> PackedScene:
	var node := Node3D.new()
	var packed := PackedScene.new()
	packed.pack(node)
	return packed


static func _test_a_url_cached_by_one_instance_is_a_hit_on_another(t: TestUtils) -> void:
	var loader_a := GlbLoader.new()
	var loader_b := GlbLoader.new()
	var url := "res://__test_glb_loader_fixture__.glb"
	loader_a._cache[url] = _fake_packed_scene()
	t.check(loader_b._cache.has(url), "a URL cached via loader_a is visible via loader_b -- the cache is process-shared, not per-instance")


static func _test_an_uncached_url_is_honestly_absent_on_a_fresh_instance(t: TestUtils) -> void:
	var loader := GlbLoader.new()
	t.check(not loader._cache.has("res://__definitely_never_cached__.glb"),
		"a URL nobody has ever loaded is honestly absent, not fabricated as a hit")
