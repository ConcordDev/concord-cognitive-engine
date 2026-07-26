extends SceneTree
## visual_probe.gd — the engine half of the visual-QA harness.
##
## Driven by `scripts/visual-qa.mjs`. Reads a job JSON (path in the
## CONCORD_VQA_JOB env var), renders each requested shot into the real
## framebuffer, and writes one PNG per shot plus a `result.json` describing
## what happened. It NEVER writes a PNG it did not actually capture, and it
## records `ok:false` + a reason for any shot it could not render — a missing
## file downstream is an honest failure, never a silently-skipped pass.
##
## Must be run against a real rasterizer:
##   xvfb-run -a -s "-screen 0 1280x720x24" godot \
##     --display-driver x11 --rendering-driver opengl3 \
##     --path world-lens-godot --script res://tools/visual_probe.gd
## `--headless` installs RasterizerDummy and draws nothing at all.
##
## FAULT INJECTION: a shot may carry `fault: "<name>"`. This exists so the
## harness's own assertions can be PROVEN capable of failing (an assertion that
## cannot fail proves nothing). Faults are never set by a normal run — only by
## `visual-qa.mjs --fault=<name>`.
##   no-camera        — render with no Camera3D at all
##   flat-saturation  — ignore the world's saturation dial (pass 1.0 always)
##   no-toon          — replace the banded cel material with a smooth one
##   empty-scene      — spawn no geometry

const ArtStyle := preload("res://world/art_style.gd")
const SceneBootstrap := preload("res://world/scene_bootstrap.gd")

var _job: Dictionary = {}
var _shots: Array = []
var _out_dir := ""
var _settle_frames := 10

var _shot_i := 0
var _frame := 0
var _results: Array = []
var _holder: Node3D = null


func _initialize() -> void:
	var job_path := OS.get_environment("CONCORD_VQA_JOB")
	if job_path == "":
		_die("CONCORD_VQA_JOB not set")
		return
	if not FileAccess.file_exists(job_path):
		_die("job file not found: %s" % job_path)
		return
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(job_path))
	if typeof(parsed) != TYPE_DICTIONARY:
		_die("job file is not a JSON object")
		return
	_job = parsed
	_out_dir = String(_job.get("outDir", ""))
	_settle_frames = int(_job.get("settleFrames", 10))
	_shots = _job.get("shots", [])
	if _out_dir == "" or _shots.is_empty():
		_die("job needs outDir + a non-empty shots array")
		return

	print("[vqa] driver=", DisplayServer.get_name())
	print("[vqa] adapter=", RenderingServer.get_video_adapter_name())
	print("[vqa] shots=", _shots.size(), " settle_frames=", _settle_frames)
	_build_shot(0)


func _process(_delta: float) -> bool:
	_frame += 1
	if _frame < _settle_frames:
		return false
	_capture(_shot_i)
	_shot_i += 1
	if _shot_i >= _shots.size():
		_write_results()
		return true
	_frame = 0
	_build_shot(_shot_i)
	return false


# ── Capture ─────────────────────────────────────────────────────────────────


func _capture(i: int) -> void:
	var shot: Dictionary = _shots[i]
	var name := String(shot.get("name", "shot_%d" % i))
	var tex := get_root().get_texture()
	if tex == null:
		_results.append({"name": name, "ok": false, "reason": "no_viewport_texture"})
		return
	var img := tex.get_image()
	if img == null or img.is_empty():
		_results.append({"name": name, "ok": false, "reason": "empty_image"})
		return
	var path := "%s/%s.png" % [_out_dir, name]
	var err := img.save_png(path)
	if err != OK:
		_results.append({"name": name, "ok": false, "reason": "save_png_error_%d" % err})
		return
	_results.append({
		"name": name,
		"ok": true,
		"width": img.get_width(),
		"height": img.get_height(),
		"path": path,
		"kind": String(shot.get("kind", "")),
		"worldId": String(shot.get("worldId", "")),
		"expect": shot.get("expect", {}),
	})
	print("[vqa] captured ", name, " ", img.get_width(), "x", img.get_height())


func _write_results() -> void:
	var payload := {
		"ok": true,
		"adapter": RenderingServer.get_video_adapter_name(),
		"driver": DisplayServer.get_name(),
		"godot": Engine.get_version_info(),
		"shots": _results,
	}
	var f := FileAccess.open("%s/result.json" % _out_dir, FileAccess.WRITE)
	if f == null:
		push_error("[vqa] cannot write result.json")
		return
	f.store_string(JSON.stringify(payload, "  "))
	f.close()


func _die(reason: String) -> void:
	push_error("[vqa] %s" % reason)
	print("[vqa] FATAL ", reason)
	quit(2)


# ── Shot construction ───────────────────────────────────────────────────────


func _build_shot(i: int) -> void:
	if _holder != null and is_instance_valid(_holder):
		_holder.queue_free()
		get_root().remove_child(_holder)
	_holder = Node3D.new()
	_holder.name = "VqaShot"
	get_root().add_child(_holder)

	var shot: Dictionary = _shots[i]
	var kind := String(shot.get("kind", ""))
	var fault := String(shot.get("fault", ""))
	match kind:
		"art_world":
			_build_art_world(shot, fault)
		"saturation_dial":
			_build_saturation_dial(shot, fault)
		"scene_bootstrap":
			_build_scene_bootstrap(shot, fault)
		"scene_transform":
			_build_scene_transform(shot, fault)
		_:
			push_error("[vqa] unknown shot kind: %s" % kind)


func _add_camera(
	pos: Vector3,
	look_at: Vector3,
	fault: String,
	ortho_size: float = 0.0,
	up: Vector3 = Vector3.UP
) -> void:
	if fault == "no-camera":
		return
	var cam := Camera3D.new()
	cam.position = pos
	if ortho_size > 0.0:
		cam.projection = Camera3D.PROJECTION_ORTHOGONAL
		cam.size = ortho_size
	_holder.add_child(cam)
	cam.look_at(look_at, up)
	cam.make_current()


func _neutral_env(bg: Color) -> void:
	var we := WorldEnvironment.new()
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = bg
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(1, 1, 1)
	env.ambient_light_energy = 0.25
	env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	we.environment = env
	_holder.add_child(we)


func _plain_material(c: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	return m


## Shot A — the full per-world look: that world's sky/sun/ambient, its own
## toonGradient, its own saturation dial. Fixed geometry across all worlds
## (3 buildings + 1 sphere + ground) so the ONLY difference between two
## worlds' frames is the palette + dial, which is exactly what the art guide
## says must be the only difference.
func _build_art_world(shot: Dictionary, fault: String) -> void:
	var world_id := String(shot.get("worldId", "concordia-hub"))

	var env := ArtStyle.make_environment(world_id)
	if env != null:
		var we := WorldEnvironment.new()
		we.environment = env
		_holder.add_child(we)

	var sun := ArtStyle.make_sun(world_id)
	if sun != null:
		sun.rotation_degrees = Vector3(-42.0, -35.0, 0.0)
		_holder.add_child(sun)

	var mat: Material
	if fault == "no-toon":
		# A smooth (unbanded) lit material — the ramp assertion MUST fail here.
		var sm := StandardMaterial3D.new()
		var grad := ArtStyle.toon_gradient(world_id)
		sm.albedo_color = grad[1] if grad.size() > 1 else Color(0.5, 0.5, 0.5)
		mat = sm
	elif fault == "flat-saturation":
		var grad := ArtStyle.toon_gradient(world_id)
		mat = ArtStyle.make_toon_material_from(grad[0], grad[1], grad[2], 1.0)
	else:
		mat = ArtStyle.make_toon_material(world_id)

	if mat == null:
		push_error("[vqa] no material for world %s (missing art_style.json?)" % world_id)
		return

	if fault != "empty-scene":
		# Ground.
		var ground := MeshInstance3D.new()
		var pm := PlaneMesh.new()
		pm.size = Vector2(60, 60)
		ground.mesh = pm
		ground.material_override = mat
		_holder.add_child(ground)

		# Three separated buildings — distinct connected regions in the frame.
		var xs := [-6.0, 0.0, 6.0]
		var hs := [3.0, 5.0, 2.0]
		for j in xs.size():
			var b := MeshInstance3D.new()
			var bm := BoxMesh.new()
			bm.size = Vector3(3.0, hs[j], 3.0)
			b.mesh = bm
			b.material_override = mat
			b.position = Vector3(xs[j], hs[j] / 2.0, -4.0)
			_holder.add_child(b)

		# A sphere — a curved surface is what makes ramp banding measurable
		# (a flat face has one normal and therefore one band).
		var sph := MeshInstance3D.new()
		var sm2 := SphereMesh.new()
		sm2.radius = 2.0
		sm2.height = 4.0
		sph.mesh = sm2
		sph.material_override = mat
		sph.position = Vector3(0.0, 2.0, 5.0)
		_holder.add_child(sph)

	_add_camera(Vector3(0.0, 6.0, 16.0), Vector3(0.0, 2.0, 0.0), fault)


## Shot B — isolates the SATURATION DIAL from palette confounds. Every world
## renders the SAME fixed reference palette; the only input that varies is
## `saturation_for_world(world_id)`. Mean chroma across these frames must
## therefore be monotonic in WORLD_SATURATION. Under a fixed neutral
## background + fixed geometry there is nothing else it could be tracking.
## `saturationOverride` pins the dial to a fixed value — used by the `ramp_probe`
## shot, where the RAMP_BANDS measurement must not be confounded by the dial
## (lowering saturation compresses the gradient stops' luminance separation, so
## a noir world's three bands can genuinely read as two plateaus; RAMP_BANDS is
## a GLOBAL rule, so it is measured once, at a fixed dial, not per world).
func _build_saturation_dial(shot: Dictionary, fault: String) -> void:
	var world_id := String(shot.get("worldId", "concordia-hub"))
	var sat := 1.0 if fault == "flat-saturation" else ArtStyle.saturation_for_world(world_id)
	if shot.has("saturationOverride"):
		sat = float(shot["saturationOverride"])

	_neutral_env(Color(0.12, 0.12, 0.12))
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-45.0, -30.0, 0.0)
	sun.light_energy = 1.0
	_holder.add_child(sun)

	# Fixed mid-saturation reference stops (s ~= 0.55 in HSV) — deliberately not
	# any world's palette, and with headroom both ways so a 1.35x dial does not
	# clamp at 1.0 and a 0.62x dial does not bottom out.
	var refs := [
		[Color(0.62, 0.28, 0.28), Color(0.78, 0.42, 0.35), Color(0.90, 0.62, 0.50)],
		[Color(0.28, 0.55, 0.36), Color(0.38, 0.72, 0.46), Color(0.55, 0.88, 0.62)],
		[Color(0.28, 0.36, 0.62), Color(0.36, 0.48, 0.80), Color(0.52, 0.66, 0.92)],
	]
	for j in refs.size():
		var stops: Array = refs[j]
		var mat: Material
		if fault == "no-toon":
			# A smooth lambert material with no ramp quantisation at all — this
			# is what "the cel shader silently no-opped" looks like, and the
			# ramp-banding assertion MUST fail on it or it is worthless.
			var sm3 := StandardMaterial3D.new()
			sm3.albedo_color = ArtStyle.apply_saturation(stops[1], sat)
			mat = sm3
		else:
			mat = ArtStyle.make_toon_material_from(stops[0], stops[1], stops[2], sat)
		var sph := MeshInstance3D.new()
		var sm := SphereMesh.new()
		sm.radius = 2.2
		sm.height = 4.4
		sph.mesh = sm
		sph.material_override = mat
		sph.position = Vector3(-5.5 + 5.5 * float(j), 0.0, 0.0)
		_holder.add_child(sph)

	_add_camera(Vector3(0.0, 0.0, 12.0), Vector3(0.0, 0.0, 0.0), fault)


## Shot C — the REAL client path: `world/scene_bootstrap.gd#apply_scene` fed a
## `concord-scene/v1` payload, rendered. This is the file that actually spawns
## the client's placeholder building geometry; nothing about the scene is
## constructed by this harness.
func _build_scene_bootstrap(shot: Dictionary, fault: String) -> void:
	_neutral_env(Color(0.05, 0.05, 0.08))
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50.0, -30.0, 0.0)
	_holder.add_child(sun)

	var bootstrap := SceneBootstrap.new()
	_holder.add_child(bootstrap)
	var payload = shot.get("payload", {})
	if typeof(payload) == TYPE_DICTIONARY and fault != "empty-scene":
		bootstrap.apply_scene(payload)

	var cam_pos: Array = shot.get("cameraPos", [0.0, 14.0, 34.0])
	_add_camera(
		Vector3(float(cam_pos[0]), float(cam_pos[1]), float(cam_pos[2])),
		Vector3.ZERO,
		fault
	)


## Shot D — top-down ORTHOGRAPHIC view of SceneBootstrap output. An orthographic
## top view turns `scale = [w,h,d]` and `rotationY` into a directly measurable
## pixel footprint: a 8x1x2 box reads wide, the same box at rotationY = PI/2
## reads deep. That makes Y-up parity / axis-flip a pixel fact, not an opinion.
func _build_scene_transform(shot: Dictionary, fault: String) -> void:
	_neutral_env(Color(0.0, 0.0, 0.0))
	var light := DirectionalLight3D.new()
	light.rotation_degrees = Vector3(-90.0, 0.0, 0.0)
	light.light_energy = 2.0
	_holder.add_child(light)

	var bootstrap := SceneBootstrap.new()
	_holder.add_child(bootstrap)
	var payload = shot.get("payload", {})
	if typeof(payload) == TYPE_DICTIONARY and fault != "empty-scene":
		bootstrap.apply_scene(payload)
	# Flat white so the footprint silhouette is unambiguous against black.
	for child in bootstrap.get_children():
		if child is MeshInstance3D:
			child.material_override = _plain_material(Color(1, 1, 1))

	# Straight down: `up` must NOT be Vector3.UP (degenerate look_at basis).
	# With up = -Z, screen +x is world +x and screen -y is world -z, so a pixel
	# footprint maps to the world footprint with no ambiguity.
	var size := float(shot.get("orthoSize", 40.0))
	_add_camera(
		Vector3(0.0, 40.0, 0.0), Vector3(0.0, 0.0, 0.0), fault, size, Vector3(0.0, 0.0, -1.0)
	)
