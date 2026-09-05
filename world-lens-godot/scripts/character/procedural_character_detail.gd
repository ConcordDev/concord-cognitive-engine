class_name ProceduralCharacterDetail
extends Node3D
##
## ProceduralCharacterDetail — adds real visual detail to the procedural player mesh.
##

const ARCHETYPE_DETAIL = {
	"tunya": {
		"skin_tone": Color(0.78, 0.62, 0.45, 1.0),
		"skin_detail": "freckles_dense",
		"hair_color": Color(0.36, 0.24, 0.15, 1.0),
		"hair_style": "long_braided",
		"eye_color": Color(0.55, 0.4, 0.2, 1.0),
		"cloth_top": Color(0.55, 0.45, 0.30, 1.0),
		"cloth_bottom": Color(0.42, 0.36, 0.27, 1.0),
		"boots": Color(0.30, 0.22, 0.15, 1.0),
		"tattoos": ["prairie_lattice_left_arm", "sun_disc_back"],
		"accessories": ["ranger_belt", "lasso_loop"],
	},
	"sovereign": {
		"skin_tone": Color(0.85, 0.78, 0.70, 1.0),
		"skin_detail": "scar_left_cheek",
		"hair_color": Color(0.08, 0.06, 0.05, 1.0),
		"hair_style": "swept_back",
		"eye_color": Color(0.20, 0.25, 0.35, 1.0),
		"cloth_top": Color(0.18, 0.18, 0.22, 1.0),
		"cloth_bottom": Color(0.12, 0.12, 0.16, 1.0),
		"boots": Color(0.06, 0.06, 0.08, 1.0),
		"tattoos": ["refusal_glyph_chest", "void_mark_neck"],
		"accessories": ["refusal_field_emitter", "hood"],
	},
	"concordia": {
		"skin_tone": Color(0.82, 0.68, 0.55, 1.0),
		"skin_detail": "copper_freckles",
		"hair_color": Color(0.45, 0.28, 0.15, 1.0),
		"hair_style": "long_wavy",
		"eye_color": Color(0.45, 0.30, 0.18, 1.0),
		"cloth_top": Color(0.65, 0.40, 0.20, 1.0),
		"cloth_bottom": Color(0.45, 0.30, 0.18, 1.0),
		"boots": Color(0.40, 0.27, 0.16, 1.0),
		"tattoos": ["copper_lattice_arms", "sun_disc_wrist"],
		"accessories": ["witness_pin", "satchel"],
	},
	"concord": {
		"skin_tone": Color(0.88, 0.80, 0.72, 1.0),
		"skin_detail": "ink_stains_fingers",
		"hair_color": Color(0.20, 0.18, 0.16, 1.0),
		"hair_style": "short_neat",
		"eye_color": Color(0.30, 0.32, 0.38, 1.0),
		"cloth_top": Color(0.35, 0.38, 0.42, 1.0),
		"cloth_bottom": Color(0.25, 0.27, 0.32, 1.0),
		"boots": Color(0.18, 0.18, 0.20, 1.0),
		"tattoos": ["code_glyph_forearm", "ledger_mark_hand"],
		"accessories": ["stylus_holster", "ledger_clutch"],
	},
}

@export var archetype: String = "average"
@export var player_mesh_path: NodePath

var _tattoo_lines: Array = []
var _pulse_time: float = 0.0


func _ready() -> void:
	_apply_detail()


func _apply_detail() -> void:
	if not has_node(player_mesh_path):
		return
	var player = get_node(player_mesh_path)
	var cfg = ARCHETYPE_DETAIL.get(archetype, {})
	if cfg.is_empty():
		return
	_apply_colors(player, cfg)
	_add_tattoos(player, cfg.get("tattoos", []))
	_add_accessories(player, cfg.get("accessories", []))


func _apply_colors(player: Node, cfg: Dictionary) -> void:
	for child in player.get_children():
		if not child is MeshInstance3D:
			continue
		var n = child.name.to_lower()
		var mat: StandardMaterial3D = child.material_override if child.material_override else null
		if not mat:
			mat = StandardMaterial3D.new()
			child.material_override = mat
		if "skin" in n or "head" in n:
			mat.albedo_color = cfg.get("skin_tone", Color.WHITE)
			mat.roughness = 0.65
		elif "hair" in n:
			mat.albedo_color = cfg.get("hair_color", Color.BLACK)
			mat.roughness = 0.75
		elif "top" in n or "torso" in n or "shirt" in n:
			mat.albedo_color = cfg.get("cloth_top", Color.GRAY)
			mat.roughness = 0.85
		elif "bottom" in n or "leg" in n or "pants" in n:
			mat.albedo_color = cfg.get("cloth_bottom", Color.DARK_GRAY)
			mat.roughness = 0.85
		elif "boot" in n or "foot" in n:
			mat.albedo_color = cfg.get("boots", Color.BLACK)
			mat.roughness = 0.80


func _add_tattoos(player: Node, tattoo_ids: Array) -> void:
	for tid in tattoo_ids:
		var spec: Dictionary = TATTOO_SPECS.get(tid, {})
		if spec.is_empty():
			continue
		var im := ImmediateMesh.new()
		var mat := StandardMaterial3D.new()
		mat.albedo_color = spec.get("color", Color.WHITE)
		mat.emission_enabled = true
		mat.emission = spec.get("color", Color.WHITE)
		mat.emission_energy_multiplier = spec.get("intensity", 0.5)
		mat.roughness = 0.6
		im.surface_begin(Mesh.PRIMITIVE_LINE_STRIP, mat)
		var w := 0.06
		im.surface_add_vertex(Vector3(-w, 0, 0))
		im.surface_add_vertex(Vector3(w, 0, 0))
		im.surface_add_vertex(Vector3(0, 0.015, 0))
		im.surface_add_vertex(Vector3(w * 0.5, -0.015, 0))
		im.surface_add_vertex(Vector3(-w * 0.5, -0.015, 0))
		im.surface_end()
		var mi := MeshInstance3D.new()
		mi.mesh = im
		var pos: Vector3 = spec.get("position", Vector3.ZERO)
		mi.position = pos
		player.add_child(mi)
		_tattoo_lines.append(mi)


const TATTOO_SPECS = {
	"refusal_glyph_chest":     { "color": Color(0.4, 0.3, 0.6),  "intensity": 0.8, "position": Vector3(0, 1.45, 0.21) },
	"void_mark_neck":          { "color": Color(0.2, 0.15, 0.3), "intensity": 0.6, "position": Vector3(0, 1.7, 0.05) },
	"copper_lattice_arms":     { "color": Color(0.85, 0.55, 0.20),"intensity": 0.5, "position": Vector3(0.32, 1.0, 0) },
	"sun_disc_wrist":          { "color": Color(0.95, 0.7, 0.30),"intensity": 0.4, "position": Vector3(0.45, 0.7, 0.05) },
	"sun_disc_back":           { "color": Color(0.95, 0.7, 0.30),"intensity": 0.4, "position": Vector3(0, 1.5, -0.21) },
	"prairie_lattice_left_arm":{ "color": Color(0.35, 0.20, 0.10),"intensity": 0.3, "position": Vector3(-0.32, 1.0, 0) },
	"code_glyph_forearm":      { "color": Color(0.20, 0.45, 0.65),"intensity": 0.4, "position": Vector3(0.30, 1.0, 0.10) },
	"ledger_mark_hand":        { "color": Color(0.15, 0.15, 0.20),"intensity": 0.3, "position": Vector3(0.50, 0.5, 0) },
}


func _add_accessories(player: Node, accessory_ids: Array) -> void:
	for aid in accessory_ids:
		match aid:
			"hood":
				var hood := MeshInstance3D.new()
				var sphere := SphereMesh.new()
				sphere.radius = 0.27
				sphere.height = 0.4
				hood.mesh = sphere
				hood.position = Vector3(0, 1.95, -0.05)
				var hm := StandardMaterial3D.new()
				hm.albedo_color = Color(0.10, 0.10, 0.14)
				hm.roughness = 0.9
				hood.material_override = hm
				player.add_child(hood)
			"ranger_belt":
				var belt := MeshInstance3D.new()
				var torus := TorusMesh.new()
				torus.inner_radius = 0.18
				torus.outer_radius = 0.22
				belt.mesh = torus
				belt.position = Vector3(0, 0.95, 0)
				belt.rotation_degrees = Vector3(90, 0, 0)
				var bm := StandardMaterial3D.new()
				bm.albedo_color = Color(0.30, 0.22, 0.15)
				bm.roughness = 0.7
				belt.material_override = bm
				player.add_child(belt)
			"lasso_loop":
				var lasso := MeshInstance3D.new()
				var torus2 := TorusMesh.new()
				torus2.inner_radius = 0.10
				torus2.outer_radius = 0.12
				lasso.mesh = torus2
				lasso.position = Vector3(0, 0.6, 0)
				lasso.rotation_degrees = Vector3(90, 0, 0)
				var lm := StandardMaterial3D.new()
				lm.albedo_color = Color(0.50, 0.40, 0.25)
				lasso.material_override = lm
				player.add_child(lasso)
			"satchel":
				var satchel := MeshInstance3D.new()
				var box := BoxMesh.new()
				box.size = Vector3(0.15, 0.20, 0.10)
				satchel.mesh = box
				satchel.position = Vector3(-0.25, 1.0, 0)
				var sm := StandardMaterial3D.new()
				sm.albedo_color = Color(0.40, 0.30, 0.20)
				sm.roughness = 0.85
				satchel.material_override = sm
				player.add_child(satchel)
			"witness_pin":
				var pin := MeshInstance3D.new()
				var cylinder := CylinderMesh.new()
				cylinder.top_radius = 0.025
				cylinder.bottom_radius = 0.025
				cylinder.height = 0.005
				pin.mesh = cylinder
				pin.position = Vector3(0.15, 1.4, 0.21)
				var pm := StandardMaterial3D.new()
				pm.albedo_color = Color(0.85, 0.55, 0.20)
				pm.emission_enabled = true
				pm.emission = Color(0.85, 0.55, 0.20)
				pm.emission_energy_multiplier = 0.3
				pin.material_override = pm
				player.add_child(pin)
			"stylus_holster":
				var stylus := MeshInstance3D.new()
				var cyl := CylinderMesh.new()
				cyl.top_radius = 0.012
				cyl.bottom_radius = 0.005
				cyl.height = 0.18
				stylus.mesh = cyl
				stylus.position = Vector3(-0.18, 1.0, 0.10)
				stylus.rotation_degrees = Vector3(0, 0, 30)
				var stm := StandardMaterial3D.new()
				stm.albedo_color = Color(0.18, 0.18, 0.20)
				stm.metallic = 0.6
				stm.roughness = 0.4
				stylus.material_override = stm
				player.add_child(stylus)
			"ledger_clutch":
				var ledger := MeshInstance3D.new()
				var lbox := BoxMesh.new()
				lbox.size = Vector3(0.18, 0.22, 0.04)
				ledger.mesh = lbox
				ledger.position = Vector3(0.20, 0.95, 0.12)
				var lm2 := StandardMaterial3D.new()
				lm2.albedo_color = Color(0.45, 0.35, 0.22)
				lm2.roughness = 0.85
				ledger.material_override = lm2
				player.add_child(ledger)
			"refusal_field_emitter":
				var emitter := MeshInstance3D.new()
				var sphere := SphereMesh.new()
				sphere.radius = 0.05
				emitter.mesh = sphere
				emitter.position = Vector3(0, 1.5, 0.18)
				var em := StandardMaterial3D.new()
				em.albedo_color = Color(0.4, 0.3, 0.6)
				em.emission_enabled = true
				em.emission = Color(0.4, 0.3, 0.6)
				em.emission_energy_multiplier = 1.5
				em.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
				em.albedo_color.a = 0.6
				emitter.material_override = em
				emitter.name = "RefusalEmitter"
				player.add_child(emitter)


func _process(delta: float) -> void:
	_pulse_time += delta
	var pulse := 0.7 + 0.3 * sin(_pulse_time * 2.0)
	for child in get_children():
		if child.name == "RefusalEmitter" and child is MeshInstance3D:
			var mi: MeshInstance3D = child
			var mat := mi.material_override as StandardMaterial3D
			if mat:
				mat.emission_energy_multiplier = pulse * 1.5
