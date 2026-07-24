class_name SessionManager
extends Node
## SessionManager — R5/E24 "unified session/camera manager": the single
## source of truth for "what mode is the Godot client currently in,"
## replacing the ad-hoc scattered-boolean approach each of this session's
## four client "modes" would otherwise invent independently: World play
## (world/boot.gd), Game Design Lens editing/playtest
## (design/design_command_client.gd + design/design_playtest_client.gd,
## D17-D21), FEA/engineering visualization
## (engineering/fea_scene_builder.gd, R5/E23), and ConKay spatial presence
## (conkay/conkay_presence.gd, R5/E22).
##
## This file does not reimplement any of those four modes' own protocol
## surfaces (see docs/GODOT_INTEGRATION.md + docs/GODOT_PROTOCOL.md §11-13
## for what each already does for real) — it only decides which one
## currently owns the shared camera + movement input, and brokers the ONE
## real server-tracked state transition that already exists
## (design ⇄ playtest, via an injected DesignPlaytestClient's real
## `design:mode` ack/nack round trip).
##
## ── Why three Mode states, not four ─────────────────────────────────────────
## Reading each mode's actual protocol surface (docs/GODOT_PROTOCOL.md) shows
## they are NOT symmetric — treating all four as equal peers in one state
## machine would be dishonest about what the server actually tracks:
##
##   - World and Design/Playtest are real, MUTUALLY EXCLUSIVE gameplay
##     substrates — only one can own the avatar's movement + the world
##     camera at a time, and Design<->Playtest is a real server-tracked
##     transition (`design:mode` ack/nack — see design_playtest_client.gd).
##     These become this file's `Mode` enum: WORLD, DESIGN_EDIT, PLAYTEST.
##
##   - FEA-viz (fea_scene_builder.gd) has NO session concept server-side at
##     all: `engineering.feaScene` is a stateless REST fetch, not a
##     design_command-style mode toggle — that file's own header explains
##     exactly why it deliberately bypasses `design_command` (the dispatch
##     is hardcoded to the `game-design` domain; extending it for one
##     visualization macro would be out of proportion). Modeling FEA-viz as
##     a fourth `Mode` would invent a state transition the server doesn't
##     have — nothing to ack/nack, nothing to roll back if "entering" it
##     fails other than the fetch itself failing. It is instead a MODAL
##     OVERLAY (`fea_overlay_active`): opening it grabs the camera/input the
##     same way a mode would, but closing it returns to whatever `Mode` was
##     already active — no mode-transition semantics at all. This is the
##     concrete answer to "does FEA-viz need to exit World mode": no, it
##     layers on top without ever changing `mode`.
##
##   - ConKay (conkay_presence.gd) is explicitly documented as an "always-on
##     overlay ... regardless of mode" (R5/E22's own header) — it never
##     competes for camera or input, so it is not part of this state machine
##     in any form (not a Mode, not an overlay that can be opened/closed).
##     `is_input_owner`/`current_input_owner` have no ConKay case because
##     ConKay never asks to be an input owner — see world/boot.gd, which
##     mounts ConKayPresence directly, entirely outside this manager.
##
## ── Legal Mode transitions ───────────────────────────────────────────────────
## WORLD <-> DESIGN_EDIT: local, client-side only. There is no wire message
##   for "enter design mode" itself — `design:mode` only recognizes
##   "playtest"/"design" (see DesignPlaytestClient.is_valid_mode), never
##   "world". Opening/closing the Game Design Lens is a lens switch the
##   client makes on its own, so this edge applies immediately and
##   optimistically the moment it's requested — nothing to ack/nack.
## DESIGN_EDIT <-> PLAYTEST: real, server-tracked. Brokered through an
##   injected DesignPlaytestClient exactly the way
##   avatar/land_air_transition_controller.gd brokers `player:mode`: apply
##   optimistically, wait for the real `design:mode:ack`/`:nack`, roll back
##   on rejection (see `request_mode`/`_on_playtest_rejected`).
## WORLD <-> PLAYTEST is ILLEGAL, directly. PLAYTEST only exists as a
##   compiled runtime view of a level under active design — leaving it
##   always returns to DESIGN_EDIT first, mirroring
##   DesignPlaytestClient.exit_playtest() itself (which sends
##   `design:mode="design"`, never `"world"`). A caller that wants World
##   from Playtest takes two real steps (exit playtest, then leave design) —
##   this file does not invent a shortcut edge the server has no concept of.
##
## ── FEA overlay legality ─────────────────────────────────────────────────────
## May open while `mode` is WORLD or DESIGN_EDIT — inspecting a structure
## while playing, or while designing a building, are both real, plausible
## callers of `engineering.feaScene` per that file's own "whatever Godot
## scene/UI holds a structure worth visualizing" framing. Refused during
## PLAYTEST — real-time play should not be interrupted by a modal structural
## viewer competing for the same camera/input.
##
## ── Input ownership: the real gate ───────────────────────────────────────────
## `current_input_owner()` / `is_input_owner()` are pure functions of
## (mode, fea_overlay_active). A movement controller
## (player/character_controller.gd, avatar/land_air_transition_controller.gd)
## calls `is_input_owner(InputOwner.CHARACTER)` at the very top of its own
## `_physics_process` and early-returns if false. This is the actual gate the
## task asks for — one centralized, pure, testable function every controller
## consults — not a scattered boolean/convention each one is trusted to
## remember on its own.
##
## STATUS: parse/lint validated only (gdparse + gdlint) — never opened in a
## real engine/renderer. See world-lens-godot/VISUAL_QA.md for exactly what
## is genuinely unverified (do transitions feel smooth, does input routing
## actually block correctly in a live running scene).

signal mode_changed(mode: int)
signal mode_transition_rejected(requested_mode: int, reason: String)
signal fea_overlay_opened()
signal fea_overlay_closed()
signal fea_overlay_rejected(reason: String)
signal input_owner_changed(owner: int)

enum Mode { WORLD, DESIGN_EDIT, PLAYTEST }
enum InputOwner { CHARACTER, FREE_FLY, ORBIT }

const CameraRig := preload("res://session/camera_rig.gd")

var mode: int = Mode.WORLD
var fea_overlay_active: bool = false

## Optional injected DesignPlaytestClient (design/design_playtest_client.gd)
## — required only for the one real server round trip in this state machine
## (DESIGN_EDIT<->PLAYTEST). Wired via `set_design_playtest_client` (a setter,
## not an `@export` NodePath) so a headless unit test can hand this a plain
## stub object satisfying the same signal contract — mirrors the project's
## existing DI convention (e.g. land_air_transition_controller.gd's
## `gateway` export accepting anything with the right shape).
var _design_playtest_client: Node = null

## Optional injected CameraRig — engine glue only; a SessionManager under
## pure-logic test never sets this and every method above still works.
var _camera_rig: Node = null

var _transition_pending: bool = false
var _pending_mode: int = Mode.WORLD


func set_design_playtest_client(client: Node) -> void:
	_design_playtest_client = client
	if client == null:
		return
	if client.has_signal("mode_entered"):
		client.mode_entered.connect(_on_playtest_entered)
	if client.has_signal("mode_exited"):
		client.mode_exited.connect(_on_playtest_exited)
	if client.has_signal("mode_rejected"):
		client.mode_rejected.connect(_on_playtest_rejected)


func set_camera_rig(rig: Node) -> void:
	_camera_rig = rig
	_push_camera_rig_mode()


## Request a transition to `target_mode`. Honest rejection (never a silent
## no-op) on: requesting the mode already active, an illegal edge, or a
## transition already in flight (no racing requests — mirrors
## LandAirTransitionController's own `_transition_pending` guard).
## `level_id` is only consulted entering PLAYTEST (forwarded to
## DesignPlaytestClient.enter_playtest verbatim).
func request_mode(target_mode: int, level_id: String = "") -> void:
	if target_mode == mode:
		mode_transition_rejected.emit(target_mode, "already_in_mode")
		return
	if not SessionManager.is_legal_mode_transition(mode, target_mode):
		mode_transition_rejected.emit(target_mode, "illegal_transition")
		return
	if _transition_pending:
		mode_transition_rejected.emit(target_mode, "transition_pending")
		return

	# WORLD<->DESIGN_EDIT is local-only — no server round trip exists for it.
	if mode == Mode.WORLD and target_mode == Mode.DESIGN_EDIT:
		_apply_mode(Mode.DESIGN_EDIT)
		return
	if mode == Mode.DESIGN_EDIT and target_mode == Mode.WORLD:
		_apply_mode(Mode.WORLD)
		return

	# The only remaining legal edges are DESIGN_EDIT<->PLAYTEST — real
	# server round trips brokered through the injected client.
	var required_method := "enter_playtest" if target_mode == Mode.PLAYTEST else "exit_playtest"
	if _design_playtest_client == null or not _design_playtest_client.has_method(required_method):
		mode_transition_rejected.emit(target_mode, "no_design_playtest_client")
		return

	_transition_pending = true
	_pending_mode = target_mode
	if target_mode == Mode.PLAYTEST:
		_design_playtest_client.enter_playtest(level_id)
	else:
		_design_playtest_client.exit_playtest()


func _on_playtest_entered(_level_id: String, _game_id: String, _scene: Dictionary) -> void:
	if not _transition_pending or _pending_mode != Mode.PLAYTEST:
		return
	_transition_pending = false
	_apply_mode(Mode.PLAYTEST)


func _on_playtest_exited(_level_id: String, _game_id: String) -> void:
	if not _transition_pending or _pending_mode != Mode.DESIGN_EDIT:
		return
	_transition_pending = false
	_apply_mode(Mode.DESIGN_EDIT)


func _on_playtest_rejected(_requested_mode: String, reason: String) -> void:
	if not _transition_pending:
		return
	var rejected_mode := _pending_mode
	_transition_pending = false
	# Visible, honest rejection — never keep the client believing a
	# transition it asked for is still pending, and never silently apply it
	# anyway. Mirrors LandAirTransitionController's own nack handling.
	mode_transition_rejected.emit(rejected_mode, reason)


func _apply_mode(new_mode: int) -> void:
	mode = new_mode
	mode_changed.emit(mode)
	_push_camera_rig_mode()
	input_owner_changed.emit(current_input_owner())


## Open the FEA overlay. Honest rejection (`fea_overlay_rejected`) rather
## than a silent no-op when illegal (during PLAYTEST) or already open.
func open_fea_overlay() -> bool:
	if fea_overlay_active:
		fea_overlay_rejected.emit("already_open")
		return false
	if not SessionManager.can_open_fea_overlay(mode):
		fea_overlay_rejected.emit("not_available_in_playtest")
		return false
	fea_overlay_active = true
	fea_overlay_opened.emit()
	_push_camera_rig_mode()
	input_owner_changed.emit(current_input_owner())
	return true


func close_fea_overlay() -> void:
	if not fea_overlay_active:
		return
	fea_overlay_active = false
	fea_overlay_closed.emit()
	_push_camera_rig_mode()
	input_owner_changed.emit(current_input_owner())


func current_input_owner() -> int:
	return SessionManager.input_owner_for(mode, fea_overlay_active)


## Convenience for a controller's own `_physics_process`/`_process` gate:
## `if not session_manager.is_input_owner(SessionManager.InputOwner.CHARACTER): return`.
func is_input_owner(candidate: int) -> bool:
	return current_input_owner() == candidate


func _push_camera_rig_mode() -> void:
	if _camera_rig != null and _camera_rig.has_method("set_rig_mode"):
		_camera_rig.set_rig_mode(SessionManager.camera_rig_mode_for(mode, fea_overlay_active))


# ── Pure static helpers (no engine calls) ────────────────────────────────────

## The full legal-transition table for `Mode`. See class doc's "Legal Mode
## transitions" section for the reasoning behind each edge (and each
## deliberate omission — WORLD<->PLAYTEST is never legal).
static func is_legal_mode_transition(from: int, to: int) -> bool:
	if from == to:
		return false
	if from == Mode.WORLD and to == Mode.DESIGN_EDIT:
		return true
	if from == Mode.DESIGN_EDIT and to == Mode.WORLD:
		return true
	if from == Mode.DESIGN_EDIT and to == Mode.PLAYTEST:
		return true
	if from == Mode.PLAYTEST and to == Mode.DESIGN_EDIT:
		return true
	return false


## FEA overlay may open from WORLD or DESIGN_EDIT, never PLAYTEST — see
## class doc's "FEA overlay legality" section.
static func can_open_fea_overlay(mode: int) -> bool:
	return mode != Mode.PLAYTEST


## Pure derivation of who owns the shared camera/movement input right now.
## The FEA overlay always wins when active (it is a modal viewer layered on
## top of whatever Mode is active) — otherwise DESIGN_EDIT is the one Mode
## with a free-fly authoring camera, and both WORLD and PLAYTEST play like
## ordinary third-person movement (PLAYTEST is, after all, actually playing
## the level being designed).
static func input_owner_for(mode: int, fea_overlay_active: bool) -> int:
	if fea_overlay_active:
		return InputOwner.ORBIT
	if mode == Mode.DESIGN_EDIT:
		return InputOwner.FREE_FLY
	return InputOwner.CHARACTER


## Pure derivation of which CameraRig.RigMode should be active — the single
## place that decides this, so CameraRig itself never has to guess from its
## own local state (see camera_rig.gd's class doc).
static func camera_rig_mode_for(mode: int, fea_overlay_active: bool) -> int:
	if fea_overlay_active:
		return CameraRig.RigMode.ORBIT
	if mode == Mode.DESIGN_EDIT:
		return CameraRig.RigMode.FREE_FLY
	return CameraRig.RigMode.FOLLOW
