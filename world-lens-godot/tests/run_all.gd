extends SceneTree
## run_all — headless test aggregator. Runs every pure-logic test suite and
## exits non-zero if any suite has a failing check.
##
## EXECUTED AGAINST A REAL ENGINE (2026-07-25). The prior "never executed,
## gdparse/gdlint only" caveat is superseded: a real Godot 4.4 headless
## binary now lives at `./.godot-runtime/bin/godot` (fetch/verify via
## `node scripts/fetch-godot.mjs`; see docs/GODOT_RUNTIME.md).
##
## Usage:
##   ./.godot-runtime/bin/godot --headless --path world-lens-godot \
##       --script tests/run_all.gd
##
## Lint is NOT a substitute for this: `gdlint` green-lights code the engine
## cannot even run. The first real execution of this suite immediately found
## four defects lint had passed — a silently-fabricated district palette
## (honesty-invariant violation), two wrong hand-computed test expectations,
## and a defensive branch made unreachable by a static type annotation.
##
## Scope: pure-logic assertions only. Rendered/visual behaviour remains
## unverified — see world-lens-godot/VISUAL_QA.md.

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
const TestDesignPlaytestClient := preload("res://tests/test_design_playtest_client.gd")
const TestLandAirTransitionController := preload(
	"res://tests/test_land_air_transition_controller.gd")
const TestSceneBootstrap := preload("res://tests/test_scene_bootstrap.gd")
const TestBuildingArchetype := preload("res://tests/test_building_archetype.gd")
const TestAssetResolver := preload("res://tests/test_asset_resolver.gd")
const TestGlbLoader := preload("res://tests/test_glb_loader.gd")
const TestAerialTrafficController := preload("res://tests/test_aerial_traffic_controller.gd")
const TestAirLegibility := preload("res://tests/test_air_legibility.gd")
const TestFeaSceneBuilder := preload("res://tests/test_fea_scene_builder.gd")
const TestConKayPresenceState := preload("res://tests/test_conkay_presence_state.gd")
const TestConKayPointing := preload("res://tests/test_conkay_pointing.gd")
const TestSessionManager := preload("res://tests/test_session_manager.gd")
const TestCameraRig := preload("res://tests/test_camera_rig.gd")
const TestDistrictStreamingPolicy := preload("res://tests/test_district_streaming_policy.gd")
const TestRooftopAccessController := preload("res://tests/test_rooftop_access_controller.gd")
const TestWayfindingMarkers := preload("res://tests/test_wayfinding_markers.gd")
const TestArtStyle := preload("res://tests/test_art_style.gd")
const TestGatewayClientAuth := preload("res://tests/test_gateway_client_auth.gd")
const TestBootRuntimeConfig := preload("res://tests/test_boot_runtime_config.gd")
const TestGatewayClientSeq := preload("res://tests/test_gateway_client_seq.gd")
const TestBootResync := preload("res://tests/test_boot_resync.gd")
const TestAvatarManager := preload("res://tests/test_avatar_manager.gd")
const TestNpcPoller := preload("res://tests/test_npc_poller.gd")
const TestCreaturePoller := preload("res://tests/test_creature_poller.gd")
const TestCreatureRig := preload("res://tests/test_creature_rig.gd")
const TestVegetationRenderer := preload("res://tests/test_vegetation_renderer.gd")
const TestQuestBreadcrumb := preload("res://tests/test_quest_breadcrumb.gd")
const TestQuestPoller := preload("res://tests/test_quest_poller.gd")
const TestQuestAvailablePoller := preload("res://tests/test_quest_available_poller.gd")
const TestQuestActions := preload("res://tests/test_quest_actions.gd")
const TestSfxSynth := preload("res://tests/test_sfx_synth.gd")
const TestLockOnState := preload("res://tests/test_lock_on_state.gd")
const TestAppearanceArchetype := preload("res://tests/test_appearance_archetype.gd")
const TestPlayerAppearanceLoader := preload("res://tests/test_player_appearance_loader.gd")


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
		"DesignPlaytestClient": TestDesignPlaytestClient.run(),
		"LandAirTransitionController": TestLandAirTransitionController.run(),
		"SceneBootstrap": TestSceneBootstrap.run(),
		"BuildingArchetype": TestBuildingArchetype.run(),
		"AssetResolver": TestAssetResolver.run(),
		"GlbLoader": TestGlbLoader.run(),
		"AerialTrafficController": TestAerialTrafficController.run(),
		"AirLegibility": TestAirLegibility.run(),
		"FeaSceneBuilder": TestFeaSceneBuilder.run(),
		"ConKayPresenceState": TestConKayPresenceState.run(),
		"ConKayPointing": TestConKayPointing.run(),
		"SessionManager": TestSessionManager.run(),
		"CameraRig": TestCameraRig.run(),
		"DistrictStreamingPolicy": TestDistrictStreamingPolicy.run(),
		"RooftopAccessController": TestRooftopAccessController.run(),
		"WayfindingMarkers": TestWayfindingMarkers.run(),
		"ArtStyle": TestArtStyle.run(),
		"GatewayClientAuth": TestGatewayClientAuth.run(),
		"BootRuntimeConfig": TestBootRuntimeConfig.run(),
		"GatewayClientSeq": TestGatewayClientSeq.run(),
		"BootResync": TestBootResync.run(),
		"AvatarManager": TestAvatarManager.run(),
		"NpcPoller": TestNpcPoller.run(),
		"CreaturePoller": TestCreaturePoller.run(),
		"CreatureRig": TestCreatureRig.run(),
		"VegetationRenderer": TestVegetationRenderer.run(),
		"QuestBreadcrumb": TestQuestBreadcrumb.run(),
		"QuestPoller": TestQuestPoller.run(),
		"QuestAvailablePoller": TestQuestAvailablePoller.run(),
		"QuestActions": TestQuestActions.run(),
		"SfxSynth": TestSfxSynth.run(),
		"LockOnState": TestLockOnState.run(),
		"AppearanceArchetype": TestAppearanceArchetype.run(),
		"PlayerAppearanceLoader": TestPlayerAppearanceLoader.run(),
	}

	var all_ok := true
	for suite_name in suites.keys():
		var result: TestUtils = suites[suite_name]
		print(result.summary(suite_name))
		if not result.ok():
			all_ok = false

	quit(0 if all_ok else 1)
