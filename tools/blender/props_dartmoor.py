"""Builds Dartmoor's trackside props (tors, ponies, sheep, walls, thatched
cottages, the prison and the rest) and exports them to
src/assets/models/props_dartmoor.glb. Same conventions as props.py, whose
helpers it uses: vertex colour plus a surface kind per face, front facing
Blender -Y (three.js +Z), origin on the ground.

  python tools/blender/props_dartmoor.py
"""
import math
import os
import random
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
from props import (EMISSIVE, GLASS, MASONRY, METAL, OUT, PAINT, PLANKS, PLASTER, SHINGLES, ball, box, build, cyl,  # noqa: E402
                   door, finish, gable, mesh, plinth, prism, window)

GRANITE = ['#8f8b82', '#97938a', '#858177', '#9c978c', '#8a857a']
WALLSTONE = '#7f7a70'


def rbox(sx, sy, sz, x=0, y=0, z=0, kind=PLASTER, col='#8f8b82', rz=0, ry=0, bevel=0.25):
    """A box with rounded edges (weathered granite), base at z."""
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.active_object
    o.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    for v in o.data.vertices:
        v.co.z += sz / 2
    m = o.modifiers.new('b', 'BEVEL')
    m.width = min(bevel, sx / 2.2, sy / 2.2, sz / 2.2)
    m.segments = 2
    bpy.ops.object.modifier_apply(modifier='b')
    o.location = (x, y, z)
    o.rotation_euler = (0, ry, rz)
    return finish(o, kind, col)


_TEX = {}


def rock(sx, sy, sz, x=0, y=0, z=0, col='#8f8b82', rx=0, ry=0, rz=0, seed=0, rough=0.28, detail=1, warp=0.0):
    """A weathered granite lump: a rounded block pushed about by noise, so
    no two are alike and none have straight edges. Base roughly at z."""
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.active_object
    o.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    # Rounded-off block (weathered edges, flat-ish faces), then enough
    # vertices for the noise to roughen.
    b = o.modifiers.new('b', 'BEVEL')
    b.width = min(sx, sy, sz) * (0.45 if warp else 0.32)
    b.segments = 2 if detail else 1
    bpy.ops.object.modifier_apply(modifier='b')
    if detail:
        m = o.modifiers.new('s', 'SUBSURF')
        m.subdivision_type = 'SIMPLE'
        m.levels = detail
        m.render_levels = detail
        bpy.ops.object.modifier_apply(modifier='s')
    if warp:
        # Big, slow bulges and hollows over the whole block, so it reads as
        # a weathered lump rather than a box.
        t = bpy.data.textures.new('w', 'CLOUDS')
        t.noise_scale = max(sx, sy, sz) * 0.45
        t.noise_depth = 1
        t.noise_basis = 'BLENDER_ORIGINAL'
        o.location = (seed * 5.1, seed * 2.9, seed * 0.7)
        bpy.ops.object.transform_apply(location=True)
        w = o.modifiers.new('w', 'DISPLACE')
        w.texture = t
        w.texture_coords = 'GLOBAL'
        w.strength = warp * max(sx, sy, sz)
        w.mid_level = 0.5
        bpy.ops.object.modifier_apply(modifier='w')
        for v in o.data.vertices:
            v.co.x -= seed * 5.1
            v.co.y -= seed * 2.9
            v.co.z -= seed * 0.7
        o.location = (0, 0, 0)
    key = (seed % 7)
    if key not in _TEX:
        t = bpy.data.textures.new(f'n{key}', 'CLOUDS')
        t.noise_scale = 0.55
        t.noise_depth = 2
        t.noise_basis = 'VORONOI_F1' if key % 2 else 'BLENDER_ORIGINAL'
        _TEX[key] = t
    d = o.modifiers.new('d', 'DISPLACE')
    d.texture = _TEX[key]
    d.texture_coords = 'GLOBAL'
    d.strength = rough * min(sx, sy, sz) * 1.6
    d.mid_level = 0.5
    # Offset the noise per rock so shared textures still differ.
    o.location = (seed * 3.7, seed * 1.3, 0)
    bpy.ops.object.transform_apply(location=True)
    bpy.ops.object.modifier_apply(modifier='d')
    if warp:
        # Shed the vertices the shape no longer needs.
        dm = o.modifiers.new('x', 'DECIMATE')
        dm.ratio = 0.3
        bpy.ops.object.modifier_apply(modifier='x')
    for v in o.data.vertices:
        v.co.x -= seed * 3.7
        v.co.y -= seed * 1.3
        v.co.z += sz / 2
    o.location = (x, y, z)
    o.rotation_euler = (rx, ry, rz)
    return finish(o, PLASTER, col)


def pile(x, y, w, d, h, rng, z0=0):
    """A tor stack: heavy weathered slabs, each tilted and slipped off the
    one below, the joints eaten back."""
    z = z0
    cx, cy = x, y
    layers = max(2, int(h / (w * 0.22)) + int(rng.random() * 2))
    for k in range(layers):
        t = 1 - 0.12 * k
        lh = h / layers * (0.75 + rng.random() * 0.6)
        n = 1 if w * t < 4 or rng.random() < 0.4 else 2
        for j in range(n):
            ww = w * t * (0.6 + rng.random() * 0.45) / (1 if n == 1 else 1.6)
            dd = d * t * (0.7 + rng.random() * 0.4)
            ox = (j - (n - 1) / 2) * ww * 0.8
            rock(ww, dd, lh * 1.15, cx + ox + (rng.random() - 0.5) * w * 0.12, cy + (rng.random() - 0.5) * d * 0.12, z - lh * 0.12,
                 col=rng.choice(GRANITE), rx=(rng.random() - 0.5) * 0.1, ry=(rng.random() - 0.5) * 0.14,
                 rz=(rng.random() - 0.5) * 0.5, seed=rng.randrange(1000), rough=0.1 + rng.random() * 0.06, detail=2, warp=0.2)
        cx += (rng.random() - 0.5) * w * 0.15
        z += lh * 0.92


def tor(name, size, seed):
    """A granite tor: a few weathered piles on a rubble skirt (clitter)."""
    rng = random.Random(seed)
    s = size
    pile(-s * 0.25, 0, s * 0.42, s * 0.36, s * 0.55, rng)
    pile(s * 0.22, s * 0.05, s * 0.34, s * 0.3, s * 0.42, rng)
    if s > 12:
        pile(s * 0.02, -s * 0.2, s * 0.24, s * 0.22, s * 0.3, rng)
        # Big tumbled blocks at the foot.
        for k in range(4):
            a = rng.random() * math.tau
            b = s * (0.1 + rng.random() * 0.07)
            rock(b * 1.5, b * 1.1, b, math.cos(a) * s * 0.42, math.sin(a) * s * 0.3, -b * 0.2, col=rng.choice(GRANITE),
                 rx=rng.random() * 0.5, rz=rng.random() * 3, seed=rng.randrange(1000), warp=0.2)
    # Grassy mound under it, so it sits on the moor.
    ball(s * 0.6, 0, 0, -s * 0.12, sx=1.1, sy=0.9, sz=0.32, kind=PAINT, col='#6f7350', segs=14)
    for k in range(int(s * 1.2)):
        a = rng.random() * math.tau
        r = s * (0.45 + rng.random() * 0.5)
        b = 0.4 + rng.random() * s * 0.06
        rock(b * 1.4, b, b * 0.8, math.cos(a) * r, math.sin(a) * r * 0.85, -b * 0.3, col=rng.choice(GRANITE),
             rx=rng.random() * 0.6, rz=rng.random() * 3, seed=rng.randrange(1000), detail=0)
    return build(name)


def sheep(name, wool='#e9e4d6', face='#2a2622'):
    ball(0.42, 0, 0, 0.72, sx=0.85, sy=1.35, sz=0.85, col=wool, segs=10)
    for lx in (-0.16, 0.16):
        for ly in (-0.32, 0.34):
            cyl(0.04, 0.5, lx, ly, 0, PAINT, face, verts=5)
    ball(0.15, 0, -0.62, 0.78, sx=0.8, sy=1.3, sz=0.9, col=face, segs=8, rx=0.5)
    ball(0.22, 0, -0.5, 0.88, sx=1.1, sy=0.6, sz=0.7, col=wool, segs=8)
    for s in (-1, 1):
        ball(0.07, s * 0.14, -0.6, 0.85, sx=1.4, sy=0.4, sz=0.5, col=face, segs=6)
    return build(name)


def pony(name, coat='#6b4a33', mane='#2a1f18', blaze=None):
    """A stocky Dartmoor pony, about 1.2 m at the withers, facing -Y."""
    ball(0.42, 0, 0, 0.95, sx=0.85, sy=1.75, sz=0.95, col=coat, segs=12)
    for lx in (-0.18, 0.18):
        for ly in (-0.5, 0.55):
            cyl(0.075, 0.82, lx, ly, 0, PAINT, coat, verts=6, r2=0.06)
            cyl(0.075, 0.1, lx, ly, 0, PAINT, '#2a2420', verts=6)
    # Neck up and forward, head.
    cyl(0.2, 0.75, 0, -0.62, 1.0, PAINT, coat, verts=8, r2=0.15, rx=0.6)
    ball(0.17, 0, -1.0, 1.55, sx=0.8, sy=1.8, sz=0.9, col=coat, segs=10, rx=0.9)
    if blaze:
        ball(0.06, 0, -1.2, 1.5, sx=0.8, sy=2.0, sz=0.8, col=blaze, segs=6, rx=0.9)
    box(0.08, 0.6, 0.18, 0, -0.75, 1.42, PAINT, mane, rx=0.65)
    for s in (-1, 1):
        cyl(0.04, 0.16, s * 0.08, -0.82, 1.72, PAINT, coat, verts=5, r2=0.01)
    cyl(0.07, 0.75, 0, 0.75, 0.4, PAINT, mane, verts=6, r2=0.03, rx=-0.3)
    return build(name)


def drystone(L, h, rng, x0=0, wobble=0.12, gaps=False):
    """A dry-stone wall along X from x0 - L/2 to x0 + L/2: courses of rough,
    odd-sized stones, a ragged top, and the odd tumble."""
    x = x0 - L / 2
    while x < x0 + L / 2 - 0.2:
        top = h * (0.75 + rng.random() * 0.35)
        if gaps and rng.random() < 0.18:
            top *= 0.35 + rng.random() * 0.3
        w = 0.45 + rng.random() * 0.5
        z = -0.3
        while z < top - 0.15:
            sh = 0.22 + rng.random() * 0.2
            rock(w * (0.85 + rng.random() * 0.3), 0.55 + rng.random() * 0.2, sh, x + w / 2, (rng.random() - 0.5) * wobble, z,
                 col=rng.choice(GRANITE), rx=(rng.random() - 0.5) * 0.25, ry=(rng.random() - 0.5) * 0.3, rz=(rng.random() - 0.5) * 0.3,
                 seed=rng.randrange(1000), rough=0.3, detail=0)
            z += sh * 0.85
        x += w * 0.92


def fieldwall():
    """4 m of rough dry-stone field wall along X, centred on the origin."""
    drystone(4.0, 1.1, random.Random(4), gaps=True)
    return build('fieldwall')


def ruinwall(name, seed):
    """A low, broken length of an old cottage wall."""
    rng = random.Random(seed)
    drystone(6.0, 1.4, rng, gaps=True, wobble=0.2)
    for k in range(6):
        b = 0.3 + rng.random() * 0.3
        rock(b * 1.4, b, b * 0.8, (rng.random() - 0.5) * 6, 0.7 + rng.random() * 0.8, -0.1, col=rng.choice(GRANITE),
             rz=rng.random() * 3, seed=rng.randrange(1000), detail=0)
    return build(name)


def fingerpost():
    """White wooden fingerpost with three arms."""
    cyl(0.07, 2.6, 0, 0, -0.3, PAINT, '#efece4', verts=8, smooth=False)
    for k, (rz, z) in enumerate(((0.3, 2.0), (2.2, 1.75), (-1.6, 1.5))):
        o = box(1.1, 0.05, 0.2, 0.55, 0, z, PAINT, '#efece4')
        o.location = (math.cos(rz) * 0.55, math.sin(rz) * 0.55, z)
        o.rotation_euler = (0, 0, rz)
        b = box(0.75, 0.06, 0.08, 0, 0, z + 0.06, PAINT, '#22201d')
        b.location = (math.cos(rz) * 0.55, math.sin(rz) * 0.55, z + 0.06)
        b.rotation_euler = (0, 0, rz)
    cyl(0.12, 0.12, 0, 0, 2.3, PAINT, '#c62f2f', verts=8)
    return build('fingerpost')


def triangle_sign(name, picto):
    """UK warning triangle on a grey post; the picture is a few dark blocks."""
    cyl(0.04, 2.4, 0, 0.05, -0.3, METAL, '#8e9296', verts=6)
    h = 0.95
    v = [(-h / 2, 0, 1.4), (h / 2, 0, 1.4), (0, 0, 1.4 + h * 0.87)]
    mesh(v + [(x, 0.03, z) for x, _, z in v], [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)], PAINT, '#c62f2f')
    i = 0.13
    vi = [(-h / 2 + i * 1.7, -0.01, 1.4 + i), (h / 2 - i * 1.7, -0.01, 1.4 + i), (0, -0.01, 1.4 + h * 0.87 - i * 2)]
    mesh(vi + [(x, 0.005, z) for x, _, z in vi], [(0, 1, 2), (3, 5, 4)], PAINT, '#f4f1e8')
    for (x, z, w, hh) in picto:
        box(w, 0.02, hh, x, -0.025, 1.4 + z, PAINT, '#1d1b19')
    return build(name)


def gorse(name, seed, s=1.0):
    rng = random.Random(seed)
    for k in range(5):
        ball(0.5 * s, (rng.random() - 0.5) * s, (rng.random() - 0.5) * s, 0.25 * s, sx=1.2, sy=1.2, sz=0.9,
             col=rng.choice(['#3f5a2c', '#46612f', '#3a5228']), segs=8)
    for k in range(18):
        ball(0.12 * s, (rng.random() - 0.5) * 1.5 * s, (rng.random() - 0.5) * 1.5 * s, (0.35 + rng.random() * 0.5) * s,
             col=rng.choice(['#e8c22a', '#f0cd34', '#d9b021']), segs=5)
    return build(name)


def bracken():
    rng = random.Random(9)
    for k in range(14):
        a = rng.random() * math.tau
        o = box(0.16, 1.1, 0.04, math.cos(a) * 0.4, math.sin(a) * 0.4, 0.3, PAINT, rng.choice(['#9a6a2f', '#a8763a', '#7d8a3a']))
        o.rotation_euler = (0.7, 0, a)
    return build('bracken')


def hawthorn():
    """A lone, wind-bent hawthorn."""
    cyl(0.18, 2.2, 0, 0, -0.2, PAINT, '#4a3b2e', verts=7, r2=0.12, rx=0.25)
    cyl(0.1, 1.6, 0, -0.4, 1.7, PAINT, '#4a3b2e', verts=6, r2=0.05, rx=1.0)
    for (x, y, z, r) in ((0.3, -0.9, 2.4, 1.0), (-0.5, -1.4, 2.2, 0.85), (0.1, -1.9, 2.0, 0.75), (-0.2, -0.4, 2.7, 0.8)):
        ball(r, x, y, z, sx=1.3, sy=1.4, sz=0.65, col='#4f6332', segs=8)
    return build('hawthorn')


def phonebox():
    w = 1.0
    box(w, w, 2.4, 0, 0, 0, PAINT, '#c4161c')
    for f, (ox, oy) in (('-y', (0, -1)), ('+y', (0, 1)), ('-x', (-1, 0)), ('+x', (1, 0))):
        rz = 0 if f in ('-y', '+y') else math.pi / 2
        for r in range(3):
            box(0.62, 0.04, 0.42, ox * (w / 2 + 0.01), oy * (w / 2 + 0.01), 0.75 + r * 0.48, GLASS, '#2a3238', rz=rz)
        box(0.66, 0.04, 0.14, ox * (w / 2 + 0.02), oy * (w / 2 + 0.02), 2.12, EMISSIVE, '#f2f0e6', rz=rz)
    box(w + 0.12, w + 0.12, 0.2, 0, 0, 2.4, PAINT, '#c4161c')
    ball(0.6, 0, 0, 2.55, sx=1.0, sy=1.0, sz=0.25, col='#c4161c', segs=10)
    return build('phonebox')


def whitepost():
    box(0.14, 0.14, 1.2, 0, 0, -0.2, PAINT, '#f2f0ea')
    box(0.15, 0.15, 0.12, 0, 0, 0.8, PAINT, '#d02a2a')
    return build('whitepost')


def peat():
    rng = random.Random(3)
    for k in range(10):
        box(0.5, 0.25, 0.22, (k % 5) * 0.55 - 1.1, (k // 5) * 0.35, (k // 5) * 0.0 + (k % 2) * 0.22, PAINT,
            rng.choice(['#3b2a20', '#45312a', '#33251b']), rz=(rng.random() - 0.5) * 0.3)
    box(4.0, 1.2, 0.6, 0, 1.6, -0.55, PAINT, '#2f241c')
    return build('peat')


def cottage(name, w=10, d=6, thatch=True, wall='#efe8d8', seed=0, sign=None):
    """A Devon cob cottage: whitewashed walls, deep thatch (or slate), chimneys."""
    plinth(w + 0.3, d + 0.3, top=0.3, col='#7f7a70')
    z = 0.3
    box(w, d, 4.6, 0, 0, z, PLASTER, wall)
    if thatch:
        top = gable(w, d, 0.85, z + 4.4, over=0.7, thick=0.7, kind=PLASTER, col='#8f7446', end_over=0.6)
        prism(w, d, math.tan(0.85) * w / 2, z + 4.6, PLASTER, wall)
        box(0.6, d + 1.5, 0.5, 0, 0, top - 0.25, PLASTER, '#7d6338')
    else:
        top = gable(w, d, 0.62, z + 4.6, over=0.4, thick=0.15, kind=SHINGLES, col='#4b4f55', end_over=0.3)
        prism(w, d, math.tan(0.62) * w / 2, z + 4.6, PLASTER, wall)
    for s in (-1, 1):
        box(0.9, 0.9, top - z + 0.6, s * (w / 2 - 0.1), 0, z, MASONRY, '#8a8478')
    for x in (-w / 2 + 1.6, w / 2 - 1.6):
        window(x, -d / 2, z + 0.9, w=0.9, h=1.0, shutters=None, frame='#f7f4ec')
        window(x, -d / 2, z + 3.0, w=0.8, h=0.8, shutters=None, frame='#f7f4ec')
    door(0, -d / 2, z, w=1.0, h=2.0, col=['#2f4a6b', '#6b2f2f', '#2f5d3a'][seed % 3], frame='#f7f4ec')
    # Porch.
    box(1.8, 1.0, 0.12, 0, -d / 2 - 0.5, z + 2.3, SHINGLES, '#4b4f55')
    if sign:
        cyl(0.07, 3.5, -w / 2 - 1.2, -d / 2 - 1.0, z, PAINT, '#3b2a1e', verts=6)
        box(1.4, 0.06, 0.06, -w / 2 - 0.6, -d / 2 - 1.0, z + 3.4, PAINT, '#3b2a1e')
        box(1.1, 0.08, 0.8, -w / 2 - 0.5, -d / 2 - 1.0, z + 2.5, PAINT, sign)
        box(0.8, 0.09, 0.5, -w / 2 - 0.5, -d / 2 - 1.0, z + 2.65, PAINT, '#e6d9b0')
    return build(name)


def inn():
    """The moorland inn: long, slate-roofed, with a hanging sign and benches."""
    w, d = 18, 8
    plinth(w + 0.3, d + 0.3, top=0.3, col='#7f7a70')
    z = 0.3
    box(w, d, 5.2, 0, 0, z, PLASTER, '#ece6d6')
    top = gable(w, d, 0.6, z + 5.2, over=0.4, thick=0.15, kind=SHINGLES, col='#3f444a', end_over=0.3)
    prism(w, d, math.tan(0.6) * w / 2, z + 5.2, PLASTER, '#ece6d6')
    for s in (-1, 1):
        box(1.0, 1.0, top - z + 0.8, s * (w / 2 - 0.2), 0, z, MASONRY, '#7f7a70')
    for k in range(5):
        x = -w / 2 + 2 + k * 3.5
        window(x, -d / 2, z + 1.0, w=1.2, h=1.1, shutters=None, frame='#f7f4ec')
        window(x, -d / 2, z + 3.4, w=1.0, h=0.9, shutters=None, frame='#f7f4ec')
    door(1.75, -d / 2, z, w=1.2, h=2.2, col='#2a2a2a')
    box(w - 1, 0.1, 0.6, 0, -d / 2 - 0.05, z + 2.55, PAINT, '#1f3a2a')
    cyl(0.1, 4.2, -w / 2 - 1.5, -d / 2 - 1.2, z, PAINT, '#2a2a2a', verts=6)
    box(1.5, 0.06, 0.06, -w / 2 - 0.8, -d / 2 - 1.2, z + 4.1, METAL, '#2a2a2a')
    box(1.2, 0.08, 1.0, -w / 2 - 0.7, -d / 2 - 1.2, z + 2.9, PAINT, '#7a1e1e')
    box(0.9, 0.09, 0.6, -w / 2 - 0.7, -d / 2 - 1.2, z + 3.1, PAINT, '#e6d9b0')
    for x in (-5, 0, 5):
        picnic(x, -d / 2 - 3.5)
    return build('inn')


def picnic(x=0, y=0):
    box(1.8, 0.7, 0.06, x, y, 0.72, PLANKS, '#8a6a48')
    for s in (-1, 1):
        box(1.8, 0.28, 0.05, x, y + s * 0.65, 0.42, PLANKS, '#8a6a48')
        for t in (-1, 1):
            box(0.08, 1.6, 0.08, x + t * 0.7, y, 0.38, PLANKS, '#7a5a3a', rx=0)
            box(0.08, 0.08, 0.75, x + t * 0.7, y + s * 0.3, 0, PLANKS, '#7a5a3a')


def picnic_table():
    picnic()
    return build('picnic')


def church_uk():
    """A moorland church: granite nave, slate roof, tall pinnacled tower."""
    w, d = 9, 20
    plinth(w + 0.4, d + 0.4, top=0.3, col='#7f7a70')
    z = 0.3
    box(w, d, 7, 0, 0, z, MASONRY, '#8e8a80')
    gable(w, d, 0.75, z + 7, over=0.4, thick=0.18, kind=SHINGLES, col='#40454b', end_over=0.3)
    prism(w, d, math.tan(0.75) * w / 2, z + 7, MASONRY, '#8e8a80')
    for k in range(4):
        y = -d / 2 + 4 + k * 4
        for s, f in ((-1, '-x'), (1, '+x')):
            window(s * w / 2, y, z + 2.5, w=1.2, h=3.0, face=f, shutters=None, frame='#a8a397')
    tw = 6.0
    ty = -d / 2 - tw / 2 + 0.5
    box(tw + 0.4, tw + 0.4, 3.3, 0, ty, -3, MASONRY, '#7f7a70')
    box(tw, tw, 26, 0, ty, z, MASONRY, '#8a867c')
    door(0, ty - tw / 2, z, w=1.6, h=3.2, col='#3a2a1e', frame='#a8a397')
    for f, (ox, oy) in (('-y', (0, -1)), ('+y', (0, 1)), ('-x', (-1, 0)), ('+x', (1, 0))):
        window(ox * tw / 2, ty + oy * tw / 2, z + 20.5, w=1.3, h=2.6, face=f, shutters=None, frame='#a8a397')
    box(tw + 0.5, tw + 0.5, 0.6, 0, ty, z + 26, MASONRY, '#9a968c')
    for sx in (-1, 1):
        for sy in (-1, 1):
            cyl(0.45, 3.2, sx * (tw / 2 - 0.2), ty + sy * (tw / 2 - 0.2), z + 26.6, MASONRY, '#9a968c', verts=4, r2=0.05, smooth=False)
    cyl(0.05, 3.0, 0, ty, z + 26.6, METAL, '#2a2a2a', verts=4)
    return build('church_uk')


def prison():
    """Princetown prison: a long, grim granite wall with an arched gate and
    cell blocks behind. About 70 m long along X."""
    L = 70
    box(L, 1.2, 6.5, 0, 0, -2, MASONRY, '#6f6b63')
    box(L + 0.4, 1.5, 0.4, 0, 0, 4.5, MASONRY, '#7a766d')
    # Gatehouse with an arch.
    box(12, 5, 9.5, 0, -1.5, -2, MASONRY, '#77736a')
    box(5, 0.3, 4.6, 0, -4.0, 0, PAINT, '#1e1c1a')
    cyl(2.5, 0.3, 0, -4.0, 4.6, PAINT, '#1e1c1a', verts=16, rx=math.pi / 2)
    box(13, 6, 0.6, 0, -1.5, 7.5, MASONRY, '#827e74')
    # Cell blocks behind.
    for k, x in enumerate((-22, 0, 22)):
        box(9, 40, 13, x, 26, -2, MASONRY, '#6a665e')
        gable(9, 40, 0.5, 11, over=0.3, thick=0.2, kind=SHINGLES, col='#3d4146', x=x, y=26)
        prism(9, 40, math.tan(0.5) * 4.5, 11, MASONRY, '#6a665e', x=x, y=26)
        for r in range(3):
            for c in range(9):
                window(x - 4.5, 10 + c * 4.0, 2 + r * 3.2, w=0.5, h=0.9, face='-x', shutters=None, frame='#5a5650')
    return build('prison')


def tractor():
    box(1.6, 2.6, 0.9, 0, 0.2, 0.7, PAINT, '#2f7d32')
    box(1.2, 1.4, 1.5, 0, 0.9, 1.6, GLASS, '#2a3238')
    box(1.35, 1.55, 0.12, 0, 0.9, 3.1, PAINT, '#2f7d32')
    for s in (-1, 1):
        for y, r, w in ((1.1, 0.8, 0.5), (-0.9, 0.5, 0.35)):
            cyl(r, w, s * (0.85 + w / 2), y, r, PAINT, '#1e1e1e', verts=14, ry=math.pi / 2)
            cyl(r * 0.55, w + 0.02, s * (0.85 + w / 2), y, r, PAINT, '#d6b23a', verts=10, ry=math.pi / 2)
    cyl(0.07, 1.0, 0.5, -0.6, 1.6, METAL, '#2a2a2a', verts=6)
    return build('tractor')


def car(name, col):
    box(1.75, 4.1, 0.75, 0, 0, 0.35, PAINT, col)
    box(1.55, 2.2, 0.62, 0, 0.25, 1.1, GLASS, '#2a3238')
    box(1.6, 2.0, 0.08, 0, 0.25, 1.72, PAINT, col)
    for sx in (-1, 1):
        for sy in (-1.3, 1.3):
            cyl(0.33, 0.24, sx * 0.85, sy, 0.33, PAINT, '#1b1b1b', verts=12, ry=math.pi / 2)
    box(0.5, 0.05, 0.15, -0.55, -2.06, 0.8, EMISSIVE, '#f6f0d8')
    box(0.5, 0.05, 0.15, 0.55, -2.06, 0.8, EMISSIVE, '#f6f0d8')
    return build(name)


def mast():
    """The TV mast on the summit: a 90 m guyed lattice with red lights."""
    H = 90
    for k in range(18):
        z = k * H / 18
        r = 1.6 - k * 0.04
        for a in range(3):
            ang = a * math.tau / 3
            cyl(0.1, H / 18 + 0.05, math.cos(ang) * r, math.sin(ang) * r, z, METAL, '#d8d8d4' if k % 4 < 2 else '#c03a2a', verts=4, smooth=False)
        for a in range(3):
            ang = a * math.tau / 3 + math.pi / 3
            box(0.06, 2.6, 0.06, math.cos(ang) * r * 0.5, math.sin(ang) * r * 0.5, z + 2, METAL, '#cfcfca', rz=ang + math.pi / 2)
    cyl(0.5, 8, 0, 0, H, METAL, '#d8d8d4', verts=6)
    for z in (30, 60, H + 7.5):
        ball(0.35, 0, 0, z, kind=EMISSIVE, col='#ff3a2a', segs=6)
    box(6, 4, 3, 6, 0, 0, PLASTER, '#b9b5ab')
    return build('mast')


def footbridge():
    """Timber footbridge beside a ford, 10 m along X."""
    for s in (-1, 1):
        box(10, 0.15, 0.3, 0, s * 0.6, 0.9, PLANKS, '#6f5a43')
        box(10, 0.08, 0.1, 0, s * 0.6, 1.9, PLANKS, '#7d6a52')
        for x in (-5, -2.5, 0, 2.5, 5):
            box(0.12, 0.12, 1.2, x, s * 0.6, 0.9, PLANKS, '#6f5a43')
    box(10, 1.3, 0.1, 0, 0, 1.15, PLANKS, '#8a7458')
    for x in (-4.9, 4.9):
        box(1.0, 1.6, 1.3, x, 0, -0.2, MASONRY, WALLSTONE)
    return build('footbridge')


def gauge():
    """Ford depth gauge: white post with black depth marks."""
    box(0.22, 0.08, 2.2, 0, 0, -0.4, PAINT, '#f2f0ea')
    for k in range(6):
        box(0.12 if k % 2 else 0.2, 0.09, 0.04, -0.02, 0, 0.0 + k * 0.3, PAINT, '#1d1b19')
    return build('gauge')


def duck(name, head='#1f5a32'):
    ball(0.18, 0, 0, 0.08, sx=0.8, sy=1.3, sz=0.6, col='#8a7458', segs=8)
    ball(0.08, 0, -0.22, 0.22, col=head, segs=6)
    box(0.05, 0.1, 0.03, 0, -0.32, 0.21, PAINT, '#e0a020')
    return build(name)


def clapper():
    """An ancient clapper bridge: long granite slabs on piled stone piers,
    about 13 m along X."""
    rng = random.Random(7)
    piers = (-4.5, -1.5, 1.5, 4.5)
    for x in piers:
        z = -1.6
        for k in range(4):
            rock(1.4 - k * 0.1, 1.6, 0.5, x + (rng.random() - 0.5) * 0.15, 0, z, col=rng.choice(GRANITE), rz=(rng.random() - 0.5) * 0.3, seed=rng.randrange(1000), rough=0.25, detail=1)
            z += 0.44
    for a, b in ((-6.5, -4.5), (-4.5, -1.5), (-1.5, 1.5), (1.5, 4.5), (4.5, 6.5)):
        rock(b - a + 0.6, 1.5, 0.4, (a + b) / 2, (rng.random() - 0.5) * 0.1, 0.12, col=rng.choice(GRANITE), ry=(rng.random() - 0.5) * 0.06, seed=rng.randrange(1000), rough=0.12)
    return build('clapper')


def gate():
    """A galvanised five-bar gate, open, between two granite posts (along X)."""
    for x in (-0.2, 3.9):
        rbox(0.35, 0.35, 1.7, x, 0, -0.3, col='#8a867c', bevel=0.06)
    for k in range(5):
        box(3.6, 0.05, 0.06, 1.9, -0.1, 0.25 + k * 0.25, METAL, '#b8bcc0')
    box(0.06, 0.05, 1.2, 0.1, -0.1, 0.2, METAL, '#b8bcc0')
    box(0.06, 0.05, 1.2, 3.6, -0.1, 0.2, METAL, '#b8bcc0')
    o = box(4.2, 0.05, 0.06, 1.9, -0.1, 0.25, METAL, '#b8bcc0')
    o.rotation_euler = (0, -0.28, 0)
    return build('gate')


def spoil():
    """Quarry spoil heap: a grey mound of broken granite."""
    rng = random.Random(11)
    ball(9, 0, 0, -3.5, sx=1.6, sy=1.0, sz=0.6, kind=PLASTER, col='#8a867e', segs=14)
    for k in range(30):
        a = rng.random() * math.tau
        r = rng.random() * 12
        b = 0.4 + rng.random() * 0.9
        rock(b * 1.3, b, b, math.cos(a) * r, math.sin(a) * r * 0.6, 1.5 - r * 0.25, col=rng.choice(GRANITE), rz=rng.random() * 3, seed=rng.randrange(1000), detail=0)
    return build('spoil')


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    tor('tor_big', 26, 1)
    tor('tor', 16, 2)
    tor('tor_small', 7, 3)
    sheep('sheep')
    sheep('sheep_dark', wool='#d6cdb8', face='#d6cdb8')
    pony('pony', coat='#6b4a33', mane='#2a1f18')
    pony('pony_dark', coat='#3a2c24', mane='#1a1512', blaze='#efe8dc')
    pony('pony_grey', coat='#a39e94', mane='#5e5a54')
    fieldwall()
    ruinwall('ruin_a', 1)
    ruinwall('ruin_b', 2)
    fingerpost()
    triangle_sign('sign_grid', [(-0.2, 0.18, 0.08, 0.2), (0.2, 0.18, 0.08, 0.2), (0, 0.33, 0.5, 0.06)])
    triangle_sign('sign_pony', [(0, 0.24, 0.36, 0.14), (-0.12, 0.12, 0.05, 0.14), (0.12, 0.12, 0.05, 0.14), (-0.2, 0.36, 0.08, 0.12)])
    triangle_sign('sign_ford', [(0, 0.14, 0.5, 0.05), (0, 0.24, 0.4, 0.05)])
    gorse('gorse', 1)
    gorse('gorse_big', 2, 1.6)
    bracken()
    hawthorn()
    phonebox()
    whitepost()
    peat()
    cottage('cottage', seed=0)
    cottage('cottage_b', w=8, d=6, seed=1, wall='#f1e9d2')
    cottage('cottage_slate', w=9, d=6, thatch=False, seed=2, wall='#e4ddcc')
    cottage('tearoom', w=11, d=7, seed=2, wall='#f3ecdb', sign='#2f5d3a')
    inn()
    picnic_table()
    church_uk()
    prison()
    tractor()
    car('car_red', '#a3262a')
    car('car_blue', '#2c4f7c')
    car('car_silver', '#b9bcbf')
    mast()
    footbridge()
    gauge()
    duck('duck')
    duck('duck_b', head='#6e5a44')
    clapper()
    gate()
    spoil()
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'props_dartmoor.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_materials='NONE', export_normals=True,
                              export_texcoords=True, export_apply=True, export_vertex_color='ACTIVE')
    print('wrote', path)


if __name__ == '__main__':
    main()
