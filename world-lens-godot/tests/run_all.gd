extends SceneTree
## run_all — headless test aggregator. Runs every pure-logic test suite and
## exits non-zero if any suite has a failing check.
##
## ENGINE-GATED: this has never actually been executed against a real Godot
## binary (the agent proxy blocks the headless engine download — see
## docs/GODOT_INTEGRATION.md). `gdparse`/`gdlint` confirm this is
## syntactically valid, loadable GDScript. Nothing more — see
## world-lens-godot/VISUAL_QA.md.
##
## Intended usage once a real engine is available:
##   godot --headless --path world-lens-godot --script res://tests/run_all.gd

const TestUtils := preload("res://tests/test_utils.gd")
const TestChunkManager := preload("res://tests/test_chunk_manager.gd")
const TestLodPolicy := preload("res://tests/test_lod_policy.gd")
const TestPropInstancer := preload("res://tests/test_prop_instancer.gd")
const TestCharacterController := preload("res://tests/test_character_controller.gd")
const TestDtuPropRenderer := preload("res://tests/test_dtu_prop_renderer.gd")
const TestDtuPropInteraction := preload("res://tests/test_dtu_prop_interaction.gd")
const TestAnimationStateMachine := preload("res://tests/test_animation_state_machine.gd")
const TestGaitSolver := preload("res://tests/test_gait_solver.gd")
const TestFlightController := preload("res://tests/test_flight_controller.gd")
const TestGroundVehicleController := preload("res://tests/test_ground_vehicle_controller.gd")
const TestMountController := preload("res://tests/test_mount_controller.gd")
const TestAerialMountController := preload("res://tests/test_aerial_mount_controller.gd")
const TestDesignCommandClient := preload("res://tests/test_design_command_client.gd")
const TestLandAirTransitionController := preload(
	"res://tests/test_land_air_transition_controller.gd")
const TestSceneBootstrap := preload("res://tests/test_scene_bootstrap.gd")
const TestAerialTrafficController := preload("res://tests/test_aerial_traffic_controller.gd")
const TestAirLegibility := preload("res://tests/test_air_legibility.gd")


func _init() -> void:
	var suites: Dictionary = {
		"ChunkManager": TestChunkManager.run(),
		"LodPolicy": TestLodPolicy.run(),
		"PropInstancer": TestPropInstancer.run(),
		"CharacterController": TestCharacterController.run(),
		"DtuPropRenderer": TestDtuPropRenderer.run(),
		"DtuPropInteraction": TestDtuPropInteraction.run(),
		"AnimationStateMachine": TestAnimationStateMachine.run(),
		"GaitSolver": TestGaitSolver.run(),
		"FlightController": TestFlightController.run(),
		"GroundVehicleController": TestGroundVehicleController.run(),
		"MountController": TestMountController.run(),
		"AerialMountController": TestAerialMountController.run(),
		"DesignCommandClient": TestDesignCommandClient.run(),
		"LandAirTransitionController": TestLandAirTransitionController.run(),
		"SceneBootstrap": TestSceneBootstrap.run(),
		"AerialTrafficController": TestAerialTrafficController.run(),
		"AirLegibility": TestAirLegibility.run(),
	}

	var all_ok := true
	for suite_name in suites.keys():
		var result: TestUtils = suites[suite_name]
		print(result.summary(suite_name))
		if not result.ok():
			all_ok = false

	quit(0 if all_ok else 1)
