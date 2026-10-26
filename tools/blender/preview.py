"""Renders quick Cycles previews of an exported model for review.

  python tools/blender/preview.py model.glb out_dir [distance]

Writes front, side, three-quarter and below views as PNGs.
"""
import math
import os
import sys

import bpy  # noqa: I001
from mathutils import Vector


def main(path, out, dist=None):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    lo = Vector((1e9, 1e9, 1e9))
    hi = -lo
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    centre = (lo + hi) / 2
    size = (hi - lo).length
    dist = dist or size * 1.6
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 32
    sc.render.resolution_x, sc.render.resolution_y = 800, 600
    sc.view_settings.view_transform = 'AgX'
    world = bpy.data.worlds.new('w')
    sc.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.6, 0.65, 0.75, 1)
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-30))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 50
    sc.collection.objects.link(cam)
    sc.camera = cam
    views = {
        'three_quarter': (35, 25),
        'side': (90, 5),
        'front': (0, 10),
        'below': (40, -35),
    }
    os.makedirs(out, exist_ok=True)
    for name, (az, el) in views.items():
        a, e = math.radians(az), math.radians(el)
        cam.location = centre + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * dist
        cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(out, f'{name}.png')
        bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else None)
