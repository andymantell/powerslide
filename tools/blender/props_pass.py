"""Builds High Alpine Pass's props (the stone hospice, its kennels and St
Bernard dogs, the Hotel Belvedere and its terrace, the pass summit sign and
souvenir huts, numbered hairpin signs, culverts, rockfall nets, ibex and
marmots, the dam's power house, the viewpoint's telescope and panorama
board and a snowplough) and exports them to
src/assets/models/props_pass.glb. Same conventions as props.py, whose
helpers it uses: vertex colour plus a surface kind per face, front facing
Blender -Y (three.js +Z), origin on the ground. The pass also has the alpine
props (chapel, hut, summit cross, snow poles, banners).

  python tools/blender/props_pass.py
"""
import math
import os
import random
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
from props import (EMISSIVE, GLASS, MASONRY, METAL, OUT, PAINT, PLANKS, PLASTER, SHINGLES, ball, box, build, cyl,  # noqa: E402
                   door, finish, gable, mesh, plinth, prism, window)
from props_dartmoor import rock  # noqa: E402

STONE = ['#8e8a82', '#9a958c', '#857f76', '#a29d93', '#7c776f']
SLATE = '#4a4d52'
TIMBER = '#6a4a2e'
DARK_TIMBER = '#4a3420'


def text(s, size, x, y, z, col, kind=PAINT, depth=0.012, align='CENTER', rz=0):
    """Raised lettering on a face looking -Y, centred on (x, z)."""
    bpy.ops.object.text_add()
    o = bpy.context.active_object
    o.data.body = s
    o.data.size = size
    o.data.align_x = align
    o.data.align_y = 'CENTER'
    o.data.extrude = depth
    o.data.resolution_u = 3
    bpy.ops.object.convert(target='MESH')
    o = bpy.context.active_object
    o.rotation_euler = (math.pi / 2, 0, rz)
    o.location = (x, y, z)
    return finish(o, kind, col)


def twosided(verts, faces, kind, col, **kw):
    """A thin card seen from both sides: the faces twice, once each way round."""
    mesh(verts, faces, kind, col, **kw)
    return mesh(verts, [tuple(reversed(f)) for f in faces], kind, col, **kw)


def stone_block(w, d, h, x=0, y=0, z=0, cols=STONE, seed=0, course=0.5):
    """A wall of coursed stone: courses of slightly different greys."""
    rng = random.Random(seed)
    n = max(1, round(h / course))
    for k in range(n):
        box(w, d, h / n, x, y, z + k * h / n, MASONRY, rng.choice(cols))


# ------------------------------------------------------------ buildings

def hospice():
    """The old pass hospice: a tall, plain block of rendered stone, four
    floors of small deep-set windows, a low slate roof against the snow, an
    arched door and a little bell gable on the chapel end. 24 x 13 m."""
    w, d, H = 24, 13, 13.0
    plinth(w + 0.6, d + 0.6, top=0.6, col='#6f6b64')
    box(w, d, H, 0, 0, 0.6, PLASTER, '#d9d4c8')
    # Rough stone quoins at the corners and a granite base course.
    for sx in (-1, 1):
        for sy in (-1, 1):
            for k in range(13):
                long = k % 2
                box(1.0 if long else 0.6, 0.62 if long else 1.0, 0.98, sx * (w / 2 - (0.42 if long else 0.22)), sy * (d / 2 - (0.22 if long else 0.42)), 0.62 + k * 1.0, MASONRY, '#9b958a')
    box(w + 0.12, d + 0.12, 1.2, 0, 0, 0.6, MASONRY, '#857f75')
    top = gable(d, w, 0.36, 0.6 + H, over=0.6, thick=0.22, kind=SHINGLES, col=SLATE, end_over=0.5, rz=math.pi / 2)
    prism(d, w, math.tan(0.36) * d / 2, 0.6 + H, PLASTER, '#d2cdc1', rz=math.pi / 2)
    # Four floors of windows, front and back; three a floor on the ends.
    for fl in range(4):
        z = 2.2 + fl * 3.0
        for i in range(8):
            x = -w / 2 + 1.9 + i * (w - 3.8) / 7
            if fl == 0 and i in (3, 4):
                continue
            for face, y in (('-y', -d / 2), ('+y', d / 2)):
                window(x, y, z, w=0.85, h=1.2, face=face, shutters='#4b5a4a' if fl else None, frame='#c9c3b6', flowers=False)
        for i in range(3):
            yy = -d / 2 + 2.6 + i * (d - 5.2) / 2
            window(w / 2, yy, z, w=0.85, h=1.2, face='+x', shutters=None, frame='#c9c3b6')
            window(-w / 2, yy, z, w=0.85, h=1.2, face='-x', shutters=None, frame='#c9c3b6')
    # Arched stone doorway and steps.
    box(3.2, 0.5, 3.6, 0, -d / 2 - 0.2, 0.6, MASONRY, '#8f897e')
    cyl(1.6, 0.5, 0, -d / 2 - 0.2, 4.2, MASONRY, '#8f897e', verts=16, rx=math.pi / 2)
    box(2.2, 0.1, 2.9, 0, -d / 2 - 0.48, 0.7, PLANKS, '#4a3020')
    cyl(1.1, 0.1, 0, -d / 2 - 0.43, 3.6, PLANKS, '#4a3020', verts=12, rx=math.pi / 2)
    for k in range(3):
        box(4.2 - k * 0.4, 0.5, 0.2, 0, -d / 2 - 0.6 - (2 - k) * 0.45, k * 0.2, MASONRY, '#7d776d')
    box(5.0, 0.12, 0.7, 0, -d / 2 - 0.08, 4.9, PAINT, '#3c3a36')
    text('HOSPICE', 0.5, 0, -d / 2 - 0.16, 5.25, '#e8dcb8')
    # Bell gable over the chapel end, with its bell.
    bx = -w / 2 + 2.2
    box(2.0, 1.0, 3.2, bx, 0, top - 1.0, PLASTER, '#d9d4c8')
    box(0.9, 1.1, 1.3, bx, 0, top + 0.6, PAINT, '#2a2826')
    cyl(0.3, 0.5, bx, 0, top + 0.8, METAL, '#a07a30', verts=10, r2=0.18)
    prism(2.3, 1.3, 0.9, top + 2.2, SHINGLES, SLATE, x=bx, rz=math.pi / 2)
    cyl(0.04, 1.0, bx, 0, top + 3.1, METAL, '#2a2a2a', verts=5)
    box(0.5, 0.05, 0.05, bx, 0, top + 3.75, METAL, '#2a2a2a')
    # Chimneys.
    for x in (5, -5):
        box(0.9, 0.9, 2.4, x, 2.0, top - 1.6, MASONRY, '#8a847a')
    return build('hospice')


def kennel():
    """The dogs' kennels: a low timber shed with three arched doorways, a
    pent roof and a fenced run in front."""
    w, d = 7.0, 2.6
    box(w + 0.2, d + 0.2, 0.3, 0, 0, -0.1, MASONRY, '#7d786f')
    box(w, d, 1.8, 0, 0, 0.2, PLANKS, '#7a5232')
    for i in range(3):
        x = -w / 3 + i * w / 3
        box(0.8, 0.08, 0.9, x, -d / 2 - 0.02, 0.2, PAINT, '#1c1712')
        cyl(0.4, 0.08, x, -d / 2 - 0.02, 1.1, PAINT, '#1c1712', verts=10, rx=math.pi / 2)
    o = box(w + 0.6, d + 0.9, 0.12, 0, 0, 2.0, SHINGLES, '#4a3a2c')
    o.rotation_euler = (-0.18, 0, 0)
    # The run: posts and rails.
    for i in range(6):
        x = -w / 2 + i * w / 5
        cyl(0.05, 1.1, x, -d / 2 - 2.6, 0, PLANKS, '#6a4a2e', verts=5)
    for z in (0.45, 0.95):
        box(w, 0.05, 0.06, 0, -d / 2 - 2.6, z, PLANKS, '#6a4a2e')
    for s in (-1, 1):
        for z in (0.45, 0.95):
            box(0.05, 2.6, 0.06, s * w / 2, -d / 2 - 1.3, z, PLANKS, '#6a4a2e')
    box(0.5, 0.4, 0.15, 2.2, -d / 2 - 0.6, 0, METAL, '#8a8a88')
    return build('kennel')


def stbernard(name, sitting=False):
    """A big St Bernard: white with chestnut patches, a dark mask, about
    0.8 m at the shoulder, facing -Y."""
    body, patch, mask = '#f2ece2', '#9a4e22', '#3a2416'
    if sitting:
        ball(0.32, 0, 0.1, 0.62, sx=0.9, sy=1.1, sz=1.3, col=patch, segs=10, rx=-0.4)
        ball(0.26, 0, -0.08, 0.6, sx=0.9, sy=0.8, sz=1.2, col=body, segs=8)
        for s in (-1, 1):
            cyl(0.07, 0.55, s * 0.14, -0.15, 0, PAINT, body, verts=6)
            ball(0.18, s * 0.2, 0.3, 0.2, sx=0.8, sy=1.4, sz=0.8, col=patch, segs=8)
        hz, hy = 1.08, -0.18
    else:
        ball(0.32, 0, 0, 0.72, sx=0.85, sy=1.75, sz=0.95, col=body, segs=12)
        ball(0.28, 0.02, 0.15, 0.82, sx=0.9, sy=1.2, sz=0.75, col=patch, segs=10)
        for lx in (-0.15, 0.15):
            for ly in (-0.38, 0.4):
                cyl(0.07, 0.6, lx, ly, 0, PAINT, body, verts=6, r2=0.06)
        cyl(0.05, 0.5, 0, 0.55, 0.62, PAINT, patch, verts=6, r2=0.03, rx=-0.9)
        hz, hy = 1.02, -0.62
    ball(0.21, 0, hy, hz, sx=1.0, sy=1.05, sz=0.95, col=patch, segs=10)
    ball(0.13, 0, hy - 0.2, hz - 0.08, sx=1.0, sy=1.1, sz=0.8, col=body, segs=8)
    ball(0.05, 0, hy - 0.32, hz - 0.04, col=mask, segs=6)
    for s in (-1, 1):
        ball(0.09, s * 0.19, hy + 0.02, hz - 0.08, sx=0.5, sy=0.8, sz=1.5, col=mask, segs=6)
        ball(0.04, s * 0.08, hy - 0.17, hz + 0.06, col=mask, segs=5)
    # The little barrel on its collar.
    cyl(0.07, 0.2, -0.1, hy + 0.12, hz - 0.36, PLANKS, '#8a5a2a', verts=8, ry=math.pi / 2)
    box(0.36, 0.06, 0.05, 0, hy + 0.12, hz - 0.22, PAINT, '#b02a20')
    return build(name)


def hotel():
    """The Hotel Belvedere: a grand old hotel of five floors in cream
    render, rows of tall windows with iron balconies, a dark mansard roof
    with dormers, its name in big gold letters along the top, and a glazed
    veranda on the front. 30 x 14 m."""
    w, d, H = 30, 14, 15.5
    plinth(w + 0.5, d + 0.5, top=1.0, col='#7a746a')
    box(w, d, H, 0, 0, 1.0, PLASTER, '#efe2c4')
    for k in range(5):
        box(w + 0.12, d + 0.12, 0.22, 0, 0, 1.0 + 3.1 * k + 2.9, PAINT, '#e2d2ae')
    box(w + 0.5, d + 0.5, 0.45, 0, 0, 1.0 + H, PAINT, '#e8dcbc')
    # Mansard: steep lower slopes, then a low cap.
    z0 = 1.45 + H
    verts = [(-w / 2 - 0.2, -d / 2 - 0.2, 0), (w / 2 + 0.2, -d / 2 - 0.2, 0), (w / 2 + 0.2, d / 2 + 0.2, 0), (-w / 2 - 0.2, d / 2 + 0.2, 0),
             (-w / 2 + 1.4, -d / 2 + 1.4, 3.2), (w / 2 - 1.4, -d / 2 + 1.4, 3.2), (w / 2 - 1.4, d / 2 - 1.4, 3.2), (-w / 2 + 1.4, d / 2 - 1.4, 3.2),
             (-w / 2 + 3.5, 0, 4.4), (w / 2 - 3.5, 0, 4.4)]
    faces = [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 9, 8), (6, 7, 8, 9), (5, 6, 9), (7, 4, 8)]
    mesh(verts, faces, SHINGLES, '#3e4a50', z=z0)
    for i in range(9):
        x = -w / 2 + 3 + i * (w - 6) / 8
        for s in (-1, 1):
            box(1.3, 1.3, 1.5, x, s * (d / 2 - 0.6), z0 + 0.4, PLASTER, '#efe2c4')
            box(0.8, 0.08, 1.0, x, s * (d / 2 + 0.07), z0 + 0.6, GLASS, '#2a3440')
            prism(1.6, 1.5, 0.6, z0 + 1.9, SHINGLES, '#3e4a50', x=x, y=s * (d / 2 - 0.6), rz=math.pi / 2)
    # Windows: tall, with iron balconies on the upper floors of the front.
    for fl in range(5):
        z = 1.6 + fl * 3.1
        for i in range(11):
            x = -w / 2 + 1.8 + i * (w - 3.6) / 10
            if fl == 0 and i in (4, 5, 6):
                continue
            window(x, -d / 2, z, w=1.1, h=1.9 if fl else 2.1, face='-y', shutters='#6a8a6a', frame='#f6efdc')
            window(x, d / 2, z, w=1.1, h=1.9, face='+y', shutters='#6a8a6a', frame='#f6efdc')
            if fl >= 1:
                box(1.6, 0.6, 0.1, x, -d / 2 - 0.3, z - 0.15, PAINT, '#e2d2ae')
                box(1.6, 0.03, 0.9, x, -d / 2 - 0.58, z - 0.05, METAL, '#2a2c2e')
        for i in range(5):
            y = -d / 2 + 1.8 + i * (d - 3.6) / 4
            window(w / 2, y, z, w=1.1, h=1.9, face='+x', shutters='#6a8a6a', frame='#f6efdc')
            window(-w / 2, y, z, w=1.1, h=1.9, face='-x', shutters='#6a8a6a', frame='#f6efdc')
    # The name along the top of the front.
    box(17, 0.15, 1.5, 0, -d / 2 - 0.1, H - 1.2, PAINT, '#7a2a24')
    text('HOTEL BELVEDERE', 1.15, 0, -d / 2 - 0.2, H - 0.45, '#e8c058', kind=METAL)
    # Glazed veranda along the middle of the ground floor.
    vw = 11
    box(vw, 3.4, 0.4, 0, -d / 2 - 1.7, 0.6, MASONRY, '#8a8478')
    for i in range(8):
        x = -vw / 2 + i * vw / 7
        box(0.18, 0.18, 3.0, x, -d / 2 - 3.3, 1.0, PAINT, '#f6efdc')
    box(vw, 0.06, 2.4, 0, -d / 2 - 3.3, 1.3, GLASS, '#3a4a54')
    for s in (-1, 1):
        box(0.06, 3.3, 2.4, s * vw / 2, -d / 2 - 1.65, 1.3, GLASS, '#3a4a54')
    o = box(vw + 0.6, 3.8, 0.15, 0, -d / 2 - 1.8, 4.0, METAL, '#4a5a5e')
    o.rotation_euler = (0.2, 0, 0)
    box(2.4, 0.1, 2.6, 0, -d / 2 - 0.05, 1.0, PLANKS, '#5a3a24')
    for x in (-10, 10, 0):
        box(1.0, 1.0, 3.0, x, 3.0, z0 + 2.4, MASONRY, '#a49a8a')
    return build('hotel')


def terrace():
    """The hotel's terrace out over the drop: a stone platform with a
    balustrade, six tables with chairs under red and white parasols."""
    w, d = 18, 9
    box(w, d, 1.0, 0, 0, -0.6, MASONRY, '#9a9286')
    box(w + 0.1, d + 0.1, 0.12, 0, 0, 0.4, MASONRY, '#b0a898')
    # Balustrade along the front and ends.
    for k in range(int(w / 0.45)):
        x = -w / 2 + 0.2 + k * 0.45
        cyl(0.08, 0.75, x, -d / 2 + 0.2, 0.52, MASONRY, '#d8d0c0', verts=6, r2=0.06)
    box(w, 0.35, 0.14, 0, -d / 2 + 0.2, 1.27, MASONRY, '#d8d0c0')
    for s in (-1, 1):
        for k in range(int(d / 0.45)):
            cyl(0.08, 0.75, s * (w / 2 - 0.2), -d / 2 + 0.2 + k * 0.45, 0.52, MASONRY, '#d8d0c0', verts=6, r2=0.06)
        box(0.35, d, 0.14, s * (w / 2 - 0.2), 0, 1.27, MASONRY, '#d8d0c0')
    for i, (x, y) in enumerate([(-6, -1.5), (0, -1.5), (6, -1.5), (-3, 2.2), (3, 2.2), (-7.5, 2.4)]):
        cyl(0.55, 0.05, x, y, 1.2, PAINT, '#f4f0e6', verts=12)
        cyl(0.05, 0.75, x, y, 0.46, METAL, '#3a3a3a', verts=6)
        for a in range(3):
            t = a / 3 * math.tau + 0.4
            cx, cy = x + math.cos(t) * 0.9, y + math.sin(t) * 0.9
            box(0.42, 0.42, 0.05, cx, cy, 0.9, METAL, '#4a4a48', rz=t)
            box(0.42, 0.04, 0.45, cx + math.cos(t) * 0.2, cy + math.sin(t) * 0.2, 0.95, METAL, '#4a4a48', rz=t + math.pi / 2)
        cyl(0.03, 2.2, x, y, 1.25, METAL, '#e8e4dc', verts=5)
        for k in range(8):
            a0 = k / 8 * math.tau
            col = '#c4262c' if k % 2 else '#f4f0e6'
            verts = [(0, 0, 0.55), (math.cos(a0) * 1.4, math.sin(a0) * 1.4, 0), (math.cos(a0 + math.tau / 8) * 1.4, math.sin(a0 + math.tau / 8) * 1.4, 0)]
            twosided(verts, [(0, 1, 2)], PAINT, col, x=x, y=y, z=3.0)
    return build('terrace')


def powerhouse():
    """The hydro power house below the dam: a tall stone hall with long
    arched windows, a low hipped copper-green roof, the big pipes running
    in at the back and a transformer yard beside it."""
    w, d, H = 20, 11, 9
    plinth(w + 0.5, d + 0.5, top=0.4, col='#6e6a62')
    stone_block(w, d, H, 0, 0, 0.4, seed=4, course=0.6)
    for i in range(5):
        x = -w / 2 + 2.5 + i * (w - 5) / 4
        box(1.6, 0.1, 5.0, x, -d / 2 - 0.03, 2.0, GLASS, '#2a3640')
        cyl(0.8, 0.1, x, -d / 2 - 0.03, 7.0, GLASS, '#2a3640', verts=12, rx=math.pi / 2)
        box(2.0, 0.16, 0.25, x, -d / 2 - 0.05, 1.8, MASONRY, '#b4ad9f')
    for s in (-1, 1):
        for i in range(2):
            y = -d / 4 + i * d / 2
            box(0.1, 1.4, 4.5, s * (w / 2 + 0.03), y, 2.4, GLASS, '#2a3640')
    verts = [(-w / 2 - 0.4, -d / 2 - 0.4, 0), (w / 2 + 0.4, -d / 2 - 0.4, 0), (w / 2 + 0.4, d / 2 + 0.4, 0), (-w / 2 - 0.4, d / 2 + 0.4, 0),
             (-w / 2 + 3, 0, 2.6), (w / 2 - 3, 0, 2.6)]
    mesh(verts, [(0, 1, 5, 4), (2, 3, 4, 5), (1, 2, 5), (3, 0, 4)], SHINGLES, '#5e8a78', z=0.4 + H)
    box(3.4, 0.12, 0.7, 0, -d / 2 - 0.08, H - 1.0, PAINT, '#3a3a38')
    text('1928', 0.55, 0, -d / 2 - 0.16, H - 0.65, '#e8dcb8')
    # Penstocks coming in at the back, out of the slope.
    for x in (-4, 4):
        for k in range(2):
            cyl(0.7, 4.2, x, d / 2 + 2.0 + k * 3.6, 1.0 + k * 2.3, METAL, '#4a4e4a', verts=12, rx=-math.radians(57))
            box(1.8, 0.6, 1.2 + k * 2.3, x, d / 2 + 2.0 + k * 3.6, 0, MASONRY, '#8a857a')
    # Transformer yard.
    tx = w / 2 + 5
    box(8, 8, 0.15, tx, 0, 0, PAINT, '#8a8578')
    for y in (-2, 2):
        box(1.8, 1.4, 2.2, tx, y, 0.15, METAL, '#6a7068')
        for k in range(3):
            cyl(0.1, 1.0, tx - 0.5 + k * 0.5, y, 2.35, PAINT, '#c8c2b4', verts=6)
    for s in (-1, 1):
        cyl(0.12, 7, tx + s * 3.5, 3.5, 0, METAL, '#6a6e70', verts=6)
        cyl(0.12, 7, tx + s * 3.5, -3.5, 0, METAL, '#6a6e70', verts=6)
    box(7.2, 0.15, 0.2, tx, 3.5, 6.8, METAL, '#6a6e70')
    box(7.2, 0.15, 0.2, tx, -3.5, 6.8, METAL, '#6a6e70')
    return build('powerhouse')


def souvenir(name, seed, roof='#a8322a'):
    """A souvenir hut at the top of the pass: a little timber stall with its
    front flap propped open, racks of postcards, cowbells hanging under the
    eaves, flags and a striped awning."""
    rng = random.Random(seed)
    w, d = 4.0, 3.0
    box(w + 0.2, d + 0.2, 0.25, 0, 0, -0.05, MASONRY, '#7a756c')
    box(w, d, 2.5, 0, 0.2, 0.2, PLANKS, '#8a6038')
    box(w - 0.4, 0.1, 1.2, 0, -d / 2 + 0.15, 1.0, PAINT, '#2a1e14')
    box(w - 0.2, 0.7, 0.08, 0, -d / 2 - 0.15, 0.95, PLANKS, '#6a4628')
    o = box(w - 0.2, 0.06, 1.2, 0, -d / 2 - 0.4, 2.15, PLANKS, '#7a5230')
    o.rotation_euler = (-1.1, 0, 0)
    top = gable(d, w, 0.55, 2.7, over=0.35, thick=0.1, kind=SHINGLES, col=roof, end_over=0.3)
    prism(w, d, top - 2.7, 2.7, PLANKS, '#8a6038', y=0.2)
    # Postcard racks either side of the hatch.
    for s in (-1, 1):
        box(0.6, 0.3, 1.5, s * (w / 2 + 0.35), -d / 2 + 0.3, 0.2, METAL, '#6a6a6a')
        for k in range(4):
            for j in range(2):
                box(0.24, 0.04, 0.17, s * (w / 2 + 0.35) - 0.14 + j * 0.28, -d / 2 + 0.13, 0.55 + k * 0.28, PAINT,
                    rng.choice(['#3a7ac8', '#e8e0c8', '#4a9a5a', '#d84a3a', '#f0c040', '#ffffff']))
    # Cowbells and little flags along the eave.
    for k in range(5):
        x = -w / 2 + 0.6 + k * (w - 1.2) / 4
        cyl(0.012, 0.3, x, -d / 2 - 0.2, 2.25, PAINT, '#c43a2a', verts=4)
        cyl(0.11, 0.2, x, -d / 2 - 0.2, 2.05, METAL, '#c8a040', verts=8, r2=0.07)
    for k, c in enumerate(['#d42b2b', '#ffffff', '#2a5ac8', '#f0c040', '#3a9a4a', '#d42b2b']):
        box(0.35, 0.02, 0.25, -w / 2 + 0.4 + k * 0.62, -d / 2 - 0.2, 2.42, PAINT, c)
    return build(name)


# ------------------------------------------------------------ signs

def pass_sign():
    """The sign at the top of the pass: a big dark board on a stone plinth,
    HIGH PASS and the height in white, an edelweiss in the corner."""
    stone_block(4.4, 1.0, 1.2, 0, 0, -0.3, seed=7, course=0.4)
    for s in (-1, 1):
        box(0.18, 0.18, 2.6, s * 1.9, 0, 0.9, METAL, '#3a3a3a')
    box(4.6, 0.12, 1.9, 0, 0, 1.6, PAINT, '#5a3a24')
    box(4.4, 0.13, 1.7, 0, 0, 1.7, PAINT, '#6e4a30')
    text('HIGH PASS', 0.62, 0, -0.08, 2.9, '#f6f2e8')
    text('2478 m', 0.5, 0, -0.08, 2.1, '#f6f2e8')
    for k in range(6):
        a = k / 6 * math.tau
        ball(0.09, -1.75 + math.cos(a) * 0.1, -0.09, 3.05 + math.sin(a) * 0.1, sx=1, sy=0.3, sz=1, col='#f6f2e8', segs=5)
    ball(0.05, -1.75, -0.1, 3.05, sy=0.3, col='#e8c040', segs=5)
    return build('pass_sign')


def hairpin_sign(n):
    """A numbered hairpin sign, the way the big passes count their
    switchbacks: a white plate with a red rim, the bend's number and a
    hairpin arrow, on a grey post."""
    cyl(0.04, 1.6, 0, 0.03, 0, METAL, '#8a8c8e', verts=6)
    box(0.62, 0.05, 0.78, 0, 0, 1.25, PAINT, '#c4161c')
    box(0.54, 0.06, 0.7, 0, 0, 1.29, PAINT, '#f6f4ee')
    text(str(n), 0.36 if n < 10 else 0.3, 0, -0.035, 1.78, '#1d1b19')
    # The hairpin arrow: two legs and a curve, in a little dark band.
    box(0.05, 0.065, 0.2, -0.08, 0, 1.36, PAINT, '#1d1b19')
    box(0.05, 0.065, 0.14, 0.08, 0, 1.36, PAINT, '#1d1b19')
    for k in range(7):
        a = math.pi * k / 6
        box(0.05, 0.065, 0.05, math.cos(a) * 0.08, 0, 1.56 + math.sin(a) * 0.05, PAINT, '#1d1b19')
    verts = [(0.03, 0, 0), (0.13, 0, 0), (0.08, 0, -0.08)]
    twosided(verts, [(0, 1, 2)], PAINT, '#1d1b19', y=-0.036, z=1.36)
    return build(f'sign_hp_{n}')


def sign_rockfall():
    """A red-rimmed triangle warning of falling rocks."""
    cyl(0.04, 2.0, 0, 0.03, 0, METAL, '#8a8c8e', verts=6)
    verts = [(-0.45, 0, 0), (0.45, 0, 0), (0, 0, 0.78)]
    twosided(verts, [(0, 1, 2)], PAINT, '#c4161c', y=0, z=1.45)
    verts = [(-0.34, 0, 0), (0.34, 0, 0), (0, 0, 0.59)]
    twosided(verts, [(0, 1, 2)], PAINT, '#f6f4ee', y=-0.012, z=1.52)
    for x, z, r in ((-0.05, 1.6, 0.05), (0.06, 1.66, 0.04), (0.0, 1.75, 0.035), (-0.12, 1.58, 0.03)):
        ball(r, x, -0.02, z, sy=0.3, col='#1d1b19', segs=5)
    box(0.04, 0.02, 0.32, 0.12, -0.02, 1.56, PAINT, '#1d1b19', ry=-0.6)
    return build('sign_rockfall')


def telescope():
    """A coin-operated viewer on a post, looking out over the view (-Y)."""
    cyl(0.25, 0.15, 0, 0, 0, MASONRY, '#7a766e', verts=10)
    cyl(0.07, 1.15, 0, 0, 0.15, METAL, '#3a5a8a', verts=8)
    box(0.34, 0.5, 0.32, 0, 0, 1.25, METAL, '#3a5a8a')
    for s in (-1, 1):
        cyl(0.07, 0.22, s * 0.08, -0.28, 1.41, METAL, '#2a3a5a', verts=8, rx=math.pi / 2)
        cyl(0.06, 0.08, s * 0.08, 0.33, 1.41, METAL, '#1a1a1a', verts=8, rx=math.pi / 2)
    return build('telescope')


def panorama():
    """A panorama board naming the peaks, slanted on two posts: a strip of
    painted mountains on cream."""
    for s in (-1, 1):
        cyl(0.05, 1.0, s * 0.9, 0, 0, METAL, '#4a4a48', verts=6)
    o = box(2.2, 0.06, 0.8, 0, 0, 0.9, PAINT, '#ece4d0')
    o.rotation_euler = (-0.7, 0, 0)
    rng = random.Random(3)
    xs = [-1.0 + k * 0.1 for k in range(21)]
    hs = [0.15 + 0.2 * abs(math.sin(k * 0.9 + 1)) * rng.uniform(0.5, 1.2) for k in range(21)]
    verts, faces = [], []
    for x, h in zip(xs, hs):
        verts += [(x, 0, 0), (x, 0, h)]
    for k in range(20):
        a = k * 2
        faces.append((a, a + 2, a + 3, a + 1))
    o = mesh(verts, faces, PAINT, '#6a8aa8')
    o.location = (0, -0.06, 1.1)
    o.rotation_euler = (-0.7, 0, 0)
    o.location = (0, -0.25 * math.sin(0.7) - 0.05, 0.9 + 0.2 * math.cos(0.7) - 0.15)
    return build('panorama')


# ------------------------------------------------------------ roadside

def culvert():
    """A culvert where a meltwater stream runs under the road: a concrete
    headwall with a round pipe mouth (front, -Y), wing walls and a splash
    of stones below."""
    box(3.6, 0.5, 2.0, 0, 0, -0.6, MASONRY, '#a8a49a')
    box(3.8, 0.6, 0.2, 0, 0, 1.4, MASONRY, '#b4b0a6')
    for s in (-1, 1):
        o = box(0.4, 1.8, 1.4, s * 1.7, -0.9, -0.6, MASONRY, '#a8a49a')
        o.rotation_euler = (0, 0, s * 0.35)
    cyl(0.62, 0.3, 0, -0.18, 0.25, MASONRY, '#8a867c', verts=16, rx=math.pi / 2)
    cyl(0.5, 0.32, 0, -0.18, 0.25, PAINT, '#141618', verts=16, rx=math.pi / 2)
    for k in range(6):
        rock(0.35, 0.3, 0.2, -0.9 + k * 0.36, -1.3 - (k % 2) * 0.4, -0.5, '#7a776f', seed=40 + k, rough=0.25, detail=0)
    return build('culvert')


def rocknet():
    """One bay of a rockfall barrier, 8 m long (X): two steel posts leaning
    up the slope, a ring net slung between them and the top cable."""
    L, H = 8.0, 3.6
    for s in (-1, 1):
        cyl(0.09, H + 0.3, s * L / 2, 0, 0, METAL, '#5a5e60', verts=8, rx=-0.18)
        cyl(0.03, 3.0, s * L / 2, 0.2, 0, METAL, '#6a6e70', verts=4, rx=0.75)
        box(0.5, 0.5, 0.3, s * L / 2, 0, -0.1, MASONRY, '#8a867c')
    lean = math.tan(0.18)
    # The net: a grid of thin cables between the posts.
    n = 12
    for i in range(n + 1):
        x = -L / 2 + i * L / n
        box(0.025, 0.025, H - 0.3, x, 0.18 * (H - 0.3) / 2 * 0 + lean * 0.15, 0.15, METAL, '#4a4e50', rx=-0.18)
    for k in range(7):
        z = 0.15 + k * (H - 0.3) / 6
        box(L, 0.025, 0.025, 0, lean * z, z, METAL, '#4a4e50')
    box(L + 0.2, 0.04, 0.04, 0, lean * H, H, METAL, '#3a3e40')
    return build('rocknet')


def snowplough():
    """A big orange snowplough lorry parked up for the summer, its V blade
    on the front (-Y) and a gritter on the back."""
    box(2.5, 8.0, 0.5, 0, 0, 0.6, METAL, '#2a2a2a')
    for y in (-2.4, 1.4, 2.9):
        for s in (-1, 1):
            cyl(0.55, 0.45, s * 1.2, y, 0.55, PAINT, '#1a1a1a', verts=14, ry=math.pi / 2)
            cyl(0.3, 0.47, s * 1.2, y, 0.55, METAL, '#e8a020', verts=10, ry=math.pi / 2)
    box(2.5, 2.4, 2.2, 0, -2.6, 1.1, PAINT, '#f08a1c')
    box(2.3, 0.08, 1.0, 0, -3.82, 2.1, GLASS, '#26343c')
    for s in (-1, 1):
        box(0.08, 1.4, 0.8, s * 1.26, -2.8, 2.2, GLASS, '#26343c')
    box(1.6, 0.4, 0.2, 0, -2.4, 3.3, EMISSIVE, '#ffa020')
    box(2.4, 5.0, 2.0, 0, 1.3, 1.1, PAINT, '#f08a1c')
    box(2.2, 4.6, 0.3, 0, 1.3, 3.1, METAL, '#c86a14')
    for k in range(5):
        box(2.42, 0.05, 1.6, 0, -0.8 + k * 1.0, 1.3, PAINT, '#d0761a')
    # The V blade.
    for s in (-1, 1):
        verts = [(0, 0, 0), (s * 1.7, 0.9, 0), (s * 1.7, 0.9, 1.3), (0, 0, 1.5)]
        twosided(verts, [(0, 1, 2, 3)], METAL, '#f0b020', y=-5.0, z=0.15)
    box(0.3, 1.2, 0.3, 0, -4.3, 0.6, METAL, '#2a2a2a')
    for s in (-1, 1):
        box(0.4, 0.06, 0.4, s * 1.5, -4.1, 0.25, PAINT, '#c41616')
    return build('snowplough')


# ------------------------------------------------------------ animals

def _horn(base, s, length, r0, curl, segs=9, col='#5a4a38', ridges=True):
    """A horn sweeping up and back in a curve from `base` (x, y, z), on side
    s: a chain of tapering segments, with ridges across the front."""
    x, y, z = base
    a = 1.25
    step = length / segs
    for k in range(segs):
        r = r0 * (1 - 0.75 * k / segs)
        dy, dz = math.cos(a) * step, math.sin(a) * step
        rx = math.atan2(math.hypot(0, dy), dz)
        cyl(r, step * 1.15, x, y, z, PAINT, col, verts=6, r2=r * 0.9, rx=-(math.pi / 2 - a), ry=s * 0.12)
        if ridges and k < segs - 2:
            cyl(r * 1.15, step * 0.18, x, y, z, PAINT, '#4a3c2c', verts=6, rx=-(math.pi / 2 - a), ry=s * 0.12)
        x += s * step * 0.12
        y += dy
        z += dz
        a -= curl / segs


def ibex(name, male=True):
    """An Alpine ibex standing on the crags, facing -Y: stocky, grey-brown
    with a darker belly line, and (the billy) great ridged horns sweeping
    back over its shoulders."""
    coat, dark = ('#7a6a56', '#4a3e30') if male else ('#9a8668', '#6a5a46')
    sc = 1.0 if male else 0.85
    ball(0.33 * sc, 0, 0, 0.82 * sc, sx=0.8, sy=1.6, sz=0.9, col=coat, segs=12)
    ball(0.26 * sc, 0, 0.05, 0.66 * sc, sx=0.7, sy=1.5, sz=0.4, col=dark, segs=8)
    for lx in (-0.13, 0.13):
        for ly in (-0.36, 0.38):
            cyl(0.05 * sc, 0.62 * sc, lx * sc, ly * sc, 0, PAINT, coat, verts=5, r2=0.035 * sc)
            cyl(0.04 * sc, 0.08, lx * sc, ly * sc, 0, PAINT, '#2a2420', verts=5)
    cyl(0.14 * sc, 0.45 * sc, 0, -0.42 * sc, 0.92 * sc, PAINT, coat, verts=8, r2=0.1 * sc, rx=0.5)
    hy, hz = -0.66 * sc, 1.28 * sc
    ball(0.12 * sc, 0, hy, hz, sx=0.75, sy=1.5, sz=0.85, col=coat, segs=8, rx=0.9)
    ball(0.05 * sc, 0, hy - 0.12 * sc, hz - 0.2 * sc, sx=0.8, sy=0.8, sz=1.6, col=dark, segs=5)
    for s in (-1, 1):
        ball(0.05 * sc, s * 0.09 * sc, hy + 0.06, hz + 0.03, sx=1.5, sy=0.4, sz=0.6, col=coat, segs=5)
        if male:
            _horn((s * 0.05, hy + 0.05, hz + 0.07), s, 0.95, 0.045, 1.9)
        else:
            _horn((s * 0.04, hy + 0.04, hz + 0.06), s, 0.25, 0.022, 0.8, segs=4, ridges=False)
    cyl(0.03, 0.12, 0, 0.6 * sc, 0.9 * sc, PAINT, dark, verts=4, rx=-0.6)
    return build(name)


def marmot():
    """A marmot sat up on its haunches by its burrow, looking about."""
    ball(0.13, 0, 0, 0.2, sx=1.0, sy=0.9, sz=1.5, col='#8a6a46', segs=8)
    ball(0.08, 0, -0.04, 0.44, sx=1.0, sy=1.0, sz=0.9, col='#7a5a3a', segs=8)
    ball(0.035, 0, -0.11, 0.42, col='#d8c8a8', segs=5)
    for s in (-1, 1):
        ball(0.03, s * 0.07, -0.08, 0.3, sx=0.6, sy=0.6, sz=1.4, col='#6a4a30', segs=4)
    ball(0.25, 0, 0.3, 0.02, sx=1.0, sy=1.0, sz=0.25, col='#7a6a58', segs=8)
    return build('marmot')


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    hospice()
    kennel()
    stbernard('stbernard')
    stbernard('stbernard_sit', sitting=True)
    hotel()
    terrace()
    powerhouse()
    souvenir('souvenir_a', 1)
    souvenir('souvenir_b', 2, roof='#3a5a3a')
    pass_sign()
    for n in range(1, 13):
        hairpin_sign(n)
    sign_rockfall()
    telescope()
    panorama()
    culvert()
    rocknet()
    snowplough()
    ibex('ibex')
    ibex('ibex_b', male=False)
    marmot()
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'props_pass.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_materials='NONE', export_normals=True,
                              export_texcoords=True, export_apply=True, export_vertex_color='ACTIVE')
    print('wrote', path)


if __name__ == '__main__':
    main()
