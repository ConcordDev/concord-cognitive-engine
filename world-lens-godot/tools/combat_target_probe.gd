extends SceneTree
## combat_target_probe.gd — real-engine verification for Combat Phase C: does
## a REAL AvatarManager-tracked remote avatar actually get selected as a
## target by a REAL CharacterController's per-frame nearest-target query,
## does the E-attack path dispatch a real `combat:attack` gateway event with
## the expected minimal payload, and does a simulated `combat:hit`/
## `combat:impact` round trip actually mutate OBSERVABLE state — a HUD-facing
## target-health signal, and a real CharacterBody3D velocity knockback
## impulse on the local player? This exercises the real AvatarManager/
## AvatarRig spawn + snapshot-interpolation path and the real
## CharacterController combat methods together — not mocks of either (only
## the gateway transport itself is a stub, since a live WebSocket round trip
## needs a running server — see FakeGatewayStub's own doc comment).
##
## Headless is sufficient here — this probe makes no rendering/visual claim,
## only real object-state mutation:
##   .godot-runtime/bin/godot --headless --path world-lens-godot \
##     --script res://tools/combat_target_probe.gd

const AvatarManager := preload("res://avatar/avatar_manager.gd")
const CharacterController := preload("res://player/character_controller.gd")
const FakeGatewayStub := preload("res://tools/fake_gateway_stub.gd")

var _avatar_manager: AvatarManager
var _character: CharacterController
var _gateway: FakeGatewayStub
var _frame := 0
var _captured := false
var _results := {}


func _initialize() -> void:
	_avatar_manager = AvatarManager.new()
	get_root().add_child(_avatar_manager)
	# A real remote NPC, 2m away on +X — within CharacterController's
	# ATTACK_RANGE_M (3.0). ingest_snapshot's own SnapshotBuffer.sample()
	# holds the oldest frame when `now - RENDER_DELAY_MS` predates it (see
	# net/snapshot_buffer.gd), so this is visible to AvatarManager's very
	# next `_process` tick — no artificial wait for interpolation to "catch up".
	_avatar_manager.ingest_snapshot(Time.get_ticks_msec(), {
		"target-npc": {"x": 2.0, "y": 0.0, "z": 0.0, "direction": 0.0},
	}, "npc")

	_gateway = FakeGatewayStub.new()
	get_root().add_child(_gateway)

	_character = CharacterController.new()
	_character.avatar_manager = _avatar_manager
	_character.gateway = _gateway
	_character.local_user_id = "local-user"
	var shape := CollisionShape3D.new()
	var capsule := CapsuleShape3D.new()
	capsule.radius = 0.35
	capsule.height = 1.8
	shape.shape = capsule
	_character.add_child(shape)
	get_root().add_child(_character)


func _process(_delta: float) -> bool:
	_frame += 1
	# A handful of physics ticks so AvatarManager's `_process` (spawns +
	# positions the real AvatarRig from the ingested snapshot) and
	# CharacterController's `_physics_process` (runs `_update_target()`) have
	# both genuinely executed at least once — not a fabricated instant result.
	if _frame < 10:
		return false

	if not _captured:
		_captured = true

		_results["target_selected"] = _character.get_current_target_id()

		_character._try_attack()
		_results["attack_dispatched"] = _gateway.sent.size() > 0
		if _gateway.sent.size() > 0:
			var last: Dictionary = _gateway.sent[_gateway.sent.size() - 1]
			_results["attack_evt"] = last["evt"]
			_results["attack_payload"] = last["data"]

		# Combat C6 — parry/dodge are untargeted (fire regardless of
		# _current_target_id) and kick is targeted (same discipline as attack,
		# reusing combat:attack as its transport). Real dispatch through the
		# same FakeGatewayStub, not a mocked method call.
		_gateway.sent.clear()
		_character._try_parry()
		_results["parry_dispatched"] = _gateway.sent.size() > 0
		if _gateway.sent.size() > 0:
			_results["parry_evt"] = _gateway.sent[0]["evt"]
			_results["parry_payload"] = _gateway.sent[0]["data"]

		_gateway.sent.clear()
		_character._try_dodge()
		_results["dodge_dispatched"] = _gateway.sent.size() > 0
		if _gateway.sent.size() > 0:
			_results["dodge_evt"] = _gateway.sent[0]["evt"]
			_results["dodge_payload"] = _gateway.sent[0]["data"]

		_gateway.sent.clear()
		_character._try_kick()
		_results["kick_dispatched"] = _gateway.sent.size() > 0
		if _gateway.sent.size() > 0:
			_results["kick_evt"] = _gateway.sent[0]["evt"]
			_results["kick_payload"] = _gateway.sent[0]["data"]

		var captured_health := {}
		_character.target_health_updated.connect(func(target_id: String, health: float, max_health: float) -> void:
			captured_health["target_id"] = target_id
			captured_health["health"] = health
			captured_health["max_health"] = max_health
		)
		_character._on_gateway_event("combat:hit", {
			"targetId": "target-npc", "damage": 12.0,
			"targetHealth": 88.0, "targetMaxHealth": 100.0,
		})
		_results["hit_health_captured"] = captured_health

		var velocity_before: Vector3 = _character.velocity
		_character._on_gateway_event("combat:impact", {
			"targetId": "local-user",
			"attackerPosition": {"x": 5.0, "y": 0.0, "z": 0.0},
			"feel": {"knockback": 6.0, "targetPauseMs": 150, "knockMs": 220, "wince": "heavy"},
		})
		var velocity_after: Vector3 = _character.velocity
		_results["velocity_before"] = [velocity_before.x, velocity_before.y, velocity_before.z]
		_results["velocity_after"] = [velocity_after.x, velocity_after.y, velocity_after.z]
		_results["knockback_applied"] = not velocity_after.is_equal_approx(velocity_before)

	if _frame < 12:
		return false

	_results["ok"] = true
	print("[combat_target_probe] RESULT ", JSON.stringify(_results))
	return true
