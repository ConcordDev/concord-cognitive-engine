class_name TestPlayerAppearanceLoader
extends RefCounted
## Pure-logic test for world/player_appearance_loader.gd's request-body
## builder — the analogue of test_creature_poller.gd's own request-body
## pin. The HTTP/timeout/envelope-unwrap machinery is engine-gated and
## covered by tools/player_appearance_probe.gd instead.

const PlayerAppearanceLoader := preload("res://world/player_appearance_loader.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_request_body_shape(t)
	return t


static func _test_request_body_shape(t: TestUtils) -> void:
	var body := PlayerAppearanceLoader.build_request_body()
	t.check_eq(String(body.get("domain", "")), "appearance",
		"request body targets the appearance domain")
	t.check_eq(String(body.get("name", "")), "load_for_user",
		"request body targets the load_for_user action — the SAME macro app/onboarding/character/page.tsx calls")
	var input = body.get("input", null)
	t.check(typeof(input) == TYPE_DICTIONARY and input.is_empty(),
		"input is an empty dict — load_for_user takes no parameters, it reads the actor off ctx")
