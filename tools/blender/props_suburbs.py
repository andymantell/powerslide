"""Builds Hillside Suburbs' props (houses, shops, the school, the park,
street furniture, the seafront) and exports them to
src/assets/models/props_suburbs.glb. Same conventions as props.py, whose
helpers it uses: vertex colour plus a surface kind per face, front facing
Blender -Y (three.js +Z), origin on the ground.

  python tools/blender/props_suburbs.py
"""
import math
import os
import random
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
from props import (EMISSIVE, GLASS, MASONRY, METAL, OUT, PAINT, PLANKS, PLASTER, SHINGLES, ball, box, build, cyl,  # noqa: E402
                   door, gable, mesh, plinth, prism, window)
from props_dartmoor import car  # noqa: E402

BRICK = ['#9a5a43', '#8d4f3b', '#a4644a', '#7f4a3a']
RENDER = ['#efe9dc', '#e9e1cf', '#f1ead6', '#e4ddd0']
DOORS = ['#2f4a6b', '#7a1e1e', '#2f5d3a', '#1d1d1d', '#d8b43a', '#4a6a8a']


def hipped(w, d, z, rise, over=0.4, col='#7b4a3a', kind=SHINGLES):
    """A hipped roof over a w x d footprint (ridge along X)."""
    a, b = w / 2 + over, d / 2 + over
    r = max(0.5, a - b)
    v = [(-a, -b, 0), (a, -b, 0), (a, b, 0), (-a, b, 0), (-r, 0, rise), (r, 0, rise)]
    f = [(0, 1, 5, 4), (2, 3, 4, 5), (1, 2, 5), (3, 0, 4), (3, 2, 1, 0)]
    mesh(v, f, kind, col, z=z)
    return z + rise


def house_front(w, d, z, floors, wall, seed, bay=False):
    rng = random.Random(seed)
    door(-w / 4, -d / 2, z, w=1.0, h=2.1, col=rng.choice(DOORS), frame='#f5f2ea')
    box(1.6, 1.0, 0.12, -w / 4, -d / 2 - 0.5, z + 2.4, PAINT, '#f5f2ea')
    for f in range(floors):
        for x in ((w / 4,) if f == 0 else (-w / 4, w / 4)):
            window(x, -d / 2, z + 0.9 + f * 2.8, w=1.4, h=1.2, shutters=None, frame='#f5f2ea')
    if bay:
        box(2.4, 0.9, 2.5, w / 4, -d / 2 - 0.45, z, MASONRY, rng.choice(BRICK))
        box(2.0, 0.05, 1.3, w / 4, -d / 2 - 0.92, z + 0.9, GLASS, '#1d2830')
        box(2.6, 1.1, 0.15, w / 4, -d / 2 - 0.5, z + 2.5, SHINGLES, '#5b4038')


def semi(name, seed, brick, render):
    """A pair of semi-detached houses: brick below, render above, hipped tiles."""
    w, d = 14, 8.5
    plinth(w + 0.2, d + 0.2, top=0.3, col='#7a6e64')
    z = 0.3
    box(w, d, 2.8, 0, 0, z, MASONRY, brick)
    box(w, d, 2.8, 0, 0, z + 2.8, PLASTER, render)
    hipped(w, d, z + 5.6, 2.8, col='#6e4434')
    box(0.8, 0.8, 2.0, 0, 1.0, z + 7.4, MASONRY, brick)
    for s in (-1, 1):
        rng = random.Random(seed + s)
        x0 = s * w / 4
        door(x0 - s * 1.6, -d / 2, z, w=1.0, h=2.1, col=rng.choice(DOORS), frame='#f5f2ea')
        box(1.6, 1.0, 0.12, x0 - s * 1.6, -d / 2 - 0.5, z + 2.4, PAINT, '#f5f2ea')
        box(2.4, 0.9, 2.5, x0 + s * 0.8, -d / 2 - 0.45, z, MASONRY, brick)
        box(2.0, 0.05, 1.3, x0 + s * 0.8, -d / 2 - 0.92, z + 0.9, GLASS, '#1d2830')
        box(2.6, 1.1, 0.15, x0 + s * 0.8, -d / 2 - 0.5, z + 2.5, SHINGLES, '#5b4038')
        for x in (x0 - s * 1.6, x0 + s * 0.8):
            window(x, -d / 2, z + 3.6, w=1.3, h=1.2, shutters=None, frame='#f5f2ea')
    return build(name)


def bungalow(name, seed, wall, roof):
    w, d = 11, 8
    plinth(w + 0.2, d + 0.2, top=0.3, col='#7a6e64')
    z = 0.3
    box(w, d, 2.7, 0, 0, z, PLASTER, wall)
    box(w + 0.05, d + 0.05, 0.5, 0, 0, z, MASONRY, '#8d4f3b')
    hipped(w, d, z + 2.7, 2.6, over=0.5, col=roof)
    house_front(w, d, z, 1, wall, seed, bay=True)
    window(-w / 4 - 2.0, -d / 2, z + 0.9, w=1.2, h=1.2, shutters=None, frame='#f5f2ea')
    box(0.6, 0.6, 1.5, w / 3, 1.5, z + 4.6, MASONRY, '#8d4f3b')
    return build(name)


def terrace(name, seed):
    """Two Victorian terraced houses (10 m), each its own colour and door,
    with a step down between them so a row can follow a steep street."""
    rng = random.Random(seed)
    for k, x in enumerate((-2.5, 2.5)):
        col = rng.choice(RENDER + ['#cfe0e8', '#f2d9c4', '#e6efd6', '#f3e3b0'])
        zk = 0.3 - k * 0.5
        box(5, 0.2, 0.01, x, 0, 0)
        box(5, 9, 6.0 + 0.6 * k, x, 0, zk - 0.6 * k - 3, MASONRY, '#7a6e64')
        box(4.96, 9, 6.2, x, 0, zk, PLASTER, col)
        door(x - 1.4, -4.5, zk, w=1.0, h=2.1, col=rng.choice(DOORS), frame='#f5f2ea')
        window(x + 0.8, -4.5, zk + 0.8, w=1.6, h=1.4, shutters=None, frame='#f5f2ea')
        window(x - 1.0, -4.5, zk + 3.6, w=1.0, h=1.3, shutters=None, frame='#f5f2ea')
        window(x + 1.2, -4.5, zk + 3.6, w=1.0, h=1.3, shutters=None, frame='#f5f2ea')
        gable(9, 5, 0.6, zk + 6.2, over=0.25, thick=0.12, kind=SHINGLES, col='#4b4f55', x=x, rz=math.pi / 2, end_over=0.0)
        box(0.7, 1.0, 1.6, x + 2.3, 0, zk + 7.6, MASONRY, '#8d4f3b')
    return build(name)


def shops():
    """A parade of three shops with flats above and striped awnings."""
    w, d = 24, 10
    plinth(w + 0.2, d + 0.2, top=0.2, col='#7a6e64')
    z = 0.2
    box(w, d, 7.2, 0, 0, z, MASONRY, '#9a5a43')
    box(w + 0.2, d + 0.2, 0.6, 0, 0, z + 7.2, PLASTER, '#e8e2d4')
    awn = [('#c0392b', '#f5f2ea'), ('#2b6cb0', '#f5f2ea'), ('#2f8a4a', '#f5f2ea')]
    fascia = ['#1f3a5a', '#7a1e1e', '#2f5d3a']
    for k in range(3):
        x = -8 + k * 8
        box(7.6, 0.15, 2.4, x, -d / 2 - 0.05, z + 0.4, GLASS, '#2a3842')
        box(7.8, 0.2, 0.7, x, -d / 2 - 0.1, z + 3.0, PAINT, fascia[k])
        box(5.0, 0.22, 0.4, x, -d / 2 - 0.15, z + 3.15, EMISSIVE, '#f3ecd0')
        for j in range(8):
            o = box(0.95, 1.6, 0.06, x - 3.33 + j * 0.95, -d / 2 - 0.85, z + 2.55, PAINT, awn[k][j % 2])
            o.rotation_euler = (-0.35, 0, 0)
        for wx in (x - 2, x + 2):
            window(wx, -d / 2, z + 4.3, w=1.4, h=1.4, shutters=None, frame='#f5f2ea')
    return build('shops')


def school():
    """A single-storey primary school with tall windows and a bell gable."""
    w, d = 30, 12
    plinth(w + 0.2, d + 0.2, top=0.3, col='#7a6e64')
    z = 0.3
    box(w, d, 4.2, 0, 0, z, MASONRY, '#a4644a')
    gable(d, w, 0.45, z + 4.2, over=0.5, thick=0.15, kind=SHINGLES, col='#4b4f55', rz=math.pi / 2)
    for k in range(8):
        window(-w / 2 + 2.5 + k * 3.6, -d / 2, z + 1.0, w=2.2, h=2.6, shutters=None, frame='#f5f2ea')
    box(4, 1.2, 3.0, 0, -d / 2 - 0.6, z, PLASTER, '#efe9dc')
    door(0, -d / 2 - 1.2, z, w=1.8, h=2.4, col='#2b6cb0', frame='#f5f2ea')
    box(3.6, 0.1, 0.8, 0, -d / 2 - 1.25, z + 2.6, PAINT, '#2b6cb0')
    return build('school')


def swings():
    for x in (-1.6, 1.6):
        for y in (-0.8, 0.8):
            o = cyl(0.06, 2.6, x, y * 0.4, 0, METAL, '#c0392b', verts=6)
            o.rotation_euler = (y * 0.25, 0, 0)
    cyl(0.07, 3.4, -1.7, 0, 2.5, METAL, '#c0392b', verts=6, ry=math.pi / 2)
    for x in (-0.7, 0.7):
        box(0.02, 0.02, 1.9, x - 0.2, 0, 0.6, METAL, '#555555')
        box(0.02, 0.02, 1.9, x + 0.2, 0, 0.6, METAL, '#555555')
        box(0.5, 0.2, 0.05, x, 0, 0.58, PAINT, '#222222')
    return build('swings')


def slide():
    box(0.9, 0.9, 2.0, 0, 1.6, 0, PAINT, '#2b6cb0')
    o = box(0.7, 3.4, 0.06, 0, -0.1, 1.0, METAL, '#e7b416')
    o.rotation_euler = (0.55, 0, 0)
    for k in range(5):
        box(0.7, 0.06, 0.05, 0, 2.2, 0.4 + k * 0.38, METAL, '#888888')
    return build('slide')


def bandstand():
    r = 4.5
    cyl(r + 0.3, 0.8, 0, 0, -0.2, MASONRY, '#d8d2c6', verts=8, smooth=False)
    for k in range(8):
        a = k * math.tau / 8
        cyl(0.1, 3.2, math.cos(a) * r, math.sin(a) * r, 0.6, METAL, '#2f5d3a', verts=6)
    cyl(r + 0.6, 2.0, 0, 0, 3.8, METAL, '#2f5d3a', verts=8, r2=0.3, smooth=False)
    cyl(0.25, 0.8, 0, 0, 5.8, METAL, '#c9a548', verts=6, r2=0.02)
    return build('bandstand')


def oak(name, seed, s=1.0):
    rng = random.Random(seed)
    cyl(0.55 * s, 4.0 * s, 0, 0, -0.3, PAINT, '#4a3b2e', verts=8, r2=0.4 * s)
    for k in range(4):
        a = k * math.tau / 4 + rng.random()
        o = cyl(0.22 * s, 3.2 * s, 0, 0, 3.4 * s, PAINT, '#4a3b2e', verts=6, r2=0.1 * s)
        o.rotation_euler = (0.8, 0, a)
    for k in range(9):
        a = rng.random() * math.tau
        r = rng.random() * 3.2 * s
        ball((2.0 + rng.random() * 1.2) * s, math.cos(a) * r, math.sin(a) * r, (5.8 + rng.random() * 2.4) * s,
             sx=1.2, sy=1.2, sz=0.8, col=rng.choice(['#3f5f2a', '#4a6a30', '#56763a', '#3a5526']), segs=8)
    return build(name)


def railings():
    """3 m of black park railings along X with spear tops."""
    box(3.0, 0.05, 0.06, 0, 0, 0.15, METAL, '#1d1d1d')
    box(3.0, 0.05, 0.06, 0, 0, 1.3, METAL, '#1d1d1d')
    for k in range(20):
        x = -1.45 + k * 0.152
        box(0.025, 0.025, 1.45, x, 0, 0, METAL, '#1d1d1d')
        cyl(0.035, 0.12, x, 0, 1.45, METAL, '#b8913a', verts=4, r2=0.0)
    for x in (-1.5, 1.5):
        box(0.08, 0.08, 1.6, x, 0, -0.2, METAL, '#1d1d1d')
    return build('railings')


def garden_wall(name='garden_wall', col='#9a5a43'):
    """3 m of low front-garden brick wall along X, with coping."""
    box(3.0, 0.25, 0.85, 0, 0, -0.2, MASONRY, col)
    box(3.05, 0.32, 0.08, 0, 0, 0.65, PLASTER, '#d8d2c6')
    return build(name)


def garden_hedge():
    """3 m of clipped privet hedge along X."""
    box(3.0, 0.8, 1.4, 0, 0, -0.1, PAINT, '#3f5f2a')
    ball(0.5, 0, 0, 1.3, sx=3.2, sy=0.9, sz=0.4, col='#4a6a30', segs=8)
    return build('garden_hedge')


def cat_wall():
    garden_wall_parts()
    ball(0.16, 0.3, 0, 0.92, sx=1.0, sy=1.4, sz=1.0, col='#2a2622', segs=8)
    ball(0.1, 0.3, -0.2, 1.12, col='#2a2622', segs=8)
    for s in (-1, 1):
        cyl(0.03, 0.08, 0.3 + s * 0.05, -0.22, 1.19, PAINT, '#2a2622', verts=3, r2=0.0)
    o = cyl(0.025, 0.4, 0.3, 0.2, 0.75, PAINT, '#2a2622', verts=4)
    o.rotation_euler = (0.2, 0, 0)
    return build('cat_wall')


def garden_wall_parts(col='#9a5a43'):
    box(3.0, 0.25, 0.85, 0, 0, -0.2, MASONRY, col)
    box(3.05, 0.32, 0.08, 0, 0, 0.65, PLASTER, '#d8d2c6')


def bin_(name, lid):
    box(0.58, 0.72, 1.0, 0, 0, 0, PAINT, '#2a2d30')
    box(0.62, 0.78, 0.06, 0, 0, 1.0, PAINT, lid)
    for s in (-1, 1):
        cyl(0.1, 0.06, s * 0.3, 0.33, 0.1, PAINT, '#111111', verts=8, ry=math.pi / 2)
    return build(name)


def postbox():
    cyl(0.28, 1.4, 0, 0, 0, PAINT, '#c4161c', verts=14)
    ball(0.3, 0, 0, 1.4, sz=0.4, col='#c4161c', segs=10)
    box(0.3, 0.04, 0.06, 0, -0.28, 1.15, PAINT, '#1d1d1d')
    return build('postbox')


def milk_float():
    box(1.5, 3.4, 0.5, 0, 0, 0.35, PAINT, '#f2f0ea')
    box(1.4, 1.0, 1.4, 0, -1.1, 0.85, GLASS, '#2a3238')
    box(1.5, 2.3, 1.5, 0, 0.5, 0.85, PAINT, '#f2f0ea')
    box(1.55, 3.45, 0.1, 0, 0, 2.35, PAINT, '#2f5d3a')
    for k in range(6):
        box(0.14, 0.14, 0.3, -0.5 + (k % 3) * 0.5, 0.2 + (k // 3) * 0.6, 0.86, GLASS, '#f4f4f0')
    for sx in (-1, 1):
        for sy in (-1.1, 1.1):
            cyl(0.28, 0.2, sx * 0.72, sy, 0.28, PAINT, '#1b1b1b', verts=10, ry=math.pi / 2)
    return build('milk_float')


def van():
    box(1.9, 5.0, 0.7, 0, 0, 0.35, PAINT, '#ecebe6')
    box(1.9, 3.4, 1.5, 0, 0.8, 1.05, PAINT, '#ecebe6')
    box(1.8, 1.4, 0.9, 0, -1.6, 1.05, GLASS, '#2a3238')
    box(1.95, 3.0, 0.4, 0, 0.9, 1.6, PAINT, '#2f8a4a')
    for sx in (-1, 1):
        for sy in (-1.6, 1.6):
            cyl(0.35, 0.24, sx * 0.92, sy, 0.35, PAINT, '#1b1b1b', verts=12, ry=math.pi / 2)
    return build('van')


def aboard():
    for s in (-1, 1):
        o = box(0.6, 0.04, 0.95, 0, s * 0.18, 0, PAINT, '#1f3a5a')
        o.rotation_euler = (s * 0.2, 0, 0)
        o2 = box(0.5, 0.05, 0.6, 0, s * 0.2, 0.25, PAINT, '#f5f2ea')
        o2.rotation_euler = (s * 0.2, 0, 0)
    return build('aboard')


def bikerack():
    for k in range(4):
        o = cyl(0.03, 0.9, -1.2 + k * 0.8, 0, 0, METAL, '#9aa0a6', verts=6)
        cyl(0.03, 0.7, -1.2 + k * 0.8, 0, 0.85, METAL, '#9aa0a6', verts=6, rx=math.pi / 2)
        cyl(0.03, 0.9, -1.2 + k * 0.8, 0.7, 0, METAL, '#9aa0a6', verts=6)
    return build('bikerack')


def belisha():
    """Zebra-crossing beacon: black and white pole with a flashing orange globe."""
    for k in range(6):
        cyl(0.06, 0.45, 0, 0, k * 0.45, PAINT, '#f5f5f0' if k % 2 else '#1d1d1d', verts=8)
    ball(0.2, 0, 0, 2.9, kind=EMISSIVE, col='#ff9a1a', segs=10)
    return build('belisha')


def sign_on_pole(name, col, inner, tri=False):
    cyl(0.04, 2.6, 0, 0.04, -0.3, METAL, '#8e9296', verts=6)
    if tri:
        h = 0.9
        v = [(-h / 2, 0, 1.6), (h / 2, 0, 1.6), (0, 0, 1.6 + h * 0.87)]
        mesh(v + [(x, 0.03, z) for x, _, z in v], [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)], PAINT, col)
        vi = [(-h / 2 + 0.22, -0.01, 1.73), (h / 2 - 0.22, -0.01, 1.73), (0, -0.01, 1.6 + h * 0.87 - 0.26)]
        mesh(vi + [(x, 0.005, z) for x, _, z in vi], [(0, 1, 2), (3, 5, 4)], PAINT, inner)
        box(0.12, 0.02, 0.25, -0.08, -0.03, 1.78, PAINT, '#1d1d1d')
        box(0.1, 0.02, 0.2, 0.1, -0.03, 1.76, PAINT, '#1d1d1d')
    elif name == 'sign_20':
        # Red ring, white middle, a blocky black 20.
        cyl(0.4, 0.04, 0, -0.01, 2.0, PAINT, col, verts=20, rx=math.pi / 2)
        cyl(0.31, 0.045, 0, -0.02, 2.0, PAINT, inner, verts=20, rx=math.pi / 2)
        k = '#1d1d1d'
        for x, z, w, h in ((-0.12, 2.2, 0.14, 0.04), (-0.06, 2.04, 0.035, 0.18), (-0.12, 2.02, 0.14, 0.04),
                           (-0.18, 1.86, 0.035, 0.18), (-0.12, 1.84, 0.14, 0.04),
                           (0.12, 2.2, 0.14, 0.04), (0.12, 1.84, 0.14, 0.04), (0.06, 1.84, 0.035, 0.4), (0.18, 1.84, 0.035, 0.4)):
            box(w, 0.02, h, x, -0.05, z, PAINT, k)
    else:
        cyl(0.4, 0.04, 0, -0.01, 2.0, PAINT, col, verts=20, rx=math.pi / 2)
        box(0.5, 0.05, 0.12, 0, -0.04, 1.95, PAINT, inner)
    return build(name)


def lollipop():
    """School crossing patrol sign, leaning by the kerb."""
    cyl(0.04, 1.8, 0, 0, 0, PAINT, '#f5f5f0', verts=6)
    cyl(0.32, 0.04, 0, -0.02, 2.0, PAINT, '#f5f5f0', verts=20, rx=math.pi / 2)
    cyl(0.28, 0.045, 0, -0.03, 2.0, PAINT, '#e8c22a', verts=20, rx=math.pi / 2)
    box(0.4, 0.05, 0.1, 0, -0.05, 1.95, PAINT, '#c4161c')
    return build('lollipop')


def station_sign():
    for x in (-1.3, 1.3):
        cyl(0.05, 2.4, x, 0, 0, PAINT, '#1d1d1d', verts=6)
    box(3.0, 0.08, 0.7, 0, 0, 1.8, PAINT, '#f5f5f0')
    box(2.9, 0.09, 0.12, 0, 0, 2.1, PAINT, '#c4161c')
    box(1.8, 0.1, 0.18, 0, 0, 1.85, PAINT, '#1d1d1d')
    return build('station_sign')


def shed(name, col):
    box(2.4, 1.8, 2.0, 0, 0, 0, PLANKS, col)
    gable(1.8, 2.4, 0.45, 2.0, over=0.15, thick=0.06, kind=PAINT, col='#2a2a2a', rz=math.pi / 2)
    prism(1.8, 2.4, 0.45, 2.0, PLANKS, col, rz=math.pi / 2)
    door(0, -0.9, 0, w=0.8, h=1.8, col=col, frame=col)
    return build(name)


def greenhouse():
    box(3.0, 2.0, 0.4, 0, 0, 0, MASONRY, '#9a5a43')
    box(3.0, 2.0, 1.6, 0, 0, 0.4, GLASS, '#c8d8d0')
    prism(2.0, 3.0, 0.6, 2.0, GLASS, '#c8d8d0', rz=math.pi / 2)
    return build('greenhouse')


def compost():
    box(1.0, 1.0, 1.0, 0, 0, 0, PAINT, '#2a2d30')
    return build('compost')


def church_hall():
    w, d = 16, 10
    plinth(w + 0.2, d + 0.2, top=0.3, col='#7a6e64')
    z = 0.3
    box(w, d, 4.5, 0, 0, z, MASONRY, '#a4644a')
    gable(d, w, 0.6, z + 4.5, over=0.4, thick=0.15, kind=SHINGLES, col='#4b4f55', rz=math.pi / 2)
    prism(d, w, math.tan(0.6) * d / 2, z + 4.5, MASONRY, '#a4644a', rz=math.pi / 2)
    for k in range(4):
        window(-w / 2 + 2.5 + k * 3.7, -d / 2, z + 1.2, w=1.4, h=2.2, shutters=None, frame='#f5f2ea')
    door(-w / 2, 0, z, w=1.6, h=2.4, face='-x', col='#2f5d3a', frame='#f5f2ea')
    return build('church_hall')


def bollard():
    cyl(0.12, 0.9, 0, 0, 0, PAINT, '#f5f5f0', verts=10)
    cyl(0.125, 0.15, 0, 0, 0.6, PAINT, '#1d1d1d', verts=10)
    return build('bollard')


def keepleft():
    cyl(0.3, 1.0, 0, 0, 0, PAINT, '#f5f5f0', verts=10)
    box(0.5, 0.06, 0.7, 0, -0.3, 1.0, PAINT, '#f5f5f0')
    cyl(0.25, 0.04, 0, -0.34, 1.35, PAINT, '#1f4fa0', verts=20, rx=math.pi / 2)
    box(0.24, 0.04, 0.06, 0, -0.37, 1.35, PAINT, '#f5f5f0', rz=0)
    return build('keepleft')


def garden_centre():
    w, d = 26, 14
    plinth(w + 0.2, d + 0.2, top=0.2, col='#7a6e64')
    z = 0.2
    box(w, d, 4.5, 0, 0, z, GLASS, '#b9c9c2')
    for k in range(9):
        box(0.15, 0.15, 4.5, -w / 2 + k * w / 8, -d / 2, z, METAL, '#2f5d3a')
    prism(d, w, 2.5, z + 4.5, GLASS, '#b9c9c2', rz=math.pi / 2)
    box(10, 0.2, 1.0, 0, -d / 2 - 0.1, z + 4.6, PAINT, '#2f8a4a')
    return build('garden_centre')


def pier():
    """A seaside pier running out along -Y, 90 m long, with a pavilion."""
    L = 90
    box(6, L, 0.4, 0, -L / 2, 4.0, PLANKS, '#8a7458')
    for y in range(0, L + 1, 6):
        for x in (-2.6, 2.6):
            cyl(0.18, 10, x, -y, -6, METAL, '#4a4f55', verts=6)
        box(5.4, 0.12, 0.12, 0, -y, 1.5, METAL, '#4a4f55', rx=0)
    for s in (-1, 1):
        box(0.06, L, 0.06, s * 3, -L / 2, 5.3, METAL, '#f5f5f0')
    box(14, 14, 0.4, 0, -L - 6, 4.0, PLANKS, '#8a7458')
    box(12, 10, 4, 0, -L - 6, 4.4, PLASTER, '#f5f2ea')
    cyl(3, 3, 0, -L - 6, 8.4, METAL, '#3a8a8a', verts=12, r2=0.3)
    for k in range(5):
        box(0.4, 0.4, 3, -5.0 + k * 2.5, -L - 1.5, 4.4, PAINT, '#3a8a8a')
    return build('pier')


def beach_hut(name, col):
    box(2.4, 2.4, 0.4, 0, 0, -0.2, PLANKS, '#8a7458')
    box(2.2, 2.2, 2.2, 0, 0, 0.2, PLANKS, col)
    gable(2.2, 2.2, 0.6, 2.4, over=0.15, thick=0.08, kind=PAINT, col='#f5f2ea')
    prism(2.2, 2.2, math.tan(0.6) * 1.1, 2.4, PLANKS, col)
    box(1.2, 0.06, 1.9, 0, -1.1, 0.2, PLANKS, '#f5f2ea')
    return build(name)


def lamppost():
    """Street light: a grey column with a curved arm and a light head over
    the road (+Y from the base, so it leans out from the kerb)."""
    cyl(0.1, 7.5, 0, 0, 0, METAL, '#6c7075', verts=8, r2=0.07)
    o = cyl(0.05, 1.6, 0, 0, 7.4, METAL, '#6c7075', verts=6)
    o.rotation_euler = (-1.2, 0, 0)
    box(0.35, 0.7, 0.14, 0, -1.6, 7.9, METAL, '#4a4e52')
    box(0.28, 0.6, 0.04, 0, -1.6, 7.86, EMISSIVE, '#ffe2a8')
    return build('lamppost')


def busstop():
    for x in (-1.6, 1.6):
        cyl(0.04, 2.4, x, 0.6, 0, METAL, '#6c7075', verts=6)
    box(3.4, 1.4, 0.08, 0, 0.0, 2.4, METAL, '#6c7075')
    box(3.2, 0.04, 1.8, 0, 0.62, 0.4, GLASS, '#b8c8d0')
    box(0.04, 1.2, 1.8, -1.6, 0.0, 0.4, GLASS, '#b8c8d0')
    cyl(0.04, 2.8, 2.2, -0.2, 0, METAL, '#6c7075', verts=6)
    cyl(0.25, 0.04, 2.2, -0.22, 2.6, PAINT, '#c4161c', verts=16, rx=math.pi / 2)
    return build('busstop')


def tpole():
    cyl(0.14, 9, 0, 0, -0.5, PLANKS, '#5a4636', verts=8, r2=0.1)
    box(1.4, 0.1, 0.1, 0, 0, 7.8, PLANKS, '#5a4636')
    return build('tpole')


def train_car():
    """One railway carriage, 20 m along X, for the railway bridge."""
    L = 20
    box(L, 2.8, 2.8, 0, 0, 0.9, PAINT, '#2f5d8a')
    box(L, 2.82, 0.5, 0, 0, 2.0, PAINT, '#e7b416')
    for k in range(9):
        for s in (-1, 1):
            box(1.4, 0.05, 0.8, -L / 2 + 1.5 + k * 2.1, s * 1.42, 2.2, GLASS, '#1d2830')
    ball(1.45, 0, 0, 3.7, sx=L / 2.9, sy=1.0, sz=0.22, kind=METAL, col='#9aa0a6', segs=12)
    for x in (-L / 2 + 3, L / 2 - 3):
        box(2.4, 2.2, 0.8, x, 0, 0.1, METAL, '#2a2a2a')
    return build('train_car')


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    semi('semi', 1, '#9a5a43', '#efe9dc')
    semi('semi_b', 2, '#8d4f3b', '#e9e1cf')
    semi('semi_c', 3, '#a4644a', '#f2efe6')
    bungalow('bungalow', 4, '#efe9dc', '#6e4434')
    bungalow('bungalow_b', 5, '#e6dcc8', '#4b4f55')
    terrace('terrace', 6)
    terrace('terrace_b', 7)
    shops()
    school()
    swings()
    slide()
    bandstand()
    oak('oak', 1)
    oak('oak_big', 2, 1.35)
    railings()
    garden_wall()
    garden_wall('garden_wall_b', '#b8a68e')
    garden_hedge()
    cat_wall()
    bin_('bin_green', '#2f7d32')
    bin_('bin_black', '#2a2d30')
    bin_('bin_blue', '#1f4fa0')
    postbox()
    milk_float()
    van()
    car('car_red', '#a3262a')
    car('car_blue', '#2c4f7c')
    car('car_silver', '#b9bcbf')
    car('car_white', '#ecebe6')
    aboard()
    bikerack()
    belisha()
    sign_on_pole('sign_school', '#c62f2f', '#f4f1e8', tri=True)
    sign_on_pole('sign_20', '#c62f2f', '#f4f1e8')
    lollipop()
    station_sign()
    shed('shed', '#5f7d4a')
    shed('shed_b', '#8a6a48')
    greenhouse()
    compost()
    church_hall()
    bollard()
    keepleft()
    garden_centre()
    pier()
    beach_hut('hut_blue', '#5aa0d0')
    beach_hut('hut_yellow', '#f0cd34')
    beach_hut('hut_pink', '#e892a8')
    beach_hut('hut_green', '#7cc08a')
    lamppost()
    busstop()
    tpole()
    train_car()
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'props_suburbs.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_materials='NONE', export_normals=True,
                              export_texcoords=True, export_apply=True, export_vertex_color='ACTIVE')
    print('wrote', path)


if __name__ == '__main__':
    main()
