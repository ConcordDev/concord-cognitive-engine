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
	_test_a_second_caller_for_an_inflight_url_piggybacks_instead_of_duplicating(t)
	_test_fail_all_subscribers_notifies_every_registered_instance(t)
	_test_fail_all_subscribers_skips_a_freed_subscriber(t)
	_test_clear_cache_also_clears_inflight(t)
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


## Thundering-herd fix (2026-08-08) — see glb_loader.gd's header comment for
## why this matters in practice (every avatar in a busy Concordia scene
## defaults to the identical hero-mesh URL). `load_glb()`'s piggyback branch
## is reachable without a real network call: seed `_inflight[url]` as if an
## owner is already mid-fetch, then confirm a second caller appends itself
## rather than creating a competing entry or touching `_cache`.
static func _test_a_second_caller_for_an_inflight_url_piggybacks_instead_of_duplicating(t: TestUtils) -> void:
	var owner := GlbLoader.new()
	var url := "res://__test_glb_loader_inflight_fixture__.glb"
	GlbLoader._inflight[url] = [owner]

	var latecomer := GlbLoader.new()
	latecomer.load_glb(url)

	t.check(GlbLoader._inflight[url].size() == 2, "a second caller for an in-flight URL appends to the subscriber list rather than starting a second fetch")
	t.check(GlbLoader._inflight[url][0] == owner, "the original owner stays first in the subscriber list")
	t.check(GlbLoader._inflight[url][1] == latecomer, "the piggybacking caller is registered as a subscriber")
	t.check(not GlbLoader._cache.has(url), "piggybacking never fabricates a cache entry -- the fetch hasn't completed")

	GlbLoader._inflight.erase(url)
	owner.free()
	latecomer.free()


static func _test_fail_all_subscribers_notifies_every_registered_instance(t: TestUtils) -> void:
	var url := "res://__test_glb_loader_fail_fanout__.glb"
	var owner := GlbLoader.new()
	var subscriber := GlbLoader.new()
	GlbLoader._inflight[url] = [owner, subscriber]

	var owner_failures := []
	var subscriber_failures := []
	owner.load_failed.connect(func(_u, reason): owner_failures.append(reason))
	subscriber.load_failed.connect(func(_u, reason): subscriber_failures.append(reason))

	owner._fail_all_subscribers(url, "test_reason")

	t.check(owner_failures == ["test_reason"], "the owner itself gets load_failed when the shared fetch fails")
	t.check(subscriber_failures == ["test_reason"], "every piggybacking subscriber also gets load_failed, not just the owner")
	t.check(not GlbLoader._inflight.has(url), "the in-flight entry is cleared once every subscriber has been notified")

	owner.free()
	subscriber.free()


## A subscriber can legitimately be freed between subscribing and the shared
## fetch resolving (e.g. an NPC despawned while its hero-mesh fetch was still
## in flight) -- `is_instance_valid` must skip it silently rather than error.
static func _test_fail_all_subscribers_skips_a_freed_subscriber(t: TestUtils) -> void:
	var url := "res://__test_glb_loader_freed_subscriber__.glb"
	var owner := GlbLoader.new()
	var doomed := GlbLoader.new()
	GlbLoader._inflight[url] = [owner, doomed]
	doomed.free()

	var owner_failures := []
	owner.load_failed.connect(func(_u, reason): owner_failures.append(reason))

	# Must not throw despite `doomed` no longer being a valid instance.
	owner._fail_all_subscribers(url, "test_reason")

	t.check(owner_failures == ["test_reason"], "the still-valid owner is notified even when a sibling subscriber was freed first")

	owner.free()


static func _test_clear_cache_also_clears_inflight(t: TestUtils) -> void:
	var loader := GlbLoader.new()
	var url := "res://__test_glb_loader_clear_inflight__.glb"
	GlbLoader._inflight[url] = [loader]
	loader.clear_cache()
	t.check(not GlbLoader._inflight.has(url), "clear_cache() also clears in-flight tracking, matching its own class-lifetime-shared-state contract")
	loader.free()
