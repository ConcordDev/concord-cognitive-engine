# server/lib/conkay/cad/render_studio.py
#
# Opaque studio renders of a cad.body mesh alone (no envelopes, no tyres):
# 3/4 front, side and 3/4 rear, Cycles, three area lights, light floor.
# Optional tool (needs Blender >= 4.2); not used by the solver.
#   blender -b -P render_studio.py -- BODY.stl OUT_DIR [PREFIX]
import bpy, sys, math, mathutils
argv = sys.argv[sys.argv.index("--") + 1:]
stl, outdir = argv[0], argv[1]
prefix = argv[2] if len(argv) > 2 else "studio"
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
# paint
m = bpy.data.materials.new("paint"); m.use_nodes = True
b = m.node_tree.nodes["Principled BSDF"]
b.inputs["Base Color"].default_value = (0.18, 0.19, 0.21, 1)  # neutral graphite grey
b.inputs["Metallic"].default_value = 0.6
b.inputs["Roughness"].default_value = 0.25
b.inputs["Coat Weight"].default_value = 1.0
car.data.materials.append(m)
# floor (shadow catcher style: light grey)
bpy.ops.mesh.primitive_plane_add(size=60, location=(ctr.x, ctr.y, 0.0))  # the ground (z = 0: tyre contact)
f = bpy.context.active_object
fm = bpy.data.materials.new("floor"); fm.use_nodes = True
fb = fm.node_tree.nodes["Principled BSDF"]
fb.inputs["Base Color"].default_value = (0.8, 0.8, 0.8, 1); fb.inputs["Roughness"].default_value = 0.6
f.data.materials.append(fm)
# world
w = bpy.data.worlds.new("w"); bpy.context.scene.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.9, 0.9, 0.92, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 0.35
def area(name, loc, energy, size):
    d = bpy.data.lights.new(name, "AREA"); d.energy = energy; d.size = size
    o = bpy.data.objects.new(name, d); bpy.context.collection.objects.link(o)
    o.location = loc
    dirv = ctr - mathutils.Vector(loc); o.rotation_euler = dirv.to_track_quat("-Z", "Y").to_euler()
area("key", (ctr.x - 3, ctr.y - 5, 6), 900, 6)
area("fill", (ctr.x + 4, ctr.y + 5, 4), 300, 6)
area("top", (ctr.x, ctr.y, 8), 600, 8)
sc = bpy.context.scene
sc.render.engine = "CYCLES"; sc.cycles.samples = 64; sc.cycles.device = "CPU"
sc.render.resolution_x, sc.render.resolution_y = 1600, 900
sc.view_settings.view_transform = "AgX"
cam_d = bpy.data.cameras.new("cam"); cam_d.lens = 70
cam = bpy.data.objects.new("cam", cam_d); bpy.context.collection.objects.link(cam); sc.camera = cam
# body x runs nose(min x) -> tail(max x); y lateral; z up
views = {
    "3q-front": mathutils.Vector((-0.9, -1.0, 0.32)),
    "side": mathutils.Vector((0.0, -1.0, 0.04)),
    "3q-rear": mathutils.Vector((0.9, -1.0, 0.35)),
}
for name, dvec in views.items():
    dvec.normalize()
    cam.location = ctr + dvec * L * 2.5
    cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = f"{outdir}/{prefix}-{name}.png"
    bpy.ops.render.render(write_still=True)
