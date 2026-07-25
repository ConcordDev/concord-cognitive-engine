class_name TestPropInstancer
extends RefCounted
## Pure-logic tests for world/prop_instancer.gd's transform assembly.
##
## ENGINE-EXECUTED (2026-07-25) — and this suite gained more from that than
## most. It exercises Transform3D/Vector3/Basis value-type math, and the
## header used to argue from first principles that such math "is usable in
## GDScript without a running scene tree" while admitting it had never
## actually been run by a real `godot` binary. It now has: a real Godot 4.4
## headless binary lives at `./.godot-runtime/bin/godot` (see
## docs/GODOT_RUNTIME.md) and `--script tests/run_all.gd` compiles and RUNS
## these 8 checks. So the expected transforms are no longer hand-derived
## values checked against a reasoned model of Godot's semantics — they are
## asserted against the ENGINE'S OWN Transform3D/Basis implementation.
##
## NOT verified: `build_multimesh`/`build_instance`, which touch real
## MultiMesh / MultiMeshInstance3D resources, are outside this suite; and
## nothing here says anything about how instanced props actually LOOK or
## perform at real prop counts. Headless installs RasterizerDummy and draws
## nothing — that stays queued in world-lens-godot/VISUAL_QA.md.

const PropInstancer := preload("res://world/prop_instancer.gd")
const TestUtils := preload("res://tests/test_utils.gd")


static func run() -> TestUtils:
	var t := TestUtils.new()

	var entries: Array = [
		{"position": Vector3(1, 2, 3), "rotationY": 0.0, "scale": 1.0},
		{"position": [4, 0, 5], "rotationY": PI, "scale": Vector3(2, 2, 2)},
		{},  # missing everything — must fall back honestly, never fabricate.
	]
	var transforms := PropInstancer.build_transforms(entries)
	t.check_eq(transforms.size(), 3, "build_transforms returns one Transform3D per entry")

	var t0: Transform3D = transforms[0]
	t.check(
		t0.origin.is_equal_approx(Vector3(1, 2, 3)),
		"entry 0 origin matches its Vector3 position")

	var t1: Transform3D = transforms[1]
	t.check(
		t1.origin.is_equal_approx(Vector3(4, 0, 5)),
		"entry 1 origin accepts an [x,y,z] array position")
	t.check(
		t1.basis.get_scale().is_equal_approx(Vector3(2, 2, 2)),
		"entry 1 basis carries the uniform Vector3 scale")

	var t2: Transform3D = transforms[2]
	t.check(
		t2.origin.is_equal_approx(Vector3.ZERO),
		"a missing position defaults to origin, not a fabricated value")
	t.check(
		t2.basis.get_scale().is_equal_approx(Vector3.ONE),
		"a missing scale defaults to identity (1,1,1)")

	# Non-dictionary entries in the list are skipped, not crashed on.
	var mixed := PropInstancer.build_transforms([{"position": Vector3.ZERO}, "not_a_dict", 42])
	t.check_eq(mixed.size(), 1, "non-dictionary entries are skipped rather than raising")

	# Scalar scale broadcasts uniformly.
	var scalar_scale_entries: Array = [{"position": Vector3.ZERO, "scale": 3.0}]
	var scalar_transforms := PropInstancer.build_transforms(scalar_scale_entries)
	var scalar_t: Transform3D = scalar_transforms[0]
	t.check(
		scalar_t.basis.get_scale().is_equal_approx(Vector3(3, 3, 3)),
		"a scalar scale broadcasts to all three axes")

	return t
