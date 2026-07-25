class_name TestConKayPointing
extends RefCounted
## Pure-logic tests for conkay/conkay_pointing.gd (R5/E22 — "point at
## buildings/props" geometry).
##
## ENGINE-EXECUTED (2026-07-25). A real Godot 4.4 headless binary now lives
## at `./.godot-runtime/bin/godot` (see docs/GODOT_RUNTIME.md), and
## `--script tests/run_all.gd` compiles and RUNS this suite — its 20 checks
## are asserted on every run.
##
## Verified: `direction_to`, `distance_to`, `yaw_pitch_to` and
## `look_at_basis` produce correct geometry, now checked against the engine's
## own Vector3/Basis implementations rather than a reasoned model of them.
##
## NOT verified: that a viewer can TELL what ConKay is pointing at. This unit
## exists to make attention direction legible, and legibility is a
## display-time judgement — headless installs RasterizerDummy and draws
## nothing, and no pointer/arrow mesh has ever been rotated by this basis on
## screen. Queued in world-lens-godot/VISUAL_QA.md.

const ConKayPointing := preload("res://conkay/conkay_pointing.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()
	_test_direction_to_normalizes(t)
	_test_direction_to_degenerate_case(t)
	_test_distance_to(t)
	_test_yaw_pitch_forward_is_zero(t)
	_test_yaw_pitch_known_directions(t)
	_test_yaw_pitch_straight_up(t)
	_test_look_at_basis_is_orthonormal(t)
	_test_look_at_basis_faces_target(t)
	_test_look_at_basis_handles_up_parallel_singularity(t)
	return t


static func _test_direction_to_normalizes(t: TestUtils) -> void:
	var d := ConKayPointing.direction_to(Vector3.ZERO, Vector3(3.0, 0.0, 0.0))
	t.check_almost(d.length(), 1.0, "direction_to always returns a unit vector")
	t.check_eq(d, Vector3(1.0, 0.0, 0.0), "direction_to points from `from` toward `target`")


static func _test_direction_to_degenerate_case(t: TestUtils) -> void:
	var d := ConKayPointing.direction_to(Vector3(5.0, 1.0, -2.0), Vector3(5.0, 1.0, -2.0))
	t.check_eq(d, Vector3.FORWARD, "from == target degrades to an honest FORWARD default, never NaN")


static func _test_distance_to(t: TestUtils) -> void:
	var dist := ConKayPointing.distance_to(Vector3.ZERO, Vector3(3.0, 4.0, 0.0))
	t.check_almost(dist, 5.0, "distance_to is real Euclidean distance (3-4-5 triangle)")


static func _test_yaw_pitch_forward_is_zero(t: TestUtils) -> void:
	var yp := ConKayPointing.yaw_pitch_to(Vector3.ZERO, Vector3(0.0, 0.0, -1.0))
	t.check_almost(float(yp["yaw"]), 0.0, "facing already-forward (-Z) needs zero yaw")
	t.check_almost(float(yp["pitch"]), 0.0, "facing already-forward needs zero pitch")


static func _test_yaw_pitch_known_directions(t: TestUtils) -> void:
	# +X target: rotating yaw by -PI/2 turns the node's forward (-Z) toward +X.
	var yp_right := ConKayPointing.yaw_pitch_to(Vector3.ZERO, Vector3(1.0, 0.0, 0.0))
	t.check_almost(float(yp_right["yaw"]), -PI / 2.0, "target directly to +X needs yaw -PI/2")

	# -X target: yaw +PI/2.
	var yp_left := ConKayPointing.yaw_pitch_to(Vector3.ZERO, Vector3(-1.0, 0.0, 0.0))
	t.check_almost(float(yp_left["yaw"]), PI / 2.0, "target directly to -X needs yaw +PI/2")

	# Directly behind (+Z): yaw wraps to +-PI (either sign is a valid 180 turn).
	var yp_behind := ConKayPointing.yaw_pitch_to(Vector3.ZERO, Vector3(0.0, 0.0, 1.0))
	t.check_almost(absf(float(yp_behind["yaw"])), PI, "target directly behind needs a +-PI yaw")


static func _test_yaw_pitch_straight_up(t: TestUtils) -> void:
	var yp := ConKayPointing.yaw_pitch_to(Vector3.ZERO, Vector3(0.0, 1.0, 0.0))
	t.check_almost(float(yp["pitch"]), PI / 2.0, "target straight up needs +PI/2 pitch (looking up)")


static func _test_look_at_basis_is_orthonormal(t: TestUtils) -> void:
	var b := ConKayPointing.look_at_basis(Vector3.ZERO, Vector3(4.0, 2.0, -3.0))
	t.check_almost(b.x.length(), 1.0, "basis.x is unit length")
	t.check_almost(b.y.length(), 1.0, "basis.y is unit length")
	t.check_almost(b.z.length(), 1.0, "basis.z is unit length")
	t.check_almost(b.x.dot(b.y), 0.0, "basis.x and basis.y are orthogonal")
	t.check_almost(b.y.dot(b.z), 0.0, "basis.y and basis.z are orthogonal")
	t.check_almost(b.x.dot(b.z), 0.0, "basis.x and basis.z are orthogonal")


static func _test_look_at_basis_faces_target(t: TestUtils) -> void:
	var from := Vector3(1.0, 0.0, 1.0)
	var target := Vector3(5.0, 3.0, -2.0)
	var b := ConKayPointing.look_at_basis(from, target)
	var expected_dir := ConKayPointing.direction_to(from, target)
	# Godot's Basis.looking_at convention: the basis's own -Z axis points
	# toward the look target, so -b.z should align with the real direction.
	t.check_almost(
		(-b.z).dot(expected_dir), 1.0,
		"the basis's forward (-Z) axis aligns with the real direction to target")


static func _test_look_at_basis_handles_up_parallel_singularity(t: TestUtils) -> void:
	# Target straight up from `from`, using the default UP reference — the
	# exact degenerate case Basis.looking_at() cannot resolve on its own.
	var b := ConKayPointing.look_at_basis(Vector3.ZERO, Vector3(0.0, 5.0, 0.0))
	t.check_almost(b.x.length(), 1.0, "still a valid unit basis.x despite the up-parallel singularity")
	t.check_almost(b.x.dot(b.y), 0.0, "still orthogonal despite the singularity fallback")
	var expected_dir := Vector3.UP
	t.check_almost(
		(-b.z).dot(expected_dir), 1.0,
		"still genuinely faces straight up after the fallback")
