class_name TestBootResync
extends RefCounted
## Pure-logic tests for world/boot.gd's R6 helpers: translating
## `city:positions`' array-of-users payload into the Dictionary-keyed-by-id
## shape AvatarManager.ingest_snapshot expects, and filtering that broadcast
## (which the server sends globally across every active city/world — see
## city-presence.js#broadcastPositions) down to the client's own world.

const Boot := preload("res://world/boot.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_users_array_to_dict_basic_shape(t)
	_test_users_array_to_dict_skips_blank_or_missing_user_id(t)
	_test_users_array_to_dict_skips_non_dictionary_entries(t)
	_test_users_array_to_dict_empty_array(t)
	_test_event_matches_world_by_city_id(t)
	_test_event_matches_world_falls_back_to_world_id_field(t)
	_test_event_matches_world_rejects_other_worlds(t)
	return t


static func _test_users_array_to_dict_basic_shape(t: TestUtils) -> void:
	var users: Array = [
		{"userId": "alice", "x": 1.0, "y": 0.0, "z": 2.0, "direction": 0.5},
		{"userId": "bob", "x": 3.0, "y": 0.0, "z": 4.0, "direction": 1.2},
	]
	var out := Boot.users_array_to_dict(users)
	t.check_eq(out.size(), 2, "one dict entry per array entry")
	t.check(out.has("alice"), "keyed by userId")
	t.check(out.has("bob"), "keyed by userId")
	t.check_eq(out["alice"]["x"], 1.0, "the original entry Dictionary is preserved verbatim")


static func _test_users_array_to_dict_skips_blank_or_missing_user_id(t: TestUtils) -> void:
	var users: Array = [
		{"userId": "", "x": 1.0},
		{"x": 2.0},  # no userId field at all
		{"userId": "carol", "x": 3.0},
	]
	var out := Boot.users_array_to_dict(users)
	t.check_eq(out.size(), 1, "entries with no usable id are dropped, not fabricated a key")
	t.check(out.has("carol"), "the one valid entry still comes through")


static func _test_users_array_to_dict_skips_non_dictionary_entries(t: TestUtils) -> void:
	var users: Array = ["not a dict", 42, {"userId": "dave", "x": 1.0}]
	var out := Boot.users_array_to_dict(users)
	t.check_eq(out.size(), 1, "malformed non-Dictionary entries are dropped, never crash")
	t.check(out.has("dave"), "the one real entry still comes through")


static func _test_users_array_to_dict_empty_array(t: TestUtils) -> void:
	t.check_eq(Boot.users_array_to_dict([]), {}, "an empty users array yields an empty dict, not an error")


static func _test_event_matches_world_by_city_id(t: TestUtils) -> void:
	t.check(
		Boot.event_matches_world({"cityId": "concordia-hub"}, "concordia-hub"),
		"matches on cityId, the field city:positions actually ships")


static func _test_event_matches_world_falls_back_to_world_id_field(t: TestUtils) -> void:
	t.check(
		Boot.event_matches_world({"worldId": "tunya"}, "tunya"),
		"falls back to a worldId field if cityId is absent, mirroring city-presence.js's own convention")


static func _test_event_matches_world_rejects_other_worlds(t: TestUtils) -> void:
	t.check(
		not Boot.event_matches_world({"cityId": "tunya"}, "concordia-hub"),
		"a broadcast for a different city/world is rejected, not accidentally ingested")
	t.check(
		not Boot.event_matches_world({}, "concordia-hub"),
		"a payload with neither field never matches a real world id")
