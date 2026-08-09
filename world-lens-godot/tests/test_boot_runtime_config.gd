class_name TestBootRuntimeConfig
extends RefCounted
## Pure-logic tests for boot.gd's resolve_runtime_config — the env-var
## override that makes a non-interactive launch (bare-metal boot script,
## CI) actually configurable, instead of only ever changeable via the
## editor inspector's @export defaults.

const Boot := preload("res://world/boot.gd")
const TestUtils := preload("res://tests/test_utils.gd")

const DEFAULTS := {
	"gateway_url": "ws://127.0.0.1:5050/godot-ws",
	"api_key": "",
	"auth_token": "",
	"world_id": "concordia-hub",
	"spectator_mode": false,
}


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_empty_env_keeps_all_defaults(t)
	_test_overrides_only_the_set_vars(t)
	_test_blank_env_value_does_not_override(t)
	_test_all_four_overridden(t)
	_test_spectator_true_enables_spectator_mode(t)
	_test_spectator_one_enables_spectator_mode(t)
	_test_spectator_unset_leaves_default_false(t)
	_test_spectator_typo_does_not_enable(t)
	_test_parse_key_value_args_basic(t)
	_test_parse_key_value_args_value_can_contain_more_equals_signs(t)
	_test_parse_key_value_args_empty_array_yields_empty(t)
	_test_parse_key_value_args_bare_flag_yields_blank_value(t)
	_test_parse_key_value_args_skips_empty_entries(t)
	_test_parse_key_value_args_feeds_resolve_runtime_config_directly(t)
	_test_is_web_build_false_under_the_headless_test_runner(t)
	return t


static func _test_parse_key_value_args_basic(t: TestUtils) -> void:
	var parsed := Boot.parse_key_value_args(PackedStringArray(["CONCORD_WORLD_ID=tunya", "CONCORD_GODOT_SPECTATOR=1"]))
	t.check_eq(parsed, {"CONCORD_WORLD_ID": "tunya", "CONCORD_GODOT_SPECTATOR": "1"}, "basic KEY=VALUE entries parse")


static func _test_parse_key_value_args_value_can_contain_more_equals_signs(t: TestUtils) -> void:
	# A JWT never contains '=' mid-token in practice, but a gateway URL with
	# a query string could -- only the FIRST '=' is the key/value split.
	var parsed := Boot.parse_key_value_args(PackedStringArray(["CONCORD_GATEWAY_URL=ws://host/godot-ws?a=b"]))
	t.check_eq(parsed["CONCORD_GATEWAY_URL"], "ws://host/godot-ws?a=b", "only the first '=' splits key from value")


static func _test_parse_key_value_args_empty_array_yields_empty(t: TestUtils) -> void:
	t.check_eq(Boot.parse_key_value_args(PackedStringArray()), {}, "empty args array -> empty dict")


static func _test_parse_key_value_args_bare_flag_yields_blank_value(t: TestUtils) -> void:
	var parsed := Boot.parse_key_value_args(PackedStringArray(["CONCORD_GODOT_SPECTATOR"]))
	t.check_eq(parsed, {"CONCORD_GODOT_SPECTATOR": ""}, "an entry with no '=' yields an empty-string value")


static func _test_parse_key_value_args_skips_empty_entries(t: TestUtils) -> void:
	var parsed := Boot.parse_key_value_args(PackedStringArray(["", "CONCORD_WORLD_ID=tunya", ""]))
	t.check_eq(parsed, {"CONCORD_WORLD_ID": "tunya"}, "stray empty array entries never produce empty-key entries")


static func _test_parse_key_value_args_feeds_resolve_runtime_config_directly(t: TestUtils) -> void:
	# The whole point of matching the env-var key names: cmdline args can be
	# handed straight to resolve_runtime_config with zero translation.
	var args := PackedStringArray(["CONCORD_WORLD_ID=tunya", "CONCORD_GODOT_AUTH_TOKEN=jwt.abc"])
	var resolved := Boot.resolve_runtime_config(Boot.parse_key_value_args(args), DEFAULTS)
	t.check_eq(resolved["world_id"], "tunya", "cmdline-arg world_id reaches resolve_runtime_config")
	t.check_eq(resolved["auth_token"], "jwt.abc", "cmdline-arg auth_token reaches resolve_runtime_config")
	t.check_eq(resolved["gateway_url"], DEFAULTS["gateway_url"], "unset gateway_url stays default")


static func _test_is_web_build_false_under_the_headless_test_runner(t: TestUtils) -> void:
	# A real, honest assertion, not a placeholder: this suite runs under
	# `godot --headless`, which reports a native OS name (Linux/etc.), never
	# "Web" -- so is_web_build() must be false here. If this ever starts
	# returning true under the headless runner, is_web_build()'s detection
	# itself is broken.
	t.check(not Boot.is_web_build(), "is_web_build() is false under the headless native test runner")


static func _test_empty_env_keeps_all_defaults(t: TestUtils) -> void:
	var resolved := Boot.resolve_runtime_config({}, DEFAULTS)
	t.check_eq(resolved, DEFAULTS, "no env vars set -> defaults untouched")


static func _test_overrides_only_the_set_vars(t: TestUtils) -> void:
	var env := {"CONCORD_GODOT_API_KEY": "sk_live_abc"}
	var resolved := Boot.resolve_runtime_config(env, DEFAULTS)
	t.check_eq(resolved["api_key"], "sk_live_abc", "api_key overridden")
	t.check_eq(resolved["gateway_url"], DEFAULTS["gateway_url"], "gateway_url left at default")
	t.check_eq(resolved["auth_token"], DEFAULTS["auth_token"], "auth_token left at default")
	t.check_eq(resolved["world_id"], DEFAULTS["world_id"], "world_id left at default")


static func _test_blank_env_value_does_not_override(t: TestUtils) -> void:
	# A present-but-empty-string env var (common when a shell exports an
	# unset variable as "") must not clobber a real editor-set default.
	var env := {"CONCORD_WORLD_ID": ""}
	var resolved := Boot.resolve_runtime_config(env, DEFAULTS)
	t.check_eq(resolved["world_id"], "concordia-hub", "blank env value does not override default")


static func _test_all_four_overridden(t: TestUtils) -> void:
	var env := {
		"CONCORD_GATEWAY_URL": "wss://godot.concord-os.org/godot-ws",
		"CONCORD_GODOT_API_KEY": "sk_live_xyz",
		"CONCORD_GODOT_AUTH_TOKEN": "jwt.should.be.unused",
		"CONCORD_WORLD_ID": "tunya",
	}
	var resolved := Boot.resolve_runtime_config(env, DEFAULTS)
	t.check_eq(resolved["gateway_url"], "wss://godot.concord-os.org/godot-ws", "gateway_url overridden")
	t.check_eq(resolved["api_key"], "sk_live_xyz", "api_key overridden")
	t.check_eq(resolved["auth_token"], "jwt.should.be.unused", "auth_token overridden")
	t.check_eq(resolved["world_id"], "tunya", "world_id overridden")


static func _test_spectator_true_enables_spectator_mode(t: TestUtils) -> void:
	var env := {"CONCORD_GODOT_SPECTATOR": "true"}
	var resolved := Boot.resolve_runtime_config(env, DEFAULTS)
	t.check_eq(resolved["spectator_mode"], true, "\"true\" enables spectator_mode")


static func _test_spectator_one_enables_spectator_mode(t: TestUtils) -> void:
	var env := {"CONCORD_GODOT_SPECTATOR": "1"}
	var resolved := Boot.resolve_runtime_config(env, DEFAULTS)
	t.check_eq(resolved["spectator_mode"], true, "\"1\" also enables spectator_mode")


static func _test_spectator_unset_leaves_default_false(t: TestUtils) -> void:
	var resolved := Boot.resolve_runtime_config({}, DEFAULTS)
	t.check_eq(resolved["spectator_mode"], false, "unset env leaves spectator_mode at its default")


static func _test_spectator_typo_does_not_enable(t: TestUtils) -> void:
	# Only the exact literals "true"/"1" opt in — this is an honest-default
	# choice (see resolve_runtime_config's own comment), not a truthiness
	# guess, so a typo like "yes" or "TRUE" must NOT silently enable it.
	var env := {"CONCORD_GODOT_SPECTATOR": "yes"}
	var resolved := Boot.resolve_runtime_config(env, DEFAULTS)
	t.check_eq(resolved["spectator_mode"], false, "an unrecognised value never enables spectator_mode")
