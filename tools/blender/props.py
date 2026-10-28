"""Builds the trackside props (buildings, animals, fences, signs and so on) in
Blender and exports them to src/assets/models/props.glb, one mesh per prop,
named by its type in src/props.js.

Props are low-poly and untextured in Blender. Each face carries:
  - a colour (vertex colour COLOR_0), the paint, wood or stone colour, and
  - a surface kind in UV u (kind + 0.5) / 8, which picks the detail channel
    and shading in src/propmat.js: 0 paint, 1 planks, 2 shingles, 3 masonry,
    4 plaster, 5 glass, 6 metal, 7 emissive.
Blender is Z-up; the exporter turns it Y-up, so a prop's front (Blender -Y)
faces three.js +Z. Origins sit on the ground at the footprint's centre.
Buildings stand on a stone plinth that runs 3 m below the origin, so they
can sit on a slope.

  python tools/blender/props.py
"""
import math
import os

import bpy

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'src', 'assets', 'models')

PAINT, PLANKS, SHINGLES, MASONRY, PLASTER, GLASS, METAL, EMISSIVE = range(8)


def hexrgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    # sRGB to linear: COLOR_0 is linear in glTF.
    return [((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c] + [1.0]


PARTS = []


def finish(o, kind, col, smooth=False):
    me = o.data
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    rgba = hexrgb(col)
    for d in attr.data:
        d.color = rgba
    # Primitives come with their own unwrap; replace it with the kind.
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    uv = me.uv_layers.new(name='UVMap')
    for d in uv.data:
        d.uv = ((kind + 0.5) / 8, 0.5)
    for p in me.polygons:
        p.use_smooth = smooth
    PARTS.append(o)
    return o


def place(o, x, y, z, rx=0, ry=0, rz=0):
    o.location = (x, y, z)
    o.rotation_euler = (rx, ry, rz)
    return o


def box(sx, sy, sz, x=0, y=0, z=0, kind=PAINT, col='#ffffff', rx=0, ry=0, rz=0):
    """Box with its base at height z."""
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.active_object
    o.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    for v in o.data.vertices:
        v.co.z += sz / 2
    place(o, x, y, z, rx, ry, rz)
    return finish(o, kind, col)


def cyl(r, h, x=0, y=0, z=0, kind=PAINT, col='#ffffff', verts=12, rx=0, ry=0, rz=0, r2=None, smooth=True):
    """Cylinder (or cone/frustum with r2) along local Z, base at z."""
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=h)
    o = bpy.context.active_object
    for v in o.data.vertices:
        v.co.z += h / 2
    place(o, x, y, z, rx, ry, rz)
    finish(o, kind, col, smooth)
    # Keep the caps flat-shaded.
    return o


def ball(r, x=0, y=0, z=0, sx=1, sy=1, sz=1, kind=PAINT, col='#ffffff', segs=12, rx=0, ry=0, rz=0):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=max(4, segs // 2), radius=r)
    o = bpy.context.active_object
    o.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    place(o, x, y, z, rx, ry, rz)
    return finish(o, kind, col, True)


def mesh(verts, faces, kind, col, x=0, y=0, z=0, rz=0):
    me = bpy.data.meshes.new('m')
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new('m', me)
    bpy.context.scene.collection.objects.link(o)
    place(o, x, y, z, 0, 0, rz)
    return finish(o, kind, col)


def prism(w, d, h, z=0, kind=PLASTER, col='#ffffff', x=0, y=0, rz=0):
    """Gable infill: a triangular prism, ridge along Y at height z + h."""
    a, b = w / 2, d / 2
    verts = [(-a, -b, 0), (a, -b, 0), (0, -b, h), (-a, b, 0), (a, b, 0), (0, b, h)]
    faces = [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)]
    return mesh(verts, faces, kind, col, x, y, z, rz)


def gable(w, d, pitch, z, over=0.6, thick=0.18, kind=SHINGLES, col='#5a4a3e', x=0, y=0, rz=0, end_over=None):
    """Two roof slabs over a w x d footprint, ridge along Y, eaves `over`
    past the walls, gables `end_over` past the ends. Returns the ridge height."""
    eo = over if end_over is None else end_over
    run = w / 2 + over
    rise = math.tan(pitch) * (w / 2)
    length = run / math.cos(pitch) + thick * math.tan(pitch)
    for s in (-1, 1):
        o = box(length, d + 2 * eo, thick, 0, 0, 0, kind, col)
        for v in o.data.vertices:
            v.co.z -= thick / 2
        o.rotation_euler = (0, s * pitch, 0)
        o.location = (s * run / 2, 0, z + rise - math.tan(pitch) * run / 2 + thick / 2 / math.cos(pitch))
        if rz:
            _rotz(o, rz, x, y)
        else:
            o.location.x += x
            o.location.y += y
    return z + rise


def _rotz(o, rz, x, y):
    c, s = math.cos(rz), math.sin(rz)
    lx, ly = o.location.x, o.location.y
    o.location.x = x + lx * c - ly * s
    o.location.y = y + lx * s + ly * c
    o.rotation_euler.z += rz


def build(name):
    """Joins the parts made since the last build into one object."""
    global PARTS
    bpy.ops.object.select_all(action='DESELECT')
    for o in PARTS:
        o.select_set(True)
    bpy.context.view_layer.objects.active = PARTS[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(PARTS) > 1:
        bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    o.data.name = name
    PARTS = []
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    print(f'{name}: {tris} tris')
    return o


# ---------------------------------------------------------------- pieces

def plinth(w, d, top=0.5, col='#8d877c'):
    """Stone foundation from 3 m below ground to `top` above it."""
    box(w, d, 3 + top, 0, 0, -3, MASONRY, col)


def window(x, y, z, w=0.9, h=1.1, face='-y', shutters='#2f5d3a', frame='#f3efe6', box_col='#c0392b', flowers=False):
    """A window on a wall face: dark glass, a frame, optional shutters and a flower box."""
    out = {'-y': (0, -1), '+y': (0, 1), '-x': (-1, 0), '+x': (1, 0)}[face]
    along = (1, 0) if face in ('-y', '+y') else (0, 1)
    rz = 0 if face in ('-y', '+y') else math.pi / 2

    def at(u, n, zz, sx, sy, sz, kind, col):
        px = x + along[0] * u + out[0] * n
        py = y + along[1] * u + out[1] * n
        box(sx, sy, sz, px, py, zz, kind, col, rz=rz)

    at(0, 0.02, z - 0.08, w + 0.16, 0.08, h + 0.16, PAINT, frame)
    at(0, 0.05, z, w, 0.06, h, GLASS, '#1d2830')
    at(0, 0.07, z + h / 2 - 0.03, w, 0.04, 0.06, PAINT, frame)
    if shutters:
        for s in (-1, 1):
            at(s * (w / 2 + 0.3), 0.04, z - 0.05, 0.5, 0.06, h + 0.1, PLANKS, shutters)
    if flowers:
        at(0, 0.2, z - 0.32, w + 0.2, 0.3, 0.25, PLANKS, '#6b4a2f')
        for k in range(5):
            u = (k - 2) / 2 * (w / 2)
            px = x + along[0] * u + out[0] * 0.22
            py = y + along[1] * u + out[1] * 0.22
            ball(0.13, px, py, z - 0.02, sx=1.3, sz=0.8, kind=PAINT, col=['#d62c3a', '#e8417a', '#d62c3a', '#f2f2f2', '#e8417a'][k], segs=6)


def door(x, y, z, w=1.0, h=2.1, face='-y', col='#5b3a22', frame='#f3efe6'):
    out = {'-y': (0, -1), '+y': (0, 1), '-x': (-1, 0), '+x': (1, 0)}[face]
    rz = 0 if face in ('-y', '+y') else math.pi / 2
    box(w + 0.2, 0.08, h + 0.1, x + out[0] * 0.02, y + out[1] * 0.02, z, PAINT, frame, rz=rz)
    box(w, 0.08, h, x + out[0] * 0.05, y + out[1] * 0.05, z, PLANKS, col, rz=rz)


def railing(x0, y0, x1, y1, z, h=1.0, col='#6b4a2f', posts=6):
    """Balcony railing of vertical boards between two points."""
    L = math.hypot(x1 - x0, y1 - y0)
    rz = math.atan2(y1 - y0, x1 - x0)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    box(L, 0.1, 0.1, cx, cy, z + h - 0.1, PLANKS, col, rz=rz)
    box(L, 0.1, 0.12, cx, cy, z, PLANKS, col, rz=rz)
    n = max(2, int(L / 0.16))
    for k in range(n):
        t = (k + 0.5) / n
        box(0.11, 0.04, h - 0.12, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z + 0.06, PLANKS, col, rz=rz)


# ---------------------------------------------------------------- alpine

def chalet(name, w=9, d=8, floors=2, wood='#7a4f2e', base='#efe9dc', roof='#4e4038', shutters='#2f5d3a', seed=0):
    """Swiss chalet: rendered stone ground floor, timber upper floor, wide
    shallow roof, a balcony on the front with flower boxes."""
    plinth(w + 0.3, d + 0.3)
    z = 0.5
    box(w, d, 2.7, 0, 0, z, PLASTER, base)
    z1 = z + 2.7
    top = z1 + 2.6 * (floors - 1)
    box(w + 0.1, d + 0.1, top - z1, 0, 0, z1, PLANKS, wood)
    # Gable end (front, -Y) is timber; the ridge runs front to back.
    ridge_h = math.tan(0.42) * (w / 2)
    prism(w + 0.1, d + 0.1, ridge_h, top, PLANKS, wood, rz=0)
    # The prism ridge runs along Y; turn the roof so the gable faces the front.
    gable(w, d, 0.42, top, over=1.2, thick=0.22, col=roof, end_over=1.4)
    # Ground-floor windows and door.
    for wx in (-w * 0.3, w * 0.3):
        window(wx, -d / 2, z + 0.9, flowers=False, shutters=shutters)
    door(0, -d / 2, z, face='-y')
    for wy in (-d * 0.25, d * 0.25):
        window(-w / 2, wy, z + 0.9, face='-x', shutters=shutters)
        window(w / 2, wy, z + 0.9, face='+x', shutters=shutters)
    # Upper floors: windows with flower boxes, and a balcony on the front.
    for f in range(floors - 1):
        zf = z1 + 2.6 * f + 0.8
        for wx in (-w * 0.3, 0, w * 0.3):
            window(wx, -d / 2, zf, flowers=True, shutters=shutters)
        for wy in (-d * 0.25, d * 0.25):
            window(-w / 2, wy, zf, face='-x', flowers=True, shutters=shutters)
            window(w / 2, wy, zf, face='+x', flowers=True, shutters=shutters)
    bz = z1 + 0.05
    box(w + 0.6, 1.3, 0.16, 0, -d / 2 - 0.6, bz, PLANKS, wood)
    railing(-w / 2 - 0.25, -d / 2 - 1.2, w / 2 + 0.25, -d / 2 - 1.2, bz + 0.16, col=wood)
    railing(-w / 2 - 0.25, -d / 2 - 1.2, -w / 2 - 0.25, -d / 2, bz + 0.16, col=wood)
    railing(w / 2 + 0.25, -d / 2 - 1.2, w / 2 + 0.25, -d / 2, bz + 0.16, col=wood)
    for k in range(6):
        box(0.5, 0.25, 0.22, -w / 2 + 0.5 + k * (w - 1) / 5, -d / 2 - 1.32, bz + 0.95, PLANKS, '#6b4a2f')
        ball(0.18, -w / 2 + 0.5 + k * (w - 1) / 5, -d / 2 - 1.32, bz + 1.2, sx=1.6, sz=0.7, col=['#d62c3a', '#e8417a'][k % 2], segs=6)
    # Brackets under the balcony.
    for bx in (-w / 2 + 0.4, 0, w / 2 - 0.4):
        box(0.15, 1.2, 0.15, bx, -d / 2 - 0.55, bz - 0.4, PLANKS, wood, rx=-0.5)
    # Chimney.
    box(0.7, 0.7, 2.2, w * 0.22, d * 0.2, top + ridge_h * 0.4, MASONRY, '#9a948a')
    return build(name)


def church():
    """Village church: white nave, steep roof, tower with an onion dome."""
    w, d = 9, 18
    plinth(w + 0.4, d + 0.4)
    plinth(5.2, 5.2) if False else None
    z = 0.5
    box(w, d, 7.5, 0, 0.0, z, PLASTER, '#f2eee4')
    gable(w, d, 0.85, z + 7.5, over=0.5, thick=0.25, col='#6e3b2c', end_over=0.4)
    prism(w, d, math.tan(0.85) * w / 2, z + 7.5, PLASTER, '#f2eee4')
    # Apse at the back.
    cyl(w / 2 - 0.2, 6.5, 0, d / 2, z, PLASTER, '#f2eee4', verts=16)
    cyl(w / 2, 2.8, 0, d / 2, z + 6.5, SHINGLES, '#6e3b2c', verts=16, r2=0.3)
    # Tall arched windows along the nave.
    for k in range(4):
        y = -d / 2 + 3 + k * 4
        for s, f in ((-1, '-x'), (1, '+x')):
            window(s * w / 2, y, z + 3, w=1.0, h=2.6, face=f, shutters=None)
    # Tower at the front.
    tw = 4.6
    box(tw + 0.4, tw + 0.4, 3.5, 0, -d / 2 - tw / 2 + 0.5, -3, MASONRY, '#8d877c')
    box(tw, tw, 18, 0, -d / 2 - tw / 2 + 0.5, z, PLASTER, '#f2eee4')
    ty = -d / 2 - tw / 2 + 0.5
    door(0, ty - tw / 2, z, w=1.6, h=3.0)
    # Belfry openings and clock faces.
    for f, (ox, oy) in (('-y', (0, -1)), ('+y', (0, 1)), ('-x', (-1, 0)), ('+x', (1, 0))):
        window(ox * tw / 2, ty + oy * tw / 2, z + 14.6, w=1.2, h=1.9, face=f, shutters=None, frame='#d9d2c3')
        rz = 0 if f in ('-y', '+y') else math.pi / 2
        cyl(0.95, 0.12, ox * (tw / 2 + 0.02), ty + oy * (tw / 2 + 0.02), z + 11.6, PAINT, '#fbf7ec', verts=20,
            rx=math.pi / 2 if f in ('-y', '+y') else 0, ry=0 if f in ('-y', '+y') else math.pi / 2)
        box(0.08, 0.06, 0.7, ox * (tw / 2 + 0.12), ty + oy * (tw / 2 + 0.12), z + 11.6 + 0.0, METAL, '#222222', rz=rz)
    # Cornice, then the onion dome, lantern and cross.
    box(tw + 0.5, tw + 0.5, 0.4, 0, ty, z + 18, PLASTER, '#e2dccd')
    dz = z + 18.4
    cyl(tw / 2 - 0.2, 0.8, 0, ty, dz, METAL, '#5f8f74', verts=16)
    ball(2.3, 0, ty, dz + 2.6, sz=1.15, kind=METAL, col='#5f8f74', segs=16)
    cyl(1.0, 1.8, 0, ty, dz + 4.3, METAL, '#5f8f74', verts=12, r2=0.15)
    cyl(0.35, 1.2, 0, ty, dz + 6.0, PLASTER, '#e2dccd', verts=8)
    ball(0.6, 0, ty, dz + 7.6, kind=METAL, col='#5f8f74', segs=10)
    cyl(0.12, 2.0, 0, ty, dz + 8.0, METAL, '#c9a548', verts=6, r2=0.04)
    box(0.08, 0.08, 1.4, 0, ty, dz + 9.4, METAL, '#c9a548')
    box(0.8, 0.08, 0.08, 0, ty, dz + 10.2, METAL, '#c9a548')
    return build('church')


def barn():
    """Big timber hay barn on a stone base, with a ramp door at the front."""
    w, d = 12, 16
    plinth(w + 0.3, d + 0.3)
    z = 0.5
    box(w, d, 2.4, 0, 0, z, MASONRY, '#a39b8e')
    box(w + 0.1, d + 0.1, 3.8, 0, 0, z + 2.4, PLANKS, '#8a5a35')
    rh = math.tan(0.6) * w / 2
    prism(w + 0.1, d + 0.1, rh, z + 6.2, PLANKS, '#8a5a35')
    gable(w, d, 0.6, z + 6.2, over=0.9, thick=0.2, col='#5c534c', end_over=0.8)
    # Big double door with a ramp, small windows.
    box(4.2, 0.12, 3.6, 0, -d / 2 - 0.05, z + 2.4, PLANKS, '#6e4527')
    box(4.6, 3.0, 0.4, 0, -d / 2 - 1.5, z + 2.0, MASONRY, '#a39b8e', rx=0.0)
    for x in (-w / 2 + 1.5, w / 2 - 1.5):
        window(x, -d / 2, z + 0.9, w=0.6, h=0.6, shutters=None, frame='#d9cfbf')
    for k in range(4):
        y = -d / 2 + 2.5 + k * 3.7
        door(-w / 2, y, z, w=0.9, h=1.9, face='-x', col='#6e4527')
    return build('barn')


def farmhouse():
    return chalet('farmhouse', w=10, d=9, floors=2, wood='#6e4527', base='#efe7d6', roof='#5c534c', shutters='#a32e2e')


def cow(name, coat='braunvieh', graze=False):
    """A cow, about 1.4 m at the withers and 2.4 m nose to tail, facing -Y.
    One smooth body (organic.py) painted by coat: braunvieh (grey-brown with a
    pale muzzle ring), simmental (red-brown with a white head, belly, legs
    and splashes) or dun. graze: head down in the grass."""
    from mathutils import noise
    from organic import Blob, V, mix
    b = Blob(0.028)
    # Body: deep chest and brisket, barrel with a little sag, broad
    # hindquarters with a level top, withers, hook and pin bones.
    # Half-extents: (across, along, up).
    b.ellip(V(0, -0.45, 1.0), 0.25, 0.3, 0.36)
    b.ellip(V(0, -0.55, 0.74), 0.14, 0.14, 0.12)
    b.ellip(V(0, 0.0, 1.0), 0.31, 0.55, 0.34)
    b.ellip(V(0, 0.05, 0.82), 0.27, 0.42, 0.17)
    b.ellip(V(0, 0.52, 1.03), 0.26, 0.28, 0.29)
    b.ellip(V(0, 0.4, 1.26), 0.22, 0.33, 0.08)
    b.ellip(V(0, -0.5, 1.3), 0.14, 0.24, 0.1)
    for s in (-1, 1):
        b.ellip(V(s * 0.2, 0.32, 1.27), 0.06, 0.06, 0.05)
        b.ellip(V(s * 0.09, 0.75, 1.21), 0.05, 0.05, 0.05)
    # Legs: forearm to knee to fetlock in front; thigh, gaskin, hock behind.
    for s in (-1, 1):
        x = s * 0.17
        b.taper(V(x, -0.52, 1.0), V(x, -0.48, 0.62), 0.13, 0.095, 3)
        b.taper(V(x, -0.48, 0.62), V(x, -0.48, 0.38), 0.08, 0.066, 2)
        b.capsule(V(x, -0.48, 0.38), V(x, -0.49, 0.1), 0.055)
        x = s * 0.18
        b.taper(V(x, 0.5, 1.05), V(x, 0.45, 0.68), 0.16, 0.11, 3)
        b.taper(V(x * 0.95, 0.47, 0.7), V(x * 0.9, 0.66, 0.45), 0.09, 0.065, 3)
        b.capsule(V(x * 0.9, 0.66, 0.45), V(x * 0.9, 0.6, 0.1), 0.054)
    # Udder and teats.
    b.ellip(V(0, 0.4, 0.64), 0.13, 0.15, 0.1)
    for tx in (-0.06, 0.06):
        for ty in (0.33, 0.47):
            b.capsule(V(tx, ty, 0.58), V(tx, ty, 0.5), 0.018)
    # Neck with its dewlap, then a long wedge of a head: broad flat forehead
    # between the horns, eyes at the sides, narrowing to a wide square muzzle.
    if graze:
        poll, muzzle, neck_end = V(0, -1.08, 0.66), V(0, -1.28, 0.14), V(0, -0.98, 0.76)
    else:
        poll, muzzle, neck_end = V(0, -1.02, 1.3), V(0, -1.36, 0.9), V(0, -0.92, 1.16)
    b.taper(V(0, -0.6, 1.14), neck_end, 0.26, 0.17, 4)
    mid = V(0, -0.75, 1.1).lerp(neck_end, 0.4)
    b.ellip(mid + V(0, 0, -0.27), 0.08, 0.18, 0.17)
    hd = (muzzle - poll).normalized()
    b.taper(poll, poll.lerp(muzzle, 0.45), 0.13, 0.115, 2)
    b.taper(poll.lerp(muzzle, 0.45), muzzle, 0.1, 0.085, 3)
    b.ellip(poll + hd * 0.05, 0.15, 0.09, 0.09)
    b.ellip(poll.lerp(muzzle, 0.3), 0.125, 0.11, 0.11)
    b.ellip(muzzle, 0.115, 0.08, 0.075)

    def paint(p):
        q = V(p.x, p.y, p.z)
        to_m = (q - muzzle).length
        if to_m < 0.115 and (q - muzzle).dot(hd) > 0.02:
            return '#2b2622' if coat != 'dun' else '#b98d80'
        head = (q - poll).length < 0.5 and q.y < poll.y + 0.12
        if q.z < 0.13:
            return '#3a3029'
        if coat == 'simmental':
            if head or q.z < 0.48 or (abs(q.x) < 0.2 and 0.22 < q.y < 0.6 and q.z < 0.72):
                return '#f2eee4'
            # Red-brown on the upper body, white belly, a few white splashes.
            n = noise.noise(q * 2.0 + V(3.1, 1.7, 0.4)) + 0.4 * noise.noise(q * 4.5)
            line = 0.78 + 0.12 * noise.noise(q * 3.0)
            return '#9b4f28' if q.z > line and n < 0.35 else '#f2eee4'
        base, light = ('#7a6857', '#b4a796') if coat == 'braunvieh' else ('#c39a6a', '#e0c8a4')
        if to_m < 0.15 and (q - muzzle).dot(hd) > -0.06:
            return '#ebe5d8'
        if abs(q.x) < 0.2 and 0.22 < q.y < 0.6 and q.z < 0.72:
            return '#e2b8ac'
        c = mix(base, light, (0.8 - q.z) * 3) if q.z < 0.8 else base
        return mix(c, '#4a3e34', (0.38 - q.z) * 4) if q.z < 0.38 else c

    b.mesh(finish, paint, ratio=0.12)
    # Hooves, ears, eyes, horns, tail with its dark switch, and the bell.
    for s in (-1, 1):
        cyl(0.06, 0.1, s * 0.17, -0.49, 0, PAINT, '#2a2420', verts=8, r2=0.052)
        cyl(0.058, 0.1, s * 0.16, 0.6, 0, PAINT, '#2a2420', verts=8, r2=0.05)
    side = V(1, 0, 0)
    up = hd.cross(side).normalized()  # out of the forehead
    for s in (-1, 1):
        e = poll + side * s * 0.16 - up * 0.02
        ball(0.09, e.x + s * 0.06, e.y, e.z, sx=1.4, sy=0.35, sz=0.7, col='#6b5a4c' if coat == 'braunvieh' else '#c4a07a' if coat == 'dun' else '#f2eee4', segs=8, rz=s * 0.25)
        ey = poll + hd * 0.17 + side * s * 0.115 + up * 0.04
        ball(0.022, ey.x, ey.y, ey.z, col='#15110e', segs=6)
        h = poll + side * s * 0.1 + up * 0.04
        cyl(0.03, 0.18, h.x, h.y, h.z, PAINT, '#e9e0c8', verts=6, r2=0.008, ry=s * 1.0, rx=-0.3)
    cyl(0.024, 0.72, 0, 0.79, 0.5, PAINT, '#6b5a4c' if coat == 'braunvieh' else '#c39a6a' if coat == 'dun' else '#f2eee4', verts=6, rx=-0.12)
    ball(0.06, 0, 0.8, 0.46, sz=2.2, col='#2a2420' if coat != 'simmental' else '#f2eee4', segs=6)
    bell = neck_end.lerp(V(0, -0.7, 1.1), 0.5) + V(0, 0, -0.33)
    cyl(0.085, 0.15, bell.x, bell.y, bell.z - 0.12, METAL, '#b8913a', verts=10, r2=0.06)
    return build(name)


def haybale():
    """Round bale wrapped in pale plastic net, lying on its side."""
    cyl(0.75, 1.2, 0, -0.6, 0.75, PLASTER, '#d8c27a', verts=14, rx=-math.pi / 2)
    return build('haybale')


def fence():
    """3 m of post-and-rail fence along X, centred on the origin."""
    for x in (-1.5, 0, 1.5):
        box(0.14, 0.14, 1.25, x, 0, -0.3, PLANKS, '#6f5a43')
    for z in (0.45, 0.85):
        box(3.1, 0.06, 0.14, 0, -0.08, z, PLANKS, '#7d6a52')
    return build('fence')


def churns():
    """Milk churn stand by the road: a little platform and three churns."""
    for x in (-0.6, 0.6):
        for y in (-0.4, 0.4):
            box(0.12, 0.12, 0.9, x, y, 0, PLANKS, '#6f5a43')
    box(1.6, 1.1, 0.12, 0, 0, 0.9, PLANKS, '#7d6a52')
    for k, x in enumerate((-0.45, 0.05, 0.5)):
        cyl(0.22, 0.55, x, -0.05 * k, 1.02, METAL, '#c8cdd0', verts=12)
        cyl(0.14, 0.15, x, -0.05 * k, 1.57, METAL, '#c8cdd0', verts=12, r2=0.1)
        cyl(0.12, 0.06, x, -0.05 * k, 1.72, METAL, '#b0b5b8', verts=12)
    return build('churns')


def woodpile():
    """Split logs stacked under a little lean-to roof."""
    L = 3.0
    for r in range(5):
        n = 9 - r
        for k in range(n):
            x = -L / 2 + 0.2 + (k + r * 0.5) * 0.32
            cyl(0.15, 0.6, x, 0, 0.15 + r * 0.27, PLANKS, ['#a5794d', '#8f6a45', '#b48a5c'][(k + r) % 3], verts=6, rx=math.pi / 2)
    for x in (-L / 2 - 0.1, L / 2 + 0.1):
        box(0.12, 0.12, 2.0, x, 0.35, 0, PLANKS, '#5c4632')
    box(L + 0.6, 1.2, 0.08, 0, 0.1, 1.95, PLANKS, '#5c4632', rx=-0.25)
    return build('woodpile')


def trough():
    """Hollowed-log water trough with a spout post and flowers."""
    box(2.6, 0.7, 0.55, 0, 0, 0, PLANKS, '#7d6a52')
    box(2.4, 0.5, 0.05, 0, 0, 0.5, GLASS, '#3d6f73')
    box(0.22, 0.22, 1.4, -1.45, 0, 0, PLANKS, '#6f5a43')
    cyl(0.03, 0.4, -1.4, 0, 1.15, METAL, '#8a8f93', verts=6, ry=math.pi / 2)
    for k in range(3):
        ball(0.2, 1.0 - k * 0.3, 0.0, 0.62, sx=1.2, sz=0.6, col=['#d62c3a', '#f2f2f2', '#e8417a'][k], segs=6)
    return build('trough')


def fountain():
    """Village fountain: an octagonal stone basin with a column and spouts."""
    cyl(2.2, 0.7, 0, 0, 0, MASONRY, '#9d968a', verts=8, smooth=False)
    cyl(2.0, 0.05, 0, 0, 0.6, GLASS, '#4d7f86', verts=8, smooth=False)
    cyl(0.35, 2.6, 0, 0, 0, MASONRY, '#9d968a', verts=8, smooth=False)
    cyl(0.6, 0.3, 0, 0, 2.6, MASONRY, '#8c857a', verts=8, smooth=False)
    ball(0.35, 0, 0, 3.1, kind=METAL, col='#5f8f74', segs=8)
    for a in range(4):
        cyl(0.04, 0.6, 0, 0, 2.0, METAL, '#8a8f93', verts=6, rx=math.pi / 2, rz=a * math.pi / 2)
    return build('fountain')


def bench():
    for x in (-0.7, 0.7):
        box(0.08, 0.45, 0.42, x, 0, 0, PLANKS, '#5c4632')
    box(1.8, 0.45, 0.06, 0, 0, 0.42, PLANKS, '#8f6a45')
    box(1.8, 0.06, 0.35, 0, 0.22, 0.55, PLANKS, '#8f6a45')
    return build('bench')


def boathouse():
    """Timber boathouse on stilts over the water, with a slipway door."""
    w, d = 6, 9
    for x in (-w / 2, w / 2):
        for y in (-d / 2, 0, d / 2):
            cyl(0.16, 4.0, x, y, -3.5, PLANKS, '#4e3b2a', verts=6)
    box(w + 0.2, d + 0.2, 0.2, 0, 0, 0.3, PLANKS, '#6f5a43')
    box(w, d, 2.8, 0, 0, 0.5, PLANKS, '#7a5233')
    prism(w, d, 1.6, 3.3, PLANKS, '#7a5233')
    gable(w, d, 0.5, 3.3, over=0.5, thick=0.15, col='#4e4038', end_over=0.5)
    box(3.0, 0.1, 2.4, 0, -d / 2 - 0.05, 0.5, PLANKS, '#5c3d24')
    window(w / 2, 1, 1.4, w=0.8, h=0.8, face='+x', shutters='#2f5d3a')
    return build('boathouse')


def jetty():
    """A 12 m wooden jetty along +Y from the bank, on piles."""
    L = 12
    box(1.8, L, 0.12, 0, L / 2, 0.4, PLANKS, '#8a7356')
    for y in range(0, L + 1, 3):
        for x in (-0.8, 0.8):
            cyl(0.1, 4.0, x, y, -3.5, PLANKS, '#4e3b2a', verts=6)
    return build('jetty')


def rowboat():
    """A wooden rowing boat, 3.5 m long, afloat (the water line is z = 0):
    a lofted hull with a pointed bow and a square transom stern, white
    topsides over red antifouling, varnished inside, three thwarts, rowlocks
    and a pair of oars stowed along the seats. Bow towards -Y."""
    from organic import paint
    N, M = 16, 9  # stations along, points down each side

    def station(t):
        y = 1.6 - 3.4 * t
        if t >= 0.42:
            w = 0.68 * (1 - ((t - 0.42) / 0.58) ** 1.8)
        else:
            w = 0.68 - 0.16 * ((0.42 - t) / 0.42) ** 2
        top = 0.3 + 0.2 * t ** 3 + 0.04 * (1 - t) ** 2
        bot = -0.2 + 0.16 * t ** 4
        return y, max(w, 0.0), top, bot

    def ring(t, inset):
        y, w, top, bot = station(t)
        pts = []
        for k in range(-M + 1, M):  # gunwale left, keel, gunwale right
            a = abs(k) / (M - 1) * math.pi / 2
            x = math.copysign(max(w - inset, 0.0) * math.sin(a) ** 0.6, k)
            z = bot + inset + (top - bot - inset) * (1 - math.cos(a)) ** 0.9
            pts.append((x, y, z))
        return pts

    K = 2 * M - 1
    shells = []
    for inset in (0.0, 0.035):
        verts, faces = [], []
        for i in range(N + 1):
            verts += ring(i / N, inset)
        for i in range(N):
            for k in range(K - 1):
                a, b = i * K + k, (i + 1) * K + k
                faces.append((a, a + 1, b + 1, b) if inset == 0 else (a, b, b + 1, a + 1))
        # Transom: the stern end of the shell, facing aft (+Y) outside.
        ring0 = list(range(K))
        faces.append(tuple(reversed(ring0)) if inset == 0 else tuple(ring0))
        shells.append((verts, faces))
    (ov, of), (iv, inf) = shells
    # Outside: white topsides, red antifouling below the water line.
    paint(mesh(ov, of, PLANKS, '#ffffff'), lambda p: '#8a2a1e' if p.z < 0.03 else '#f1eee6')
    mesh(iv, inf, PLANKS, '#a87b4f')
    # Gunwale capping: a strip over the top edge of both shells.
    rv, rf = [], []
    for k in (0, K - 1):
        base = len(rv)
        for i in range(N + 1):
            rv += [ov[i * K + k], iv[i * K + k]]
        for i in range(N):
            a = base + 2 * i
            f = (a, a + 2, a + 3, a + 1)
            rf.append(f if k == 0 else tuple(reversed(f)))
    mesh(rv, rf, PLANKS, '#5a3c24')
    # Thwarts across at seat height, a stern sheet, rowlocks and the oars.
    for t in (0.18, 0.47, 0.75):
        y, w, top, bot = station(t)
        box(2 * w - 0.08, 0.24, 0.035, 0, y, top - 0.17, PLANKS, '#b88b5a')
    y, w, top, bot = station(0.47)
    for s in (-1, 1):
        cyl(0.012, 0.09, s * (w - 0.02), y + 0.45, top, METAL, '#8a8f94', verts=5)
        # Oar stowed along the seats: loom, then a flat blade towards the bow.
        cyl(0.022, 2.1, s * 0.22, 1.25, top - 0.11, PLANKS, '#d2b48a', verts=6, rx=math.pi / 2)
        box(0.12, 0.55, 0.014, s * 0.22, -0.85 - 0.27, top - 0.12, PLANKS, '#d2b48a')
    # Painter (mooring rope) coiled on the bow seat.
    yb, wb, topb, _ = station(0.88)
    cyl(0.09, 0.04, 0, yb, topb - 0.25, PAINT, '#c9b98f', verts=10)
    return build('rowboat')


def sawmill():
    """Open-sided sawmill shed with a long roof and a log carriage."""
    w, d = 8, 18
    plinth(w, d, top=0.3, col='#9a948a')
    for x in (-w / 2 + 0.2, w / 2 - 0.2):
        for k in range(5):
            box(0.25, 0.25, 4.0, x, -d / 2 + 0.5 + k * (d - 1) / 4, 0.3, PLANKS, '#5c4632')
    box(w, d, 0.25, 0, 0, 4.3, PLANKS, '#5c4632')
    prism(w, d, 1.6, 4.55, PLANKS, '#6f5a43')
    gable(w, d, 0.38, 4.55, over=0.8, thick=0.15, col='#6b6f72', kind=METAL, end_over=0.6)
    # Back wall, saw bench and a log on the carriage.
    box(w, 0.2, 4.0, 0, d / 2 - 0.1, 0.3, PLANKS, '#7a5233')
    box(1.2, d - 3, 0.8, 0, 0, 0.3, PLANKS, '#4e3b2a')
    cyl(0.4, 9, 0, -4.5, 1.5, PLANKS, '#9b7a55', verts=10, rx=-math.pi / 2)
    cyl(0.9, 0.06, 0.8, 2, 1.1, METAL, '#c0c5c8', verts=24, ry=math.pi / 2)
    return build('sawmill')


def logstack():
    """A pyramid of long logs, 8 m long, along Y."""
    L = 8
    for r in range(4):
        n = 6 - r
        for k in range(n):
            x = -(n - 1) * 0.3 + k * 0.6
            cyl(0.3, L, x, -L / 2, 0.3 + r * 0.52, PLANKS, ['#9b7a55', '#8a6a48', '#a88560'][(k + r) % 3], verts=8, rx=-math.pi / 2)
    for x in (-1.9, 1.9):
        box(0.15, 0.15, 1.6, x, -L / 3, 0, PLANKS, '#4e3b2a')
        box(0.15, 0.15, 1.6, x, L / 3, 0, PLANKS, '#4e3b2a')
    return build('logstack')


def chapel():
    """Small white wayside chapel with a little bell turret."""
    w, d = 4.5, 6.5
    plinth(w + 0.3, d + 0.3)
    z = 0.5
    box(w, d, 3.6, 0, 0, z, PLASTER, '#f4f0e6')
    rh = math.tan(0.75) * w / 2
    prism(w, d, rh, z + 3.6, PLASTER, '#f4f0e6')
    gable(w, d, 0.75, z + 3.6, over=0.35, thick=0.18, col='#5a4a3e', end_over=0.5)
    door(0, -d / 2, z, w=1.1, h=2.3, col='#6e4527')
    for f, x in (('-x', -w / 2), ('+x', w / 2)):
        window(x, 0.5, z + 1.4, w=0.6, h=1.3, face=f, shutters=None)
    tz = z + 3.6 + rh
    box(0.9, 0.9, 1.2, 0, -d / 2 + 0.8, tz - 0.4, PLANKS, '#7a5233')
    cyl(0.75, 1.3, 0, -d / 2 + 0.8, tz + 0.8, SHINGLES, '#5a4a3e', verts=4, r2=0.02, rz=math.pi / 4, smooth=False)
    box(0.05, 0.05, 0.7, 0, -d / 2 + 0.8, tz + 2.1, METAL, '#c9a548')
    box(0.4, 0.05, 0.05, 0, -d / 2 + 0.8, tz + 2.55, METAL, '#c9a548')
    return build('chapel')


def shrine():
    """Wayside crucifix with a little roof, at the roadside."""
    box(0.18, 0.18, 2.6, 0, 0, 0, PLANKS, '#5c4632')
    box(1.3, 0.14, 0.14, 0, 0, 1.9, PLANKS, '#5c4632')
    gable(0.7, 0.5, 0.6, 2.6, over=0.25, thick=0.06, col='#4e4038')
    box(0.08, 0.06, 0.6, 0, -0.12, 1.55, PAINT, '#e9dfcc')
    box(0.6, 0.06, 0.07, 0, -0.12, 1.92, PAINT, '#e9dfcc')
    for k in range(3):
        ball(0.15, (k - 1) * 0.35, -0.25, 0.1, sz=0.7, col=['#d62c3a', '#f5d23d', '#d62c3a'][k], segs=6)
    return build('shrine')


def hut():
    """Mountain hut: stone ground floor, timber upper, red and white shutters."""
    w, d = 10, 8
    plinth(w + 0.3, d + 0.3, col='#7f7a72')
    z = 0.5
    box(w, d, 3.0, 0, 0, z, MASONRY, '#9c968c')
    box(w + 0.1, d + 0.1, 2.5, 0, 0, z + 3.0, PLANKS, '#5c3d24')
    rh = math.tan(0.5) * w / 2
    prism(w + 0.1, d + 0.1, rh, z + 5.5, PLANKS, '#5c3d24')
    gable(w, d, 0.5, z + 5.5, over=0.9, thick=0.25, col='#62666a', kind=SHINGLES, end_over=0.9)
    for wx in (-w * 0.3, w * 0.3):
        window(wx, -d / 2, z + 1.0, shutters='#b8322f')
        window(wx, -d / 2, z + 3.7, shutters='#b8322f')
    door(0, -d / 2, z, col='#6e4527')
    window(0, -d / 2, z + 3.7, shutters='#b8322f')
    # A flag on a pole and a terrace with benches.
    box(w, 3.0, 0.15, 0, -d / 2 - 1.5, z, PLANKS, '#8a7356')
    cyl(0.06, 8, w / 2 + 1, -d / 2 - 2.5, 0, METAL, '#d9d9d9', verts=6)
    box(1.4, 0.03, 0.9, w / 2 + 1.72, -d / 2 - 2.5, 6.9, PAINT, '#d42b2b')
    box(0.9, 0.035, 0.18, w / 2 + 1.72, -d / 2 - 2.5, 7.26, PAINT, '#ffffff')
    box(0.18, 0.035, 0.6, w / 2 + 1.72, -d / 2 - 2.5, 7.05, PAINT, '#ffffff')
    return build('hut')


def summitcross():
    """Big timber summit cross on a cairn."""
    for k in range(8):
        a = k * math.pi / 4
        ball(0.7, math.cos(a) * 1.0, math.sin(a) * 1.0, 0.2, sz=0.6, kind=MASONRY, col='#8a857c', segs=6)
    ball(1.0, 0, 0, 0.6, sz=0.7, kind=MASONRY, col='#8a857c', segs=7)
    box(0.35, 0.3, 8.0, 0, 0, 0.5, PLANKS, '#6b4a2f')
    box(4.0, 0.28, 0.35, 0, 0, 6.0, PLANKS, '#6b4a2f')
    box(0.5, 0.4, 0.4, 0, -0.1, 6.0, METAL, '#c9a548')
    return build('summitcross')


def pylon():
    """Gondola lift pylon: a tapered steel tower with a crossarm and sheaves.
    The cable runs along Y, 18 m up, the arms at x = +-3."""
    H = 18
    for sx in (-1, 1):
        for sy in (-1, 1):
            o = cyl(0.12, H + 0.5, sx * 1.4, sy * 1.0, 0, METAL, '#c9ccce', verts=6, smooth=False)
            o.rotation_euler = (sy * 0.05, -sx * 0.06, 0)
    for k in range(5):
        z = 1 + k * 3.6
        sc = 1 - k * 0.07
        box(2.8 * sc, 0.1, 0.1, 0, -1.0 * sc, z, METAL, '#c9ccce')
        box(2.8 * sc, 0.1, 0.1, 0, 1.0 * sc, z, METAL, '#c9ccce')
        box(0.1, 2.0 * sc, 0.1, -1.4 * sc, 0, z, METAL, '#c9ccce')
        box(0.1, 2.0 * sc, 0.1, 1.4 * sc, 0, z, METAL, '#c9ccce')
    box(7.0, 0.8, 0.5, 0, 0, H, METAL, '#b0b3b5')
    for x in (-3, 3):
        box(0.3, 3.0, 0.3, x, 0, H - 0.4, METAL, '#55595d')
        for y in (-1.2, -0.4, 0.4, 1.2):
            cyl(0.22, 0.12, x, y, H - 0.55, METAL, '#2b2f33', verts=10, ry=math.pi / 2)
    cyl(0.6, 0.6, 0, 0, -0.3, MASONRY, '#9a948a', verts=8) if False else box(3.6, 2.6, 0.5, 0, 0, -0.3, MASONRY, '#9a948a')
    return build('pylon')


def gondola():
    """An 8-seat gondola cabin hanging from its grip arm (top at z = 0)."""
    box(0.15, 0.15, 2.2, 0, 0, -2.2, METAL, '#55595d')
    box(0.5, 0.3, 0.25, 0, 0, -0.2, METAL, '#2b2f33')
    box(1.9, 1.7, 1.9, 0, 0, -4.3, PAINT, '#d0342c')
    box(1.95, 1.75, 0.9, 0, 0, -3.25, GLASS, '#2a3a44')
    box(1.6, 1.4, 0.15, 0, 0, -2.35, PAINT, '#d0342c')
    return build('gondola')


def station():
    """Lift station: concrete base, glass hall and the big bullwheel housing."""
    w, d = 14, 22
    plinth(w + 0.3, d + 0.3, col='#a7a39b')
    box(w, d, 4.0, 0, 0, 0.5, PLASTER, '#c9c4b9')
    box(w - 1, d - 2, 3.0, 0, 0, 4.5, GLASS, '#2a3a44')
    box(w + 2, d + 2, 0.5, 0, 0, 7.5, METAL, '#b0b3b5')
    cyl(5.0, 1.2, 0, d / 2 - 5, 8.0, METAL, '#8e9295', verts=24)
    for x in (-w / 2 + 1, w / 2 - 1):
        for y in (-d / 2 + 1, d / 2 - 1):
            box(0.6, 0.6, 7.0, x, y, 0.5, PLASTER, '#c9c4b9')
    door(0, -d / 2, 0.5, w=3.0, h=2.6, col='#3e4448')
    box(6, 0.1, 1.0, 0, -d / 2 - 1.05, 4.6, PAINT, '#d0342c')
    return build('station')


def chevron(name, sx):
    """Bend chevron board (red with white arrows) on two posts. Arrows point
    towards +X (sx = 1) or -X (sx = -1), seen from the front."""
    for x in (-0.6, 0.6):
        box(0.08, 0.08, 1.6, x, 0.04, 0, METAL, '#9ea3a8')
    box(1.6, 0.04, 0.55, 0, 0, 1.15, PAINT, '#c8251f')
    for k in range(3):
        x = -0.5 + k * 0.45
        for s in (-1, 1):
            box(0.28, 0.02, 0.08, x * sx, -0.03, 1.42 + s * 0.09, PAINT, '#f5f5f5', ry=s * 0.7 * sx)
    return build(name)


def warnsign(name, sx):
    """Bend warning triangle on a post: red border, white inside and a black
    bend, one bar that runs straight up and curves away towards sx."""
    box(0.08, 0.08, 2.2, 0, 0.04, 0, METAL, '#9ea3a8')
    tri = [(math.pi / 2), (math.pi / 2 + 2.094), (math.pi / 2 + 4.189)]
    v = [(math.cos(a) * 0.62, 0, math.sin(a) * 0.62 + 2.2) for a in tri]
    mesh([(x, y, z) for x, y, z in v] + [(x, 0.03, z) for x, y, z in v], [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)], PAINT, '#c8251f')
    v2 = [(math.cos(a) * 0.44, -0.01, math.sin(a) * 0.44 + 2.2) for a in tri]
    mesh(v2, [(0, 1, 2)], PAINT, '#f7f4ec')
    # The bend: a straight run up from the bottom, then an arc of radius R.
    R, w = 0.21, 0.05
    path = [(0, 1.99 + k * 0.05) for k in range(4)]
    for k in range(1, 9):
        th = k / 8 * 1.15
        path.append((sx * R * (1 - math.cos(th)), 2.14 + R * math.sin(th)))
    verts = []
    for i, (x, z) in enumerate(path):
        x0, z0 = path[max(i - 1, 0)]
        x1, z1 = path[min(i + 1, len(path) - 1)]
        dx, dz = x1 - x0, z1 - z0
        n = math.hypot(dx, dz)
        nx, nz = dz / n, -dx / n  # right of the direction of travel
        verts += [(x - nx * w, -0.016, z - nz * w), (x + nx * w, -0.016, z + nz * w)]
    faces = [(2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2) for i in range(len(path) - 1)]
    mesh(verts, faces, PAINT, '#1a1a1a')
    return build(name)


def snowpole():
    """Orange-and-black snow marker pole."""
    for k in range(5):
        cyl(0.035, 0.5, 0, 0, k * 0.5, PAINT, '#e36a1c' if k % 2 else '#1f1f1f', verts=6)
    return build('snowpole')


def bunting_pole():
    """Tall white pole that bunting is strung between."""
    cyl(0.07, 7, 0, 0, 0, PAINT, '#ececec', verts=8)
    ball(0.12, 0, 0, 7.0, kind=METAL, col='#c9a548', segs=6)
    return build('flagpole')


def flagpole_flag():
    """Pole with a tall swallowtail banner (red and white)."""
    cyl(0.06, 8, 0, 0, 0, PAINT, '#ececec', verts=8)
    box(0.9, 0.03, 3.2, 0.5, 0, 4.4, PAINT, '#d42b2b')
    box(0.9, 0.035, 1.0, 0.5, 0, 5.5, PAINT, '#ffffff')
    return build('banner')


def spectator(name, top='#2b6cb0', legs='#2f3a4f', skin='#e0b393', hair='#5a3a22', pose='cheer', hat=None, scarf=None):
    """A race fan, about 1.75 m, facing -Y: one smooth body (organic.py) in a
    top and trousers, with a face, hair, hands and shoes. pose: cheer (both
    arms up), clap (hands together in front) or film (phone held up)."""
    from organic import Blob, V
    b = Blob(0.014)
    head = V(0, -0.01, 1.655)
    # Legs: hip, knee, ankle, a little apart.
    for s in (-1, 1):
        hip, knee, ank = V(s * 0.095, 0, 0.92), V(s * 0.105, -0.025, 0.5), V(s * 0.11, 0.0, 0.09)
        b.taper(hip, knee, 0.078, 0.056, 3)
        b.taper(knee, knee.lerp(ank, 0.3), 0.056, 0.055, 1)
        b.taper(knee.lerp(ank, 0.3), ank, 0.055, 0.04, 2)
        # Trainers: a rounded toe box and heel.
        b.ellip(V(s * 0.11, -0.05, 0.05), 0.048, 0.125, 0.045)
    # Hips, waist, chest, shoulders, neck.
    b.ellip(V(0, 0, 0.96), 0.165, 0.105, 0.11)
    b.ellip(V(0, 0, 1.1), 0.15, 0.1, 0.12)
    b.ellip(V(0, -0.005, 1.3), 0.185, 0.115, 0.15)
    b.ellip(V(0, 0, 1.43), 0.2, 0.09, 0.05)
    b.capsule(V(0, 0, 1.45), V(0, -0.005, 1.56), 0.052)
    if scarf:
        b.ellip(V(0, -0.01, 1.47), 0.085, 0.08, 0.04)
    # Head: skull, jaw, nose and ears.
    b.ellip(head, 0.083, 0.098, 0.112)
    b.ellip(head + V(0, -0.025, -0.06), 0.068, 0.07, 0.06)
    b.ellip(head + V(0, -0.1, -0.005), 0.016, 0.02, 0.028)
    for s in (-1, 1):
        b.ellip(head + V(s * 0.083, 0.005, 0.0), 0.012, 0.022, 0.03)
    # Arms: shoulder, elbow, hand per pose.
    arms = {
        'cheer': [(V(0.33, 0.02, 1.68), V(0.38, -0.02, 1.96)), (V(-0.33, 0.02, 1.68), V(-0.38, -0.02, 1.96))],
        'clap': [(V(0.28, -0.1, 1.18), V(0.035, -0.33, 1.42)), (V(-0.28, -0.1, 1.18), V(-0.035, -0.33, 1.42))],
        'film': [(V(0.29, -0.2, 1.4), V(0.1, -0.4, 1.62)), (V(-0.24, 0.0, 1.13), V(-0.27, -0.04, 0.88))],
    }[pose]
    hands = []
    for s, (el, ha) in zip((1, -1), arms):
        sh = V(s * 0.2, 0, 1.43)
        b.taper(sh, el, 0.05, 0.04, 3)
        b.taper(el, ha, 0.04, 0.032, 3)
        d = (ha - el).normalized()
        hc = ha + d * 0.05
        b.capsule(ha, hc + d * 0.03, 0.033)
        hands.append(hc)

    def paint(p):
        q = V(p.x, p.y, p.z)
        h = q - head
        if h.length < 0.16 and q.z > 1.5:
            hair_line = q.z > head.z + 0.035 or (h.y > 0.035 and q.z > head.z - 0.07)
            if hat and q.z > head.z + 0.03:
                return hat
            if hair_line and not (abs(h.x) > 0.075 and q.z < head.z + 0.03):
                return hair
            return skin
        if any((q - c).length < 0.075 for c in hands):
            return skin
        if scarf and 1.43 < q.z < 1.53 and math.hypot(q.x, q.y) < 0.11:
            return scarf
        if q.z < 0.1:
            return '#24262a' if q.z > 0.025 else '#e8e6e0'
        if q.z < 0.93:
            return legs
        return top

    b.mesh(finish, paint, ratio=0.12)
    # Eyes, and the phone or bobble.
    for s in (-1, 1):
        ball(0.011, head.x + s * 0.034, head.y - 0.088, head.z + 0.015, col='#1d1a18', segs=6)
    if pose == 'film':
        box(0.075, 0.012, 0.15, hands[0].x - 0.03, hands[0].y - 0.04, hands[0].z - 0.06, PAINT, '#15171a', rx=-0.25)
    if hat:
        ball(0.04, head.x, head.y + 0.01, head.z + 0.125, col='#f2f2ee', segs=8)
    return build(name)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    chalet('chalet', seed=1)
    chalet('chalet_small', w=7.5, d=7, floors=2, wood='#8a5a35', base='#f1e6d2', roof='#5c534c', shutters='#a32e2e')
    chalet('chalet_tall', w=10, d=9, floors=3, wood='#6b4428', base='#ece6da', roof='#4a3f38', shutters='#2f5d3a')
    farmhouse()
    church()
    barn()
    cow('cow', 'braunvieh')
    cow('cow_pied', 'simmental', graze=True)
    cow('cow_dun', 'dun')
    haybale()
    fence()
    churns()
    woodpile()
    trough()
    fountain()
    bench()
    boathouse()
    jetty()
    rowboat()
    sawmill()
    logstack()
    chapel()
    shrine()
    hut()
    summitcross()
    pylon()
    gondola()
    station()
    chevron('chevron_r', 1)
    chevron('chevron_l', -1)
    warnsign('warnsign_r', 1)
    warnsign('warnsign_l', -1)
    snowpole()
    bunting_pole()
    flagpole_flag()
    spectator('fan_a', top='#2b6cb0', legs='#2f3a4f', pose='cheer', hair='#3b2618')
    spectator('fan_b', top='#d69e2e', legs='#4a4f57', skin='#c68a64', hair='#1d1714', pose='clap', scarf='#c53030')
    spectator('fan_c', top='#c53030', legs='#2b3442', skin='#f0c8a8', hair='#b5803e', pose='film', hat='#2f6b4a')
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'props.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_materials='NONE', export_normals=True,
                              export_texcoords=True, export_apply=True, export_vertex_color='ACTIVE')
    print('wrote', path)


if __name__ == '__main__':
    main()
