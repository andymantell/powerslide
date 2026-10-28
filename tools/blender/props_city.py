"""Builds City at Night's props (street blocks with shops and neon, painted
row houses with bay windows, office towers, the tram and its stop, the
Chinatown gate and food stalls, the market, the stadium, the fair, the docks
and the container ship) and exports them to src/assets/models/props_city.glb.
Same conventions as props.py, whose helpers it uses: vertex colour plus a
surface kind per face, front facing Blender -Y (three.js +Z), origin on the
ground. The city also loads the suburbs' street furniture (lampposts, bus
stops, bins and parked cars).

City glass is kind 11 (WINDOWS): src/propmat.js lights about half of its
panes at night, a pane being each 3 m along a wall and 3.2 m up. So floors
start at multiples of 3.2 m, and wall lengths are multiples of 6 m with the
panes centred 1.5 m in from each end, 3 m apart.

  python tools/blender/props_city.py
"""
import math
import os
import random
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
from props import (EMISSIVE, GLASS, MASONRY, METAL, OUT, PAINT, PLANKS, PLASTER, SHINGLES, ball, box, build, cyl,  # noqa: E402
                   mesh)

LEAVES = 8
PAVING = 9
TARMAC = 10
WINDOWS = 11
FLOOR = 3.2

BRICK = ['#7a3e2e', '#8a4a36', '#6e3a2c', '#94563e', '#5e3428', '#a0664a']
STONE = ['#b8ab98', '#a89c8a', '#c4b8a4', '#9a8e7e', '#d0c6b4']
PASTEL = ['#d9c7a3', '#b7cbd6', '#e2b6a6', '#c9d6b4', '#e8dcc0', '#b9b1d0', '#e6c88a', '#a8c4c0']
NEON = ['#ff3a8c', '#3ae8ff', '#ffd23a', '#7aff5a', '#ff5a3a', '#b05aff', '#ff8ad8']
GLASS_COL = '#22303a'


# ------------------------------------------------------------ pieces

def panes(L, face, off, z0, floors, rng, pw=1.6, ph=1.9, frame='#2a2724', sills=True, skip=()):
    """A grid of windows on a wall face: `face` is '-y', '+y', '-x' or '+x',
    `off` the face's distance from the centre, `L` its length (a multiple of
    6), floors from z0 (a multiple of 3.2) up."""
    n = int(round(L / 3))
    for f in range(floors):
        z = z0 + f * FLOOR + 0.75
        for k in range(n):
            if (f, k) in skip:
                continue
            u = -L / 2 + 1.5 + 3 * k
            for (sx, sy, sz, nn, dz, kind, col) in ((pw + 0.24, 0.1, ph + 0.24, 0.02, -0.12, PAINT, frame),
                                                     (pw, 0.12, ph, 0.04, 0, WINDOWS, GLASS_COL)) + \
                    (((pw + 0.4, 0.22, 0.12, 0.1, -0.24, MASONRY, '#b4ab9c'),) if sills else ()):
                if face in ('-y', '+y'):
                    s = -1 if face == '-y' else 1
                    box(sx, sy, sz, u, s * (off + nn), z + dz, kind, col)
                else:
                    s = -1 if face == '-x' else 1
                    box(sy, sx, sz, s * (off + nn), u, z + dz, kind, col)


def cornice(w, d, z, col, h=0.6, out=0.35):
    box(w + 2 * out, d + 2 * out, h * 0.4, 0, 0, z, PAINT, col)
    box(w + out, d + out, h * 0.6, 0, 0, z + h * 0.4, PAINT, col)


def roof_clutter(w, d, z, rng, tank=True):
    """Water tanks, air-con units, a stair house and vents on a flat roof."""
    box(w - 0.4, d - 0.4, 0.1, 0, 0, z, PAINT, '#4a4744')
    if tank and rng.random() < 0.7:
        x, y = rng.uniform(-w / 4, w / 4), rng.uniform(0, d / 4)
        for a in range(4):
            ang = a * math.pi / 2 + math.pi / 4
            cyl(0.08, 3.0, x + math.cos(ang) * 1.2, y + math.sin(ang) * 1.2, z, METAL, '#3a3836', verts=4)
        cyl(1.5, 3.2, x, y, z + 3.0, PLANKS, '#6a5040', verts=14)
        cyl(1.6, 0.9, x, y, z + 6.2, SHINGLES, '#3a3430', verts=14, r2=0.1)
    box(3.2, 3.6, 2.8, rng.uniform(-w / 3, w / 3), d / 4, z, PLASTER, '#8a847c')
    for _ in range(rng.randint(2, 5)):
        box(1.4, 1.0, 1.0, rng.uniform(-w / 2 + 1, w / 2 - 1), rng.uniform(-d / 2 + 1, d / 2 - 1), z, METAL, '#9a9c9e')


def fire_escape(x, y, z0, floors, col='#2a2a2a'):
    """A zigzag iron fire escape on the front: landings and stairs."""
    for f in range(floors):
        z = z0 + f * FLOOR
        box(4.6, 1.2, 0.08, x, y - 0.6, z, METAL, col)
        for k in range(12):
            box(0.04, 0.04, 1.0, x - 2.25 + k * 0.41, y - 1.18, z, METAL, col)
        box(4.6, 0.05, 0.05, x, y - 1.18, z + 1.0, METAL, col)
        if f < floors - 1:
            s = 1 if f % 2 else -1
            box(5.1, 0.6, 0.06, x, y - 0.75, z + 1.57, METAL, col, ry=s * 0.675)
            box(5.1, 0.04, 0.6, x, y - 1.05, z + 1.9, METAL, col, ry=s * 0.675)


def shopfront(w, y, rng, neon=0.0, awnings=True):
    """Ground-floor shops across a w-wide front at y, one to each 6 m: two
    plate-glass panes (lit or dark at night, like the windows above), a
    door, a fascia sign and sometimes an awning or a neon sign."""
    n = int(w // 6)
    for k in range(n):
        x = -w / 2 + 6 * k + 3
        for px in (x - 1.5, x + 1.5):
            box(2.7, 0.12, 2.3, px, y - 0.02, 0.35, WINDOWS, '#3a3428')
        box(0.2, 0.18, 2.4, x, y - 0.05, 0.3, PAINT, '#1e1e1e')
        box(5.8, 0.14, 0.12, x, y - 0.05, 0.25, PAINT, '#1e1e1e')
        box(0.95, 0.2, 2.2, x + 2.2, y - 0.08, 0.1, PAINT, rng.choice(['#1e1e1e', '#5a1e1e', '#1e3a2a']))
        col = rng.choice(['#1e2a3a', '#5a1e1e', '#1e3a2a', '#2a2a2a', '#4a3a1e'])
        box(5.9, 0.3, 0.7, x, y - 0.15, 2.7, PAINT, col)
        if rng.random() < neon:
            # A neon sign along the fascia, in a tube colour or two.
            c = rng.choice(NEON)
            box(4.4, 0.12, 0.14, x, y - 0.32, 3.14, EMISSIVE, c)
            box(4.4, 0.12, 0.14, x, y - 0.32, 2.66, EMISSIVE, c)
            for j in range(4):
                box(0.6, 0.12, 0.3, x - 1.5 + j, y - 0.32, 2.8, EMISSIVE, rng.choice((c, c, '#8a7a60')))
        else:
            # Lettering lit softly on the sign board.
            for j in range(rng.randint(3, 6)):
                box(0.4, 0.06, 0.32, x - 1.6 + j * 0.62, y - 0.32, 2.88, EMISSIVE, rng.choice(['#8a6a3a', '#6a6a6a', '#7a3a2a', '#3a5a7a']))
        if awnings and rng.random() < 0.4:
            a = rng.choice([('#b02a2a', '#f0e8d8'), ('#1e5a3a', '#f0e8d8'), ('#2a4a7a', '#f0e8d8'), ('#2a2a2a', '#2a2a2a')])
            for j in range(6):
                o = box(1.0, 1.6, 0.05, x - 2.5 + j, y - 0.85, 2.3, PAINT, a[j % 2])
                o.rotation_euler = (-0.3, 0, 0)


def blade(x, y, z, h, col, rng):
    """A tall neon blade sign sticking out from a front wall."""
    box(0.35, 1.5, h, x, y - 0.8, z, PAINT, '#1a1a22')
    for k in range(int(h / 0.9)):
        box(0.4, 1.2, 0.55, x, y - 0.8, z + 0.25 + k * 0.9, EMISSIVE, rng.choice((col, col, '#8a7a60')))
    box(0.42, 1.56, 0.12, x, y - 0.8, z, EMISSIVE, col)
    box(0.42, 1.56, 0.12, x, y - 0.8, z + h - 0.12, EMISSIVE, col)
    box(0.42, 0.1, h, x, y - 1.52, z, EMISSIVE, col)


# ------------------------------------------------------------ buildings

def block(name, w, d, floors, seed, wall=MASONRY, col=None, neon=0.0, escape=False, blades=0, tank=True, trim='#cfc6b4'):
    """A street block: shops on the ground floor, flats or offices above.
    Front on -Y. A plinth runs 5 m down so it can stand on a steep street."""
    rng = random.Random(seed)
    col = col or rng.choice(BRICK if wall == MASONRY else STONE)
    H = FLOOR * (floors + 1)
    box(w, d, 5.0, 0, 0, -5.0, MASONRY, '#5a5550')
    box(w, d, H, 0, 0, 0, wall, col)
    # Ground floor in stone, a string course over the shops, a cornice.
    box(w + 0.1, d + 0.1, FLOOR, 0, 0, 0, MASONRY, trim)
    box(w + 0.3, d + 0.3, 0.3, 0, 0, FLOOR, PAINT, trim)
    shopfront(w, -d / 2, rng, neon=neon)
    panes(w, '-y', d / 2, FLOOR, floors, rng, frame=rng.choice(['#e8e2d4', '#2a2724', '#5a3a2a']))
    panes(d, '-x', w / 2, FLOOR, floors, rng, sills=False)
    panes(d, '+x', w / 2, FLOOR, floors, rng, sills=False)
    panes(w, '+y', d / 2, FLOOR, floors, rng, sills=False)
    cornice(w, d, H, trim)
    roof_clutter(w, d, H + 0.6, rng, tank)
    if escape:
        fire_escape(rng.choice((-1, 1)) * (w / 2 - 3.5), -d / 2, FLOOR * 2, floors - 1)
    for k in range(blades):
        x = (-w / 2 + 2) if k == 0 else (w / 2 - 2)
        blade(x, -d / 2, FLOOR * 1.4, min(H - FLOOR * 1.6, 9 + rng.random() * 5), rng.choice(NEON), rng)
    return build(name)


def victorian(name, seed, col):
    """A San Francisco style painted row house, 6 m wide: a garage at the
    street, a bay window up two floors, a bracketed cornice."""
    rng = random.Random(seed)
    w, d = 6, 12
    trim = rng.choice(['#f4efe4', '#ffffff', '#e8e0c8'])
    accent = rng.choice(['#7a2a3a', '#2a4a6a', '#3a5a3a', '#c08a2a', '#5a3a6a'])
    box(w, d, 5.0, 0, 0, -5.0, MASONRY, '#6a645c')
    H = FLOOR * 3
    box(w - 0.1, d, H, 0, 0, 0, PLANKS, col)
    # Garage and stair to the front door.
    box(2.8, 0.12, 2.4, -1.5, -d / 2 - 0.02, 0, PLANKS, trim)
    box(2.5, 0.14, 2.2, -1.5, -d / 2 - 0.04, 0.05, PLANKS, accent)
    box(1.2, 0.14, 2.3, 1.7, -d / 2 - 0.04, FLOOR + 0.05, PLANKS, accent)
    for k in range(9):
        box(1.4, 0.35, 0.36, 1.7, -d / 2 - 2.8 + k * 0.3, k * 0.36, MASONRY, '#9a948a')
    box(1.6, 1.2, 0.15, 1.7, -d / 2 - 0.6, FLOOR - 0.05, PAINT, trim)
    # The bay: three faces up two floors, with a little roof.
    for f in (1, 2):
        z = f * FLOOR
        box(3.0, 0.9, FLOOR, -1.5, -d / 2 - 0.45, z, PLANKS, col)
        box(1.7, 0.1, 1.9, -1.5, -d / 2 - 0.92, z + 0.75, WINDOWS, GLASS_COL)
        box(1.9, 0.08, 2.1, -1.5, -d / 2 - 0.9, z + 0.65, PAINT, trim)
        for s in (-1, 1):
            box(0.1, 0.5, 1.8, -1.5 + s * 1.52, -d / 2 - 0.45, z + 0.8, GLASS, GLASS_COL)
        box(3.2, 1.1, 0.25, -1.5, -d / 2 - 0.45, z + FLOOR - 0.3, PAINT, trim)
        box(1.0, 0.1, 1.9, 1.5, -d / 2 - 0.04, z + 0.75, WINDOWS, GLASS_COL)
        box(1.2, 0.08, 2.1, 1.5, -d / 2 - 0.02, z + 0.65, PAINT, trim)
    # Bracketed cornice and a false front parapet.
    box(w + 0.2, 1.0, 0.5, 0, -d / 2 - 0.3, H, PAINT, trim)
    for k in range(7):
        box(0.15, 0.6, 0.5, -w / 2 + 0.3 + k * 0.9, -d / 2 - 0.2, H - 0.5, PAINT, trim)
    box(w, 0.3, 1.1, 0, -d / 2 + 0.1, H + 0.5, PLANKS, col)
    box(w + 0.1, 0.5, 0.15, 0, -d / 2, H + 1.6, PAINT, accent)
    box(w - 0.2, d - 0.6, 0.6, 0, 0.3, H, PAINT, '#4a4744')
    return build(name)


def tower(name, w, d, H, seed, glass='#2a3a4a', fin='#b8bcc0', crown='#f2f6ff', steps=2, top=None):
    """An office tower: glass curtain walls (each pane its own light at
    night), fins every 3 m, spandrels at each floor, set back in `steps`
    stages, a lit crown and a mast with a red light."""
    rng = random.Random(seed)
    box(w + 6, d + 6, 5.0, 0, 0, -5.0, MASONRY, '#5a5856')
    box(w + 6, d + 6, 0.4, 0, 0, 0, PAVING, '#8a8680')
    # Lobby: tall clear glass.
    box(w - 1.0, d - 1.0, FLOOR * 2, 0, 0, 0.4, WINDOWS, '#3a4a54')
    box(w, d, 0.6, 0, 0, FLOOR * 2, PAINT, fin)
    z = FLOOR * 2
    stage_h = (H - z) / steps
    ww, dd = w, d
    for st in range(steps):
        zt = z + stage_h
        floors = int((zt - z) / FLOOR)
        zt = z + floors * FLOOR
        box(ww, dd, zt - z, 0, 0, z, WINDOWS, glass)
        for k in range(int(ww / 3) + 1):
            for s in (-1, 1):
                box(0.18, 0.5, zt - z, -ww / 2 + 3 * k, s * (dd / 2 + 0.2), z, METAL, fin)
        for k in range(int(dd / 3) + 1):
            for s in (-1, 1):
                box(0.5, 0.18, zt - z, s * (ww / 2 + 0.2), -dd / 2 + 3 * k, z, METAL, fin)
        for f in range(floors):
            box(ww + 0.3, dd + 0.3, 0.45, 0, 0, z + f * FLOOR, PAINT, '#3a4048')
        box(ww + 0.6, dd + 0.6, 0.8, 0, 0, zt, PAINT, fin)
        z = zt + 0.8
        if st < steps - 1:
            ww, dd = ww - 6, dd - 6
    # The crown: a lit band and a mast.
    style = top or rng.choice(['band', 'spire', 'flat'])
    if style == 'band':
        box(ww - 1, dd - 1, 6, 0, 0, z, METAL, '#4a5058')
        for s in (-1, 1):
            box(ww - 1.2, 0.1, 1.0, 0, s * ((dd - 1) / 2 + 0.05), z + 3.5, EMISSIVE, crown)
            box(0.1, dd - 1.2, 1.0, s * ((ww - 1) / 2 + 0.05), 0, z + 3.5, EMISSIVE, crown)
        z += 6
    elif style == 'spire':
        v = [(-ww / 2, -dd / 2, 0), (ww / 2, -dd / 2, 0), (ww / 2, dd / 2, 0), (-ww / 2, dd / 2, 0), (0, 0, ww * 1.4)]
        mesh(v, [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)], METAL, '#8a9098', z=z)
        for s in (-1, 1):
            box(0.15, 0.15, ww * 1.2, s * ww * 0.18, -dd * 0.18, z, EMISSIVE, crown, ry=s * 0.33, rx=0.33)
        z += ww * 1.4
    else:
        roof_clutter(ww, dd, z, rng, tank=False)
        z += 3
    cyl(0.3, 18, 0, 0, z, METAL, '#cfd2d4', verts=6, r2=0.1)
    ball(0.5, 0, 0, z + 18, kind=EMISSIVE, col='#ff2a1a', segs=6)
    return build(name)


def screen():
    """A giant video screen on a steel frame: bold blocks of colour."""
    rng = random.Random(4)
    box(24, 1.2, 14, 0, 0.6, 6, METAL, '#2a2c30')
    cols = ['#ff3a6a', '#2a8aff', '#ffd23a', '#3aff9a', '#ffffff', '#ff7a2a', '#8a3aff']
    for i in range(8):
        for j in range(5):
            box(2.8, 0.1, 2.5, -10.5 + i * 3, -0.05, 7 + j * 2.6, EMISSIVE, rng.choice(cols))
    for x in (-8, 8):
        box(1.2, 1.2, 6, x, 0.6, 0, METAL, '#3a3c40')
    return build('screen')


def billboard():
    """A lit rooftop billboard on a lattice frame, 14 m wide."""
    box(14, 0.3, 5, 0, 0, 4, PAINT, '#e8e0d0')
    box(13, 0.1, 4, 0, -0.2, 4.5, EMISSIVE, '#ff8a3a')
    box(6, 0.1, 2.4, -2.5, -0.27, 5.3, EMISSIVE, '#2a3a8a')
    ball(1.2, 4, -0.3, 6.5, sy=0.2, kind=EMISSIVE, col='#fff2c0', segs=10)
    for x in (-6, -2, 2, 6):
        box(0.2, 0.2, 4, x, 0.3, 0, METAL, '#4a4c50')
        o = box(0.12, 0.12, 4.4, x + 1, 0.3, 0, METAL, '#4a4c50')
        o.rotation_euler = (0, 0.45, 0)
    for x in (-5, 0, 5):
        box(0.15, 1.0, 0.15, x, -0.6, 9.0, METAL, '#4a4c50')
        box(0.4, 0.4, 0.25, x, -1.1, 8.9, EMISSIVE, '#fff6e0')
    return build('billboard')


# ------------------------------------------------------------ trams

def tram(name='tram', body='#2a6a4a', cream='#efe6c8'):
    """A heritage electric streetcar, 14 m along X, with a trolley pole."""
    L, W = 14, 2.6
    box(L, W, 1.1, 0, 0, 0.55, PAINT, body)
    box(L, W, 0.9, 0, 0, 1.65, PAINT, cream)
    box(L - 1.0, W + 0.02, 0.85, 0, 0, 1.7, GLASS, '#2a3238')
    for k in range(9):
        box(0.14, W + 0.06, 0.95, -L / 2 + 0.9 + k * (L - 1.8) / 8, 0, 1.65, PAINT, cream)
    box(L, W, 0.35, 0, 0, 2.55, PAINT, body)
    box(L - 0.6, W - 0.4, 0.45, 0, 0, 2.9, PAINT, '#3a3a3a')
    for s in (-1, 1):
        box(0.1, W - 0.2, 1.8, s * (L / 2 + 0.03), 0, 1.0, PAINT, body)
        box(0.12, 1.6, 0.8, s * (L / 2 + 0.05), 0, 1.75, GLASS, '#2a3238')
        box(0.12, 0.5, 0.25, s * (L / 2 + 0.06), 0, 2.62, EMISSIVE, '#ffe8a8')
        box(0.12, 0.3, 0.3, s * (L / 2 + 0.06), 0.7, 0.75, EMISSIVE, '#fff6e0')
        box(0.12, 0.3, 0.3, s * (L / 2 + 0.06), -0.7, 0.75, EMISSIVE, '#fff6e0')
        for x in (-0.8, 0.8):
            cyl(0.38, 0.12, s * 4.5 + x, -0.75, 0.38, METAL, '#2a2a2a', verts=12, rx=math.pi / 2)
            cyl(0.38, 0.12, s * 4.5 + x, 0.87, 0.38, METAL, '#2a2a2a', verts=12, rx=math.pi / 2)
        box(2.6, W - 0.6, 0.4, s * 4.5, 0, 0.15, METAL, '#2a2a2a')
    # Trolley pole up to the wire, 5.8 m over the rail.
    box(0.6, 0.6, 0.3, 2.0, 0, 3.35, METAL, '#2a2a2a')
    o = cyl(0.05, 4.6, 2.0, 0, 3.6, METAL, '#2a2a2a', verts=6)
    o.rotation_euler = (0, -1.15, 0)
    return build(name)


def tram_stop():
    """A tram stop island: a raised platform 20 m along X with a lit
    shelter and a sign."""
    box(20, 2.6, 0.32, 0, 0, -0.1, PAVING, '#a8a49c')
    box(20, 0.25, 0.02, 0, -1.2, 0.22, PAINT, '#e8c83a')
    for x in (-2.5, 2.5):
        cyl(0.06, 2.6, x, 0.8, 0.22, METAL, '#3a3c40', verts=6)
        cyl(0.06, 2.6, x, -0.5, 0.22, METAL, '#3a3c40', verts=6)
    box(6, 1.8, 0.12, 0, 0.15, 2.8, METAL, '#3a3c40')
    box(5.8, 1.6, 0.04, 0, 0.15, 2.76, EMISSIVE, '#e8f2ff')
    box(5.0, 0.05, 1.8, 0, 0.85, 0.5, GLASS, '#a8b8c0')
    box(4.0, 0.4, 0.45, 0, 0.55, 0.22, PLANKS, '#6a5040')
    cyl(0.07, 3.6, 7.5, 0, 0.22, METAL, '#3a3c40', verts=6)
    box(0.8, 0.12, 0.8, 7.5, 0, 3.4, EMISSIVE, '#ffd23a')
    box(1.2, 0.2, 2.0, -7.5, 0.6, 0.22, PAINT, '#2a4a6a')
    box(1.0, 0.05, 1.4, -7.5, 0.48, 0.5, EMISSIVE, '#f2f2e8')
    return build('tram_stop')


# ------------------------------------------------------------ Chinatown

def lantern_gate():
    """A Chinatown gate across the street, 18 m along X: red columns on the
    pavements either side and three tiers of green-tiled roofs with
    up-turned eaves, 7 m clear over the road."""
    RED, GOLD, TILE = '#b01e1e', '#d8a83a', '#2a6a4a'
    for x in (-8.4, -5.2, 5.2, 8.4):
        box(1.4, 1.4, 0.6, x, 0, 0, MASONRY, '#c8c0b0')
        cyl(0.4, 9.0 if abs(x) > 6 else 11.0, x, 0, 0.6, PAINT, RED, verts=12)
    box(17.8, 0.8, 0.9, 0, 0, 7.0, PAINT, RED)
    box(11.2, 0.8, 0.9, 0, 0, 9.4, PAINT, RED)
    box(3.6, 0.3, 1.6, 0, -0.5, 10.4, PAINT, '#1a3a6a')
    box(3.2, 0.32, 1.2, 0, -0.52, 10.6, EMISSIVE, GOLD)

    def roof(x, w, z, d=3.0):
        v = [(-w / 2, -d / 2, 0), (w / 2, -d / 2, 0), (w / 2, d / 2, 0), (-w / 2, d / 2, 0),
             (-w / 2 + 0.8, 0, 1.3), (w / 2 - 0.8, 0, 1.3)]
        mesh(v, [(0, 1, 5, 4), (2, 3, 4, 5), (1, 2, 5), (3, 0, 4), (3, 2, 1, 0)], SHINGLES, TILE, x=x, z=z)
        for s in (-1, 1):
            for t in (-1, 1):
                o = box(0.9, 0.3, 0.25, x + s * (w / 2 + 0.1), t * (d / 2 - 0.1), z + 0.2, PAINT, TILE)
                o.rotation_euler = (0, -s * 0.5, 0)
        box(w - 1.4, 0.25, 0.3, x, 0, z + 1.3, PAINT, GOLD)
    roof(-6.8, 4.8, 9.6)
    roof(6.8, 4.8, 9.6)
    roof(0, 12.0, 12.0, 3.4)
    for x in (-6.8, 6.8):
        for k in range(3):
            ball(0.35, x - 1.0 + k * 1.0, -0.6, 6.6, sx=1, sy=1, sz=1.3, kind=EMISSIVE, col='#ff3a1a', segs=8)
    return build('lantern_gate')


def food_stall(name, seed):
    """A street food cart: a counter, a lit menu, a striped canopy."""
    rng = random.Random(seed)
    c = rng.choice([('#c8302a', '#f2e8d0'), ('#e8a82a', '#2a2a2a'), ('#2a6a8a', '#f2e8d0')])
    box(3.0, 1.6, 1.0, 0, 0, 0.2, METAL, '#c0c4c8')
    box(3.1, 1.7, 0.08, 0, 0, 1.2, METAL, '#9a9ea2')
    for x in (-1.3, 1.3):
        cyl(0.25, 0.12, x, 0.85, 0.25, PAINT, '#2a2a2a', verts=10, rx=math.pi / 2)
    for x, y in ((-1.4, -0.7), (1.4, -0.7), (-1.4, 0.7), (1.4, 0.7)):
        cyl(0.04, 1.4, x, y, 1.28, METAL, '#3a3a3a', verts=6)
    for k in range(6):
        box(0.6, 2.2, 0.06, -1.5 + 0.3 + k * 0.6, 0, 2.7, PAINT, c[k % 2])
    box(2.4, 0.06, 0.5, 0, -0.85, 2.1, EMISSIVE, '#fff2c0')
    for k in range(3):
        cyl(0.3, 0.25, -0.8 + k * 0.8, 0.1, 1.28, METAL, '#6a6a6a', verts=10)
    for k in range(5):
        ball(0.18, -1.2 + k * 0.6, -0.9, 2.55, sz=1.3, kind=EMISSIVE, col='#ff3a1a', segs=6)
    box(0.8, 0.8, 0.8, 1.9, 0.2, 0, PLANKS, '#8a6a4a')
    return build(name)


# ------------------------------------------------------------ market

def market_stall(name, seed):
    """A night market stall: a frame, a striped awning, a trestle of
    produce or goods and a string of bulbs."""
    rng = random.Random(seed)
    stripes = rng.choice([('#c8302a', '#f2e8d0'), ('#2a6a3a', '#f2e8d0'), ('#2a4a8a', '#f2e8d0'), ('#e8a82a', '#c8302a'), ('#6a2a6a', '#f2e8d0')])
    for x in (-1.9, 1.9):
        for y in (-1.2, 1.2):
            cyl(0.04, 2.6 if y > 0 else 2.2, x, y, 0, METAL, '#3a3a3a', verts=6)
    for k in range(8):
        o = box(0.5, 2.7, 0.04, -1.75 + k * 0.5, 0, 2.4, PAINT, stripes[k % 2])
        o.rotation_euler = (0.15, 0, 0)
    box(3.6, 1.1, 0.06, 0, -0.5, 0.85, PLANKS, '#8a6a4a')
    for x in (-1.6, 1.6):
        box(0.06, 1.0, 0.85, x, -0.5, 0, PLANKS, '#6a5040')
    goods = rng.choice([['#d83a2a', '#e8a82a', '#7aa83a'], ['#e8d84a', '#e8a82a', '#c8302a'], ['#3a8ad8', '#e83a8a', '#f2f2f2'], ['#7a4a2a', '#c89a5a', '#4a2a1a']])
    for k in range(6):
        box(0.5, 0.4, 0.22, -1.4 + k * 0.56, -0.6, 0.91, PLANKS, '#a8865a')
        for j in range(4):
            ball(0.09, -1.55 + k * 0.56 + (j % 2) * 0.2, -0.7 + (j // 2) * 0.2, 1.15, kind=PAINT, col=rng.choice(goods), segs=6)
    for k in range(7):
        ball(0.07, -1.8 + k * 0.6, -1.3, 2.05 - 0.15 * math.sin(k / 6 * math.pi), kind=EMISSIVE, col='#ffe8a0', segs=5)
    for k in range(2):
        box(0.5, 0.4, 0.35, 1.0 + k * 0.55, 0.9, 0, PLANKS, '#9a7a4a')
    return build(name)


def crates():
    rng = random.Random(9)
    for k in range(7):
        x, y, z = (k % 3) * 0.62 - 0.6, (k // 3 % 2) * 0.5, (k // 6) * 0.42
        box(0.58, 0.44, 0.4, x, y, z, PLANKS, rng.choice(['#a8865a', '#9a7a4a', '#7a8a9a', '#5a7a5a']))
    return build('crates')


# ------------------------------------------------------------ stadium

def stadium():
    """A floodlit stadium, 150 x 110 m: an oval bowl of stands under a
    roof ring, the pitch glowing inside and four floodlight masts."""
    A, B = 75, 55  # outer half axes
    N = 40
    H = 26
    def ring(a, b, z):
        return [(a * math.cos(t * math.tau / N), b * math.sin(t * math.tau / N), z) for t in range(N)]
    # Outer wall: concrete with glazed concourse bands.
    o = ring(A, B, -4) + ring(A, B, H)
    faces = [(i, (i + 1) % N, N + (i + 1) % N, N + i) for i in range(N)]
    mesh(o, faces, PLASTER, '#a8a49c')
    for k, z in enumerate((3.2, 9.6)):
        g = ring(A + 0.2, B + 0.2, z) + ring(A + 0.2, B + 0.2, z + 3.2)
        mesh(g, faces, WINDOWS, '#3a4a54')
    # Stands: from the pitch edge up and out to the wall.
    a0, b0 = 52, 34
    s = ring(a0, b0, 1.0) + ring(A - 1, B - 1, H - 2)
    mesh(s, [(N + i, N + (i + 1) % N, (i + 1) % N, i) for i in range(N)], PAINT, '#3a4a7a')
    for k in range(1, 6):
        t = k / 6
        r = ring(a0 + (A - 1 - a0) * t, b0 + (B - 1 - b0) * t, 1.0 + (H - 3) * t)
        r2 = ring(a0 + (A - 1 - a0) * t + 0.4, b0 + (B - 1 - b0) * t + 0.4, 1.0 + (H - 3) * t + 0.15)
        mesh(r + r2, [(i, (i + 1) % N, N + (i + 1) % N, N + i) for i in range(N)], PAINT, '#c8c8d0')
    # The pitch, lit by the floodlights.
    box(100, 64, 0.3, 0, 0, 0.7, EMISSIVE, '#1e4a1e')
    for k in range(10):
        box(10, 64, 0.02, -45 + k * 10, 0, 1.01, EMISSIVE, '#245a24' if k % 2 else '#1e4a1e')
    box(0.3, 64, 0.03, 0, 0, 1.03, EMISSIVE, '#c8d8c8')
    # Roof ring over the stands.
    r1, r2 = ring(A + 1, B + 1, H + 3), ring(A - 14, B - 12, H + 1)
    mesh(r1 + r2, [(i, (i + 1) % N, N + (i + 1) % N, N + i) for i in range(N)], METAL, '#d8dadc')
    for i in range(0, N, 2):
        x, y, _ = r1[i]
        box(0.4, 0.4, H + 3, x, y, 0, METAL, '#c8cacc')
    # Floodlight masts at the corners.
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (A - 6), sy * (B - 6)
            cyl(1.0, 52, x, y, 0, METAL, '#b8bcc0', verts=8, r2=0.6)
            box(9, 1.2, 6, x, y, 52, METAL, '#3a3c40', rz=math.atan2(-y, -x) + math.pi / 2)
            box(8.6, 1.3, 5.6, x - sx * 0.4, y - sy * 0.4, 52.2, EMISSIVE, '#f8fbff', rz=math.atan2(-y, -x) + math.pi / 2)
    return build('stadium')


def carpark_city():
    """A city car park, 40 x 24 m: tarmac, painted bays and a lamp."""
    box(40, 24, 0.12, 0, 0, -0.06, TARMAC, '#6a6a6a')
    for row in (-1, 1):
        for k in range(14):
            box(0.12, 5.0, 0.02, -18.2 + k * 2.8, row * 6.5, 0.06, PAINT, '#e8e8e0')
    for x in (-10, 10):
        cyl(0.12, 9, x, 0, 0, METAL, '#6c7075', verts=8)
        box(1.2, 0.5, 0.3, x, 0, 9, METAL, '#4a4e52')
        box(1.0, 0.4, 0.05, x, 0, 8.97, EMISSIVE, '#fff0d0')
    return build('carpark_city')


# ------------------------------------------------------------ fair

def ferris_legs():
    """The ferris wheel's stand: two A-frames to an axle 26 m up (along Y),
    a ticket booth and a fence. The wheel turns in src/structures.js."""
    for y in (-3.2, 3.2):
        for s in (-1, 1):
            o = cyl(0.45, 28.5, s * 6.5, y, 0, METAL, '#e8e8f0', verts=8, r2=0.3)
            o.rotation_euler = (0, s * -0.235, 0)
        box(13, 0.4, 0.4, 0, y, 9, METAL, '#e8e8f0')
    cyl(0.7, 7.2, 0, -3.6, 26, METAL, '#c8c8d0', verts=10, rx=-math.pi / 2)
    box(16, 9, 0.5, 0, 0, 0, PAVING, '#8a8680')
    box(3, 2.4, 2.6, 7, -5, 0, PLANKS, '#c8302a')
    box(3.2, 2.6, 0.2, 7, -5, 2.6, PAINT, '#f2e8d0')
    box(2.4, 0.06, 0.5, 7, -6.22, 2.0, EMISSIVE, '#ffd23a')
    return build('ferris_legs')


def ferris_wheel():
    """The turning wheel, 22 m radius, axis along Y at the origin: two rims
    with spokes and bulbs. Cabins hang from it (ferris_cab)."""
    R, N = 22, 32
    for y in (-2.6, 2.6):
        for i in range(N):
            a0, a1 = i * math.tau / N, (i + 1) * math.tau / N
            x0, z0, x1, z1 = R * math.cos(a0), R * math.sin(a0), R * math.cos(a1), R * math.sin(a1)
            L = math.hypot(x1 - x0, z1 - z0)
            box(L, 0.35, 0.35, (x0 + x1) / 2, y, (z0 + z1) / 2 - 0.175, METAL, '#e8e8f0', ry=-(a0 + a1) / 2 - math.pi / 2)
            ball(0.18, x0, y - 0.3 * (1 if y < 0 else -1), z0, kind=EMISSIVE, col=NEON[i % 4], segs=5)
        for i in range(16):
            a = i * math.tau / 16
            box(R, 0.15, 0.15, R / 2 * math.cos(a), y, R / 2 * math.sin(a) - 0.075, METAL, '#d0d0d8', ry=-a)
            for t in (0.35, 0.7):
                ball(0.13, R * t * math.cos(a), y - 0.2 * (1 if y < 0 else -1), R * t * math.sin(a), kind=EMISSIVE, col='#fff2c0', segs=5)
    for i in range(16):
        a = (i + 0.5) * math.tau / 16
        box(0.15, 5.4, 0.15, R * math.cos(a), 0, R * math.sin(a), METAL, '#d0d0d8')
    cyl(1.5, 6.0, 0, -3.0, 0, METAL, '#c8c8d0', verts=12, rx=-math.pi / 2)
    return build('ferris_wheel')


def ferris_cab():
    """A cabin hanging from its pin at the origin."""
    cyl(0.06, 1.0, 0, 0, -1.0, METAL, '#3a3a3a', verts=6)
    box(2.0, 2.0, 0.3, 0, 0, -2.9, PAINT, '#e83a5a')
    for x in (-0.95, 0.95):
        for y in (-0.95, 0.95):
            box(0.08, 0.08, 1.4, x, y, -2.6, METAL, '#d8d8d8')
    box(2.1, 2.1, 0.3, 0, 0, -1.2, PAINT, '#e83a5a')
    box(1.9, 1.9, 0.02, 0, 0, -1.22, EMISSIVE, '#fff2c0')
    return build('ferris_cab')


def carousel():
    """A merry-go-round: a lit canopy, horses on poles, all of which turns
    in src/structures.js about its centre."""
    R = 7
    cyl(R, 0.6, 0, 0, 0, PLANKS, '#c8a07a', verts=24)
    cyl(1.0, 5.6, 0, 0, 0.6, PAINT, '#e8d0a0', verts=12)
    o = cyl(R + 0.6, 1.8, 0, 0, 5.4, PAINT, '#c8302a', verts=24, r2=0.6)
    for i in range(24):
        a = i * math.tau / 24
        box(1.6, 0.1, 0.9, (R + 0.65) * math.cos(a), (R + 0.65) * math.sin(a), 4.6, PAINT, '#f2e8d0' if i % 2 else '#c8302a', rz=a + math.pi / 2)
        ball(0.15, (R + 0.75) * math.cos(a), (R + 0.75) * math.sin(a), 5.05, kind=EMISSIVE, col='#ffe8a0', segs=5)
    cyl(0.3, 1.4, 0, 0, 7.2, PAINT, '#d8a83a', verts=8)
    for i in range(12):
        a = i * math.tau / 12
        r = 5.0 if i % 2 else 3.6
        x, y = r * math.cos(a), r * math.sin(a)
        cyl(0.05, 4.8, x, y, 0.6, METAL, '#d8a83a', verts=6)
        h = 1.6 + 0.4 * (i % 3)
        col = ['#f2f2f2', '#2a2a2a', '#c8a07a', '#f2e8d0'][i % 4]
        box(1.5, 0.35, 0.55, x, y, h, PAINT, col, rz=a + math.pi / 2)
        box(0.3, 0.3, 0.7, x + 0.6 * math.cos(a + math.pi / 2), y + 0.6 * math.sin(a + math.pi / 2), h + 0.4, PAINT, col, rz=a + math.pi / 2)
    return build('carousel')


def fair_stall(name, seed):
    """A fairground game booth with a lit sign and bulbs."""
    rng = random.Random(seed)
    c = rng.choice(['#c8302a', '#2a6ad8', '#e8a82a', '#8a2ad8'])
    box(4, 3, 2.6, 0, 0.3, 0, PLANKS, c)
    box(3.6, 0.1, 1.5, 0, -1.22, 0.9, PAINT, '#1a1a1a')
    box(4.4, 0.4, 1.0, 0, -1.3, 2.7, PAINT, '#f2e8d0')
    box(4.0, 0.1, 0.6, 0, -1.52, 2.9, EMISSIVE, rng.choice(NEON))
    for k in range(9):
        ball(0.1, -2 + k * 0.5, -1.55, 3.8, kind=EMISSIVE, col='#ffe8a0', segs=5)
    v = [(-2.2, -1.5, 0), (2.2, -1.5, 0), (2.2, 1.8, 0), (-2.2, 1.8, 0), (0, 0, 1.2)]
    mesh(v, [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)], PAINT, '#f2e8d0', z=3.7)
    return build(name)


# ------------------------------------------------------------ docks

def container_stack(name, seed, rows=3, cols=2, high=3):
    """Shipping containers, 12.2 m long along X, stacked."""
    rng = random.Random(seed)
    cs = ['#c8302a', '#2a6ab0', '#e8a82a', '#3a8a4a', '#8a8a8a', '#e86a2a', '#5a3a8a', '#d8d8d0', '#2a4a5a']
    for r in range(rows):
        for c in range(cols):
            for h in range(high - (1 if rng.random() < 0.3 else 0)):
                x, y, z = c * 12.4 - (cols - 1) * 6.2, r * 2.5 - (rows - 1) * 1.25, h * 2.6
                col = rng.choice(cs)
                box(12.2, 2.44, 2.59, x, y, z, METAL, col)
                for k in range(16):
                    box(0.08, 2.5, 2.4, x - 5.7 + k * 0.76, y, z + 0.1, METAL, col)
    return build(name)


def crane():
    """A ship-to-shore container crane: a portal on legs 18 m apart (along
    Y, rails on the quay) and a boom reaching 50 m out over the water
    (-Y). Red and white."""
    RED, WHITE = '#c8302a', '#e8e8e8'
    for x in (-8, 8):
        for y in (-9, 9):
            box(1.4, 1.4, 44, x, y, 0, METAL, RED)
            box(2.4, 2.4, 1.2, x, y, 0, METAL, '#3a3a3a')
        box(1.2, 18, 1.2, x, 0, 12, METAL, RED)
        box(1.0, 18, 1.0, x, 0, 30, METAL, RED)
        o = box(0.6, 25, 0.6, x, 0, 13, METAL, RED)
        o.rotation_euler = (0.9, 0, 0)
    for y in (-9, 9):
        box(17, 1.2, 1.4, 0, y, 42.8, METAL, RED)
    # The boom, reaching out over the ship, and its backreach.
    box(4, 85, 2.6, 0, -15, 44, METAL, WHITE)
    for k in range(18):
        box(4.2, 0.3, 2.8, 0, -55 + k * 4.8, 43.9, METAL, RED)
    for x in (-6, 6):
        box(1.0, 1.0, 22, x, 2, 44, METAL, WHITE)
    # Stays from the apex out along the boom and back.
    for y1, ln in ((-50, 0), (-22, 0), (20, 0)):
        dy, dz = y1 - 2, 46.6 - 66
        L = math.hypot(dy, dz)
        o = cyl(0.12, L, 0, 2, 66, METAL, '#cccccc', verts=4)
        o.rotation_euler = (math.atan2(-dy, dz), 0, 0)
    box(14, 3, 3, 0, 2, 66, METAL, WHITE)
    box(6, 8, 5, 0, 18, 44, METAL, '#e8e8e8')
    box(3, 3, 2.6, 0, -30, 41, METAL, '#3a3a3a')
    box(2.2, 2.4, 1.4, 0, -30, 39.4, GLASS, '#3a4a54')
    for y in (-57, -30, -2, 24):
        ball(0.4, 0, y, 47, kind=EMISSIVE, col='#ff2a1a', segs=6)
    box(3.0, 0.4, 0.4, 0, -40, 43.4, EMISSIVE, '#fff6e0')
    box(3.0, 0.4, 0.4, 0, -20, 43.4, EMISSIVE, '#fff6e0')
    return build('crane')


def ship():
    """A container ship, 180 m along X, 30 m beam, origin at the waterline:
    a dark hull, containers stacked on deck and the bridge aft."""
    rng = random.Random(11)
    L, Wd = 180, 30
    v = []
    prof = [(-90, 0.8), (-80, 1.0), (60, 1.0), (75, 0.85), (85, 0.55), (90, 0.1)]
    for x, s in prof:
        v += [(x, -Wd / 2 * s, -8), (x, Wd / 2 * s, -8), (x, Wd / 2 * s, 12), (x, -Wd / 2 * s, 12)]
    faces = []
    for i in range(len(prof) - 1):
        a, b = i * 4, (i + 1) * 4
        faces += [(a, b, b + 3, a + 3), (a + 1, a + 2, b + 2, b + 1), (a + 3, b + 3, b + 2, a + 2), (a, a + 1, b + 1, b)]
    n = len(prof) * 4
    faces += [(0, 3, 2, 1), (n - 4, n - 3, n - 2, n - 1)]
    mesh(v, faces, METAL, '#2a3a4a')
    box(170, Wd + 0.2, 1.2, -5, 0, 1.5, PAINT, '#8a2a2a')
    box(168, Wd - 1, 0.3, -5, 0, 12, PAINT, '#6a6a5a')
    cs = ['#c8302a', '#2a6ab0', '#e8a82a', '#3a8a4a', '#8a8a8a', '#e86a2a', '#5a3a8a', '#d8d8d0']
    for bay in range(9):
        x = -55 + bay * 13
        rows = 10 if 0 < bay < 8 else 8
        for r in range(rows):
            hgt = rng.randint(3, 6)
            box(12.2, 2.44, 2.59 * hgt, x, -rows * 1.25 + 1.25 + r * 2.5, 12.3, METAL, rng.choice(cs))
    # The bridge house aft.
    box(16, 26, 22, -78, 0, 12, PAINT, '#e8e8e8')
    box(16.4, 26.4, 2.4, -78, 0, 31, WINDOWS, GLASS_COL)
    box(18, 36, 0.6, -78, 0, 34, PAINT, '#e8e8e8')
    for z in (16, 22, 27):
        box(16.2, 26.2, 0.9, -78, 0, z, WINDOWS, GLASS_COL)
    cyl(2.4, 10, -84, 0, 34, PAINT, '#c8302a', verts=10)
    ball(0.5, -78, 0, 38, kind=EMISSIVE, col='#ffffff', segs=6)
    ball(0.5, 88, 0, 14, kind=EMISSIVE, col='#ffffff', segs=6)
    ball(0.4, -78, -18, 34.5, kind=EMISSIVE, col='#ff2a1a', segs=6)
    ball(0.4, -78, 18, 34.5, kind=EMISSIVE, col='#2aff4a', segs=6)
    return build('ship')


def warehouse():
    """A dockside warehouse, 60 x 30 m, with roller doors and a sign."""
    box(60, 30, 4, 0, 0, -4, MASONRY, '#5a5856')
    box(60, 30, 10, 0, 0, 0, METAL, '#7a8a8a')
    for k in range(80):
        box(0.12, 30.1, 10, -29.6 + k * 0.75, 0, 0, METAL, '#6a7a7a')
    v = [(-30, -15, 0), (30, -15, 0), (30, 15, 0), (-30, 15, 0), (-30, 0, 3), (30, 0, 3)]
    mesh(v, [(0, 1, 5, 4), (2, 3, 4, 5), (1, 2, 5), (3, 0, 4)], METAL, '#5a6a6a', z=10)
    for x in (-20, -6, 8, 22):
        box(6, 0.2, 5.5, x, -15.05, 0, METAL, '#d8a83a')
        box(0.8, 0.3, 0.3, x, -15.3, 6.0, EMISSIVE, '#fff0d0')
    box(20, 0.2, 2, 0, -15.1, 7.2, PAINT, '#1a3a6a')
    box(18, 0.25, 1.4, 0, -15.15, 7.5, EMISSIVE, '#f2f2e8')
    return build('warehouse')


def bollard_quay():
    cyl(0.35, 0.6, 0, 0, 0, METAL, '#2a2a2a', verts=10)
    cyl(0.5, 0.15, 0, 0, 0.6, METAL, '#2a2a2a', verts=10)
    return build('bollard_quay')


def riverboat(name, col):
    """A river cruise boat, 30 m along X, strings of lights."""
    v = [(-15, -3.5, -1), (13, -3.5, -1), (15, 0, -1), (13, 3.5, -1), (-15, 3.5, -1)]
    v += [(x, y * 1.05, 1.5) for x, y, _ in v]
    mesh(v, [(0, 1, 6, 5), (1, 2, 7, 6), (2, 3, 8, 7), (3, 4, 9, 8), (4, 0, 5, 9), (5, 6, 7, 8, 9)], PAINT, col)
    box(22, 6, 2.4, -2, 0, 1.5, PAINT, '#e8e8e8')
    box(21.6, 6.1, 1.4, -2, 0, 2.0, WINDOWS, GLASS_COL)
    box(23, 6.6, 0.25, -2, 0, 3.9, PAINT, '#3a3a3a')
    for k in range(16):
        ball(0.12, -13 + k * 1.5, -3.4, 4.3, kind=EMISSIVE, col='#fff0b0', segs=5)
        ball(0.12, -13 + k * 1.5, 3.4, 4.3, kind=EMISSIVE, col='#fff0b0', segs=5)
    return build(name)


def hydrant():
    cyl(0.16, 0.7, 0, 0, 0, PAINT, '#c8302a', verts=10)
    ball(0.17, 0, 0, 0.7, sz=0.8, kind=PAINT, col='#c8302a', segs=8)
    cyl(0.07, 0.4, -0.2, 0, 0.45, PAINT, '#c8302a', verts=6, ry=math.pi / 2)
    return build('hydrant')


def street_tree():
    """A London plane in a tree pit, its canopy kept clear of buses."""
    rng = random.Random(3)
    box(1.4, 1.4, 0.06, 0, 0, 0, METAL, '#3a3a3a')
    cyl(0.22, 4.6, 0, 0, 0, PAINT, '#8a8270', verts=8, r2=0.16)
    for k in range(5):
        a = k * math.tau / 5 + rng.random()
        o = cyl(0.1, 2.6, 0, 0, 4.0, PAINT, '#8a8270', verts=6, r2=0.05)
        o.rotation_euler = (0.7, 0, a)
    for k in range(9):
        a = rng.random() * math.tau
        r = rng.random() * 2.0
        ball(1.4 + rng.random() * 0.8, math.cos(a) * r, math.sin(a) * r, 6.2 + rng.random() * 1.8, sx=1.1, sy=1.1, sz=0.85,
             kind=LEAVES, col=rng.choice(['#3f5f2a', '#4a6a30', '#56763a']), segs=8)
    return build('street_tree')


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # Street blocks: (name, w, d, floors, seed, wall, neon, escape, blades)
    block('block_a', 18, 18, 4, 1, MASONRY, escape=True)
    block('block_b', 12, 18, 5, 2, PLASTER, col='#c8b89a')
    block('block_c', 24, 18, 6, 3, MASONRY)
    block('block_d', 18, 18, 7, 4, PLASTER, col='#b8b0a4', trim='#e0d8c8')
    block('block_e', 12, 18, 3, 5, MASONRY, escape=True)
    block('block_f', 24, 24, 9, 6, PLASTER, col='#a8a49c', trim='#c8c4bc', tank=False)
    block('neon_a', 18, 18, 4, 11, MASONRY, neon=0.9, blades=1)
    block('neon_b', 12, 18, 5, 12, PLASTER, col='#8a7a6a', neon=1.0, blades=2)
    block('neon_c', 24, 18, 3, 13, MASONRY, neon=0.9, blades=2)
    block('neon_d', 18, 18, 6, 14, PLASTER, col='#6a6a7a', neon=0.8, blades=1, escape=True)
    for k, c in enumerate(PASTEL[:6]):
        victorian(f'victorian_{"abcdef"[k]}', 20 + k, c)
    tower('tower_a', 30, 30, 120, 31, steps=3, top='spire')
    tower('tower_b', 36, 24, 90, 32, glass='#1e2e3a', steps=2, top='band')
    tower('tower_c', 24, 24, 150, 33, glass='#2a3440', fin='#8a9098', steps=3, top='band', crown='#ff7a3a')
    tower('tower_d', 30, 24, 70, 34, glass='#34444e', steps=1, top='flat')
    tower('tower_e', 42, 30, 105, 35, glass='#22323e', steps=2, top='flat')
    screen()
    billboard()
    tram()
    tram('tram_red', body='#a82a2a', cream='#efe6c8')
    tram_stop()
    lantern_gate()
    food_stall('food_stall', 1)
    food_stall('food_stall_b', 2)
    food_stall('food_stall_c', 3)
    for k in range(4):
        market_stall(f'market_stall{"" if k == 0 else "_" + "bcd"[k - 1]}', 40 + k)
    crates()
    stadium()
    carpark_city()
    ferris_legs()
    ferris_wheel()
    ferris_cab()
    carousel()
    fair_stall('fair_stall', 1)
    fair_stall('fair_stall_b', 2)
    container_stack('containers', 1)
    container_stack('containers_b', 2, rows=4, cols=1, high=4)
    container_stack('containers_c', 3, rows=2, cols=3, high=2)
    crane()
    ship()
    warehouse()
    bollard_quay()
    riverboat('riverboat', '#1a2a4a')
    riverboat('riverboat_b', '#4a1a1a')
    hydrant()
    street_tree()
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'props_city.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_materials='NONE', export_normals=True,
                              export_texcoords=True, export_apply=True, export_vertex_color='ACTIVE')
    print('wrote', path)


if __name__ == '__main__':
    main()
