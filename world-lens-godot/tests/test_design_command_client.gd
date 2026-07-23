class_name TestDesignCommandClient
extends RefCounted
## Pure-logic tests for design/design_command_client.gd's static helpers.
## ENGINE-GATED execution — see world-lens-godot/VISUAL_QA.md.

const DesignCommandClient := preload("res://design/design_command_client.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_build_command_data(t)
	_test_is_success(t)
	return t


static func _test_build_command_data(t: TestUtils) -> void:
	var envelope := DesignCommandClient.build_command_data(
		"entity-add", {"gameId": "g1", "name": "Slime"})
	t.check_eq(envelope["action"], "entity-add", "action is forwarded")
	t.check_eq(envelope["params"]["gameId"], "g1", "params are forwarded verbatim")
	t.check_eq(envelope["params"]["name"], "Slime", "params are forwarded verbatim (2nd field)")

	var default_params := DesignCommandClient.build_command_data("game-create")
	t.check(
		default_params["params"].is_empty(),
		"params default to an empty dict when omitted")


static func _test_is_success(t: TestUtils) -> void:
	t.check(
		DesignCommandClient.is_success({"ok": true, "action": "game-create"}),
		"ok:true is a success")
	t.check(
		not DesignCommandClient.is_success({"ok": false, "error": "unknown_macro"}),
		"ok:false is not a success")
	t.check(
		not DesignCommandClient.is_success({"action": "level-create"}),
		"a missing ok field defaults to failure, never a fabricated success")
	t.check(
		not DesignCommandClient.is_success({}),
		"an empty dict is a failure")
