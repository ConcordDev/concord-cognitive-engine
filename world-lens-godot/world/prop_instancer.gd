class_name PropInstancer
extends RefCounted
## PropInstancer — MultiMesh-based instancing helper for repeated DTU props
## (trees, stalls, rocks, etc. spawned from server-authored placement data).
##
## Transform-list assembly (`build_transforms`) is PURE STATIC — given a
## list of `{position, rotationY, scale}` dictionaries it returns an
## `Array[Transform3D]` using only value types (Vector3/Basis/Transform3D
## work fine with no live scene tree), so it is unit-testable in isolation.
## Only `build_multimesh`/`build_instance` actually touch a MultiMesh /
## MultiMeshInstance3D resource.
##
## Honest handling: a malformed entry never fabricates a plausible-looking
## transform out of nothing — missing fields fall back to the identity
## transform (origin zero, no rotation, unit scale), which is visibly
## "nothing was specified" rather than an invented position.

## `entries`: Array of Dictionary —
##   "position": Vector3 or [x, y, z] (default Vector3.ZERO)
##   "rotationY": float radians (default 0.0)
##   "scale": float, Vector3, or [x, y, z] (default 1.0 / Vector3.ONE)
## Non-Dictionary entries are skipped, not crashed on.
static func build_transforms(entries: Array) -> Array[Transform3D]:
	var out: Array[Transform3D] = []
	for entry in entries:
		if typeof(entry) != TYPE_DICTIONARY:
			continue
		out.append(PropInstancer._transform_for_entry(entry))
	return out


static func _transform_for_entry(entry: Dictionary) -> Transform3D:
	var pos := PropInstancer._vec3_from(entry.get("position", Vector3.ZERO))
	var rot_y: float = entry.get("rotationY", 0.0)
	var scale := PropInstancer._scale_from(entry.get("scale", 1.0))
	var basis := Basis().rotated(Vector3.UP, rot_y).scaled(scale)
	return Transform3D(basis, pos)


static func _vec3_from(v) -> Vector3:
	if typeof(v) == TYPE_VECTOR3:
		return v
	if typeof(v) == TYPE_ARRAY and v.size() >= 3:
		return Vector3(float(v[0]), float(v[1]), float(v[2]))
	return Vector3.ZERO


static func _scale_from(v) -> Vector3:
	if typeof(v) == TYPE_VECTOR3:
		return v
	if typeof(v) == TYPE_ARRAY and v.size() >= 3:
		return Vector3(float(v[0]), float(v[1]), float(v[2]))
	if typeof(v) == TYPE_FLOAT or typeof(v) == TYPE_INT:
		var s: float = v
		return Vector3(s, s, s)
	return Vector3.ONE


## Build a MultiMesh from a mesh + a list of transforms. Per-instance
## color/custom-data is intentionally left off — props don't need per-
## instance tint yet; add it here if/when a caller needs it.
static func build_multimesh(mesh: Mesh, transforms: Array[Transform3D]) -> MultiMesh:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = mesh
	mm.instance_count = transforms.size()
	for i in range(transforms.size()):
		mm.set_instance_transform(i, transforms[i])
	return mm


## Convenience: raw placement entries -> a ready-to-mount MultiMeshInstance3D.
static func build_instance(mesh: Mesh, entries: Array) -> MultiMeshInstance3D:
	var transforms := PropInstancer.build_transforms(entries)
	var node := MultiMeshInstance3D.new()
	node.multimesh = PropInstancer.build_multimesh(mesh, transforms)
	return node
