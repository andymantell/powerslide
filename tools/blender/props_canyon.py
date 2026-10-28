"""Builds Desert Canyon's props (mesas, buttes and hoodoos, cacti and scrub,
the motel and its neon sign, the gas station and diner, the ghost town,
the railway, the dam's towers, the rock arch and the trading post) and
exports them to src/assets/models/props_canyon.glb. Same conventions as
props.py, whose helpers it uses: vertex colour plus a surface kind per
face, front facing Blender -Y (three.js +Z), origin on the ground.

  python tools/blender/props_canyon.py
"""
import math
import os
import random
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
from props import (EMISSIVE, GLASS, MASONRY, METAL, OUT, PAINT, PLANKS, PLASTER, SHINGLES, ball, box, build, cyl,  # noqa: E402
                   door, gable, mesh, plinth, prism, window)
from props_dartmoor import rock  # noqa: E402

LEAVES = 8
TARMAC = 10
REDS = ['#9a4a2e', '#b0603a', '#c27a4a', '#8a3e26', '#a85a36', '#d09060']


# ------------------------------------------------------------ rock

def _waves(rng, n=4, amp=0.15):
    """A smooth random periodic function of angle: a sum of sines."""
    terms = [(k, rng.uniform(0, math.tau), amp * rng.uniform(0.4, 1.0) / k ** 0.8) for k in range(1, n + 1)]
    return lambda a: sum(A * math.sin(k * a + p) for k, p, A in terms)


def _bands(rng, H, n):
    """Strata: band edges up the cliff and a colour for each."""
    cuts = sorted(rng.uniform(0, H) for _ in range(n))
    cols = [rng.choice(REDS) for _ in range(n + 1)]
    return lambda z: cols[sum(1 for c in cuts if z > c)]


def formation(name, seed, R, H, talus=0.25, flare=0.7, ledges=5, outline=0.18, sides=44, rings=30, profile=None, cap='#c9a07a', stretch=1.0):
    """A banded sandstone rock form: an irregular outline lifted into
    near-vertical cliffs with gullies and ledges, standing on a flaring
    talus apron, with a flat cap. `profile(t)` (t 0..1 up the cliff) scales
    the radius for hoodoos and spires."""
    rng = random.Random(seed)
    out = _waves(rng, 7, outline)
    gul = _waves(rng, 3, 1.0)
    K = rng.randint(9, 15)
    band = _bands(rng, H, ledges + 3)
    zt = H * talus
    ledge_z = sorted(rng.uniform(zt, H * 0.95) for _ in range(ledges))
    verts, faces, cols = [], [], []
    zs = [-H * 0.08] + [zt * (i / 6) for i in range(1, 7)] + [zt + (H - zt) * (i / (rings - 7)) for i in range(1, rings - 6)]
    for z in zs:
        for k in range(sides):
            a = k / sides * math.tau
            r = R * (1 + out(a))
            if z < zt:
                r *= 1 + flare * ((zt - z) / zt) ** 1.4
            else:
                t = (z - zt) / (H - zt)
                # Gullies cut deeper low down; each ledge steps the cliff in.
                r *= 1 - 0.05 * max(0, gul(a * K)) * (1 - t * 0.5) - 0.03 * sum(1 for lz in ledge_z if z > lz)
                if profile:
                    r *= profile(t)
            r *= 1 + rng.uniform(-0.015, 0.015)
            verts.append((math.cos(a) * r * stretch, math.sin(a) * r, z))
    n = len(zs)
    for i in range(n - 1):
        for k in range(sides):
            a, b = i * sides + k, i * sides + (k + 1) % sides
            faces.append((a, b, b + sides, a + sides))
            zc = (zs[i] + zs[i + 1]) / 2
            cols.append('#a8683f' if zc < zt * 0.9 else band(zc))
    top = len(verts)
    verts.append((0, 0, zs[-1] + R * 0.02))
    for k in range(sides):
        faces.append(((n - 1) * sides + k, (n - 1) * sides + (k + 1) % sides, top))
        cols.append(cap)
    o = mesh(verts, faces, PLASTER, cap)
    from props import hexrgb
    attr = o.data.color_attributes['Col']
    for p, c in zip(o.data.polygons, cols):
        rgba = hexrgb(c)
        for li in p.loop_indices:
            attr.data[li].color = rgba
    return o


def mesa(name='mesa', seed=1, R=70, H=70):
    """A flat-topped mesa: sheer banded cliffs on a talus skirt."""
    formation(name, seed, R, H, talus=0.22, flare=0.55, ledges=5, outline=0.3, stretch=1.7)
    return build(name)


def butte(name='butte', seed=2, R=22, H=80):
    """A tall, narrow butte on a talus cone."""
    formation(name, seed, R, H, talus=0.3, flare=1.1, ledges=4, outline=0.22, stretch=1.3)
    return build(name)


def hoodoo(name='hoodoo', seed=3, H=9):
    """A hoodoo: a knobbly column of soft rock wearing a hard cap rock hat."""
    rng = random.Random(seed)
    neck = [rng.uniform(0, math.tau) for _ in range(3)]
    prof = lambda t: 0.75 + 0.25 * math.sin(t * 9 + neck[0]) * (1 - t) + 0.1 * math.sin(t * 17 + neck[1]) - 0.25 * t
    formation(name, seed, 1.3, H, talus=0.12, flare=0.9, ledges=3, outline=0.12, sides=16, rings=18, profile=prof)
    rock(3.0, 2.8, 0.9, 0.2, 0, H - 0.35, '#c9a07a', seed=seed * 7 + 9, rough=0.15, detail=1, warp=0.2)
    return build(name)


def boulder_red(name='boulder_red', seed=4, s=3.0):
    rock(s * 1.3, s, s * 0.8, 0, 0, -s * 0.15, REDS[seed % len(REDS)], seed=seed, rough=0.2, detail=1, warp=0.25)
    return build(name)


def rock_arch():
    """A natural sandstone arch about 26 m tall, its legs 30 m apart on X
    (the road runs through it along Y): a thick, knobbly band of banded rock
    curving over, thickest at the feet."""
    rng = random.Random(30)
    band = _bands(rng, 28, 7)
    S, Hc = 14.0, 22.0
    N, M = 40, 18
    verts, faces, cols = [], [], []
    for i in range(N + 1):
        t = i / N
        ang = math.pi * t
        x, z = -S * math.cos(ang), Hc * max(0.0, math.sin(ang)) ** 0.85 - 3.0 * (1 - math.sin(ang)) ** 4
        # Tangent along the arch, its normal in the XZ plane.
        da = 0.01
        x2, z2 = -S * math.cos(ang + da), Hc * max(0.0, math.sin(ang + da)) ** 0.85 - 3.0 * (1 - math.sin(ang + da)) ** 4
        tx, tz = x2 - x, z2 - z
        tl = math.hypot(tx, tz) or 1
        nx, nz = -tz / tl, tx / tl
        feet = abs(math.cos(ang)) ** 3
        rr = 3.2 + 3.4 * feet
        rd = 4.5 + 2.5 * feet
        for k in range(M):
            th = k / M * math.tau
            bump = 1 + 0.12 * math.sin(th * 3 + i * 0.7) + 0.06 * math.sin(th * 7 + i * 1.9) + rng.uniform(-0.03, 0.03)
            verts.append((x + nx * math.cos(th) * rr * bump, math.sin(th) * rd * bump, z + nz * math.cos(th) * rr * bump))
    for i in range(N):
        for k in range(M):
            a, b = i * M + k, i * M + (k + 1) % M
            faces.append((a, a + M, b + M, b))
            zc = (verts[a][2] + verts[b + M][2]) / 2
            cols.append(band(zc))
    o = mesh(verts, faces, PLASTER, '#a85a36')
    from props import hexrgb
    attr = o.data.color_attributes['Col']
    for p, c in zip(o.data.polygons, cols):
        rgba = hexrgb(c)
        for li in p.loop_indices:
            attr.data[li].color = rgba
    # Rubble round the feet.
    for s in (-1, 1):
        rock(9, 10, 4, s * 15, 0, -2.5, '#a8683f', seed=31 + s, rough=0.15, detail=1, warp=0.25)
    return build('rock_arch')


# ------------------------------------------------------------ plants

def saguaro(name='saguaro', seed=1):
    """A saguaro cactus: a ribbed column with arms that turn up."""
    rng = random.Random(seed)
    H = rng.uniform(6, 9)
    col = '#4f7a3a'
    cyl(0.32, H, 0, 0, 0, LEAVES, col, verts=12, r2=0.26)
    ball(0.27, 0, 0, H, kind=LEAVES, col=col, segs=10)
    for k in range(rng.randint(1, 3)):
        a = rng.random() * math.tau
        z = rng.uniform(H * 0.35, H * 0.6)
        L = rng.uniform(0.9, 1.4)
        up = rng.uniform(1.5, 3.0)
        x, y = math.cos(a), math.sin(a)
        cyl(0.2, L, x * 0.2, y * 0.2, z, LEAVES, col, verts=8, ry=math.pi / 2, rz=a)
        cyl(0.2, up, x * (L + 0.1), y * (L + 0.1), z - 0.1, LEAVES, col, verts=8)
        ball(0.2, x * (L + 0.1), y * (L + 0.1), z - 0.1 + up, kind=LEAVES, col=col, segs=8)
    return build(name)


def barrel_cactus():
    for k, (x, y, r) in enumerate(((0, 0, 0.45), (0.8, 0.3, 0.3), (-0.5, 0.6, 0.25))):
        ball(r, x, y, r * 0.8, sz=1.3, kind=LEAVES, col='#5f8a3e', segs=12)
        ball(r * 0.4, x, y, r * 2.0, sz=0.5, kind=PAINT, col='#e8c22a', segs=8)
    return build('barrel_cactus')


def prickly_pear():
    """Prickly pear: flat green pads stacked every which way, a few red fruit."""
    rng = random.Random(5)
    pads = [(0, 0, 0.3, 0)]
    for i in range(12):
        px, py, pz, pa = rng.choice(pads)
        a = pa + rng.uniform(-0.8, 0.8)
        nx, ny, nz = px + math.cos(a) * 0.35, py + math.sin(a) * 0.1, pz + 0.4
        ball(0.3, nx, ny, nz, sx=1.0, sy=0.25, sz=1.25, kind=LEAVES, col=rng.choice(['#5f8a3e', '#6a944a', '#577f38']), segs=8, rz=rng.uniform(-0.5, 0.5), ry=rng.uniform(-0.4, 0.4))
        pads.append((nx, ny, nz, a))
        if rng.random() < 0.3:
            ball(0.06, nx, ny, nz + 0.38, kind=PAINT, col='#b0204a', segs=6)
    return build('prickly_pear')


def sagebrush(name='sagebrush', seed=1, s=1.0):
    """A clump of grey-green sagebrush."""
    rng = random.Random(seed)
    for k in range(6):
        ball(0.5 * s * rng.uniform(0.7, 1.2), rng.uniform(-0.5, 0.5) * s, rng.uniform(-0.5, 0.5) * s, 0.35 * s, sz=0.7, kind=LEAVES,
             col=rng.choice(['#8a9468', '#7a8660', '#9aa078']), segs=8)
    return build(name)


def tumbleweed():
    """A tumbleweed: a loose ball of dry, twiggy stems."""
    rng = random.Random(6)
    for k in range(10):
        a, b = rng.random() * math.tau, rng.random() * math.pi
        box(1.1, 0.03, 0.03, 0, 0, 0.5, PLANKS, '#b0905a', rx=a, ry=b, rz=rng.random() * 3)
    ball(0.5, 0, 0, 0.5, kind=LEAVES, col='#a88a58', segs=8)
    return build('tumbleweed')


def joshua(name='joshua', seed=1):
    """A Joshua tree: shaggy forked limbs ending in spiky green tufts."""
    rng = random.Random(seed)
    trunk = '#6a5a44'
    H = rng.uniform(3, 4.5)
    cyl(0.25, H, 0, 0, 0, PLANKS, trunk, verts=8, r2=0.18)
    for k in range(rng.randint(3, 5)):
        a = rng.random() * math.tau
        L = rng.uniform(1.2, 2.2)
        tilt = rng.uniform(0.5, 0.9)
        x, y = math.cos(a) * math.sin(tilt) * L, math.sin(a) * math.sin(tilt) * L
        o = cyl(0.14, L, 0, 0, H - 0.2, PLANKS, trunk, verts=6)
        o.rotation_euler = (-math.sin(a) * tilt, math.cos(a) * tilt, 0)
        z = H - 0.2 + math.cos(tilt) * L
        ball(0.45, x, y, z + 0.2, sz=1.1, kind=LEAVES, col=rng.choice(['#6a7a3a', '#5f7234']), segs=8)
    return build(name)


# ------------------------------------------------------------ roadside

def motel():
    """A single-storey roadside motel: a row of rooms with doors and windows
    under a flat roof, a walkway canopy, and an office with a big window."""
    w, d = 36, 8
    plinth(w + 0.3, d + 0.3, top=0.3, col='#9a8a78')
    z = 0.3
    box(w, d, 3.2, 0, 0, z, PLASTER, '#e8dcc0')
    box(w + 0.6, d + 0.6, 0.3, 0, 0, z + 3.2, PAINT, '#3aa0a0')
    box(w + 0.4, 2.4, 0.15, 0, -d / 2 - 1.2, z + 2.9, PAINT, '#3aa0a0')
    for k in range(12):
        x = -w / 2 + 1.5 + k * 2.9
        cyl(0.07, 2.9, x, -d / 2 - 2.2, z, METAL, '#d0d0c8', verts=6)
        door(x - 0.5, -d / 2, z, w=0.9, h=2.1, col=['#c0392b', '#2a6a8a', '#d8a020'][k % 3], frame='#f5f0e0')
        window(x + 0.8, -d / 2, z + 1.0, w=1.0, h=1.0, shutters=None, frame='#f5f0e0')
    # Office at the end, with a big shop window and an ice machine.
    box(7, 9, 3.6, w / 2 + 3.5, 0.5, z, PLASTER, '#f0e6cc')
    box(6.8, 0.08, 1.8, w / 2 + 3.5, -4.02, z + 0.9, GLASS, '#2a3a44')
    box(7.4, 9.4, 0.3, w / 2 + 3.5, 0.5, z + 3.6, PAINT, '#c0392b')
    box(0.9, 0.7, 1.6, w / 2 - 0.5, -d / 2 - 0.5, z, METAL, '#d8d8d0')
    return build('motel')


def neon_sign():
    """The motel's tall neon sign: a pole, a big arrow board and a star."""
    cyl(0.25, 14, 0, 0, 0, METAL, '#c8c8c0', verts=8)
    box(6.0, 0.6, 3.0, 0, 0, 9.5, PAINT, '#2a6a6a')
    box(5.4, 0.65, 2.4, 0, 0, 9.8, EMISSIVE, '#ff4a6a')
    for k in range(6):
        box(0.55, 0.7, 0.8, -2.0 + k * 0.8, 0, 10.6, EMISSIVE, '#fff2b0')
    # Arrow pointing down at the office.
    box(5.0, 0.5, 0.6, -0.5, 0, 8.0, PAINT, '#d8a020')
    box(4.6, 0.55, 0.3, -0.5, 0, 8.15, EMISSIVE, '#ffd040')
    v = [(-3.6, 0, 7.6), (-2.6, 0, 8.3), (-3.6, 0, 8.9)]
    v = [(x, y - 0.3, z) for x, y, z in v] + [(x, y + 0.3, z) for x, y, z in v]
    mesh(v, [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)], EMISSIVE, '#ffd040')
    # A star on top.
    for a in range(5):
        box(0.35, 0.4, 2.0, 0, 0, 13.3, EMISSIVE, '#fff2b0', ry=a * math.pi / 5)
    box(2.6, 0.5, 0.8, 0, 0, 5.5, EMISSIVE, '#7ae0ff')
    return build('neon_sign')


def carpark():
    """A cracked, sun-bleached car park slab with faded bays, 30 x 16 m."""
    box(30, 16, 0.1, 0, 0, -0.05, TARMAC, '#9a948a')
    for k in range(9):
        box(0.12, 4.5, 0.02, -12 + k * 3, 5.5, 0.05, PAINT, '#d8d4c4')
    rng = random.Random(3)
    for k in range(14):
        box(rng.uniform(1.5, 4), 0.06, 0.02, rng.uniform(-13, 13), rng.uniform(-7, 7), 0.05, PAINT, '#4a4640', rz=rng.uniform(0, 3.1))
    return build('carpark')


def gas_station():
    """An abandoned gas station: a canopy on posts over two rusty pumps,
    and the little sales kiosk with boarded windows."""
    box(12, 7, 0.6, 0, -6, 4.8, PAINT, '#e8e0d0')
    box(12.2, 7.2, 0.25, 0, -6, 5.4, PAINT, '#b02a20')
    for x in (-5, 5):
        for y in (-8.5, -3.5):
            cyl(0.18, 4.8, x, y, 0, METAL, '#c8c4bc', verts=8)
    box(12, 3.5, 0.15, 0, -6, 0, MASONRY, '#a8a298')
    for x in (-2.5, 2.5):
        pump(x, -6)
    plinth(8.3, 6.3, top=0.3, col='#9a8a78')
    box(8, 6, 3.4, 0, 3.5, 0.3, PLASTER, '#e0d4bc')
    box(8.4, 6.4, 0.3, 0, 3.5, 3.7, PAINT, '#b02a20')
    for x in (-2.2, 2.2):
        box(2.2, 0.1, 1.6, x, 0.47, 1.2, PLANKS, '#8a6a48')
    door(0, 0.5, 0.3, w=1.0, h=2.1, col='#6a6a6a', frame='#d8d0c0')
    # The tall price sign, faded.
    cyl(0.15, 8, 7.5, -10, 0, METAL, '#8a8680', verts=6)
    box(2.4, 0.3, 1.8, 7.5, -10, 7.0, PAINT, '#e8e0d0')
    box(2.0, 0.32, 0.4, 7.5, -10, 8.1, PAINT, '#b02a20')
    return build('gas_station')


def pump(x=0, y=0, rust='#a04a2a'):
    box(0.7, 0.5, 1.6, x, y, 0.15, PAINT, rust)
    box(0.5, 0.52, 0.5, x, y, 1.0, PAINT, '#e8e0c8')
    ball(0.25, x, y, 1.9, kind=GLASS, col='#d8d0b0', segs=8)
    box(0.08, 0.3, 0.6, x + 0.38, y, 0.8, METAL, '#2a2a2a')


def rusty_pump():
    pump(0, 0, '#8a3a1e')
    box(1.2, 0.8, 0.15, 0, 0, 0, MASONRY, '#a8a298')
    return build('rusty_pump')


def diner():
    """A streamlined chrome diner with a long window strip and a rounded end."""
    w, d = 18, 6
    plinth(w + 0.3, d + 0.3, top=0.5, col='#9a8a78')
    z = 0.5
    box(w, d, 1.0, 0, 0, z, METAL, '#d8d8d0')
    box(w, d, 1.3, 0, 0, z + 1.0, GLASS, '#2a3a44')
    box(w, d, 0.9, 0, 0, z + 2.3, METAL, '#d8d8d0')
    box(w + 0.1, d + 0.1, 0.25, 0, 0, z + 2.5, PAINT, '#c0392b')
    cyl(d / 2, 3.2, w / 2, 0, z, METAL, '#d8d8d0', verts=16)
    box(w + 0.4, d + 0.4, 0.2, 0, 0, z + 3.2, PAINT, '#e8e4d8')
    box(1.6, 1.2, 0.2, -3, -d / 2 - 0.6, 0.0, MASONRY, '#a8a298')
    door(-3, -d / 2, z, w=1.0, h=2.2, col='#c0392b', frame='#d8d8d0')
    box(6, 0.4, 1.2, 1, -d / 2 - 0.2, z + 3.4, PAINT, '#e8e0c8')
    for k in range(5):
        box(0.8, 0.45, 0.8, -1 + k * 1.0, -d / 2 - 0.25, z + 3.6, EMISSIVE, '#ff4a4a')
    return build('diner')


def pickup(name='pickup', col='#7a4a2a'):
    """An old rounded pickup truck, faded and rusting."""
    box(1.9, 4.8, 0.7, 0, 0, 0.45, PAINT, col)
    box(1.8, 1.6, 0.35, 0, -1.6, 1.15, PAINT, col)
    box(1.7, 1.4, 0.9, 0, -0.2, 1.05, PAINT, col)
    box(1.6, 0.06, 0.6, 0, -0.92, 1.3, GLASS, '#3a4248')
    box(1.9, 2.1, 0.5, 0, 1.4, 1.1, PAINT, col)
    box(1.7, 1.9, 0.05, 0, 1.4, 1.1, PAINT, '#3a2a20')
    for sx in (-1, 1):
        for sy in (-1.5, 1.5):
            cyl(0.4, 0.25, sx * 0.9, sy, 0.4, PAINT, '#1b1b1b', verts=12, ry=math.pi / 2)
            ball(0.5, sx * 0.85, sy, 0.6, sx=0.4, sy=1.1, sz=0.7, col=col, segs=8)
    box(1.95, 0.15, 0.2, 0, -2.45, 0.5, METAL, '#b0b0a8')
    return build(name)


def buried_car():
    """A car half swallowed by a sand drift."""
    box(1.8, 4.2, 0.8, 0, 0, -0.3, PAINT, '#4a6a8a', rx=0.12, ry=0.08)
    box(1.6, 2.0, 0.6, 0, 0.3, 0.45, GLASS, '#2a3238', rx=0.12, ry=0.08)
    box(1.65, 1.9, 0.08, 0, 0.35, 1.02, PAINT, '#4a6a8a', rx=0.12, ry=0.08)
    ball(2.6, 0.4, -1.2, -1.4, sx=1.3, sy=1.6, sz=0.75, kind=PLASTER, col='#d0985e', segs=12)
    return build('buried_car')


def sand_fence():
    """A 4 m length of slatted sand fence on posts, along X."""
    for x in (-2, 0, 2):
        box(0.1, 0.1, 1.4, x, 0, -0.2, PLANKS, '#7a6450')
    for k in range(24):
        box(0.05, 0.03, 1.1, -1.9 + k * 0.165, -0.06, 0.05, PLANKS, '#a8916e')
    box(4.1, 0.03, 0.06, 0, -0.08, 0.9, METAL, '#6a6a68')
    return build('sand_fence')


def viewpoint():
    """A canyon-rim viewpoint: a stone wall, a railing and a coin telescope."""
    for k in range(6):
        box(2.0, 0.6, 0.9, -5 + k * 2.0, 0, 0, MASONRY, ['#a86a44', '#9a5e3c', '#b47650'][k % 3])
    for x in (-5.5, 5.5):
        box(0.1, 0.1, 1.0, x, 0, 0.9, METAL, '#4a4a48')
    box(11, 0.06, 0.06, 0, 0, 1.85, METAL, '#4a4a48')
    telescope(-1.5, -1.2)
    box(1.6, 0.1, 1.0, 3, -0.4, 1.0, PAINT, '#5a3a22', rx=-0.5)
    box(1.4, 0.11, 0.8, 3, -0.45, 1.05, PAINT, '#d8c8a0', rx=-0.5)
    return build('viewpoint')


def telescope(x=0, y=0):
    cyl(0.07, 1.1, x, y, 0, METAL, '#2a5a8a', verts=8)
    box(0.35, 0.6, 0.35, x, y - 0.1, 1.1, METAL, '#2a5a8a', rx=0.2)
    for s in (-1, 1):
        cyl(0.1, 0.35, x + s * 0.1, y - 0.45, 1.2, METAL, '#1d1d1d', verts=8, rx=math.pi / 2 - 0.2)


def telescope_post():
    telescope()
    return build('telescope')


# ------------------------------------------------------------ ghost town

def false_front(name, w, d, h, col, sign, sign_col='#e8dcc0', porch=True, seed=1):
    """A wild west false-front building: a tall square facade over a gabled
    shed, a boardwalk porch with posts, and a painted sign."""
    rng = random.Random(seed)
    plinth(w + 0.3, d + 0.3, top=0.4, col='#7a6a58')
    z = 0.4
    box(w, d, h, 0, 0, z, PLANKS, col)
    rh = math.tan(0.45) * w / 2
    prism(w, d, rh, z + h, PLANKS, col)
    gable(w, d, 0.45, z + h, over=0.3, thick=0.08, kind=METAL, col='#8a5a3a', end_over=0.2)
    box(w + 0.2, 0.25, h + rh + 1.2, 0, -d / 2 - 0.1, z, PLANKS, col)
    box(w * 0.75, 0.3, 1.0, 0, -d / 2 - 0.2, z + h + rh - 0.4, PAINT, sign_col)
    for k in range(len(sign)):
        box(0.4, 0.32, 0.55, -w * 0.3 + k * (w * 0.6 / max(1, len(sign) - 1)), -d / 2 - 0.25, z + h + rh - 0.18, PAINT, '#2a1a10')
    if porch:
        box(w, 2.6, 0.15, 0, -d / 2 - 1.4, z - 0.15, PLANKS, '#8a7058')
        for x in (-w / 2 + 0.2, -w / 6, w / 6, w / 2 - 0.2):
            box(0.15, 0.15, 3.0, x, -d / 2 - 2.6, z, PLANKS, '#6a5040')
        box(w + 0.3, 2.8, 0.1, 0, -d / 2 - 1.4, z + 3.0, METAL, '#8a5a3a', rx=-0.15)
    door(0, -d / 2 - 0.25, z, w=1.4, h=2.3, col='#4a3020', frame='#c8b8a0')
    for x in (-w * 0.3, w * 0.3):
        window(x, -d / 2 - 0.25, z + 0.9, w=1.2, h=1.4, shutters=None, frame='#c8b8a0')
        if rng.random() < 0.5:
            box(1.4, 0.1, 0.2, x, -d / 2 - 0.3, z + 1.5, PLANKS, '#8a6a48', ry=0.3)
    return build(name)


def windmill():
    """A windmill pump: a steel lattice tower, a many-bladed fan and a tail."""
    H = 10
    for sx in (-1, 1):
        for sy in (-1, 1):
            o = box(0.12, 0.12, H * 1.01, sx * 1.4, sy * 1.4, 0, METAL, '#8a8a84')
            o.rotation_euler = (sy * 0.13, -sx * 0.13, 0)
    for k in range(4):
        z = 1 + k * 2.4
        w = 1.4 * (1 - z / H * 0.9)
        for s in (-1, 1):
            box(w * 2, 0.06, 0.06, 0, s * w, z, METAL, '#8a8a84')
            box(0.06, w * 2, 0.06, s * w, 0, z, METAL, '#8a8a84')
    box(0.5, 1.4, 0.5, 0, 0.3, H, METAL, '#6a6a64')
    for k in range(18):
        a = k / 18 * math.tau
        box(0.32, 0.02, 1.6, math.cos(a) * 1.0, -0.5, H + 0.25 + math.sin(a) * 1.0, METAL, '#c8c8c0', ry=-a + math.pi / 2, rx=0.15)
    box(0.04, 2.4, 1.2, 0, 1.8, H, PAINT, '#c8c8c0')
    box(1.6, 1.6, 0.9, 2.5, 0, 0, METAL, '#6a6a64')
    return build('windmill')


def water_tank_west():
    """A wooden water tower on four legs, beside the old railroad."""
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(0.3, 0.3, 7.0, sx * 1.8, sy * 1.8, 0, PLANKS, '#5a4030')
    for z in (2.5, 5.0):
        for s in (-1, 1):
            box(4.0, 0.12, 0.12, 0, s * 1.8, z, PLANKS, '#5a4030')
            box(0.12, 4.0, 0.12, s * 1.8, 0, z, PLANKS, '#5a4030')
    box(4.6, 4.6, 0.3, 0, 0, 7.0, PLANKS, '#6a5040')
    cyl(2.2, 3.6, 0, 0, 7.3, PLANKS, '#8a6a48', verts=16)
    for k in range(4):
        cyl(2.24, 0.08, 0, 0, 7.5 + k * 0.9, METAL, '#2a2a2a', verts=16)
    cyl(2.35, 1.0, 0, 0, 10.9, SHINGLES, '#5a4a3a', verts=16, r2=0.15)
    return build('water_tank_west')


def hitching_rail():
    for x in (-1.4, 1.4):
        box(0.12, 0.12, 1.1, x, 0, 0, PLANKS, '#6a5040')
    box(3.2, 0.1, 0.1, 0, 0, 1.0, PLANKS, '#7a6050')
    cyl(0.3, 0.8, 2.3, 0.4, 0, PLANKS, '#7a5a3a', verts=10)
    cyl(0.32, 0.05, 2.3, 0.4, 0.2, METAL, '#3a3a3a', verts=10)
    cyl(0.32, 0.05, 2.3, 0.4, 0.6, METAL, '#3a3a3a', verts=10)
    return build('hitching_rail')


def wagon_wheel():
    cyl(0.75, 0.08, 0, 0, 0.75, PLANKS, '#6a5040', verts=16, rx=math.pi / 2 + 0.1)
    for k in range(6):
        box(1.4, 0.05, 0.06, 0, -0.02, 0.75, PLANKS, '#6a5040', ry=k * math.pi / 6)
    return build('wagon_wheel')


def trading_post():
    """An adobe trading post: rounded earth walls, poles through the parapet,
    a shady porch and a painted sign."""
    w, d = 16, 10
    plinth(w + 0.3, d + 0.3, top=0.3, col='#a8805a')
    z = 0.3
    box(w, d, 4.0, 0, 0, z, PLASTER, '#c8946a')
    box(w + 0.1, d + 0.1, 0.6, 0, 0, z + 4.0, PLASTER, '#c08a60')
    for k in range(8):
        cyl(0.13, 1.2, -w / 2 + 1 + k * 2, -d / 2 - 0.1, z + 3.2, PLANKS, '#6a5040', verts=6, rx=math.pi / 2)
    box(w, 3.0, 0.15, 0, -d / 2 - 1.5, z + 3.0, PLANKS, '#8a6a48')
    for x in (-w / 2 + 0.3, -w / 6, w / 6, w / 2 - 0.3):
        box(0.2, 0.2, 3.0, x, -d / 2 - 2.9, z, PLANKS, '#6a5040')
    door(0, -d / 2, z, w=1.4, h=2.3, col='#2a6a8a', frame='#e8dcc0')
    for x in (-w * 0.3, w * 0.3):
        window(x, -d / 2, z + 0.9, w=1.4, h=1.2, shutters='#2a6a8a', frame='#e8dcc0')
    box(7, 0.2, 1.0, 0, -d / 2 - 0.1, z + 4.7, PAINT, '#e8dcc0')
    for k in range(9):
        box(0.4, 0.22, 0.5, -2.8 + k * 0.7, -d / 2 - 0.15, z + 4.95, PAINT, ['#b02a20', '#2a6a8a'][k % 2])
    return build('trading_post')


# ------------------------------------------------------------ railway

def freight_car(name, kind):
    """One freight car, 14 m long along Y, on two bogies."""
    L = 14
    for y in (-L / 2 + 2.5, L / 2 - 2.5):
        box(2.4, 2.8, 0.7, 0, y, 0.25, METAL, '#2a2a2a')
        for s in (-1, 1):
            for k in (-0.8, 0.8):
                cyl(0.45, 0.2, s * 0.75, y + k, 0.45, METAL, '#3a3a3a', verts=10, ry=math.pi / 2)
    box(3.0, L, 0.4, 0, 0, 1.0, METAL, '#3a3a3a')
    if kind == 'box':
        box(3.0, L - 0.3, 3.2, 0, 0, 1.4, METAL, '#8a3a24')
        for s in (-1, 1):
            box(0.05, 2.6, 2.6, s * 1.52, 0, 1.6, METAL, '#6a2a1a')
    elif kind == 'tank':
        cyl(1.45, L - 1, 0, -L / 2 + 0.5, 2.9, METAL, '#2a2a2c', verts=14, rx=-math.pi / 2)
        cyl(0.4, 0.4, 0, 0, 4.3, METAL, '#2a2a2c', verts=8)
    elif kind == 'hopper':
        box(3.0, L - 0.4, 2.6, 0, 0, 1.4, METAL, '#6a6a5a')
        for y in (-3, 0, 3):
            box(2.6, 2.0, 0.9, 0, y, 0.6, METAL, '#5a5a4a')
    elif kind == 'flat':
        for k in range(3):
            box(2.6, 3.8, 2.4, 0, -4.4 + k * 4.4, 1.4, METAL, ['#2a5a8a', '#b8a020', '#2a7a4a'][k])
    return build(name)


def locomotive():
    """A diesel locomotive, 20 m long along Y, cab at the -Y end."""
    L = 20
    for y in (-L / 2 + 3.5, L / 2 - 3.5):
        box(2.4, 4.0, 0.8, 0, y, 0.25, METAL, '#2a2a2a')
        for s in (-1, 1):
            for k in (-1.3, 0, 1.3):
                cyl(0.5, 0.2, s * 0.75, y + k, 0.5, METAL, '#3a3a3a', verts=10, ry=math.pi / 2)
    box(3.0, L, 0.5, 0, 0, 1.05, METAL, '#3a3a3a')
    box(2.7, L - 5, 3.0, 0, 2.0, 1.55, METAL, '#d8a020')
    box(3.0, 4.0, 3.6, 0, -L / 2 + 2.5, 1.55, METAL, '#d8a020')
    box(2.8, 0.05, 1.0, 0, -L / 2 + 0.48, 3.4, GLASS, '#2a3238')
    box(3.02, 0.6, 0.4, 0, -L / 2 + 0.6, 2.0, PAINT, '#1d1d1d')
    box(3.02, L - 5, 0.4, 0, 2.0, 2.2, PAINT, '#1d1d1d')
    cyl(0.18, 0.05, 0, -L / 2 + 0.47, 2.7, EMISSIVE, '#fff6d0', verts=10, rx=math.pi / 2)
    return build('locomotive')


def crossbuck():
    """A railroad crossing sign: white crossed boards and red lights."""
    cyl(0.07, 4.0, 0, 0, 0, METAL, '#d8d8d0', verts=6)
    for a in (0.6, -0.6):
        box(2.0, 0.06, 0.3, 0, -0.08, 3.4, PAINT, '#f4f0e6', ry=a)
    box(1.4, 0.12, 0.15, 0, -0.06, 2.5, METAL, '#2a2a2a')
    for s in (-1, 1):
        cyl(0.18, 0.15, s * 0.6, -0.15, 2.4, PAINT, '#1d1d1d', verts=12, rx=math.pi / 2)
        cyl(0.13, 0.05, s * 0.6, -0.3, 2.4, EMISSIVE, '#ff2a1a', verts=12, rx=math.pi / 2)
    return build('crossbuck')


def signal_post():
    cyl(0.1, 6, 0, 0, 0, METAL, '#2a2a2a', verts=6)
    box(0.6, 0.4, 1.6, 0, 0, 5.0, METAL, '#1d1d1d')
    for k, c in enumerate(('#2aff4a', '#ffd02a', '#ff2a1a')):
        cyl(0.14, 0.1, 0, -0.22, 6.3 - k * 0.5, EMISSIVE if k == 0 else PAINT, c if k == 0 else '#3a3a3a', verts=10, rx=math.pi / 2)
    return build('signal_post')


# ------------------------------------------------------------ dam

def intake_tower():
    """A dam intake tower: a tall concrete cylinder rising out of the
    reservoir with a little house on top."""
    cyl(4.0, 50, 0, 0, -45, MASONRY, '#c8c0b0', verts=20)
    for k in range(6):
        box(0.6, 0.3, 30, math.cos(k * 1.05) * 4.0, math.sin(k * 1.05) * 4.0, -25, MASONRY, '#b8b0a0', rz=k * 1.05)
    cyl(4.6, 0.6, 0, 0, 5, MASONRY, '#d8d0c0', verts=20)
    cyl(3.0, 3.0, 0, 0, 5.6, PLASTER, '#e0d8c8', verts=16)
    cyl(3.4, 1.4, 0, 0, 8.6, SHINGLES, '#6a8a8a', verts=16, r2=0.5)
    for k in range(8):
        a = k / 8 * math.tau
        box(0.8, 0.1, 1.2, math.cos(a) * 3.02, math.sin(a) * 3.02, 6.8, GLASS, '#2a3a44', rz=a + math.pi / 2)
    return build('intake_tower')


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mesa()
    mesa('mesa_b', seed=5, R=50, H=55)
    butte()
    butte('butte_b', seed=7, R=16, H=60)
    hoodoo()
    hoodoo('hoodoo_b', seed=6, H=12)
    boulder_red()
    boulder_red('boulder_red_b', seed=9, s=5.0)
    rock_arch()
    saguaro()
    saguaro('saguaro_b', seed=2)
    saguaro('saguaro_c', seed=3)
    barrel_cactus()
    prickly_pear()
    sagebrush()
    sagebrush('sagebrush_b', seed=2, s=1.4)
    tumbleweed()
    joshua()
    joshua('joshua_b', seed=2)
    motel()
    neon_sign()
    carpark()
    gas_station()
    rusty_pump()
    diner()
    pickup()
    pickup('pickup_b', '#5a6a6a')
    buried_car()
    sand_fence()
    viewpoint()
    telescope_post()
    false_front('saloon', 10, 14, 4.5, '#8a6a4a', 'SALOON', seed=1)
    false_front('store', 8, 12, 4.0, '#9a7a58', 'STORE', sign_col='#d8c8a0', seed=2)
    false_front('bank', 8, 10, 4.2, '#7a5a40', 'BANK', seed=3)
    false_front('jail', 6, 8, 3.6, '#a08060', 'JAIL', porch=False, seed=4)
    windmill()
    water_tank_west()
    hitching_rail()
    wagon_wheel()
    trading_post()
    freight_car('boxcar', 'box')
    freight_car('tankcar', 'tank')
    freight_car('hopper', 'hopper')
    freight_car('flatcar', 'flat')
    locomotive()
    crossbuck()
    signal_post()
    intake_tower()
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'props_canyon.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_materials='NONE', export_normals=True,
                              export_texcoords=True, export_apply=True, export_vertex_color='ACTIVE')
    print('wrote', path)


if __name__ == '__main__':
    main()
