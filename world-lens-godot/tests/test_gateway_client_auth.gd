class_name TestGatewayClientAuth
extends RefCounted
## Pure-logic tests for GatewayClient.build_auth_payload — the dual
## token/apiKey auth path added for the bare-metal one-command boot
## (scripts/launch-godot-client.sh). Mirrors server/lib/godot-gateway.js
## #tryAuth's accepted field names exactly (`token` / `apiKey`).

const GatewayClient := preload("res://net/gateway_client.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_prefers_api_key_when_both_set(t)
	_test_api_key_only(t)
	_test_token_only(t)
	_test_neither_set_sends_empty_token(t)
	return t


static func _test_prefers_api_key_when_both_set(t: TestUtils) -> void:
	var payload := GatewayClient.build_auth_payload("key123", "token456")
	t.check(payload.has("apiKey"), "prefers apiKey field when both configured")
	t.check(not payload.has("token"), "does not also send token when apiKey is used")
	t.check_eq(payload.get("apiKey"), "key123", "apiKey value passed through")


static func _test_api_key_only(t: TestUtils) -> void:
	var payload := GatewayClient.build_auth_payload("key123", "")
	t.check_eq(payload, {"apiKey": "key123"}, "api_key-only payload shape")


static func _test_token_only(t: TestUtils) -> void:
	var payload := GatewayClient.build_auth_payload("", "token456")
	t.check_eq(payload, {"token": "token456"}, "token-only payload shape")


static func _test_neither_set_sends_empty_token(t: TestUtils) -> void:
	# Honest failure, not a fabricated success: an unconfigured client sends
	# an empty token, which the server rejects as invalid_token — it must
	# never silently omit the auth frame or invent a value.
	var payload := GatewayClient.build_auth_payload("", "")
	t.check_eq(payload, {"token": ""}, "empty-credential payload stays honestly empty")
