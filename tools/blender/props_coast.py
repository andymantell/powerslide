"""Builds Coastal Cliffs' props (the lighthouse and its keepers' cottages,
the fishing harbour's cottages, boats, pots and harbour light, sea stacks
and a sea arch, the wreck and the lifeboat station, the castle ruin and its
gatehouse, wind turbines and windsocks, camper vans, the ice cream van, the
surf school and the cliff-top cafe) and exports them to
src/assets/models/props_coast.glb. Same conventions as props.py, whose
helpers it uses: vertex colour plus a surface kind per face, front facing
Blender -Y (three.js +Z), origin on the ground. Boats, stacks, the arch and
the wreck have their origin at the waterline. The coast also loads Dartmoor's
and the suburbs' props (cottages, gorse, fingerposts, beach huts, the train).

  python tools/blender/props_coast.py
"""
import math
import os
import random
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
from props import (EMISSIVE, GLASS, MASONRY, METAL, OUT, PAINT, PLANKS, PLASTER, SHINGLES, ball, box, build, cyl,  # noqa: E402
                   door, gable, hexrgb, mesh, plinth, prism, window)
from props_dartmoor import rock  # noqa: E402
import props as P  # noqa: E402

LEAVES = 8
SLATE = '#3f454c'
GRANITE = ['#6e6c66', '#7a776f', '#5f5e59', '#86827a', '#696a66', '#57585a']
TURF = '#5d7a3a'
WASH = ['#f2efe6', '#e8e2d2', '#f4ead0', '#dfe8ea', '#f0dcd0', '#e4ecd8', '#f2e2b8', '#d8e2ee']


def colour_faces(o, cols):
    attr = o.data.color_attributes['Col']
    for p, c in zip(o.data.polygons, cols):
        rgba = hexrgb(c)
        for li in p.loop_indices:
            attr.data[li].color = rgba


def _waves(rng, n=4, amp=0.15):
    terms = [(k, rng.uniform(0, math.tau), amp * rng.uniform(0.4, 1.0) / k ** 0.8) for k in range(1, n + 1)]
    return lambda a: sum(A * math.sin(k * a + p) for k, p, A in terms)


SEAROCK = ['#5e5d58', '#66645e', '#6e6b64', '#5a5a5a', '#625f58', '#6a675f']


def _bands(rng, H, n=7):
    """Strata: a few bands of grey up the rock, each its own shade."""
    cuts = sorted(rng.uniform(0, H) for _ in range(n))
    cols = [rng.choice(SEAROCK) for _ in range(n + 1)]
    return lambda z: cols[sum(1 for c in cuts if z > c)]


def roughen(o, strength, size, seed):
    """Pushes a rock mesh in and out along its normals with cloud noise, so
    it reads as weathered rock rather than a smooth tube."""
    t = bpy.data.textures.new(f'rough{seed}', 'CLOUDS')
    t.noise_scale = size
    t.noise_depth = 2
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    for v in o.data.vertices:
        v.co.x += seed * 3.1
        v.co.y += seed * 1.7
    m = o.modifiers.new('d', 'DISPLACE')
    m.texture = t
    m.texture_coords = 'LOCAL'
    m.strength = strength
    m.mid_level = 0.5
    bpy.ops.object.modifier_apply(modifier='d')
    for v in o.data.vertices:
        v.co.x -= seed * 3.1
        v.co.y -= seed * 1.7


# ------------------------------------------------------------ rock

def stack(name, seed, R, H, lean=0.0, sides=28, rings=22):
    """A sea stack: a column of dark, jointed rock rising from the water,
    wider at the foot where the waves have piled boulders, with a cap of
    turf and a lean. Origin at the waterline; it carries on 12 m below."""
    rng = random.Random(seed)
    out = _waves(rng, 6, 0.22)
    joints = sorted(rng.uniform(0.15, 0.9) for _ in range(4))
    band = _bands(rng, H)
    zs = [-12, -2] + [H * (i / (rings - 3)) for i in range(rings - 2)]
    verts, faces, cols = [], [], []
    for z in zs:
        t = max(0.0, z / H)
        for k in range(sides):
            a = k / sides * math.tau
            r = R * (1 + out(a)) * (1.25 - 0.35 * t + 0.25 * max(0.0, 0.25 - t) * 4)
            # Each joint steps the face in a little.
            r *= 1 - 0.05 * sum(1 for j in joints if t > j) + rng.uniform(-0.03, 0.03)
            verts.append((math.cos(a) * r + lean * z, math.sin(a) * r, z))
    n = len(zs)
    for i in range(n - 1):
        for k in range(sides):
            a, b = i * sides + k, i * sides + (k + 1) % sides
            faces.append((a, b, b + sides, a + sides))
            zc = (zs[i] + zs[i + 1]) / 2
            cols.append('#4a4a46' if zc < 1.2 else band(zc))
    # Domed turf cap: a ring of turf just over the edge, then a low dome.
    last = (n - 1) * sides
    for k in range(sides):
        x, y, z = verts[last + k]
        cx = lean * H
        verts.append((cx + (x - cx) * 0.65, y * 0.65, H + R * 0.16))
    ring = len(verts) - sides
    for k in range(sides):
        faces.append((last + k, last + (k + 1) % sides, ring + (k + 1) % sides, ring + k))
        cols.append(TURF)
    top = len(verts)
    verts.append((lean * H, 0, H + R * 0.24))
    for k in range(sides):
        faces.append((ring + k, ring + (k + 1) % sides, top))
        cols.append(TURF)
    o = mesh(verts, faces, PLASTER, GRANITE[0])
    colour_faces(o, cols)
    for p in o.data.polygons:
        p.use_smooth = True
    roughen(o, R * 0.35, R * 0.45, seed)
    # Boulders round the foot.
    for k in range(5):
        a = rng.uniform(0, math.tau)
        rr = R * 1.3
        rock(R * 0.5, R * 0.45, R * 0.3, math.cos(a) * rr, math.sin(a) * rr, -R * 0.15, '#5a5954', seed=seed * 10 + k, rough=0.2, detail=1, warp=0.2)
    return build(name)


def sea_arch():
    """A natural arch standing in the sea, 60 m across X and 34 m high, with
    the sea running through it (Y): a thick, jointed band of dark rock with a
    turf top, its legs planted in the water. Origin at the waterline."""
    rng = random.Random(70)
    band = _bands(rng, 40)
    S, Hc = 22.0, 30.0
    N, M = 64, 28
    verts, faces, cols = [], [], []
    for i in range(N + 1):
        t = i / N
        ang = math.pi * t
        f = lambda a: (-S * math.cos(a), Hc * max(0.0, math.sin(a)) ** 0.7 - 14.0 * (1 - math.sin(a)) ** 3)
        x, z = f(ang)
        x2, z2 = f(ang + 0.01)
        tx, tz = x2 - x, z2 - z
        tl = math.hypot(tx, tz) or 1
        nx, nz = -tz / tl, tx / tl
        feet = abs(math.cos(ang)) ** 3
        rr = 5.5 + 7 * feet
        rd = 9 + 5 * feet
        for k in range(M):
            th = k / M * math.tau
            bump = 1 + 0.16 * math.sin(th * 3 + i * 0.5) + 0.08 * math.sin(th * 7 + i * 1.3) + rng.uniform(-0.03, 0.03)
            verts.append((x + nx * math.cos(th) * rr * bump, math.sin(th) * rd * bump, z + nz * math.cos(th) * rr * bump))
    for i in range(N):
        for k in range(M):
            a, b = i * M + k, i * M + (k + 1) % M
            faces.append((a, a + M, b + M, b))
            zc = (verts[a][2] + verts[b + M][2]) / 2
            up = math.cos(k / M * math.tau) > 0.55 and zc > Hc - 4
            cols.append(TURF if up else '#4a4a46' if zc < 1.5 else band(zc))
    o = mesh(verts, faces, PLASTER, GRANITE[0])
    colour_faces(o, cols)
    for p in o.data.polygons:
        p.use_smooth = True
    roughen(o, 3.2, 5.0, 7)
    for k, s in enumerate((-1, 1, -1, 1)):
        rock(7, 8, 4, s * (S + 6 + k * 2), rng.uniform(-8, 8), -2, '#5a5954', seed=71 + k, rough=0.2, detail=1, warp=0.25)
    return build('sea_arch')


def reef(name='reef', seed=80):
    """A low scatter of wave-washed rocks just breaking the surface."""
    rng = random.Random(seed)
    for k in range(7):
        s = rng.uniform(1.5, 4)
        rock(s * 1.4, s, s * 0.6, rng.uniform(-10, 10), rng.uniform(-6, 6), -s * 0.4, '#4e4e4a', seed=seed + k, rough=0.25, detail=1, warp=0.2)
    return build(name)


# ------------------------------------------------------------ buildings

def lighthouse():
    """A round tower 28 m tall striped red and white, with a black gallery
    and lantern on top (the lamp glows), on a granite plinth."""
    cyl(4.0, 1.5, 0, 0, -1.0, MASONRY, '#7a776f', verts=20)
    bands = 6
    H = 24.0
    for k in range(bands):
        z0, z1 = 0.5 + k * H / bands, 0.5 + (k + 1) * H / bands
        r0, r1 = 3.2 - 1.0 * k / bands, 3.2 - 1.0 * (k + 1) / bands
        cyl(r0, z1 - z0, 0, 0, z0, PLASTER, '#c8302a' if k % 2 else '#f4f2ec', verts=20, r2=r1)
    for z in (5, 10, 15, 19.5):
        box(0.7, 0.2, 1.1, 0, -(3.2 - z / H) - 0.02, z, GLASS, '#1d2830')
    door(0, -3.2, 0.5, w=1.1, h=2.2, col='#2a2a2a', frame='#f4f2ec')
    z = 0.5 + H
    cyl(3.0, 0.3, 0, 0, z, PAINT, '#2a2a2a', verts=20)
    for k in range(20):
        a = k / 20 * math.tau
        cyl(0.04, 1.0, math.cos(a) * 2.9, math.sin(a) * 2.9, z + 0.3, METAL, '#2a2a2a', verts=4)
    cyl(2.95, 0.06, 0, 0, z + 1.3, METAL, '#2a2a2a', verts=20)
    cyl(1.6, 0.8, 0, 0, z + 0.3, PAINT, '#2a2a2a', verts=16)
    cyl(1.55, 2.0, 0, 0, z + 1.1, GLASS, '#3a4a50', verts=16)
    cyl(0.6, 1.2, 0, 0, z + 1.5, EMISSIVE, '#fff2c0', verts=10)
    cyl(1.7, 1.2, 0, 0, z + 3.1, PAINT, '#2a2a2a', verts=16, r2=0.3)
    ball(0.3, 0, 0, z + 4.4, kind=PAINT, col='#2a2a2a', segs=8)
    cyl(0.03, 1.4, 0, 0, z + 4.4, METAL, '#2a2a2a', verts=4)
    return build('lighthouse')


def keepers():
    """The keepers' cottages: a low whitewashed terrace of three with slate
    roofs and chimneys, inside a white yard wall."""
    w, d = 21, 6.5
    plinth(w + 0.3, d + 0.3, top=0.3, col='#7f7a70')
    box(w, d, 3.2, 0, 0, 0.3, PLASTER, '#f2f0ea')
    top = gable(d, w, 0.55, 3.5, over=0.3, thick=0.15, kind=SHINGLES, col=SLATE, end_over=0.25, rz=math.pi / 2)
    prism(d, w, math.tan(0.55) * d / 2, 3.5, PLASTER, '#f2f0ea', rz=math.pi / 2)
    for k in range(3):
        x = -w / 2 + 3.5 + k * 7
        door(x, -d / 2, 0.3, w=1.0, h=2.0, col='#1f3f5f', frame='#f4f2ec')
        window(x - 1.8, -d / 2, 1.1, w=1.0, h=1.1, shutters=None, frame='#f7f4ec')
        window(x + 1.8, -d / 2, 1.1, w=1.0, h=1.1, shutters=None, frame='#f7f4ec')
        box(0.8, 0.9, top - 3.0, x + 3.5 if k < 2 else x + 3.0, 0, 3.0, MASONRY, '#d8d4ca')
    # Yard wall in front with a gap for the gate.
    for s in (-1, 1):
        box(w / 2 - 1.2, 0.5, 1.4, s * (w / 4 + 0.6), -d / 2 - 5, 0, PLASTER, '#f2f0ea')
        box(0.5, 5, 1.4, s * (w / 2 + 0.25), -d / 2 - 2.5, 0, PLASTER, '#f2f0ea')
    return build('keepers')


def fisher_cottage(name, seed):
    """A fisherman's cottage for the harbour: two storeys, 6 m wide, a
    colour-washed or granite front, slate roof, a chimney each end."""
    rng = random.Random(seed)
    w, d = 6.0, 7.0
    granite = seed % 4 == 3
    col = '#8a867c' if granite else WASH[seed % len(WASH)]
    plinth(w + 0.2, d + 0.2, top=0.25, col='#6e6a62')
    box(w, d, 5.6, 0, 0, 0.25, MASONRY if granite else PLASTER, col)
    # The ridge runs along the street (X), so a row reads as a terrace.
    top = gable(d, w, 0.62, 5.85, over=0.25, thick=0.14, kind=SHINGLES, col=SLATE, end_over=0.0, rz=math.pi / 2)
    prism(d, w, math.tan(0.62) * d / 2, 5.85, MASONRY if granite else PLASTER, col, rz=math.pi / 2)
    trim = '#f4f2ec' if granite else rng.choice(['#f4f2ec', '#2f4a6b', '#2f5d3a'])
    door(-1.4, -d / 2, 0.25, w=0.95, h=2.0, col=rng.choice(['#1f3f5f', '#6b2f2f', '#2f5d3a', '#e8c040']), frame=trim)
    window(1.2, -d / 2, 1.0, w=1.2, h=1.2, shutters=None, frame=trim)
    window(-1.4, -d / 2, 3.6, w=1.0, h=1.0, shutters=None, frame=trim)
    window(1.2, -d / 2, 3.6, w=1.0, h=1.0, shutters=None, frame=trim)
    box(0.7, 0.8, top - 5.0, rng.choice([-1, 1]) * (w / 2 - 0.4), d / 4, 5.0, MASONRY, '#8a867c')
    return build(name)


def harbour_light():
    """The light at the end of the harbour wall: a short white stone tower
    with a green lamp."""
    cyl(1.3, 6, 0, 0, 0, MASONRY, '#e8e4da', verts=14, r2=1.0)
    cyl(1.25, 0.3, 0, 0, 6, PAINT, '#2a2a2a', verts=14)
    cyl(0.6, 1.0, 0, 0, 6.3, GLASS, '#2a4a3a', verts=10)
    cyl(0.35, 0.7, 0, 0, 6.45, EMISSIVE, '#4aff7a', verts=8)
    cyl(0.7, 0.6, 0, 0, 7.3, PAINT, '#2a2a2a', verts=10, r2=0.1)
    door(0, -1.15, 0, w=0.8, h=1.8, col='#2f5d3a', frame='#e8e4da')
    return build('harbour_light')


def lifeboat_station():
    """A lifeboat house on the shore, 12 m wide, with big blue doors facing
    the sea (-Y) and a slipway running down from them; a lookout on top."""
    w, d = 12, 18
    plinth(w + 0.3, d + 0.3, top=0.4, col='#7a776f')
    box(w, d, 8, 0, 0, 0.4, PLASTER, '#f2f0ea')
    gable(w, d, 0.5, 8.4, over=0.4, thick=0.18, kind=SHINGLES, col='#7a3a2e', end_over=0.3)
    prism(w, d, math.tan(0.5) * w / 2, 8.4, PLASTER, '#f2f0ea')
    box(7, 0.2, 6.4, 0, -d / 2 - 0.05, 0.4, PLANKS, '#1f4f8f')
    box(7.6, 0.25, 0.4, 0, -d / 2 - 0.05, 6.8, PAINT, '#f2f0ea')
    box(5, 0.2, 0.8, 0, -d / 2 - 0.1, 7.3, PAINT, '#1f4f8f')
    for s in (-1, 1):
        window(s * 4.6, -d / 2, 3.5, w=1.0, h=1.6, shutters=None, frame='#1f4f8f')
    # Slipway: a ramp of timber on piles, out and down.
    L = 34
    v = [(-2.5, -d / 2, 0.4), (2.5, -d / 2, 0.4), (2.5, -d / 2 - L, -6), (-2.5, -d / 2 - L, -6)]
    v += [(x, y, z - 0.6) for x, y, z in v]
    mesh(v, [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], PLANKS, '#6a5444')
    for k in range(6):
        y = -d / 2 - 4 - k * 6
        z = 0.4 - (k * 6 + 4) / L * 6.4
        for s in (-1, 1):
            cyl(0.18, z + 8, s * 2.2, y, -8, PLANKS, '#4a3a2e', verts=6)
    for s in (-1, 1):
        box(0.15, L, 0.15, s * 0.9, -d / 2 - L / 2, -2.6, METAL, '#8a8a8a', rx=math.atan2(6.4, L))
    # The boat on the slip, ready to go: blue hull, orange top.
    box(3.6, 13, 2.2, 0, -d / 2 - 3, 0.6, PAINT, '#1f3f7f')
    box(3.0, 5, 2.2, 0, -d / 2 - 2, 2.8, PAINT, '#e8701a')
    box(3.05, 4.6, 0.7, 0, -d / 2 - 2, 4.0, GLASS, '#1d2830')
    return build('lifeboat_station')


def castle_keep():
    """A ruined square keep, 14 m on a side: thick granite walls broken off
    at different heights, arrow slits, an empty window high up."""
    rng = random.Random(90)
    s = 14
    plinth(s + 1, s + 1, top=0.4, col='#6e6c66')
    hs = [16, 11, 18, 8]
    for k, (x, y, sx, sy) in enumerate(((0, -s / 2 + 1, s, 2), (s / 2 - 1, 0, 2, s), (0, s / 2 - 1, s, 2), (-s / 2 + 1, 0, 2, s))):
        H = hs[k]
        box(sx, sy, H, x, y, 0, MASONRY, rng.choice(GRANITE))
        # A broken, stepped top.
        for j in range(4):
            f = (j - 1.5) / 4
            box(sx / 4 if sx > 2 else 2, sy / 4 if sy > 2 else 2, rng.uniform(0, 2.5), x + f * (sx if sx > 2 else 0), y + f * (sy if sy > 2 else 0), H, MASONRY, rng.choice(GRANITE))
    for z in (3, 7):
        box(0.3, 0.1, 1.4, -3, -s / 2 - 0.02, z, PAINT, '#1a1a1a')
        box(0.3, 0.1, 1.4, 3, -s / 2 - 0.02, z, PAINT, '#1a1a1a')
    box(1.6, 0.1, 2.6, 0, -s / 2 - 0.02, 11, PAINT, '#1a1a1a')
    box(2.2, 0.1, 3.2, 0, -s / 2 - 0.02, 0.4, PAINT, '#1a1a1a')
    # Fallen stones.
    for k in range(6):
        rock(1.4, 1.1, 0.8, rng.uniform(-10, 10), rng.uniform(-11, -8), 0, rng.choice(GRANITE), seed=91 + k, rough=0.2, detail=1)
    return build('castle_keep')


def castle_tower():
    """A round corner tower, ruined to an uneven top."""
    rng = random.Random(95)
    cyl(4.4, 13, 0, 0, -1, MASONRY, GRANITE[1], verts=18, r2=4.0)
    for k in range(9):
        a = k / 9 * math.tau
        box(2.4, 1.6, rng.uniform(0.5, 3.5), math.cos(a) * 3.4, math.sin(a) * 3.4, 12, MASONRY, rng.choice(GRANITE), rz=a)
    for z in (4, 8):
        box(0.3, 0.1, 1.3, 0, -4.25, z, PAINT, '#1a1a1a')
    return build('castle_tower')


def castle_wall():
    """A 20 m run of curtain wall along X, 2 m thick, crenellated where it
    still stands and broken down to a stump at one end."""
    rng = random.Random(97)
    L = 20
    for k in range(10):
        x = -L / 2 + 1 + k * 2
        H = 7.5 if k < 6 else 7.5 - (k - 5) * 1.4
        box(2.02, 2, H, x, 0, -1, MASONRY, rng.choice(GRANITE))
        if k < 6 and k % 2 == 0:
            box(1.0, 2, 1.0, x - 0.5, 0, H - 1, MASONRY, rng.choice(GRANITE))
    box(L, 2.6, 0.6, 0, 0, -1, MASONRY, '#5f5e59')
    return build('castle_wall')


def castle_gate():
    """The gatehouse: two drum towers 15 m apart on X with the road running
    between them (Y) under a pointed arch and a portcullis slot, with
    battlements across the top."""
    rng = random.Random(98)
    gap = 4.5  # half the clear width at road level
    for s in (-1, 1):
        cyl(3.6, 16, s * (gap + 3.2), 0, -2, MASONRY, GRANITE[0], verts=18)
        for k in range(8):
            a = k / 8 * math.tau
            box(1.6, 1.2, 1.3, s * (gap + 3.2) + math.cos(a) * 3.1, math.sin(a) * 3.1, 14, MASONRY, rng.choice(GRANITE), rz=a)
        for z in (5, 9):
            box(0.3, 0.1, 1.3, s * (gap + 3.2), -3.62, z, PAINT, '#1a1a1a')
        # The gate passage walls.
        box(0.9, 7, 7, s * (gap + 0.45), 0, -1, MASONRY, GRANITE[2])
    # The arch over the road: voussoirs round a pointed opening.
    N = 14
    for k in range(N + 1):
        t = k / N
        ang = math.pi * t
        x = -gap * math.cos(ang)
        z = 5.6 + 2.6 * math.sin(ang) ** 0.8
        box(1.2, 7.2, 0.9, x, 0, z, MASONRY, '#7a776f', ry=-(ang - math.pi / 2) * 0.6)
    box(2 * gap + 1.8, 7, 4.2, 0, 0, 8.3, MASONRY, GRANITE[1])
    for k in range(6):
        box(1.0, 7, 1.0, -gap + 0.5 + k * 2.0, 0, 12.5, MASONRY, rng.choice(GRANITE))
    # The portcullis, raised, its teeth just showing.
    for k in range(7):
        box(0.12, 0.12, 1.4, -gap + 1 + k * (2 * gap - 2) / 6, -2, 6.6, METAL, '#2a2622')
    box(2 * gap, 0.14, 0.14, 0, -2, 7.6, METAL, '#2a2622')
    return build('castle_gate')


def flag():
    """A tall white pole with a red and gold flag streaming in the wind."""
    cyl(0.1, 10, 0, 0, 0, PAINT, '#f2f0ea', verts=8, r2=0.06)
    ball(0.14, 0, 0, 10, kind=PAINT, col='#e8c040', segs=6)
    v = [(0.08, 0, 9.8), (2.6, 0.25, 9.6), (3.8, -0.15, 9.4), (3.8, -0.15, 8.0), (2.6, 0.2, 8.1), (0.08, 0, 8.2)]
    mesh(v, [(0, 1, 4, 5), (1, 2, 3, 4)], PAINT, '#c4161c')
    mesh([(x, y - 0.02, z) for x, y, z in v], [(5, 4, 1, 0), (4, 3, 2, 1)], PAINT, '#c4161c')
    box(1.0, 0.06, 0.5, 1.6, 0.1, 8.65, PAINT, '#e8c040')
    return build('flag')


# ------------------------------------------------------------ boats

def hull(L, B, D, col, sheer='#f2f0ea', rise=0.5, x0=0.0, deck='#8a7a66'):
    """A boat hull along X (bow +X): beam B, depth D, its bottom below 0."""
    prof = [(-L / 2, 0.82), (-L / 4, 1.0), (L / 6, 1.0), (L * 0.36, 0.75), (L / 2, 0.02)]
    v = []
    for x, s in prof:
        top = D + rise * max(0.0, (x / (L / 2))) ** 2
        v += [(x + x0, -B / 2 * s * 0.55, -D * 0.6), (x + x0, B / 2 * s * 0.55, -D * 0.6), (x + x0, B / 2 * s, top), (x + x0, -B / 2 * s, top)]
    faces = []
    for i in range(len(prof) - 1):
        a, b = i * 4, (i + 1) * 4
        faces += [(a, b, b + 3, a + 3), (a + 1, a + 2, b + 2, b + 1), (a, a + 1, b + 1, b)]
    n = len(prof) * 4
    faces += [(0, 3, 2, 1)]
    mesh(v, faces, PAINT, col)
    # Deck and a bright band at the sheer.
    mesh([(x + x0, -B / 2 * s * 0.96, D * 0.75 + rise * max(0.0, x / (L / 2)) ** 2) for x, s in prof] +
         [(x + x0, B / 2 * s * 0.96, D * 0.75 + rise * max(0.0, x / (L / 2)) ** 2) for x, s in prof][::-1],
         [tuple(range(2 * len(prof)))], PLANKS, deck)
    for side in (-1, 1):
        v2 = [(x + x0, side * B / 2 * s * 1.003, D + rise * max(0.0, x / (L / 2)) ** 2 - h) for x, s in prof for h in (0, 0.3)]
        f2 = [(2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1) if side > 0 else (2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2) for i in range(len(prof) - 1)]
        mesh(v2, f2, PAINT, sheer)


def fishing_boat(name, col, cab='#f2f0ea', seed=1):
    """A 12 m inshore fishing boat: wheelhouse aft, a mast and derrick,
    pots stacked on deck. Origin at the waterline."""
    rng = random.Random(seed)
    hull(12, 4.2, 1.4, col)
    box(2.6, 2.4, 2.2, -2.8, 0, 1.0, PAINT, cab)
    box(2.65, 2.45, 0.8, -2.8, 0, 2.2, GLASS, '#1d2830')
    box(3.0, 2.8, 0.15, -2.8, 0, 3.2, PAINT, '#2a2a2a')
    cyl(0.1, 7, 0.5, 0, 1.0, PAINT, '#e8e4da', verts=6)
    o = cyl(0.06, 4, 0.5, 0, 3.5, PAINT, '#e8e4da', verts=6)
    o.rotation_euler = (0, 1.0, 0)
    for k in range(rng.randint(3, 6)):
        box(0.9, 0.7, 0.6, 2.0 + (k % 3) * 0.95, -0.6 + (k // 3) * 0.75, 1.05, PAINT, '#2a3a4a')
    box(0.6, 0.6, 0.1, -2.8, 0, 3.35, PAINT, '#e8701a')
    return build(name)


def dinghy(name='dinghy', col='#c8302a'):
    """A small rowing dinghy pulled up on the sand."""
    hull(3.6, 1.5, 0.55, col, rise=0.15)
    box(1.4, 0.2, 0.06, 0, 0, 0.35, PLANKS, '#8a7a66')
    return build(name)


def wreck():
    """A rusty steel trawler driven onto the rocks: 38 m, broken behind the
    wheelhouse, listing, the bow high on the rocks and the stern sunk."""
    rng = random.Random(60)
    rust = ['#7a3a1e', '#8a4a2a', '#6a3020', '#5a2a1a', '#9a5a32']
    # Bow half, up on the rocks and heeled over.
    hull(22, 7.5, 3.4, '#6a3020', sheer='#8a4a2a', rise=1.2, x0=8, deck='#4a2a1e')
    o = bpy.context.active_object
    for k in range(5):
        box(rng.uniform(1, 3), 0.06, rng.uniform(0.6, 2.0), rng.uniform(-2, 16), -3.0 + rng.uniform(-0.2, 0.2), rng.uniform(0, 2.5), PAINT, rng.choice(rust))
    box(4.5, 5, 3.5, 0, 0, 2.6, PAINT, '#8a4a2a')
    box(4.6, 5.1, 1.0, 0, 0, 4.4, PAINT, '#3a2a22')
    cyl(0.25, 9, 6, 0, 2.6, METAL, '#5a2a1a', verts=6, rx=0.2)
    build('_bow')
    bow = bpy.data.objects['_bow']
    bow.rotation_euler = (0.42, -0.2, 0.05)
    bow.location = (2, 0, 2.2)
    bpy.ops.object.select_all(action='DESELECT')
    bow.select_set(True)
    bpy.context.view_layer.objects.active = bow
    bpy.ops.object.transform_apply(location=True, rotation=True)
    P.PARTS.append(bow)
    # Stern half, settled lower and twisted.
    hull(14, 7.5, 3.4, '#5a2a1a', sheer='#7a3a1e', rise=0.0, x0=-10, deck='#3e2418')
    cyl(0.6, 3, -12, 0, 3, METAL, '#3a2a22', verts=10)
    for k in range(4):
        box(rng.uniform(1, 2.5), 0.06, rng.uniform(0.5, 1.5), rng.uniform(-16, -4), 3.0, rng.uniform(-0.5, 2), PAINT, rng.choice(rust))
    build('_stern')
    st = bpy.data.objects['_stern']
    st.rotation_euler = (-0.38, 0.12, 0.3)
    st.location = (-4, 2.5, -2.6)
    bpy.ops.object.select_all(action='DESELECT')
    st.select_set(True)
    bpy.context.view_layer.objects.active = st
    bpy.ops.object.transform_apply(location=True, rotation=True)
    P.PARTS.append(st)
    # The rocks it lies on.
    for k in range(6):
        rock(rng.uniform(3, 6), rng.uniform(3, 5), rng.uniform(1.5, 3), rng.uniform(-6, 20), rng.uniform(-6, 6), -2.2, '#4e4e4a', seed=61 + k, rough=0.22, detail=1, warp=0.2)
    return build('wreck')


# ------------------------------------------------------------ cliff top

def turbine():
    """A wind turbine's white tower, 62 m to the hub, with its nacelle
    facing -Y. The rotor (turbine_rotor) turns separately."""
    cyl(2.2, 62, 0, 0, -1, PAINT, '#f2f4f4', verts=16, r2=1.3)
    cyl(4.0, 1.2, 0, 0, -1, MASONRY, '#9a9890', verts=16)
    box(3.2, 11, 3.6, 0, 1.6, 61, PAINT, '#eef0f0')
    ball(1.6, 0, -4.1, 62.8, sx=1.1, sy=1.4, sz=1.1, kind=PAINT, col='#eef0f0', segs=12)
    box(1.0, 0.06, 2.2, 0, -0.2, 63, PAINT, '#2a2a2a')
    return build('turbine')


def turbine_rotor():
    """Three tapered blades, 40 m long, round a hub at the origin, in the XZ
    plane (they spin about Y), red tips for the aircraft."""
    L = 40
    for k in range(3):
        a = k / 3 * math.tau
        c, sn = math.cos(a), math.sin(a)
        rot = lambda p: (p[0] * c + p[2] * sn, p[1], -p[0] * sn + p[2] * c)
        for z0, z1, col in ((1.2, L - 5, '#f2f4f4'), (L - 5, L, '#c8302a')):
            w0 = 1.5 - 1.1 * (z0 / L)
            w1 = 1.5 - 1.1 * (z1 / L)
            v = [(-w0, 0, z0), (w0 * 1.1, 0, z0), (w1 * 1.1, 0, z1), (-w1, 0, z1)]
            v += [(x * 0.8, 0.3, z) for x, _, z in v]
            mesh([rot(p) for p in v], [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (2, 6, 7, 3), (1, 5, 6, 2), (0, 3, 7, 4)], PAINT, col)
    ball(1.3, 0, -0.6, 0, sx=1, sy=1.6, sz=1, kind=PAINT, col='#eef0f0', segs=10)
    return build('turbine_rotor')


def windsock():
    """A windsock on a striped pole, streaming straight out (+X)."""
    cyl(0.06, 6, 0, 0, 0, METAL, '#c8c8c8', verts=6)
    ring = 0.45
    for k in range(5):
        r0 = ring * (1 - k * 0.12)
        cyl(r0, 0.6, 0.35 + k * 0.6, 0, 5.6, PAINT, '#e8701a' if k % 2 == 0 else '#f2f0ea', verts=10, r2=r0 * 0.88, ry=math.pi / 2 + 0.12)
    return build('windsock')


def sign_wind():
    """UK warning triangle for side winds: the windsock picture."""
    from props_dartmoor import triangle_sign
    return triangle_sign('sign_wind', [(-0.2, 0.15, 0.04, 0.5), (0.0, 0.52, 0.42, 0.06), (0.05, 0.42, 0.32, 0.06), (0.1, 0.33, 0.22, 0.06)])


def sign_cliff():
    """A white board on two posts: DANGER, cliff edge (red bar, black text bars)."""
    for s in (-1, 1):
        cyl(0.05, 1.8, s * 0.55, 0, 0, PAINT, '#e8e4da', verts=6)
    box(1.3, 0.05, 0.8, 0, 0, 0.9, PAINT, '#f4f2ec')
    box(1.2, 0.06, 0.24, 0, 0, 1.4, PAINT, '#c4161c')
    for k in range(3):
        box(1.0 - k * 0.2, 0.06, 0.06, 0, 0, 1.2 - k * 0.12, PAINT, '#1d1b19')
    return build('sign_cliff')


def cafe():
    """The cliff-top cafe: a long, low granite building with a slate roof,
    big windows and a sign facing the road (-Y), and a terrace of tables
    under striped parasols out to the side."""
    w, d = 16, 8
    plinth(w + 0.3, d + 0.3, top=0.3, col='#6e6c66')
    box(w, d, 3.6, 0, 0, 0.3, MASONRY, '#8a867c')
    top = gable(d, w, 0.5, 3.9, over=0.5, thick=0.15, kind=SHINGLES, col=SLATE, end_over=0.4, rz=math.pi / 2)
    prism(d, w, math.tan(0.5) * d / 2, 3.9, MASONRY, '#8a867c', rz=math.pi / 2)
    for x in (-5, -1.5, 2):
        box(2.8, 0.1, 1.8, x, -d / 2 - 0.03, 1.0, GLASS, '#2a3a40')
        box(3.0, 0.14, 0.12, x, -d / 2 - 0.04, 2.8, PAINT, '#f4f2ec')
    door(5.5, -d / 2, 0.3, w=1.2, h=2.2, col='#2f5d6b', frame='#f4f2ec')
    box(6, 0.12, 0.9, -1.5, -d / 2 - 0.08, 3.0, PAINT, '#2f5d6b')
    box(5.4, 0.14, 0.5, -1.5, -d / 2 - 0.1, 3.2, PAINT, '#f4f2ec')
    box(0.8, 0.9, top - 3.0, -w / 2 + 1, 0, 3.0, MASONRY, '#7a776f')
    # The terrace, off the +X end.
    box(10, 12, 0.3, w / 2 + 5.5, 0, 0, MASONRY, '#9a968c')
    for k, (x, y) in enumerate(((w / 2 + 3, -3), (w / 2 + 8, -3), (w / 2 + 3, 3), (w / 2 + 8, 3))):
        cyl(0.5, 0.05, x, y, 1.0, PLANKS, '#8a6a4a', verts=10)
        cyl(0.05, 0.75, x, y, 0.3, METAL, '#3a3a3a', verts=5)
        cyl(0.04, 2.1, x, y, 0.3, METAL, '#e8e4da', verts=5)
        for j in range(8):
            a0, a1 = j / 8 * math.tau, (j + 1) / 8 * math.tau
            v = [(x, y, 2.75), (x + math.cos(a0) * 1.4, y + math.sin(a0) * 1.4, 2.35), (x + math.cos(a1) * 1.4, y + math.sin(a1) * 1.4, 2.35)]
            mesh(v + [(a, b, c - 0.03) for a, b, c in v], [(0, 1, 2), (3, 5, 4)], PAINT, ['#c8302a', '#2f6b8a', '#e8b416'][k % 3] if j % 2 else '#f4f2ec')
        for j in range(3):
            a = j / 3 * math.tau + k
            box(0.4, 0.4, 0.45, x + math.cos(a) * 0.9, y + math.sin(a) * 0.9, 0.3, PLANKS, '#6a5444')
    # Low wall round the terrace.
    box(0.4, 12, 0.8, w / 2 + 10.6, 0, 0, MASONRY, '#7a776f')
    return build('cafe')


def camper(name, col, roof=False):
    """A classic split-screen camper van: two-tone, a V on the nose (+Y
    is the back), a pop-top roof on some."""
    box(1.8, 4.3, 1.2, 0, 0, 0.35, PAINT, col)
    box(1.8, 4.3, 0.85, 0, 0, 1.55, PAINT, '#f2efe6')
    ball(0.95, 0, -2.0, 1.25, sx=0.98, sy=0.35, sz=0.9, kind=PAINT, col=col, segs=10)
    for s in (-1, 1):
        box(0.7, 0.06, 0.5, s * 0.45, -2.27, 1.75, GLASS, '#1d2830')
        for k in range(3):
            box(0.05, 0.75, 0.45, s * 0.91, -0.5 + k * 1.1, 1.8, GLASS, '#1d2830')
        for y in (-1.45, 1.35):
            cyl(0.33, 0.24, s * 0.82, y, 0.33, PAINT, '#1a1a1a', verts=12, ry=math.pi / 2)
    box(0.05, 0.06, 0.5, 0, -2.3, 1.15, PAINT, '#f2efe6', ry=0.5)
    box(0.05, 0.06, 0.5, 0, -2.3, 1.15, PAINT, '#f2efe6', ry=-0.5)
    if roof:
        v = [(-0.85, -1.5, 2.4), (0.85, -1.5, 2.4), (0.85, 1.6, 2.4), (-0.85, 1.6, 2.4), (0.85, -1.5, 3.0), (-0.85, -1.5, 3.0)]
        mesh(v, [(0, 1, 4, 5), (1, 2, 4), (3, 0, 5), (5, 4, 2, 3)], PAINT, '#f2efe6')
    return build(name)


def ice_cream_van():
    """An ice cream van: a cream box body with a serving hatch on its left
    (-X), a giant cone on the roof."""
    box(2.1, 5.6, 2.6, 0, 0, 0.4, PAINT, '#f4ead0')
    box(2.12, 5.62, 0.35, 0, 0, 0.4, PAINT, '#e86a9a')
    box(2.0, 1.4, 1.0, 0, -2.6, 0.4, PAINT, '#f4ead0')
    box(1.9, 0.06, 0.7, 0, -3.32, 1.0, GLASS, '#1d2830')
    box(0.06, 2.2, 1.0, -1.06, 0.6, 1.4, GLASS, '#1d2830')
    box(0.5, 2.4, 0.08, -1.3, 0.6, 2.45, PAINT, '#e86a9a')
    cyl(0.35, 0.9, 0, 1.4, 3.0, PLANKS, '#d8a050', verts=10, r2=0.05, rx=math.pi)
    ball(0.4, 0, 1.4, 3.15, kind=PAINT, col='#fff4f0', segs=8)
    for s in (-1, 1):
        for y in (-1.9, 1.8):
            cyl(0.38, 0.26, s * 0.98, y, 0.38, PAINT, '#1a1a1a', verts=12, ry=math.pi / 2)
    return build('ice_cream_van')


def surf_school():
    """The surf school: a blue clapboard shack with a rack of boards and a
    flag, on the sand."""
    box(6, 4, 3, 0, 0, 0, PLANKS, '#3a7a9a')
    gable(4, 6, 0.3, 3, over=0.3, thick=0.1, kind=METAL, col='#d8d8d0', rz=math.pi / 2)
    prism(4, 6, math.tan(0.3) * 2, 3, PLANKS, '#3a7a9a', rz=math.pi / 2)
    box(2.4, 0.1, 2.0, -1, -2.02, 0, PLANKS, '#f2f0ea')
    box(4, 0.1, 0.6, 0, -2.05, 2.3, PAINT, '#f4c020')
    # Board rack.
    cols = ['#e8701a', '#f4c020', '#2fa8c8', '#e84a6a', '#f2f0ea', '#4ac86a']
    for s in (-1, 1):
        box(0.1, 0.1, 2.0, 4.0, s * 1.5, 0, PLANKS, '#6a5444')
    for k, c in enumerate(cols):
        ball(0.28, 4.0 + (k - 2.5) * 0.12, 0, 1.25, sx=0.15, sy=1.0, sz=4.2, kind=PAINT, col=c, segs=8)
    return build('surf_school')


def surfboard_rack():
    """Boards stood up against a rail, for the beach."""
    cols = ['#2fa8c8', '#e84a6a', '#f4c020', '#f2f0ea']
    box(3, 0.1, 0.1, 0, 0, 1.4, PLANKS, '#6a5444')
    for s in (-1, 1):
        box(0.1, 0.1, 1.5, s * 1.45, 0, 0, PLANKS, '#6a5444')
    for k, c in enumerate(cols):
        ball(0.27, -1.0 + k * 0.65, 0.25, 1.1, sx=1.0, sy=0.15, sz=4.0, kind=PAINT, col=c, segs=8, rx=-0.2)
    return build('surfboard_rack')


def lobster_pots():
    """A stack of withy and net pots, with a coil of rope and a buoy."""
    rng = random.Random(5)
    for k in range(9):
        x, y, z = (k % 3) * 0.8 - 0.8, ((k // 3) % 2) * 0.8 - 0.4, (k // 6) * 0.55
        cyl(0.36, 0.5, x, y, z, PLANKS, rng.choice(['#6a5a3a', '#2a3a4a', '#4a3a2a']), verts=8, r2=0.3)
    cyl(0.5, 0.15, 1.6, 0.4, 0, PAINT, '#c8a83a', verts=12)
    ball(0.3, 1.5, -0.6, 0.3, kind=PAINT, col='#e8701a', segs=8)
    return build('lobster_pots')


def fish_boxes():
    """Plastic fish boxes stacked on the quay."""
    rng = random.Random(6)
    for k in range(7):
        box(1.0, 0.6, 0.3, (k % 2) * 1.05, 0, (k // 2) * 0.3, PAINT, rng.choice(['#2f6b9a', '#e8701a', '#4a8a4a', '#d8c040']))
    return build('fish_boxes')


def bollard_quay():
    cyl(0.35, 0.6, 0, 0, 0, METAL, '#2a2a2a', verts=10)
    cyl(0.5, 0.15, 0, 0, 0.6, METAL, '#2a2a2a', verts=10)
    return build('bollard_quay')


def bench_sea():
    """A memorial bench on the cliff path, facing the view."""
    box(1.8, 0.45, 0.06, 0, 0, 0.45, PLANKS, '#8a6a4a')
    box(1.8, 0.06, 0.45, 0, 0.22, 0.5, PLANKS, '#8a6a4a')
    for s in (-1, 1):
        box(0.08, 0.5, 0.45, s * 0.8, 0, 0, PLANKS, '#6a5444')
    return build('bench_sea')


def viaduct_bay():
    """One 18 m bay of a granite railway viaduct along X: a tall tapering
    pier and half of the round arch either side of it, deck at z = 0 and
    the pier running 60 m down so it reaches whatever ground is below."""
    L, B = 18.0, 7.0
    col = '#7a766c'
    # Pier, tapering out towards its foot.
    v = []
    for z, hw, hd in ((-60, 2.6, 5.2), (-9.5, 1.6, 4.2)):
        v += [(-hw, -hd, z), (hw, -hd, z), (hw, hd, z), (-hw, hd, z)]
    mesh(v, [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], MASONRY, col)
    # Spandrels and soffit: the arch's intrados, a half-arch to each side.
    R = L / 2 - 1.6
    N = 10
    for side in (-1, 1):
        for k in range(N):
            a0, a1 = math.pi * k / (N * 2), math.pi * (k + 1) / (N * 2)
            # From the pier face (angle 0) up to the crown (pi/2), mirrored.
            x0, z0 = side * (1.6 + R - R * math.cos(a0)), -9.5 + R * math.sin(a0)
            x1, z1 = side * (1.6 + R - R * math.cos(a1)), -9.5 + R * math.sin(a1)
            for y in (-B / 2, B / 2):
                f = [(x0, y, z0), (x1, y, z1), (x1, y, -1.2), (x0, y, -1.2)]
                mesh(f if (y < 0) == (side > 0) else f[::-1], [(0, 1, 2, 3)], MASONRY, col)
            f = [(x0, -B / 2, z0), (x1, -B / 2, z1), (x1, B / 2, z1), (x0, B / 2, z0)]
            mesh(f[::-1] if side > 0 else f, [(0, 1, 2, 3)], MASONRY, '#6a665e')
    # Deck slab, string course and parapets.
    box(L, B + 0.6, 1.2, 0, 0, -1.2, MASONRY, '#6e6a62')
    for s in (-1, 1):
        box(L, 0.5, 1.1, 0, s * (B / 2 + 0.05), 0, MASONRY, col)
        box(L, 0.6, 0.15, 0, s * (B / 2 + 0.05), 1.1, MASONRY, '#9a968c')
    # Ballast and track.
    box(L, 3.4, 0.25, 0, 0, 0, PAINT, '#6d665c')
    for s in (-0.75, 0.75):
        box(L, 0.08, 0.15, 0, s, 0.25, METAL, '#8a8580')
    return build('viaduct_bay')


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    stack('stack_a', 1, 9, 48, lean=0.04)
    stack('stack_b', 2, 6.5, 30, lean=-0.06)
    stack('stack_c', 3, 11, 20, lean=0.02)
    sea_arch()
    reef()
    lighthouse()
    keepers()
    for k in range(8):
        fisher_cottage(f'fisher_{"abcdefgh"[k]}', k)
    harbour_light()
    lifeboat_station()
    castle_keep()
    castle_tower()
    castle_wall()
    castle_gate()
    flag()
    fishing_boat('boat_a', '#1f4f8f', seed=1)
    fishing_boat('boat_b', '#c8302a', seed=2)
    fishing_boat('boat_c', '#2f6b3a', cab='#f4c020', seed=3)
    fishing_boat('boat_d', '#f2f0ea', cab='#2f6b9a', seed=4)
    dinghy('dinghy', '#c8302a')
    dinghy('dinghy_b', '#2f6b9a')
    wreck()
    turbine()
    turbine_rotor()
    windsock()
    sign_wind()
    sign_cliff()
    cafe()
    camper('camper', '#2f8a8a', roof=True)
    camper('camper_b', '#c8502a')
    camper('camper_c', '#6a9a4a', roof=True)
    ice_cream_van()
    surf_school()
    surfboard_rack()
    lobster_pots()
    fish_boxes()
    bench_sea()
    bollard_quay()
    viaduct_bay()
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'props_coast.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_materials='NONE', export_normals=True,
                              export_texcoords=True, export_apply=True, export_vertex_color='ACTIVE')
    print('wrote', path)


if __name__ == '__main__':
    main()
