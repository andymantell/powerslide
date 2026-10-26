"""Builds boulder models in Blender: displaced, partly flattened icospheres
decimated to game budgets. Exports src/assets/models/rocks.glb with meshes
rock0..rockN. Texturing is done in the game with triplanar rock and moss.

  python tools/blender/rocks.py [variants]
"""
import os
import random
import sys

import bpy  # noqa: I001 (bpy must load before bmesh/mathutils)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'src', 'assets', 'models')


def boulder(i, rng):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=5, radius=1.0)
    o = bpy.context.active_object
    o.name = f'rock{i}'
    o.scale = (rng.uniform(0.9, 1.4), rng.uniform(0.55, 0.85), rng.uniform(0.8, 1.2))
    bpy.ops.object.transform_apply(scale=True)
    # Big blocky facets, then finer lumps.
    for kind, size, strength in (('VORONOI', rng.uniform(0.7, 1.1), 0.45), ('CLOUDS', 0.35, 0.12), ('CLOUDS', 0.12, 0.04)):
        tex = bpy.data.textures.new(f'{o.name}_{kind}_{size}', kind)
        if kind == 'VORONOI':
            tex.distance_metric = 'DISTANCE'
            tex.color_mode = 'INTENSITY'
            tex.noise_intensity = 1.0
            tex.weight_1, tex.weight_2 = 1.0, -0.6
        else:
            tex.noise_depth = 2
        tex.noise_scale = size
        m = o.modifiers.new(kind, 'DISPLACE')
        m.texture = tex
        m.texture_coords = 'OBJECT'
        m.strength = strength
        m.mid_level = 0.5
        empty = bpy.data.objects.new(f'{o.name}_off{size}', None)
        empty.location = (rng.uniform(-50, 50), rng.uniform(-50, 50), rng.uniform(-50, 50))
        bpy.context.scene.collection.objects.link(empty)
        m.texture_coords_object = empty
    dec = o.modifiers.new('dec', 'DECIMATE')
    dec.ratio = 0.035
    bpy.ops.object.convert(target='MESH')
    # Flatten the underside so it sits in the ground (Blender is Z-up; this is Y in three).
    me = o.data
    zs = [v.co.z for v in me.vertices]
    floor = min(zs) + (max(zs) - min(zs)) * 0.22
    for v in me.vertices:
        if v.co.z < floor:
            v.co.z = floor + (v.co.z - floor) * 0.15
    for v in me.vertices:
        v.co.z -= floor
    for p in me.polygons:
        p.use_smooth = True
    bpy.ops.object.shade_auto_smooth(angle=0.9)
    print(o.name, len(me.polygons), 'tris approx')
    return o


if __name__ == '__main__':
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 4
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rng = random.Random(5)
    objs = [boulder(i, rng) for i in range(n)]
    for o in list(bpy.context.scene.objects):
        if o.type != 'MESH':
            bpy.data.objects.remove(o)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'rocks.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_materials='NONE',
                              export_normals=True, export_texcoords=False, export_apply=True)
    print('wrote', path)
