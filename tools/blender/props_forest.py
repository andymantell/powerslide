"""Builds Pine Forest's props (the ranger station, logging gear, the sawmill,
lakeside cabins, the fire lookout, burnt snags and the giant tunnel tree)
and exports them to src/assets/models/props_forest.glb. Same conventions as
props.py, whose helpers it uses: vertex colour plus a surface kind per face,
front facing Blender -Y (three.js +Z), origin on the ground.

  python tools/blender/props_forest.py
"""
import math
import os
import random
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
from props import (EMISSIVE, GLASS, MASONRY, METAL, OUT, PAINT, PLANKS, SHINGLES, ball, box, build, cyl,  # noqa: E402
                   door, gable, mesh, plinth, prism, window)
from props_dartmoor import rock  # noqa: E402

LEAVES = 8
BARK = ['#7a5a40', '#6c4e37', '#866448', '#73543c']
ENDS = ['#c9a26c', '#bf9660', '#d1ad78', '#b88d5a']
LOGWALL = '#7a5636'


def log(r, L, x, y, z, rz=0, tilt=0, bark=None, end=None, verts=8, seed=0):
    """A felled log of radius r and length L, centred on (x, y, z), lying
    along X turned by rz (and pitched by tilt), with pale sawn ends."""
    rng = random.Random(seed)
    bark = bark or rng.choice(BARK)
    end = end or rng.choice(ENDS)
    dx, dy, dz = math.cos(rz) * math.cos(tilt), math.sin(rz) * math.cos(tilt), math.sin(tilt)
    sx, sy, sz = x - dx * L / 2, y - dy * L / 2, z - dz * L / 2
    cyl(r, L, sx, sy, sz, PLANKS, bark, verts=verts, ry=math.pi / 2 - tilt, rz=rz)
    if end:
        for k in (-0.01, L + 0.002):
            cyl(r * 0.9, 0.012, sx + dx * k, sy + dy * k, sz + dz * k, PAINT, end, verts=verts, ry=math.pi / 2 - tilt, rz=rz)


def logwall_box(w, d, h, z=0, col=LOGWALL, notch=True):
    """A log-cabin box: stacked horizontal logs on all four walls, the
    corners crossing past each other."""
    r = 0.17
    n = int(h / (r * 2))
    for i in range(n):
        zz = z + r + i * r * 2
        c = ['#7a5636', '#6e4c30', '#84603e'][i % 3] if col == LOGWALL else col
        over = 0.35 if notch else 0
        log(r, w + over * 2, 0, -d / 2, zz, 0, bark=c, end='#b48a5a', verts=6, seed=i)
        log(r, w + over * 2, 0, d / 2, zz, 0, bark=c, end='#b48a5a', verts=6, seed=i + 1)
        log(r, d + over * 2, -w / 2, 0, zz + r, math.pi / 2, bark=c, end='#b48a5a', verts=6, seed=i + 2)
        log(r, d + over * 2, w / 2, 0, zz + r, math.pi / 2, bark=c, end='#b48a5a', verts=6, seed=i + 3)
    # Infill behind the logs so there are no gaps to see through.
    box(w - 0.1, d - 0.1, h, 0, 0, z, PLANKS, '#4e3624')
    return z + h


def sign_board(w, h, x, y, z, col, posts='#5c4632', post_h=None, rz=0):
    post_h = post_h or z + h
    for s in (-1, 1):
        box(0.12, 0.12, post_h, x + s * (w / 2 - 0.15), y + 0.08, 0, PLANKS, posts, rz=rz)
    box(w, 0.08, h, x, y, z, PLANKS, col, rz=rz)


# ------------------------------------------------------------ ranger station

def ranger_hut():
    """Forest ranger station: a log cabin with a deep porch, a green tin
    roof, a stone chimney and a flagpole."""
    w, d = 9, 7
    plinth(w + 0.4, d + 0.4, top=0.5, col='#7d776c')
    z = 0.5
    top = logwall_box(w, d, 3.0, z)
    rh = math.tan(0.6) * w / 2
    prism(w, d, rh, top, PLANKS, '#6e4c30')
    gable(w, d + 3.2, 0.6, top, over=0.7, thick=0.12, kind=SHINGLES, col='#4f7550', y=-1.6, end_over=0.3)
    # Porch: deck, rail and posts under the long roof.
    box(w + 0.6, 3.0, 0.18, 0, -d / 2 - 1.5, z - 0.18, PLANKS, '#8a6a48')
    for x in (-w / 2, -w / 6, w / 6, w / 2):
        cyl(0.12, 3.1, x, -d / 2 - 2.9, z, PLANKS, '#6e4c30', verts=8)
    for s in (-1, 1):
        box(w / 2 - 1.0, 0.08, 0.08, s * (w / 4 + 0.5), -d / 2 - 2.9, z + 0.9, PLANKS, '#6e4c30')
    box(1.8, 1.0, 0.18, 0, -d / 2 - 3.4, 0.25, PLANKS, '#8a6a48')
    door(0, -d / 2 - 0.2, z, w=1.1, h=2.15, col='#3d5a3a', frame='#c9b48a')
    for x in (-w * 0.3, w * 0.3):
        window(x, -d / 2 - 0.2, z + 1.0, w=1.3, h=1.1, shutters=None, frame='#c9b48a')
    # Sign over the porch: routed yellow letters on brown.
    box(3.4, 0.1, 0.55, 0, -d / 2 - 2.95, z + 3.15, PLANKS, '#5a3b22')
    for k in range(7):
        box(0.28, 0.12, 0.3, -1.2 + k * 0.4, -d / 2 - 3.0, z + 3.27, PAINT, '#e8c04a')
    # Stone chimney at the end.
    for i in range(9):
        box(1.3, 1.1, 0.75, w / 2 + 0.5, 1.0, -0.2 + i * 0.75, MASONRY, ['#8b867d', '#7b766e', '#958f85'][i % 3])
    # Flagpole.
    cyl(0.06, 9, -w / 2 - 2.0, -d / 2 - 2.5, 0, METAL, '#d9d9d9', verts=6)
    box(1.5, 0.03, 0.95, -w / 2 - 1.22, -d / 2 - 2.5, 7.9, PAINT, '#2f5d3a')
    box(0.5, 0.035, 0.3, -w / 2 - 1.22, -d / 2 - 2.5, 8.2, PAINT, '#e8c04a')
    return build('ranger_hut')


def sign_fire():
    """Fire danger board: a half-dial in green, blue, yellow, orange and red
    with a pointer, under a little shingle roof."""
    for s in (-1, 1):
        box(0.15, 0.15, 3.2, s * 1.1, 0.05, 0, PLANKS, '#5c4632')
    box(2.6, 0.1, 1.6, 0, 0, 1.2, PLANKS, '#6b4a2c')
    box(2.4, 0.11, 0.3, 0, -0.01, 1.3, PAINT, '#f1e8d0')
    cols = ['#2f7d3a', '#2a5fa8', '#e8c22a', '#e07a1f', '#c62d24']
    cx, cz, R = 0, 1.75, 0.95
    for i, c in enumerate(cols):
        a0, a1 = math.pi - i * math.pi / 5, math.pi - (i + 1) * math.pi / 5
        v = [(cx, -0.07, cz), (cx + math.cos(a0) * R, -0.07, cz + math.sin(a0) * R), (cx + math.cos(a1) * R, -0.07, cz + math.sin(a1) * R)]
        mesh(v, [(0, 2, 1)], PAINT, c)
    # Pointer at "high".
    a = math.pi * 0.28
    box(0.06, 0.03, R * 0.9, cx, -0.09, cz, PAINT, '#1d1d1d', ry=math.pi / 2 - a)
    cyl(0.08, 0.04, cx, -0.08, cz, PAINT, '#1d1d1d', verts=8, rx=math.pi / 2)
    gable(2.6, 0.6, 0.5, 2.85, over=0.2, thick=0.06, kind=SHINGLES, col='#4a3a2c', rz=math.pi / 2)
    return build('sign_fire')


def picnic_table():
    box(1.9, 0.75, 0.07, 0, 0, 0.74, PLANKS, '#8a6a48')
    for s in (-1, 1):
        box(1.9, 0.3, 0.06, 0, s * 0.68, 0.44, PLANKS, '#8a6a48')
        for t in (-1, 1):
            box(0.09, 0.09, 0.85, t * 0.72, s * 0.32, 0, PLANKS, '#6e5236', rx=s * 0.45)
        box(0.08, 1.7, 0.08, s * 0.72, 0, 0.36, PLANKS, '#6e5236')
    return build('picnic_table')


def trail_map():
    """Trail map board: a map of green woods, blue lakes and red trails."""
    for s in (-1, 1):
        box(0.15, 0.15, 2.6, s * 1.0, 0.1, 0, PLANKS, '#5c4632')
    box(2.3, 0.1, 1.4, 0, 0.05, 0.9, PLANKS, '#6b4a2c')
    box(2.0, 0.05, 1.15, 0, -0.02, 1.02, PAINT, '#9cbf7a')
    rng = random.Random(4)
    for _ in range(6):
        box(rng.uniform(0.2, 0.5), 0.05, rng.uniform(0.15, 0.4), rng.uniform(-0.75, 0.75), -0.04, rng.uniform(1.1, 1.8), PAINT, '#4f7d3b')
    box(0.45, 0.05, 0.25, 0.5, -0.05, 1.4, PAINT, '#4a84c4')
    for k in range(6):
        box(0.32, 0.05, 0.04, -0.7 + k * 0.28, -0.06, 1.3 + math.sin(k) * 0.25, PAINT, '#c62d24', ry=0.4 * math.cos(k * 1.7))
    gable(2.4, 0.7, 0.55, 2.4, over=0.2, thick=0.06, kind=SHINGLES, col='#4a3a2c', rz=math.pi / 2)
    return build('trail_map')


def sign_forestry(name='sign_forestry', lines=3):
    """Brown forestry sign with routed yellow lettering, on two posts."""
    sign_board(2.6, 1.0, 0, 0, 1.0, '#5a3b22')
    for i in range(lines):
        n = [9, 6, 7][i % 3]
        for k in range(n):
            box(0.17, 0.1, 0.17, -1.0 + k * 0.24, -0.04, 1.73 - i * 0.28, PAINT, '#e8c04a')
    return build(name)


def sign_trucks():
    """Yellow diamond warning sign: logging trucks entering."""
    cyl(0.045, 2.6, 0, 0.05, -0.3, METAL, '#8e9296', verts=6)
    box(0.85, 0.04, 0.85, 0, 0, 1.55, PAINT, '#f2c419', ry=math.pi / 4)
    # A truck and its logs in black.
    box(0.22, 0.05, 0.18, -0.2, -0.03, 1.9, PAINT, '#1d1d1d')
    box(0.42, 0.05, 0.06, 0.08, -0.03, 1.9, PAINT, '#1d1d1d')
    for k in range(3):
        box(0.4, 0.05, 0.04, 0.1, -0.03, 1.98 + k * 0.06, PAINT, '#1d1d1d')
    for x in (-0.22, 0.02, 0.22):
        cyl(0.05, 0.05, x, -0.03, 1.86, PAINT, '#1d1d1d', verts=8, rx=math.pi / 2)
    return build('sign_trucks')


def bear_bin():
    """Bear-proof bin: a heavy brown steel box with a latched sloping lid."""
    box(1.3, 0.8, 1.0, 0, 0, 0, METAL, '#5a4a3a')
    v = [(-0.67, -0.42, 1.0), (0.67, -0.42, 1.0), (0.67, 0.42, 1.15), (-0.67, 0.42, 1.15)]
    mesh(v + [(x, y, z + 0.05) for x, y, z in v], [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], METAL, '#4a3c2e')
    box(0.5, 0.05, 0.08, 0, -0.43, 0.85, METAL, '#a8a8a0')
    box(0.7, 0.03, 0.3, 0, -0.42, 0.35, PAINT, '#e8e2cf')
    box(0.3, 0.035, 0.2, -0.12, -0.43, 0.4, PAINT, '#3a2a1d')
    return build('bear_bin')


# ------------------------------------------------------------- logging

def log_stack(name='log_stack', L=12, rows=7, seed=1):
    """A towering stack of long logs, end-on to the road (along X), held in
    by tall posts."""
    rng = random.Random(seed)
    for r in range(rows):
        n = rows + 2 - r
        y0 = -(n - 1) * 0.29
        for k in range(n):
            L2 = L + rng.uniform(-0.6, 0.6)
            log(0.29 + rng.uniform(-0.04, 0.04), L2, rng.uniform(-0.3, 0.3), y0 + k * 0.58, 0.3 + r * 0.5, rng.uniform(-0.03, 0.03), seed=seed * 100 + r * 10 + k)
    for x in (-L / 3, L / 3):
        for s in (-1, 1):
            box(0.2, 0.2, rows * 0.5 + 0.6, x, s * ((rows + 1) * 0.29 + 0.5), 0, PLANKS, '#4e3b2a')
    return build(name)


def log_pile():
    """A loose pile of cut logs by the road."""
    rng = random.Random(7)
    for r, n in enumerate((5, 4, 2)):
        for k in range(n):
            log(0.25, 6 + rng.uniform(-0.5, 0.5), rng.uniform(-0.4, 0.4), -(n - 1) * 0.26 + k * 0.52, 0.25 + r * 0.44, rng.uniform(-0.12, 0.12), seed=r * 7 + k)
    return build('log_pile')


def log_loader():
    """A yellow tracked log loader with its boom raised and a grapple."""
    Y = '#e2b21d'
    for s in (-1, 1):
        box(0.7, 4.2, 0.9, s * 1.3, 0, 0, METAL, '#2a2a2a')
        for k in range(5):
            cyl(0.33, 0.6, s * 1.6, -1.6 + k * 0.8, 0.45, METAL, '#3a3a3a', verts=8, ry=math.pi / 2)
    box(2.4, 3.2, 0.5, 0, 0, 0.9, METAL, '#3a3a3a')
    box(2.8, 3.4, 1.3, 0, 0.4, 1.4, PAINT, Y)
    box(1.3, 1.5, 1.7, -0.6, -0.9, 2.7, PAINT, Y)
    box(1.15, 1.35, 1.0, -0.6, -0.9, 3.1, GLASS, '#26323a')
    box(1.4, 1.6, 0.1, -0.6, -0.9, 4.4, PAINT, Y)
    # Boom: two arms up and out, the grapple hanging from the tip.
    box(0.45, 0.45, 5.2, 0.6, -1.0, 2.5, PAINT, Y, rx=0.7)
    box(0.4, 0.4, 4.0, 0.6, -4.3, 6.4, PAINT, Y, rx=2.4)
    cyl(0.07, 1.4, 0.6, -7.0, 2.1, METAL, '#555555', verts=6)
    for s in (-1, 1):
        box(0.15, 0.6, 1.2, 0.6 + s * 0.35, -7.0, 1.0, METAL, '#4a4a4a', ry=s * 0.4)
    log(0.3, 5, 0.6, -7.0, 1.0, 0, seed=3)
    return build('log_loader')


def logging_truck(name='logging_truck', col='#9b2a22'):
    """A parked logging truck: a cab-over-engine tractor and a trailer of
    long logs held by stakes."""
    # Cab at the -Y end.
    box(2.4, 2.4, 1.2, 0, -6.2, 0.6, PAINT, col)
    box(2.4, 2.0, 1.6, 0, -6.4, 1.8, PAINT, col)
    box(2.2, 0.1, 0.8, 0, -7.42, 2.3, GLASS, '#26323a')
    box(1.0, 0.08, 0.8, 0, -7.42, 1.0, METAL, '#c0c5c8')
    for s in (-1, 1):
        cyl(0.08, 2.6, s * 1.1, -5.2, 1.6, METAL, '#c0c5c8', verts=6)
    box(2.4, 13.0, 0.4, 0, 0.5, 0.9, METAL, '#2a2a2a')
    for y in (-6.4, -4.4, -3.2, 3.0, 4.2, 5.4):
        for s in (-1, 1):
            cyl(0.5, 0.45, s * 1.05, y, 0.5, METAL, '#1b1b1b', verts=12, ry=math.pi / 2)
    rng = random.Random(len(name))
    for r in range(3):
        n = 5 - r
        for k in range(n):
            log(0.28, 11 + rng.uniform(-0.5, 0.5), -(n - 1) * 0.28 + k * 0.56, 0.8, 1.6 + r * 0.48, math.pi / 2, seed=r * 10 + k)
    for y in (-3.5, 0.8, 5.0):
        for s in (-1, 1):
            box(0.12, 0.12, 1.9, s * 1.35, y, 1.2, METAL, '#2a2a2a')
    return build(name)


def stump(name='stump', burnt=False, r=0.45):
    cyl(r, 0.55, 0, 0, -0.1, PLANKS, '#1d1814' if burnt else '#5a4030', verts=9, r2=r * 0.85)
    cyl(r * 0.8, 0.02, 0, 0, 0.45, PAINT, '#2a2420' if burnt else '#c9a26c', verts=9)
    for k in range(4):
        a = k * math.pi / 2 + 0.4
        box(0.18, r * 1.2, 0.18, math.cos(a) * r, math.sin(a) * r, -0.05, PLANKS, '#1d1814' if burnt else '#4e3829', rz=a + math.pi / 2, rx=0.4)
    return build(name)


def fallen_log(name='fallen_log', L=9, seed=2):
    """A fallen trunk with its root plate torn up at one end."""
    log(0.38, L, 0, 0, 0.3, 0, tilt=0.03, end='#9a7a52', seed=seed)
    for k in range(9):
        a = k / 9 * math.tau
        box(0.15, 0.15, 1.4, -L / 2 - 0.1 + math.cos(a) * 0.3, math.sin(a) * 0.6, 0.3 + math.sin(a) * 0.5, PLANKS, '#3e2e22', ry=-0.9 + 0.2 * math.cos(a * 3), rz=a * 0.3)
    rock(1.0, 1.9, 1.6, -L / 2 - 0.4, 0, 0.0, '#4a3a2a', seed=seed, rough=0.2)
    return build(name)


# ------------------------------------------------------------ sawmill

def mill():
    """A working sawmill: a long timber shed with an open side, a tall
    smoking stack and a conveyor up to the hopper."""
    w, d = 12, 24
    plinth(w + 0.4, d + 0.4, top=0.3, col='#8f897e')
    z = 0.3
    box(w, d, 5.5, 0, 0, z, PLANKS, '#7a5233')
    rh = math.tan(0.42) * w / 2
    prism(w, d, rh, z + 5.5, PLANKS, '#6e4a2e')
    gable(w, d, 0.42, z + 5.5, over=0.8, thick=0.12, kind=METAL, col='#7d8286', end_over=0.6)
    # Open bays along the front, dark inside, with a log going in.
    for y in (-8, 0, 8):
        box(0.1, 5.0, 4.0, -w / 2 - 0.02, y, z, PAINT, '#1e1a16')
    for y in (-8, 0, 8):
        log(0.4, 8, -w / 2 - 2.5, y, z + 0.6, 0, seed=int(y) + 20)
    for k in range(4):
        window(w / 2 + 0.01, -9 + k * 6, z + 2.8, w=1.4, h=1.0, face='+x', shutters=None, frame='#c9b48a')
    # Stack: steel chimney with bands.
    cyl(0.7, 16, w / 4, d / 2 - 3, 0, METAL, '#4a4c4e', verts=12)
    for k in range(4):
        cyl(0.76, 0.2, w / 4, d / 2 - 3, 3 + k * 3.5, METAL, '#2e3032', verts=12)
    # Conveyor up to a hopper, and a sawdust heap.
    box(1.0, 14, 0.3, -w / 2 - 4, d / 2 + 2, 0.5, METAL, '#6a6e72', rx=0.42)
    box(3.0, 3.0, 3.0, -w / 2 - 4, d / 2 + 8, 5.4, PLANKS, '#5c4632')
    for s in (-1, 1):
        for t in (-1, 1):
            box(0.25, 0.25, 5.4, -w / 2 - 4 + s * 1.3, d / 2 + 8 + t * 1.3, 0, PLANKS, '#4e3b2a')
    ball(4.0, w / 2 + 6, d / 2 - 2, -1.5, sx=1.2, sy=1.0, sz=0.7, col='#c9a26c', segs=12)
    return build('mill')


def timber_stack(name='timber_stack', seed=5):
    """Sawn planks stacked to dry, with spacer sticks between layers, on
    bearers, and a rusty tin top."""
    rng = random.Random(seed)
    L, W = 6, 1.6
    box(0.2, W + 0.3, 0.2, -L / 3, 0, 0, PLANKS, '#4e3b2a')
    box(0.2, W + 0.3, 0.2, L / 3, 0, 0, PLANKS, '#4e3b2a')
    z = 0.2
    for i in range(rng.randint(8, 12)):
        box(L, W, 0.06, 0, 0, z, PLANKS, rng.choice(['#d9b88a', '#cfae7f', '#e0c294']))
        z += 0.06
        for x in (-L / 2 + 0.2, 0, L / 2 - 0.2):
            box(0.04, W, 0.05, x, 0, z, PLANKS, '#a8865c')
        z += 0.05
    box(L + 0.3, W + 0.4, 0.04, 0, 0, z, METAL, '#8a5a3a')
    return build(name)


def flume():
    """A 12 m section of log flume: a V-shaped wooden trough with water,
    on trestle legs, running along X."""
    L, H = 12, 3.0
    for s in (-1, 1):
        box(L, 0.08, 1.0, 0, s * 0.45, H, PLANKS, '#7a5a3a', rx=s * 0.6)
    box(L, 0.6, 0.05, 0, 0, H + 0.3, GLASS, '#4c7a86')
    for x in (-L / 2 + 0.5, -L / 6, L / 6, L / 2 - 0.5):
        for s in (-1, 1):
            box(0.18, 0.18, H + 3.2, x, s * 0.8, -3.0, PLANKS, '#5c4632', rx=s * 0.12)
        box(0.12, 1.8, 0.12, x, 0, H * 0.5, PLANKS, '#5c4632')
        box(0.12, 1.8, 0.12, x, 0, H * 0.5, PLANKS, '#5c4632', rx=0.9)
    box(L, 0.1, 0.12, 0, -0.85, H * 0.5, PLANKS, '#5c4632')
    log(0.25, 3.5, 1.5, 0, H + 0.42, 0, seed=8)
    return build('flume')


# ------------------------------------------------------------ cabin lake

def log_cabin(name='log_cabin', seed=1):
    """Lakeside log cabin with a shingle roof, stone chimney and a porch."""
    rng = random.Random(seed)
    w, d = rng.choice([(7, 6), (8, 6.5)])
    plinth(w + 0.3, d + 0.3, top=0.4, col='#7d776c')
    z = 0.4
    top = logwall_box(w, d, 2.7, z)
    rh = math.tan(0.75) * d / 2
    prism(d, w, rh, top, PLANKS, '#6e4c30', rz=math.pi / 2)
    gable(d, w, 0.75, top, over=0.6, thick=0.15, kind=SHINGLES, col=rng.choice(['#7a6450', '#5f7058', '#8a4a3c']), end_over=0.5, rz=math.pi / 2)
    door(-w / 4, -d / 2 - 0.2, z, w=1.0, h=2.0, col='#5a3a22', frame='#c9b48a')
    window(w / 4, -d / 2 - 0.2, z + 0.9, w=1.3, h=1.0, shutters='#2f5d3a', frame='#c9b48a')
    box(w, 2.2, 0.15, 0, -d / 2 - 1.1, z - 0.15, PLANKS, '#8a6a48')
    for x in (-w / 2 + 0.2, w / 2 - 0.2):
        cyl(0.1, 2.4, x, -d / 2 - 2.0, z, PLANKS, '#6e4c30', verts=8)
    box(w + 0.4, 2.4, 0.08, 0, -d / 2 - 1.2, z + 2.4, SHINGLES, '#4a3a2c', rx=-0.2)
    for i in range(int((top + rh + 0.8) / 0.6)):
        box(1.0, 1.0, 0.6, w / 2 + 0.4, d / 6, i * 0.6, MASONRY, ['#8b867d', '#7b766e', '#958f85'][i % 3])
    # Firewood stacked by the end wall.
    for k in range(3):
        for j in range(5 - k):
            log(0.1, 0.7, -w / 2 - 0.5, -d / 2 + 0.6 + j * 0.2 + k * 0.1, 0.1 + k * 0.18, 0, end='#c9a26c', verts=5, seed=k * 9 + j)
    return build(name)


def canoe(name='canoe', col='#b8322a'):
    """A canoe pulled up on the shore, upside down to keep the rain out."""
    ball(0.45, 0, 0, 0.0, sx=1.0, sy=10.0, sz=0.75, col=col, segs=14)
    box(0.95, 0.12, 0.05, 0, 0, 0.02, PLANKS, '#c8b48f')
    cyl(0.025, 1.5, 0.6, 1.0, 0.03, PLANKS, '#c8b48f', verts=5, rx=-math.pi / 2, rz=0.2)
    box(0.18, 0.4, 0.02, 0.75, 2.55, 0.02, PLANKS, '#c8b48f', rz=0.2)
    return build(name)


def jetty_long():
    """An 18 m jetty out over the lake, on log piles, with a bench at the end."""
    L = 18
    box(2.0, L, 0.14, 0, L / 2, 0.5, PLANKS, '#8a7356')
    for y in range(0, L + 1, 3):
        for x in (-0.9, 0.9):
            cyl(0.13, 5.0, x, y, -4.5, PLANKS, '#4e3b2a', verts=6)
    box(1.6, 0.4, 0.06, 0, L - 0.4, 0.95, PLANKS, '#6e5236')
    for x in (-0.7, 0.7):
        box(0.08, 0.3, 0.45, x, L - 0.4, 0.5, PLANKS, '#6e5236')
    return build('jetty_long')


# ------------------------------------------------------------ lookout and tanks

def lookout():
    """A fire lookout: a tall timber tower with cross bracing and a glazed
    cab on top, a catwalk all round and a hipped roof."""
    H, B, T = 28.0, 6.0, 3.0
    for sx in (-1, 1):
        for sy in (-1, 1):
            # Legs lean in from the wide base to the cab.
            x0, y0, x1, y1 = sx * B / 2, sy * B / 2, sx * T / 2, sy * T / 2
            L = math.sqrt(H * H + (x1 - x0) ** 2 + (y1 - y0) ** 2)
            ang = math.atan2(math.hypot(x1 - x0, y1 - y0), H)
            o = box(0.3, 0.3, L, x0, y0, -1.0, PLANKS, '#6e5236')
            o.rotation_euler = (sy * ang * 0.7071, -sx * ang * 0.7071, 0)
    for k in range(7):
        z = 1 + k * 4.5
        t = z / H
        half = B / 2 * (1 - t) + T / 2 * t
        for s in (-1, 1):
            box(half * 2, 0.15, 0.15, 0, s * half, z, PLANKS, '#5c4632')
            box(0.15, half * 2, 0.15, s * half, 0, z, PLANKS, '#5c4632')
            # X braces on each face.
            if k < 6:
                h2 = 4.5
                L = math.hypot(half * 2, h2)
                for d in (-1, 1):
                    box(L, 0.1, 0.1, 0, s * half, z + h2 / 2, PLANKS, '#5c4632', ry=d * math.atan2(h2, half * 2))
                    box(0.1, L, 0.1, s * half, 0, z + h2 / 2, PLANKS, '#5c4632', rx=d * math.atan2(h2, half * 2))
    # Cab, catwalk, roof.
    box(T + 2.0, T + 2.0, 0.2, 0, 0, H, PLANKS, '#8a6a48')
    for s in (-1, 1):
        box(T + 2.0, 0.08, 1.0, 0, s * (T / 2 + 1.0), H + 0.2, PLANKS, '#6e5236')
        box(0.08, T + 2.0, 1.0, s * (T / 2 + 1.0), 0, H + 0.2, PLANKS, '#6e5236')
    box(T, T, 1.0, 0, 0, H + 0.2, PLANKS, '#7a5233')
    box(T - 0.1, T - 0.1, 1.4, 0, 0, H + 1.2, GLASS, '#2a3a44')
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(0.15, 0.15, 1.4, sx * (T / 2 - 0.05), sy * (T / 2 - 0.05), H + 1.2, PLANKS, '#6e5236')
    a = T / 2 + 0.5
    v = [(-a, -a, 0), (a, -a, 0), (a, a, 0), (-a, a, 0), (0, 0, 1.3)]
    mesh(v, [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (3, 2, 1, 0)], SHINGLES, '#3f4a3a', z=H + 2.6)
    cyl(0.03, 1.5, 0, 0, H + 3.9, METAL, '#8a8f93', verts=5)
    # Zig-zag stair up one side.
    for k in range(12):
        z = k * 2.3
        t = z / H
        half = B / 2 * (1 - t) + T / 2 * t
        box(0.9, 2.8, 0.12, half + 0.5, (-1) ** k * 0.2, z + 1.1, PLANKS, '#8a6a48', rx=(-1) ** k * 0.65)
    return build('lookout')


def water_tank():
    """A wooden stave water tank on a timber stand, with steel hoops."""
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(0.3, 0.3, 4.0, sx * 1.6, sy * 1.6, 0, PLANKS, '#5c4632')
    box(4.0, 4.0, 0.3, 0, 0, 4.0, PLANKS, '#6e5236')
    cyl(2.0, 3.0, 0, 0, 4.3, PLANKS, '#8a6a48', verts=16)
    for k in range(4):
        cyl(2.04, 0.08, 0, 0, 4.5 + k * 0.75, METAL, '#3a3a3a', verts=16)
    cyl(2.15, 0.9, 0, 0, 7.3, SHINGLES, '#4a3a2c', verts=16, r2=0.2)
    return build('water_tank')


def water_tower():
    """A railway water tower: a tank high on a trestle with a spout that
    swings out over the track."""
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(0.35, 0.35, 7.0, sx * 2.0, sy * 2.0, 0, PLANKS, '#4e3b2a', rx=-sy * 0.05, ry=sx * 0.05)
    for z in (2.5, 5.0):
        for s in (-1, 1):
            box(4.4, 0.15, 0.15, 0, s * 2.0, z, PLANKS, '#4e3b2a')
            box(0.15, 4.4, 0.15, s * 2.0, 0, z, PLANKS, '#4e3b2a')
    box(5.0, 5.0, 0.3, 0, 0, 7.0, PLANKS, '#5c4632')
    cyl(2.4, 4.0, 0, 0, 7.3, PLANKS, '#8a4f2e', verts=18)
    for k in range(5):
        cyl(2.44, 0.08, 0, 0, 7.5 + k * 0.85, METAL, '#2a2a2a', verts=18)
    cyl(2.6, 1.4, 0, 0, 11.3, SHINGLES, '#3a3a3a', verts=18, r2=0.15)
    box(0.4, 3.0, 0.4, 0, -3.5, 8.0, METAL, '#3a3a3a', rx=-0.3)
    cyl(0.04, 4, 0, -2.5, 8.6, METAL, '#3a3a3a', verts=5, rx=0.3)
    return build('water_tower')


# ------------------------------------------------------------ giants and burnt

def giant_tree(name='giant_tree', seed=1, hole=False):
    """A giant redwood: a huge fluted red trunk flaring at the root, bare
    for 25 m, then high clumps of foliage. With `hole`, a tunnel 8 m wide
    and 6.5 m tall is cut through it along X (the road runs through)."""
    rng = random.Random(seed)
    R, H = (6.2, 62) if hole else (3.2, 55)
    rings = 18
    sides = 28
    verts, faces = [], []
    for i in range(rings + 1):
        t = i / rings
        z = H * t ** 1.4 - 2.0
        r = R * (1 - t) ** 0.85 * (1 + 0.8 * max(0, 0.12 - t) / 0.12) + 0.3
        for k in range(sides):
            a = k / sides * math.tau
            flute = 1 + 0.07 * math.sin(a * 9 + rng.random()) * (1 - t)
            verts.append((math.cos(a) * r * flute, math.sin(a) * r * flute, z))
    for i in range(rings):
        for k in range(sides):
            a, b = i * sides + k, i * sides + (k + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    if hole:
        # Cut the tunnel with a boolean so the inside shows bare red wood.
        me = bpy.data.meshes.new('trunk')
        me.from_pydata(verts, [], faces)
        o = bpy.data.objects.new('trunk', me)
        bpy.context.scene.collection.objects.link(o)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.fill_holes(sides=0)
        bpy.ops.object.mode_set(mode='OBJECT')
        bpy.ops.mesh.primitive_cube_add(size=1)
        c = bpy.context.active_object
        c.scale = (R * 3, 8.0, 7.0)
        c.location = (0, 0, 2.3)
        # Arched top: a cylinder along X merged with the box.
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=4.0, depth=R * 3, location=(0, 0, 5.8), rotation=(0, math.pi / 2, 0))
        a = bpy.context.active_object
        for cut in (c, a):
            m = o.modifiers.new('cut', 'BOOLEAN')
            m.operation = 'DIFFERENCE'
            m.object = cut
            m.solver = 'EXACT'
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier=m.name)
        bpy.data.objects.remove(c)
        bpy.data.objects.remove(a)
        from props import finish
        finish(o, PAINT, '#8a3e26')
        # Recolour the cut faces (inside the tunnel) as pale heartwood.
        attr = o.data.color_attributes['Col']
        from props import hexrgb
        pale, char = hexrgb('#b06a45'), hexrgb('#2a1a12')
        for p in o.data.polygons:
            n = p.normal
            cz = p.center.z
            if abs(n.z) > 0.9 and cz < 0.5:
                continue
            inside = math.hypot(p.center.x, p.center.y) < R * 0.9 and cz < 10
            if inside:
                for li in p.loop_indices:
                    attr.data[li].color = pale
            elif cz < 1.5 and rng.random() < 0.5:
                for li in p.loop_indices:
                    attr.data[li].color = char
    else:
        o = mesh(verts, faces, PAINT, '#8a3e26')
    # Fibrous red bark: vertical streaks of lighter and darker red.
    from props import hexrgb
    attr = o.data.color_attributes['Col']
    shades = [hexrgb(c) for c in ('#8a3e26', '#7a3420', '#9a4a2e', '#6e2e1c', '#a3573a')]
    for p in o.data.polygons:
        if hole and math.hypot(p.center.x, p.center.y) < R * 0.9 and p.center.z < 10:
            continue
        a = math.atan2(p.center.y, p.center.x)
        c = shades[int((a + math.pi) / math.tau * sides * 1.0 + 0.5 * math.sin(p.center.z)) % len(shades)]
        for li in p.loop_indices:
            attr.data[li].color = c
    # High branches and clumps of dark foliage.
    for k in range(14):
        t = 0.5 + k / 14 * 0.45
        z = H * t ** 1.4
        rr = R * (1 - t) ** 0.85 + 0.3
        a = k * 2.4 + rng.random()
        L = 4 + 6 * (1 - t)
        box(0.5, L, 0.5, math.cos(a) * rr, math.sin(a) * rr, z - 1, PLANKS, '#5a2e1e', rz=a - math.pi / 2, rx=-0.9)
        bx, by = math.cos(a) * (rr + L * 0.75), math.sin(a) * (rr + L * 0.75)
        for j in range(4):
            r2 = (1.6 + 1.4 * (1 - t)) * rng.uniform(0.7, 1.1)
            ball(r2, bx + rng.uniform(-2, 2), by + rng.uniform(-2, 2), z + L * 0.35 + rng.uniform(-1, 1.5), sx=1.3, sy=1.3, sz=0.75,
                 kind=LEAVES, col=rng.choice(['#3a5a2e', '#33522a', '#42653a']), segs=8)
    for j in range(5):
        ball(2.6, rng.uniform(-1.5, 1.5), rng.uniform(-1.5, 1.5), H - 4 + j * 1.6, sx=1.0, sy=1.0, sz=1.2, kind=LEAVES, col='#35552c', segs=8)
    return build(name)


def snag(name='snag', seed=1):
    """A burnt pine: a charred black trunk with broken stubs of branches
    and a snapped top."""
    rng = random.Random(seed)
    H = rng.uniform(10, 16)
    cyl(0.4, H, 0, 0, -0.3, PLANKS, '#2a221d', verts=8, r2=0.1)
    for k in range(rng.randint(10, 16)):
        z = rng.uniform(H * 0.3, H * 0.92)
        a = rng.random() * math.tau
        L = rng.uniform(0.5, 2.2) * (1 - z / H + 0.3)
        r = 0.3 * (1 - z / H) + 0.05
        box(0.12, L, 0.12, math.cos(a) * r, math.sin(a) * r, z, PLANKS, '#231c18', rz=a - math.pi / 2, rx=-rng.uniform(1.0, 1.4))
    # Scorched bark shading lighter at the top where the fire didn't reach.
    cyl(0.41, 2.5, 0, 0, -0.3, PLANKS, '#100d0b', verts=8, r2=0.36)
    return build(name)


def sapling(name='sapling', seed=1):
    """A young pine coming back after the fire: a small bright green cone."""
    rng = random.Random(seed)
    h = rng.uniform(0.8, 1.6)
    cyl(0.04, h * 0.4, 0, 0, 0, PLANKS, '#5a4030', verts=5)
    for k in range(3):
        cyl(h * (0.32 - k * 0.08), h * 0.4, 0, 0, h * (0.15 + k * 0.25), LEAVES, '#5f8f3a', verts=7, r2=0.02)
    return build(name)


def fireweed():
    """A clump of pink fireweed, the first flowers after a fire."""
    rng = random.Random(9)
    for k in range(9):
        x, y = rng.uniform(-0.6, 0.6), rng.uniform(-0.6, 0.6)
        h = rng.uniform(0.7, 1.3)
        cyl(0.02, h * 0.6, x, y, 0, PAINT, '#4a6a2a', verts=4)
        cyl(0.07, h * 0.45, x, y, h * 0.55, LEAVES, '#d0528a', verts=5, r2=0.01)
    return build('fireweed')


# ------------------------------------------------------------ trestle extras

def gift_shop():
    """A little gift shop hut with a striped awning, by the tunnel tree."""
    w, d = 6, 4.5
    plinth(w + 0.3, d + 0.3, top=0.3, col='#7d776c')
    z = 0.3
    box(w, d, 2.8, 0, 0, z, PLANKS, '#8a5a36')
    rh = math.tan(0.55) * w / 2
    prism(w, d, rh, z + 2.8, PLANKS, '#8a5a36')
    gable(w, d, 0.55, z + 2.8, over=0.4, thick=0.1, kind=SHINGLES, col='#3e4a3a', end_over=0.3)
    door(-1.6, -d / 2, z, w=1.0, h=2.1, col='#2f5d3a', frame='#e8dcc0')
    box(2.6, 0.06, 1.2, 0.8, -d / 2 - 0.02, z + 0.9, GLASS, '#26323a')
    for k in range(6):
        box(0.5, 1.2, 0.05, -0.45 + k * 0.5, -d / 2 - 0.55, z + 2.3, PAINT, '#c62d24' if k % 2 else '#f4efe2', rx=-0.35)
    box(3.2, 0.1, 0.6, 0, -d / 2 - 0.05, z + 3.0, PAINT, '#f4efe2')
    for k in range(5):
        box(0.35, 0.12, 0.3, -0.9 + k * 0.45, -d / 2 - 0.1, z + 3.15, PAINT, '#8a3e26')
    return build('gift_shop')


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ranger_hut()
    sign_fire()
    picnic_table()
    trail_map()
    sign_forestry()
    sign_forestry('sign_forestry_b', 2)
    sign_trucks()
    bear_bin()
    log_stack()
    log_stack('log_stack_b', L=10, rows=6, seed=2)
    log_pile()
    log_loader()
    logging_truck()
    logging_truck('logging_truck_b', '#2a5a8a')
    stump()
    stump('stump_burnt', burnt=True, r=0.35)
    fallen_log()
    fallen_log('fallen_log_b', L=7, seed=5)
    mill()
    timber_stack()
    timber_stack('timber_stack_b', seed=8)
    flume()
    log_cabin()
    log_cabin('log_cabin_b', seed=2)
    canoe()
    canoe('canoe_green', '#2f6a44')
    jetty_long()
    lookout()
    water_tank()
    water_tower()
    giant_tree()
    giant_tree('giant_tree_b', seed=2)
    giant_tree('tunnel_tree', seed=3, hole=True)
    snag()
    snag('snag_b', seed=2)
    snag('snag_c', seed=3)
    sapling()
    sapling('sapling_b', seed=2)
    fireweed()
    gift_shop()
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'props_forest.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_materials='NONE', export_normals=True,
                              export_texcoords=True, export_apply=True, export_vertex_color='ACTIVE')
    print('wrote', path)


if __name__ == '__main__':
    main()
