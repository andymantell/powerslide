"""A dairy cow, hand-modelled from cross-section cages (sculpt.py): a deep
barrel with a level topline, withers, angular hooks and pins, a brisket and
dewlap, a long straight-profiled head with a square muzzle, thin legs with
knees, hocks and cloven hooves, an udder, ears, horns and a tail. About
1.4 m at the withers and 2.4 m nose to tail, facing -Y.
"""
import math

from mathutils import Vector, Matrix, noise

import props
from props import PAINT, ball, cyl, hexrgb
from sculpt import V, loft, subdivide, smooth_join, decimate, bake_ao

X, Y, Z = V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)


def body_stations():
    """Tail head to the base of the neck. (y, top, widest z, bottom, half
    width, eu, ed, top taper, bottom taper)."""
    rows = [
        (0.96, 1.30, 1.10, 0.94, 0.2, 3.0, 2.5, 0.05, 0.1),
        (0.87, 1.37, 1.14, 0.84, 0.25, 3.2, 2.0, 0.15, 0.15),
        (0.66, 1.40, 1.20, 0.70, 0.315, 3.8, 2.0, 0.15, 0.32),
        (0.44, 1.38, 1.02, 0.63, 0.31, 2.4, 2.0, 0.18, 0.12),
        (0.18, 1.355, 0.95, 0.59, 0.335, 2.2, 1.9, 0.26, 0.0),
        (-0.10, 1.355, 0.95, 0.59, 0.33, 2.2, 1.9, 0.3, 0.0),
        (-0.36, 1.375, 1.0, 0.62, 0.305, 2.0, 2.0, 0.38, 0.0),
        (-0.56, 1.42, 1.0, 0.64, 0.29, 1.8, 2.0, 0.52, 0.1),
        (-0.74, 1.35, 0.95, 0.58, 0.27, 2.0, 2.2, 0.42, 0.2),
        (-0.86, 1.27, 0.95, 0.62, 0.22, 2.0, 2.0, 0.3, 0.3),
        (-0.96, 1.22, 0.98, 0.7, 0.18, 2.0, 2.0, 0.2, 0.35),
        (-1.04, 1.21, 1.0, 0.8, 0.15, 2.0, 2.0, 0.15, 0.3),
        (-1.09, 1.22, 1.04, 0.9, 0.135, 2.0, 2.0, 0.1, 0.2),
    ]
    st = []
    for y, zt, zc, zb, w, eu, ed, tt, tb in rows:
        st.append(dict(c=V(0, y, zc), a=X, u=Z, w=w, hu=zt - zc, hd=zc - zb, eu=eu, ed=ed, tt=tt, tb=tb))
    return st


def leg_stations(x, rows):
    """Rings in the ground plane stacked down a leg. rows: (z, y centre,
    across radius, fore-aft radius, exponent)."""
    st = []
    for z, cy, rx, ry, e in rows:
        st.append(dict(c=V(x, cy, z), a=X, u=-Y, w=rx, hu=ry, hd=ry, eu=e, ed=e))
    return st


FRONT_LEG = [
    (1.06, -0.60, 0.105, 0.16, 2.0),
    (0.88, -0.60, 0.085, 0.125, 2.0),
    (0.72, -0.59, 0.066, 0.085, 2.0),
    (0.56, -0.585, 0.052, 0.066, 2.2),
    (0.46, -0.585, 0.052, 0.068, 2.4),  # knee
    (0.38, -0.585, 0.042, 0.052, 2.2),
    (0.22, -0.585, 0.04, 0.05, 2.2),
    (0.12, -0.59, 0.047, 0.057, 2.2),  # fetlock
    (0.075, -0.595, 0.044, 0.054, 2.2),
]
HIND_LEG = [
    (1.08, 0.64, 0.10, 0.23, 2.0),
    (0.90, 0.62, 0.095, 0.19, 2.0),
    (0.74, 0.65, 0.075, 0.13, 2.0),
    (0.60, 0.70, 0.06, 0.09, 2.0),
    (0.48, 0.76, 0.056, 0.085, 2.4),  # hock
    (0.40, 0.74, 0.044, 0.056, 2.2),
    (0.24, 0.69, 0.04, 0.05, 2.2),
    (0.12, 0.655, 0.047, 0.057, 2.2),
    (0.075, 0.65, 0.044, 0.054, 2.2),
]


def hoof(x, y, kind, col):
    """Cloven hoof: two claws side by side, squared off at the toe."""
    parts = []
    for s in (-1, 1):
        st = [
            dict(c=V(x + s * 0.026, y, 0.085), a=X, u=-Y, w=0.027, hu=0.05, hd=0.05, eu=2.5, ed=2.5),
            dict(c=V(x + s * 0.028, y - 0.004, 0.04), a=X, u=-Y, w=0.03, hu=0.06, hd=0.055, eu=3.0, ed=2.5),
            dict(c=V(x + s * 0.03, y - 0.008, 0.0), a=X, u=-Y, w=0.03, hu=0.064, hd=0.055, eu=3.5, ed=2.5),
        ]
        o = loft(st, 10, name='hoof')
        subdivide(o, 1)
        parts.append(o)
    return parts


def head_stations(poll, muzzle):
    d = (muzzle - poll).normalized()
    a = X
    u = a.cross(d).normalized()  # out of the forehead
    length = (muzzle - poll).length
    rows = [  # (s along, half width, above axis, below axis, eu, ed, top taper, bottom taper)
        (-0.06, 0.12, 0.06, 0.09, 2.0, 2.0, 0.0, 0.1),
        (0.02, 0.155, 0.07, 0.12, 3.5, 2.0, 0.05, 0.15),
        (0.14, 0.15, 0.055, 0.14, 2.8, 2.0, 0.1, 0.25),
        (0.24, 0.125, 0.05, 0.13, 2.4, 2.0, 0.1, 0.3),
        (0.34, 0.105, 0.045, 0.105, 2.4, 2.2, 0.05, 0.2),
        (0.44, 0.098, 0.045, 0.085, 2.8, 2.4, 0.0, 0.1),
        (0.5, 0.098, 0.052, 0.078, 3.2, 2.8, 0.0, 0.0),
        (0.525, 0.09, 0.046, 0.07, 3.4, 3.0, 0.0, 0.0),
    ]
    st = []
    for s, w, hu, hd, eu, ed, tt, tb in rows:
        st.append(dict(c=poll + d * (s * length / 0.5), a=a, u=u, w=w, hu=hu, hd=hd, eu=eu, ed=ed, tt=tt, tb=tb))
    return st, d, u


def cow(name, coat='braunvieh', graze=False):
    if graze:
        poll, muzzle = V(0, -1.12, 0.8), V(0, -1.28, 0.38)
        neck_rows = [(-0.96, 1.17, 0.95, 0.66), (-1.04, 1.06, 0.88, 0.66), (-1.09, 0.95, 0.8, 0.62)]
    else:
        poll, muzzle = V(0, -1.1, 1.24), V(0, -1.4, 0.9)
        neck_rows = None
    body_st = body_stations()
    if neck_rows:
        for st, (y, zt, zc, zb) in zip(body_st[-3:], neck_rows):
            st['c'] = V(0, y, zc)
            st['hu'], st['hd'] = zt - zc, zc - zb
    parts = []
    body = loft(body_st, 20, caps=(True, True), name='body')
    # Creases: none on the body; the hooks come from the boxy ring.
    subdivide(body, 2)
    parts.append(body)
    head_st, hd, hu = head_stations(poll, muzzle)
    head = loft(head_st, 16, name='head')
    subdivide(head, 2)
    parts.append(head)
    for s in (-1, 1):
        f = loft(leg_stations(s * 0.2, FRONT_LEG), 12, name='leg')
        subdivide(f, 1)
        h = loft(leg_stations(s * 0.21, HIND_LEG), 12, name='leg')
        subdivide(h, 1)
        parts += [f, h]
        parts += hoof(s * 0.2, -0.6, PAINT, '#2a2420')
        parts += hoof(s * 0.21, 0.645, PAINT, '#2a2420')
    # Udder: a full bag between the hind legs, four teats.
    ud = loft([
        dict(c=V(0, 0.3, 0.66), a=X, u=Z, w=0.1, hu=0.06, hd=0.05),
        dict(c=V(0, 0.42, 0.62), a=X, u=Z, w=0.15, hu=0.1, hd=0.1, ed=2.4),
        dict(c=V(0, 0.56, 0.64), a=X, u=Z, w=0.13, hu=0.09, hd=0.08),
        dict(c=V(0, 0.66, 0.72), a=X, u=Z, w=0.07, hu=0.05, hd=0.04),
    ], 12, name='udder')
    subdivide(ud, 1)
    parts.append(ud)
    for tx in (-0.065, 0.065):
        for ty in (0.36, 0.5):
            t = cyl(0.016, 0.075, tx, ty, 0.45, PAINT, '#dcb0a8', verts=6, r2=0.012)
            props.PARTS.remove(t)
            parts.append(t)
    # Tail: hangs from the tail head, a slight curve, a dark switch at the end.
    tail_st = []
    for i, (y, z, r) in enumerate([(0.96, 1.3, 0.035), (1.0, 1.18, 0.03), (1.0, 1.0, 0.025), (0.99, 0.8, 0.02), (0.98, 0.64, 0.018), (0.98, 0.58, 0.03), (0.98, 0.48, 0.034), (0.97, 0.38, 0.015)]):
        tail_st.append(dict(c=V(0, y, z), a=X, u=Y, w=r, hu=r, hd=r))
    tail = loft(tail_st, 8, name='tail')
    subdivide(tail, 1)
    parts.append(tail)
    # Ears: broad leaves out of the poll's sides, drooping a little.
    for s in (-1, 1):
        e = poll + X * s * 0.15 - hu * 0.03 + hd * 0.04
        ear = ball(0.125, e.x + s * 0.1, e.y, e.z - 0.03, sx=1.0, sy=0.28, sz=0.5, col='#ffffff', segs=10, rz=-s * 0.25, ry=s * 0.6)
        props.PARTS.remove(ear)
        parts.append(ear)
        # Horns: short, curving up and out.
        h = poll + X * s * 0.08 + hu * 0.04 - hd * 0.02
        horn = cyl(0.034, 0.21, h.x, h.y, h.z, PAINT, '#ffffff', verts=8, r2=0.007, ry=s * 1.25, rx=-0.55)
        props.PARTS.remove(horn)
        parts.append(horn)
        # Eyes: at the sides of the head, a third of the way down.
        ey = poll + hd * 0.16 + X * s * 0.142 + hu * 0.02
        eye = ball(0.024, ey.x, ey.y, ey.z, sy=0.8, col='#ffffff', segs=8)
        props.PARTS.remove(eye)
        parts.append(eye)
    o = smooth_join(parts, name)
    decimate(o, 3300)
    while o.data.color_attributes:
        o.data.color_attributes.remove(o.data.color_attributes[0])
    props.finish(o, PAINT, '#ffffff', smooth=True)
    hd_axis = hd

    def along_head(q):
        return (q - poll).dot(hd_axis)

    dark_nose = '#2b2622' if coat != 'dun' else '#b98d80'
    base, light, dorsal = {
        'braunvieh': ('#7a6a5a', '#b7aa98', '#c9bfae'),
        'dun': ('#c39a6a', '#e3cfae', '#e8d8bc'),
        'simmental': ('#9b4f28', '#f2eee4', '#9b4f28'),
    }[coat]
    white = '#f2eee4'

    def paint(p):
        q = Vector(p)
        s = along_head(q)
        side = abs(q.x)
        in_head = (q - poll).length < 0.62 and q.y < poll.y + 0.1
        # Eyes, nose, nostrils.
        for sx in (-1, 1):
            ey = poll + hd_axis * 0.16 + X * sx * 0.142 + hu * 0.02
            if (q - ey).length < 0.028:
                return '#141008'
            nz = muzzle + X * sx * 0.045 + hu * 0.02 + hd_axis * 0.02
            if (q - nz).length < 0.028:
                return dark_nose
        if s > 0.47 and (q - muzzle).dot(hd_axis) > -0.04 and (q - muzzle).length < 0.12:
            return dark_nose
        if q.z < 0.09:
            return '#2a2420'
        if coat == 'simmental':
            if in_head or q.z < 0.5 or (side < 0.22 and 0.2 < q.y < 0.66 and q.z < 0.74):
                return white
            n = noise.noise(q * 2.0 + V(3.1, 1.7, 0.4)) + 0.4 * noise.noise(q * 4.5)
            line = 0.8 + 0.12 * noise.noise(q * 3.0)
            return base if q.z > line and n < 0.35 else white
        if in_head and s > 0.4:
            return mix(light, '#ebe5d8', (s - 0.4) * 6)  # pale mealy muzzle
        if in_head and side > 0.17 and q.z > poll.z - 0.12:
            return mix(base, light, 0.5)  # inside of the ears
        # Udder and teats pink, belly and inner legs pale, lower legs dark.
        if 0.2 < q.y < 0.72 and q.z < 0.74 and side < 0.17:
            return '#e2bdb1'
        c = base
        if q.z > 1.2 and side < 0.07 and q.y < 0.95 and not in_head:
            c = mix(c, dorsal, (0.07 - side) / 0.07 * 0.8)  # pale back stripe
        if q.z < 0.8:
            c = mix(c, light, (0.8 - q.z) * 2.2)
        if q.z < 0.4:
            c = mix(c, '#3d332b', (0.4 - q.z) * 2.6)
        return c

    paint_obj(o, paint)
    bake_ao(o, rays=28, dist=0.6, strength=0.75)
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    print(f'{name}: {tris} tris')
    props.PARTS = []
    return o


def paint_obj(o, colour):
    attr = o.data.color_attributes['Col']
    cache = {}
    for loop in o.data.loops:
        h = colour(o.data.vertices[loop.vertex_index].co)
        if h not in cache:
            cache[h] = hexrgb(h)
        attr.data[loop.index].color = cache[h]


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    ca = [int(a[i:i + 2], 16) for i in (1, 3, 5)]
    cb = [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return '#' + ''.join(f'{round(x + (y - x) * t):02x}' for x, y in zip(ca, cb))
