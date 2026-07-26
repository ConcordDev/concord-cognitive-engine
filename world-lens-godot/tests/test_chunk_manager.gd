class_name TestChunkManager
extends RefCounted
## Pure-logic tests for world/chunk_manager.gd's coordinate math.
##
## ENGINE-EXECUTED (2026-07-25). The prior "never run against a real engine,
## gdparse only confirms valid syntax" caveat is superseded: a real Godot 4.4
## headless binary now lives at `./.godot-runtime/bin/godot` (see
## docs/GODOT_RUNTIME.md), and `--script tests/run_all.gd` compiles and RUNS
## this suite — its 16 checks are asserted on every run.
##
## What that does and does not buy: `world_to_chunk`/`chunk_load_set`/
## `diff_chunk_sets` are an integer-grid transform plus a set diff with no
## visual output of their own, so those ARE now genuinely verified. The
## engine-touching half of chunk_manager.gd — `ResourceLoader.
## load_threaded_request`/`get_status`/`get` and the actual scene
## instancing — is not exercised here, and whether streaming at these radii
## reads without pop-in is a display-time question. Headless installs
## RasterizerDummy and draws nothing, so that stays queued in
## world-lens-godot/VISUAL_QA.md.

const ChunkManager := preload("res://world/chunk_manager.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()

	# world_to_chunk: floor-division into CHUNK_SIZE (100m) cells.
	t.check_eq(
		ChunkManager.world_to_chunk(Vector3(0, 0, 0)), Vector2i(0, 0),
		"origin maps to chunk (0,0)")
	t.check_eq(
		ChunkManager.world_to_chunk(Vector3(150, 0, 250)), Vector2i(1, 2),
		"positive coords floor-divide by 100")
	t.check_eq(
		ChunkManager.world_to_chunk(Vector3(-50, 0, -150)), Vector2i(-1, -2),
		"negative coords floor toward -inf, matching the server's Math.floor")
	t.check_eq(
		ChunkManager.world_to_chunk(Vector3(99.9, 0, 0)), Vector2i(0, 0),
		"just under a chunk edge stays in the same chunk")
	t.check_eq(
		ChunkManager.world_to_chunk(Vector3(100.0, 0, 0)), Vector2i(1, 0),
		"exactly on the edge rolls to the next chunk")

	# chunk_load_set: radius-0 is just the center; radius-1 is a 3x3 ring.
	var r0 := ChunkManager.chunk_load_set(Vector2i(5, 5), 0)
	t.check_eq(r0.size(), 1, "radius 0 yields exactly the center chunk")
	t.check(r0.has(Vector2i(5, 5)), "radius 0 set contains the center")

	var r1 := ChunkManager.chunk_load_set(Vector2i(0, 0), 1)
	t.check_eq(r1.size(), 9, "radius 1 yields a 3x3 = 9 chunk ring")
	t.check(
		r1.has(Vector2i(-1, -1)) and r1.has(Vector2i(1, 1)),
		"radius 1 ring includes both far corners")

	var r_neg := ChunkManager.chunk_load_set(Vector2i(0, 0), -1)
	t.check_eq(r_neg.size(), 0, "negative radius yields an empty set, not a crash")

	# diff_chunk_sets: load newly-desired, unload no-longer-desired.
	var current: Array = [Vector2i(0, 0), Vector2i(1, 0)]
	var desired: Array = [Vector2i(1, 0), Vector2i(2, 0)]
	var diff := ChunkManager.diff_chunk_sets(current, desired)
	var to_load: Array = diff["to_load"]
	var to_unload: Array = diff["to_unload"]
	t.check_eq(to_load.size(), 1, "diff loads exactly the newly-desired chunk")
	t.check(to_load.has(Vector2i(2, 0)), "diff wants to load (2,0)")
	t.check_eq(to_unload.size(), 1, "diff unloads exactly the no-longer-desired chunk")
	t.check(to_unload.has(Vector2i(0, 0)), "diff wants to unload (0,0)")

	var diff_same := ChunkManager.diff_chunk_sets(desired, desired)
	var same_load: Array = diff_same["to_load"]
	var same_unload: Array = diff_same["to_unload"]
	t.check_eq(same_load.size(), 0, "an unchanged desired set loads nothing")
	t.check_eq(same_unload.size(), 0, "an unchanged desired set unloads nothing")

	return t
