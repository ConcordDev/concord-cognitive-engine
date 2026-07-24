class_name TestDesignPlaytestClient
extends RefCounted
## Pure-logic tests for design/design_playtest_client.gd's static helpers.
## ENGINE-GATED execution — see world-lens-godot/VISUAL_QA.md.

const DesignPlaytestClient := preload("res://design/design_playtest_client.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_build_mode_data(t)
	_test_is_valid_mode(t)
	return t


static func _test_build_mode_data(t: TestUtils) -> void:
	var envelope := DesignPlaytestClient.build_mode_data("playtest", "lvl_abc123")
	t.check_eq(envelope["mode"], "playtest", "mode is forwarded")
	t.check_eq(envelope["levelId"], "lvl_abc123", "levelId is forwarded")

	var exit_envelope := DesignPlaytestClient.build_mode_data("design")
	t.check_eq(exit_envelope["mode"], "design", "mode is forwarded (exit case)")
	t.check_eq(exit_envelope["levelId"], "", "levelId defaults to empty when omitted")


static func _test_is_valid_mode(t: TestUtils) -> void:
	t.check(DesignPlaytestClient.is_valid_mode("playtest"), "playtest is a valid mode")
	t.check(DesignPlaytestClient.is_valid_mode("design"), "design is a valid mode")
	t.check(not DesignPlaytestClient.is_valid_mode("play"), "an unrecognized mode string is invalid")
	t.check(not DesignPlaytestClient.is_valid_mode(""), "an empty mode string is invalid")
