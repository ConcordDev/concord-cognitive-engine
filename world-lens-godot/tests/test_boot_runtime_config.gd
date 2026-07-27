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
}


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_empty_env_keeps_all_defaults(t)
	_test_overrides_only_the_set_vars(t)
	_test_blank_env_value_does_not_override(t)
	_test_all_four_overridden(t)
	return t


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
