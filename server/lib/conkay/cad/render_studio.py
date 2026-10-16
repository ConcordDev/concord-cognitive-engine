# server/lib/conkay/cad/render_studio.py
#
# Opaque studio renders of a cad.body mesh alone (no envelopes, no tyres):
# 3/4 front, side and 3/4 rear, Cycles. Presentation only: the mesh rendered
# is the analysed solid, unchanged (no smoothing modifiers, no added parts).
#
# Lighting: an HDRI lights and reflects in the paint, while camera rays see a
# flat studio backdrop (Light Path "Is Camera Ray"), so the car reads as shot
# in a studio cove. Paint is a clearcoat metallic. The analysed solid has no
# glazing surface, so no glass is drawn here; glass/lamp overlays are a
# separate presentation layer.
#
# Optional tool (needs Blender >= 4.2); not used by the solver.
#   blender -b -P render_studio.py -- BODY.stl OUT_DIR [PREFIX]
#       [--hdri PATH.hdr|exr] [--hdri-rot DEG] [--hdri-strength S]
#       [--samples N] [--paint R,G,B] [--res WxH] [--views a,b]
# Without --hdri, Blender's bundled studio-light HDRI (city.exr) is used when
# present, else a flat grey world with three area lights.
import bpy, sys, os, math, mathutils

argv = sys.argv[sys.argv.index("--") + 1:]
pos, opts = [], {}
i = 0
while i < len(argv):
    if argv[i].startswith("--"):
        opts[argv[i][2:]] = argv[i + 1]; i += 2
    else:
        pos.append(argv[i]); i += 1
stl, outdir = pos[0], pos[1]
prefix = pos[2] if len(pos) > 2 else "studio"
samples = int(opts.get("samples", 128))
paint = tuple(float(v) for v in opts.get("paint", "0.10,0.11,0.13").split(",")) + (1.0,)
res_x, res_y = (int(v) for v in opts.get("res", "1600x900").split("x"))

hdri = opts.get("hdri")
if not hdri:
    bundled = bpy.utils.system_resource("DATAFILES", path="studiolights/world/city.exr")
    hdri = bundled if bundled and os.path.exists(bundled) else None

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.stl_import(filepath=stl)
car = bpy.context.selected_objects[0]
bpy.context.view_layer.objects.active = car
bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
bb = [car.matrix_world @ mathutils.Vector(c) for c in car.bound_box]
mn = mathutils.Vector([min(v[i] for v in bb) for i in range(3)])
mx = mathutils.Vector([max(v[i] for v in bb) for i in range(3)])
ctr = (mn + mx) / 2
L = mx.x - mn.x

# clearcoat metallic paint
m = bpy.data.materials.new("paint"); m.use_nodes = True
b = m.node_tree.nodes["Principled BSDF"]
b.inputs["Base Color"].default_value = paint
b.inputs["Metallic"].default_value = 0.7
b.inputs["Roughness"].default_value = 0.32       # base flake layer
b.inputs["Coat Weight"].default_value = 1.0
b.inputs["Coat Roughness"].default_value = 0.03  # glossy lacquer over it
b.inputs["Coat IOR"].default_value = 1.5
car.data.materials.append(m)

# floor: matte light grey cove floor that receives shadows
bpy.ops.mesh.primitive_plane_add(size=60, location=(ctr.x, ctr.y, 0.0))  # z = 0: tyre contact
f = bpy.context.active_object
fm = bpy.data.materials.new("floor"); fm.use_nodes = True
fb = fm.node_tree.nodes["Principled BSDF"]
fb.inputs["Base Color"].default_value = (0.72, 0.72, 0.74, 1); fb.inputs["Roughness"].default_value = 0.55
f.data.materials.append(fm)

# world
w = bpy.data.worlds.new("w"); bpy.context.scene.world = w; w.use_nodes = True
nt = w.node_tree
bg = nt.nodes["Background"]
backdrop = (0.82, 0.83, 0.86, 1)
if hdri:
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(hdri, check_existing=True)
    mapping = nt.nodes.new("ShaderNodeMapping")
    coord = nt.nodes.new("ShaderNodeTexCoord")
    mapping.inputs["Rotation"].default_value[2] = math.radians(float(opts.get("hdri-rot", 120)))
    nt.links.new(coord.outputs["Generated"], mapping.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], env.inputs["Vector"])
    nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = float(opts.get("hdri-strength", 1.0))
    flat = nt.nodes.new("ShaderNodeBackground")
    flat.inputs["Color"].default_value = backdrop
    flat.inputs["Strength"].default_value = 1.0
    lp = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs["Fac"])
    nt.links.new(bg.outputs["Background"], mix.inputs[1])
    nt.links.new(flat.outputs["Background"], mix.inputs[2])
    out = nt.nodes["World Output"]
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
else:
    bg.inputs[0].default_value = (0.9, 0.9, 0.92, 1)
    bg.inputs[1].default_value = 0.35


def area(name, loc, energy, size):
    d = bpy.data.lights.new(name, "AREA"); d.energy = energy; d.size = size
    o = bpy.data.objects.new(name, d); bpy.context.collection.objects.link(o)
    o.location = loc
    dirv = ctr - mathutils.Vector(loc); o.rotation_euler = dirv.to_track_quat("-Z", "Y").to_euler()


# a long soft top strip for the studio highlight down the body; the key/fill
# pair only when there is no HDRI to light the car
area("top", (ctr.x, ctr.y, 7), 500 if hdri else 600, 8)
if not hdri:
    area("key", (ctr.x - 3, ctr.y - 5, 6), 900, 6)
    area("fill", (ctr.x + 4, ctr.y + 5, 4), 300, 6)

sc = bpy.context.scene
sc.render.engine = "CYCLES"; sc.cycles.samples = samples; sc.cycles.device = "CPU"
sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = res_x, res_y
sc.view_settings.view_transform = "AgX"
sc.view_settings.look = "AgX - Medium High Contrast"
cam_d = bpy.data.cameras.new("cam"); cam_d.lens = 70
cam = bpy.data.objects.new("cam", cam_d); bpy.context.collection.objects.link(cam); sc.camera = cam
# body x runs nose(min x) -> tail(max x); y lateral; z up
views = {
    "3q-front": mathutils.Vector((-0.9, -1.0, 0.32)),
    "side": mathutils.Vector((0.0, -1.0, 0.04)),
    "3q-rear": mathutils.Vector((0.9, -1.0, 0.35)),
}
only = opts.get("views")
for name, dvec in views.items():
    if only and name not in only.split(","):
        continue
    dvec.normalize()
    cam.location = ctr + dvec * L * 2.5
    cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = f"{outdir}/{prefix}-{name}.png"
    bpy.ops.render.render(write_still=True)
