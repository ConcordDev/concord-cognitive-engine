class_name TestSessionManager
extends RefCounted
## Pure-logic tests for session/session_manager.gd — R5/E24 "unified
## session/camera manager".
##
## ENGINE-EXECUTED (2026-07-25). A real Godot 4.4 headless binary now lives
## at `./.godot-runtime/bin/godot` (see docs/GODOT_RUNTIME.md), and
## `--script tests/run_all.gd` compiles and RUNS this suite — its 21 checks
## are asserted on every run.
##
## Covers, and now genuinely executes: the Mode legal-transition table (every
## legal edge, and every deliberately-illegal one — especially
## WORLD<->PLAYTEST, which must never be legal directly), FEA-overlay
## legality per mode, and the pure input-owner / camera-rig-mode derivation
## functions. These are a pure state machine with no visual output of their
## own, so that half is verified in full rather than merely compiled.
##
## Still NOT exercised: the engine-level ack/nack broker (`request_mode`'s
## DesignPlaytestClient round trip), which needs a live Node signal graph and
## a running server. Nor does anything here confirm that a mode switch looks
## clean on screen — headless installs RasterizerDummy and draws nothing.
## Both remain in world-lens-godot/VISUAL_QA.md's engine-gated section.

const SessionManager := preload("res://session/session_manager.gd")
const CameraRig := preload("res://session/camera_rig.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_world_design_edit_is_bidirectional_and_local(t)
	_test_design_edit_playtest_is_bidirectional(t)
	_test_world_playtest_direct_transition_is_illegal(t)
	_test_no_mode_transitions_to_itself(t)
	_test_can_open_fea_overlay_gating(t)
	_test_input_owner_derivation(t)
	_test_camera_rig_mode_derivation(t)
	return t


static func _test_world_design_edit_is_bidirectional_and_local(t: TestUtils) -> void:
	t.check(
		SessionManager.is_legal_mode_transition(
			SessionManager.Mode.WORLD, SessionManager.Mode.DESIGN_EDIT),
		"WORLD -> DESIGN_EDIT is legal (opening the Game Design Lens)")
	t.check(
		SessionManager.is_legal_mode_transition(
			SessionManager.Mode.DESIGN_EDIT, SessionManager.Mode.WORLD),
		"DESIGN_EDIT -> WORLD is legal (closing the Game Design Lens)")


static func _test_design_edit_playtest_is_bidirectional(t: TestUtils) -> void:
	t.check(
		SessionManager.is_legal_mode_transition(
			SessionManager.Mode.DESIGN_EDIT, SessionManager.Mode.PLAYTEST),
		"DESIGN_EDIT -> PLAYTEST is legal (enter_playtest)")
	t.check(
		SessionManager.is_legal_mode_transition(
			SessionManager.Mode.PLAYTEST, SessionManager.Mode.DESIGN_EDIT),
		"PLAYTEST -> DESIGN_EDIT is legal (exit_playtest)")


static func _test_world_playtest_direct_transition_is_illegal(t: TestUtils) -> void:
	t.check(
		not SessionManager.is_legal_mode_transition(
			SessionManager.Mode.WORLD, SessionManager.Mode.PLAYTEST),
		"WORLD -> PLAYTEST is ILLEGAL directly — playtest only exists under active design")
	t.check(
		not SessionManager.is_legal_mode_transition(
			SessionManager.Mode.PLAYTEST, SessionManager.Mode.WORLD),
		"PLAYTEST -> WORLD is ILLEGAL directly — must exit to DESIGN_EDIT first")


static func _test_no_mode_transitions_to_itself(t: TestUtils) -> void:
	t.check(
		not SessionManager.is_legal_mode_transition(SessionManager.Mode.WORLD, SessionManager.Mode.WORLD),
		"a mode never legally transitions to itself (WORLD)")
	t.check(
		not SessionManager.is_legal_mode_transition(
			SessionManager.Mode.DESIGN_EDIT, SessionManager.Mode.DESIGN_EDIT),
		"a mode never legally transitions to itself (DESIGN_EDIT)")
	t.check(
		not SessionManager.is_legal_mode_transition(
			SessionManager.Mode.PLAYTEST, SessionManager.Mode.PLAYTEST),
		"a mode never legally transitions to itself (PLAYTEST)")


static func _test_can_open_fea_overlay_gating(t: TestUtils) -> void:
	t.check(
		SessionManager.can_open_fea_overlay(SessionManager.Mode.WORLD),
		"FEA overlay may open while in WORLD")
	t.check(
		SessionManager.can_open_fea_overlay(SessionManager.Mode.DESIGN_EDIT),
		"FEA overlay may open while in DESIGN_EDIT")
	t.check(
		not SessionManager.can_open_fea_overlay(SessionManager.Mode.PLAYTEST),
		"FEA overlay refuses to open during PLAYTEST — real-time play owns the camera/input")


static func _test_input_owner_derivation(t: TestUtils) -> void:
	t.check_eq(
		SessionManager.input_owner_for(SessionManager.Mode.WORLD, false),
		SessionManager.InputOwner.CHARACTER,
		"WORLD with no overlay -> CHARACTER owns input")
	t.check_eq(
		SessionManager.input_owner_for(SessionManager.Mode.PLAYTEST, false),
		SessionManager.InputOwner.CHARACTER,
		"PLAYTEST with no overlay -> CHARACTER owns input (playtest is actually playing)")
	t.check_eq(
		SessionManager.input_owner_for(SessionManager.Mode.DESIGN_EDIT, false),
		SessionManager.InputOwner.FREE_FLY,
		"DESIGN_EDIT with no overlay -> FREE_FLY owns input")
	t.check_eq(
		SessionManager.input_owner_for(SessionManager.Mode.WORLD, true),
		SessionManager.InputOwner.ORBIT,
		"the FEA overlay always wins input ownership over WORLD when active")
	t.check_eq(
		SessionManager.input_owner_for(SessionManager.Mode.DESIGN_EDIT, true),
		SessionManager.InputOwner.ORBIT,
		"the FEA overlay always wins input ownership over DESIGN_EDIT when active")


static func _test_camera_rig_mode_derivation(t: TestUtils) -> void:
	t.check_eq(
		SessionManager.camera_rig_mode_for(SessionManager.Mode.WORLD, false),
		CameraRig.RigMode.FOLLOW,
		"WORLD with no overlay -> FOLLOW rig")
	t.check_eq(
		SessionManager.camera_rig_mode_for(SessionManager.Mode.PLAYTEST, false),
		CameraRig.RigMode.FOLLOW,
		"PLAYTEST with no overlay -> FOLLOW rig (same as WORLD — both are playing)")
	t.check_eq(
		SessionManager.camera_rig_mode_for(SessionManager.Mode.DESIGN_EDIT, false),
		CameraRig.RigMode.FREE_FLY,
		"DESIGN_EDIT with no overlay -> FREE_FLY rig")
	t.check_eq(
		SessionManager.camera_rig_mode_for(SessionManager.Mode.PLAYTEST, true),
		CameraRig.RigMode.ORBIT,
		"the FEA overlay always wins the rig mode when active, regardless of underlying mode")
