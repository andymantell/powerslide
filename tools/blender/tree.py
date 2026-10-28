"""Builds conifer models in Blender and exports them for the game.

  python tools/blender/tree.py          (needs `pip install bpy` for Python 3.13)

Output: src/assets/models/conifers.glb, N variants, each a trunk mesh and a
foliage card mesh. Geometry is authored Y-up and exported without axis
conversion, so it lands in three.js as built. Impostors for distant trees are
rendered in the game at start-up so they match the biome's lighting.

Foliage is built from alpha-tested branch cards (spruce_twig.png, from
tools/textures/gen.py) laid along drooping whorled branches, the way spruces
grow. Species parameters live in SPECIES so other biomes can add pines etc.
"""
import math
import os
import random
import sys

import bpy  # noqa: I001 (bpy must load before bmesh/mathutils)
import bmesh
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
TEX = os.path.join(ROOT, 'src', 'assets', 'textures')
OUT = os.path.join(ROOT, 'src', 'assets', 'models')

SPECIES = {
    'spruce': dict(
        height=(11.0, 15.0), trunk_r=0.22, crown_base=0.9, whorl_gap=0.36, per_whorl=(6, 8),
        max_len=3.4, len_pow=0.8, droop=(0.05, -0.5), tip_up=0.4, card_w=1.5, segs=3,
        twig='spruce_twig.png', bark='bark_albedo.webp',
    ),
    # Tall pines for the Pine Forest: a long bare trunk and a high, rounded
    # crown of fewer, longer branches that sweep upward.
    'pine': dict(
        height=(17.0, 23.0), trunk_r=0.34, crown_base=0.0, crown_frac=(0.45, 0.6), whorl_gap=0.42, per_whorl=(5, 7),
        max_len=3.6, len_pow=0.28, droop=(0.4, -0.1), tip_up=0.45, card_w=2.6, segs=3,
        twig='pine_twig.png', bark='bark_albedo.webp',
    ),
}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, image, alpha=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(os.path.join(TEX, image))
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.85
    if alpha:
        nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
        m.blend_method = 'CLIP' if hasattr(m, 'blend_method') else None
        try:
            m.surface_render_method = 'DITHERED'
        except AttributeError:
            pass
    return m


def trunk(rng, sp, H, mat):
    bm = bmesh.new()
    sides = 8
    rings = int(H / 0.8) + 1
    uv = bm.loops.layers.uv.new()
    verts = []
    for r in range(rings + 1):
        t = r / rings
        y = t * H
        rad = sp['trunk_r'] * (1 - t) ** 0.9 + 0.015
        rad *= 1.25 if r == 0 else 1.0  # root flare
        ox = math.sin(y * 0.7 + rng.random()) * 0.03
        ring = []
        for s in range(sides):
            a = s / sides * math.tau
            ring.append(bm.verts.new((ox + math.cos(a) * rad, y, math.sin(a) * rad)))
        verts.append(ring)
    for r in range(rings):
        for s in range(sides):
            a, b = verts[r][s], verts[r][(s + 1) % sides]
            c, d = verts[r + 1][(s + 1) % sides], verts[r + 1][s]
            f = bm.faces.new((a, d, c, b))
            for loop, (u, v) in zip(f.loops, ((s, r), (s, r + 1), (s + 1, r + 1), (s + 1, r))):
                loop[uv].uv = (u / sides * 2, v * 0.8 / 1.2)
    me = bpy.data.meshes.new('trunk')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    return me


def foliage(rng, sp, H, mat):
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    y0 = sp['crown_base'] + rng.uniform(-0.3, 0.6)
    if 'crown_frac' in sp:
        y0 = H * rng.uniform(*sp['crown_frac'])
    y = H - 0.15
    whorl = 0
    while y > y0:
        t = (y - y0) / (H - y0)  # 0 at crown base, 1 at top
        n = rng.randint(*sp['per_whorl'])
        rot = rng.random() * math.tau
        for k in range(n):
            az = rot + k / n * math.tau + rng.uniform(-0.25, 0.25)
            L = (sp['max_len'] * (1 - t) ** sp['len_pow'] + 0.35) * rng.uniform(0.8, 1.1)
            droop = sp['droop'][0] + (sp['droop'][1] - sp['droop'][0]) * (1 - t) + rng.uniform(-0.1, 0.1)
            card(bm, uv, rng, sp, Vector((0, y, 0)), az, L, droop)
        # Short inner cards fill the gaps between whorls near the trunk.
        if whorl % 2 == 0:
            az = rng.random() * math.tau
            L = (sp['max_len'] * (1 - t) ** sp['len_pow'] + 0.3) * 0.5
            card(bm, uv, rng, sp, Vector((0, y - sp['whorl_gap'] * 0.5, 0)), az, L, -0.2)
        whorl += 1
        y -= sp['whorl_gap'] * (0.85 + 0.3 * rng.random()) * (0.75 + 0.5 * (1 - t))
    # Leader: two crossed vertical cards at the very top.
    for az in (0.0, math.pi / 2):
        card(bm, uv, rng, sp, Vector((0, H - 1.1, 0)), az, 1.4, 1.45, width=0.55)
    me = bpy.data.meshes.new('foliage')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    return me


def card(bm, uv, rng, sp, base, az, L, droop, width=None):
    """A bent quad strip from `base` outward along azimuth `az`."""
    segs = sp['segs']
    w = (width or sp['card_w']) * min(1.0, 0.45 + L * 0.3)
    out = Vector((math.cos(az), 0, math.sin(az)))
    side = Vector((-math.sin(az), 0, math.cos(az)))
    roll = rng.uniform(-0.35, 0.35)
    # Main card lies roughly flat (sprays face the light); a narrower crossed
    # card stands on edge so the branch still has body seen side-on.
    for rl, wscale in ((roll, 1.0), (roll + math.pi / 2, 0.55)):
        rows = []
        p = base.copy()
        for i in range(segs + 1):
            t = i / segs
            # Branch droops, then the tip curls back up.
            pitch = droop + sp['tip_up'] * t * t
            d = (out * math.cos(pitch) + Vector((0, math.sin(pitch), 0))).normalized()
            across = side * math.cos(rl) + Vector((0, math.sin(rl), 0))
            half = w * wscale * 0.5 * (0.55 + 0.45 * math.sin(min(1.0, t * 1.4) * math.pi * 0.5))
            rows.append((bm.verts.new(p - across * half), bm.verts.new(p + across * half), t))
            p = p + d * (L / segs)
        for i in range(segs):
            a, b, ta = rows[i]
            c, e, tb = rows[i + 1]
            f = bm.faces.new((a, b, e, c))
            for loop, co in zip(f.loops, ((0.02, ta), (0.98, ta), (0.98, tb), (0.02, tb))):
                loop[uv].uv = (co[0], co[1] * 0.97 + 0.01)

def build(species='spruce', variants=3, seed=7):
    sp = SPECIES[species]
    bark = material('bark', sp['bark'])
    leaf = material('needles', sp['twig'], alpha=True)
    objs = []
    for v in range(variants):
        rng = random.Random(seed + v * 101)
        H = rng.uniform(*sp['height'])
        t = bpy.data.objects.new(f'{species}{v}_trunk', trunk(rng, sp, H, bark))
        f = bpy.data.objects.new(f'{species}{v}_foliage', foliage(rng, sp, H, leaf))
        for o in (t, f):
            bpy.context.scene.collection.objects.link(o)
            o.location.x = v * 12
        objs.append((t, f, H))
    return objs


def export(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for o in bpy.context.scene.objects:
        o.location.x = 0
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_image_format='NONE',
                              export_materials='PLACEHOLDER', export_normals=True, export_texcoords=True,
                              export_apply=True, export_yup=False)
    print('wrote', path)


if __name__ == '__main__':
    variants = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    reset()
    for species in SPECIES:
        build(species, variants)
    export(os.path.join(OUT, 'conifers.glb'))
