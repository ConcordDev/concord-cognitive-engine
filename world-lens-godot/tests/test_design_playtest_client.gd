class_name TestDesignPlaytestClient
extends RefCounted
## Pure-logic tests for design/design_playtest_client.gd's static helpers.
##
## ENGINE-EXECUTED (2026-07-25). A real Godot 4.4 headless binary now lives
## at `./.godot-runtime/bin/godot` (see docs/GODOT_RUNTIME.md), and
## `--script tests/run_all.gd` compiles and RUNS this suite — its 8 checks
## are asserted on every run.
##
## Verified: `build_mode_data`'s frame shape and `is_valid_mode`'s accept/
## reject set — the pure half of the design⇄playtest toggle.
##
## NOT verified, and as with its sibling test_design_command_client.gd the
## gap here is protocol rather than pixels: no frame has ever been sent over
## a real GatewayClient to a running server, so the `design:mode:ack` /
## `design:mode:nack` round trip — including the claim that a nack is
## forwarded verbatim instead of being reinterpreted as success — is still
## unexercised end to end. Belongs with the engine-gated protocol items in
## world-lens-godot/VISUAL_QA.md.

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
