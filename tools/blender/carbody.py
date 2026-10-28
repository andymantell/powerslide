"""Hand-modelled car bodies for vehicles.py: a coarse cage of cross-section
rings (centre top, roof edge, pillar foot, shoulder, door, sill, floor) is
smoothed by Catmull-Clark subdivision with creases along the shoulder and
sill lines, then the wheel arches and door shut lines are cut out of it and
the lamps, grille, bumpers, mirrors and wheel-well liners are added as parts.

Each station of the cage is one slice through the car at a distance u from
the nose: the top centre height, the roof edge (x, z), the pillar foot (x,
z), the belt line (x, z), the widest point of the door (x, z), the sill
top and bottom, and the floor edge. Same axes as vehicles.py (nose +Y).
"""
import math

import bpy
import bmesh
from mathutils import Vector

from vehicles import (Builder, BLACK, CHROME, GREY, HEAD, TAIL, AMBER, RUBBER, PLATE_W, PLATE_Y, INTERIOR, MI,
                      box, cyl, tube, mirrors, handles, wipers, driver, interior, plates, lamp_spec, car_wheels)

RING = 16  # points per ring: 9 down the right side (top centre to floor centre), 7 back up the left


def band_at(i):
    """The band (0 bonnet/roof .. 7 floor) of ring point i: the strip below it."""
    return i if i < 8 else RING - 1 - i


def point_band(i):
    """Which line (0 top .. 8 floor centre) ring point i lies on."""
    return i if i <= 8 else RING - i


def y_of(L, u):
    return L / 2 - u


class Station:
    """One ring of the cage. top: centre z. roof: (x, z) of the roof edge or
    bonnet crease. foot: (x, z) of the pillar foot / top of the side glass.
    belt: (x, z) of the shoulder line. door: (x, z) of the widest point.
    sill: (x, z_top, z_bottom). floor: x of the floor edge, at z_floor."""

    def __init__(self, u, top, roof, foot, belt, door, sill, floor, zfloor=0.2, du=None, cap=False):
        self.u, self.top, self.roof, self.foot, self.belt, self.door, self.sill = u, top, roof, foot, belt, door, sill
        self.floor, self.zfloor, self.cap = floor, zfloor, cap
        # du: per band (0 top .. 7 floor centre), how far back from u the
        # point sits, so a bumper can lead the bonnet lip at the nose.
        self.du = du or {}

    def ring(self, L):
        """16 points round the slice, right side top to bottom then left."""
        r = [
            (0.0, self.top), self.roof, self.foot, self.belt, self.door,
            (self.sill[0], self.sill[1]), (self.sill[0] * 0.96, self.sill[2]), (self.floor, self.zfloor), (0.0, self.zfloor),
        ]
        ys = [y_of(L, self.u + self.du.get(b, 0.0)) for b in range(len(r))]
        pts = [Vector((x, y, z)) for (x, z), y in zip(r, ys)]
        left = [Vector((-x, y, z)) for (x, z), y in reversed(list(zip(r, ys))[1:-1])]
        return pts + left


def cage(stations, L, region):
    """Builds the cage mesh. region(u, band, x) names the material of a face
    whose centre sits at u, x in band j (0 top .. 7 floor). Returns (object,
    per-face material names)."""
    bm = bmesh.new()
    rings = [[bm.verts.new(p) for p in st.ring(L)] for st in stations]
    n = len(rings[0])
    mats = []
    for (s0, r0), (s1, r1) in zip(zip(stations, rings), zip(stations[1:], rings[1:])):
        um = (s0.u + s1.u) / 2
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
            xm = f.calc_center_median().x
            mats.append(region(um, band_at(i), xm))
    # Caps: the nose and tail faces, each a ring shrunk towards its middle
    # and a small polygon closing it (a big n-gon pinches under subdivision).
    for ring_, st, rev in ((rings[0], stations[0], True), (rings[-1], stations[-1], False)):
        c = sum((v.co for v in ring_), Vector()) / len(ring_)
        dy = -0.01 if rev else 0.01
        inner = [bm.verts.new(c + (v.co - c) * 0.3 + Vector((0, dy, 0))) for v in ring_]
        for i in range(n):
            j = (i + 1) % n
            quad = (ring_[i], ring_[j], inner[j], inner[i])
            bm.faces.new(quad if not rev else tuple(reversed(quad)))
            mats.append(region(st.u, 'cap', (ring_[i].co.x + ring_[j].co.x) / 2))
        bm.faces.new(list(reversed(inner)) if rev else inner)
        mats.append(region(st.u, 'cap', 0.0))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('cage')
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new('cage', me)
    bpy.context.scene.collection.objects.link(o)
    return o, mats


def set_creases(o, stations, L, weights):
    """weights(band_a, band_b, u) -> crease for the edge between rings at
    bands a/b running along the car, and weights('ring', band, u) for edges
    across a station."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    layer = bm.edges.layers.float.get('crease_edge') or bm.edges.layers.float.new('crease_edge')
    n = RING
    bm.verts.ensure_lookup_table()
    for e in bm.edges:
        a, b = e.verts
        if max(a.index, b.index) >= len(stations) * n:
            continue  # end cap inner rings
        ba, bb = point_band(a.index % n), point_band(b.index % n)
        ua, ub = stations[a.index // n].u, stations[b.index // n].u
        xm = (a.co.x + b.co.x) / 2
        if abs(ua - ub) < 1e-6:
            e[layer] = weights('ring', min(ba, bb), ua, xm)
        else:
            e[layer] = weights(ba, bb, (ua + ub) / 2, xm)
    bm.to_mesh(o.data)
    bm.free()


def subdivide(o, levels):
    m = o.modifiers.new('sub', 'SUBSURF')
    m.levels = m.render_levels = levels
    m.use_creases = True
    m.boundary_smooth = 'PRESERVE_CORNERS'
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.modifier_apply(modifier='sub')


def cut(o, cutters, material='floor'):
    """Boolean-subtracts each cutter object from o; the faces it makes get
    `material` (one of o's slots)."""
    for c in cutters:
        c.data.materials.append(o.data.materials[o.data.materials.find(material)])
        m = o.modifiers.new('cut', 'BOOLEAN')
        m.operation = 'DIFFERENCE'
        m.solver = 'EXACT'
        m.material_mode = 'TRANSFER'
        m.object = c
        bpy.ops.object.select_all(action='DESELECT')
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.object.modifier_apply(modifier='cut')
        bpy.data.objects.remove(c)


def prim_cyl(r, depth, loc, rot, verts=24):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=verts, location=loc, rotation=rot)
    return bpy.context.active_object


def prim_box(size, loc, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    return o


def add_body(B, o, colours):
    """Adds the body object to the builder, face by face, with its
    per-polygon material names and a colour per material."""
    me = o.data
    vmap = [B.bm.verts.new(v.co.copy()) for v in me.vertices]
    for p in me.polygons:
        m = me.materials[p.material_index].name if me.materials else 'paint'
        f = B.face([vmap[i] for i in p.vertices], {'lamp_head': 'lamp', 'lamp_tail': 'lamp', 'floor': 'detail'}.get(m, m), colours.get(m))
        if f:
            f.smooth = True


def liner(B, x, y, z, r, width, sx):
    """Dark wheel well behind an arch: an inside-out drum, open outwards."""
    o = prim_cyl(r, width, (x - sx * width / 2, y, z), (0, math.pi / 2, 0), 20)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    # Drop the outer cap, flip the rest so it's seen from outside.
    outer = [f for f in bm.faces if len(f.verts) > 4 and (f.calc_center_median().x - x) * sx > -width / 4]
    bmesh.ops.delete(bm, geom=outer, context='FACES')
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(o.data)
    bm.free()
    for p in o.data.polygons:
        p.use_smooth = len(p.vertices) == 4
    B.add_object(o, 'detail', (0.03, 0.03, 0.03))
    bpy.data.objects.remove(o)


# ---------------------------------------------------------------- the saloon
def saloon_stations():
    """A mid-size saloon, 4.75 m. Numbers are metres from the nose."""
    S = Station
    hw = 0.91
    # The end faces stay flat (a flat cap subdivides cleanly); the slope of
    # the nose and tail comes from the station behind each one.
    nose = {b: 0.04 for b in range(9)}
    nose2 = {0: 0.14, 1: 0.13, 2: 0.10, 3: 0.05, 4: 0.0, 5: -0.03, 6: -0.02, 7: 0.0, 8: 0.0}
    tail = {b: -0.04 for b in range(9)}
    tail2 = {0: -0.12, 1: -0.11, 2: -0.09, 3: -0.04, 4: 0.0, 5: 0.03, 6: 0.02, 7: 0.0, 8: 0.0}
    rows = [
        # u, top, roof(x,z), foot(x,z), belt(x,z), door(x,z), sill(x,zt,zb), floor x
        S(0.00, 0.78, (0.30, 0.775), (0.40, 0.77), (0.46, 0.73), (0.48, 0.60), (0.50, 0.40, 0.28), 0.40, du=nose, cap=True),
        S(0.05, 0.80, (0.56, 0.785), (0.72, 0.77), (0.86, 0.76), (0.87, 0.645), (0.83, 0.38, 0.26), 0.56, du=nose2),
        S(0.30, 0.84, (0.60, 0.815), (0.75, 0.80), (0.885, 0.785), (0.895, 0.645), (0.86, 0.38, 0.25), 0.62),
        S(0.70, 0.875, (0.62, 0.845), (0.76, 0.83), (0.90, 0.815), (0.91, 0.60), (0.88, 0.39, 0.25), 0.66),
        S(1.10, 0.91, (0.63, 0.88), (0.77, 0.865), (0.905, 0.85), (0.915, 0.62), (0.885, 0.395, 0.25), 0.68),
        S(1.45, 0.94, (0.70, 0.905), (0.80, 0.895), (0.905, 0.90), (0.915, 0.63), (0.885, 0.40, 0.25), 0.68),
        S(1.55, 1.00, (0.74, 0.985), (0.86, 0.945), (0.905, 0.93), (0.915, 0.63), (0.885, 0.40, 0.25), 0.68),
        S(1.95, 1.26, (0.70, 1.235), (0.78, 1.13), (0.905, 0.97), (0.915, 0.63), (0.885, 0.40, 0.25), 0.68),
        S(2.30, 1.405, (0.66, 1.385), (0.72, 1.33), (0.905, 0.995), (0.915, 0.63), (0.885, 0.40, 0.25), 0.68),
        S(2.75, 1.44, (0.66, 1.42), (0.72, 1.36), (0.905, 1.01), (0.915, 0.63), (0.885, 0.40, 0.25), 0.68),
        S(3.15, 1.43, (0.66, 1.41), (0.72, 1.35), (0.905, 1.03), (0.915, 0.63), (0.885, 0.40, 0.25), 0.68),
        S(3.55, 1.31, (0.70, 1.29), (0.78, 1.19), (0.905, 1.05), (0.915, 0.63), (0.885, 0.40, 0.25), 0.68),
        S(3.95, 1.11, (0.74, 1.095), (0.86, 1.075), (0.905, 1.06), (0.915, 0.63), (0.885, 0.40, 0.25), 0.68),
        S(4.35, 1.085, (0.63, 1.065), (0.77, 1.055), (0.90, 1.05), (0.91, 0.62), (0.88, 0.39, 0.25), 0.66),
        S(4.45, 1.075, (0.62, 1.055), (0.76, 1.045), (0.895, 1.04), (0.905, 0.74), (0.87, 0.385, 0.25), 0.64),
        S(4.60, 1.05, (0.60, 1.03), (0.74, 1.02), (0.875, 1.02), (0.885, 0.885), (0.85, 0.38, 0.25), 0.62),
        S(4.70, 1.02, (0.56, 1.00), (0.70, 0.99), (0.83, 0.99), (0.85, 0.875), (0.81, 0.37, 0.26), 0.56, du=tail2),
        S(4.75, 0.96, (0.30, 0.955), (0.40, 0.95), (0.46, 0.94), (0.48, 0.84), (0.50, 0.38, 0.28), 0.40, du=tail, cap=True),
    ]
    return rows


def spec_saloon2():
    L, W = 4.75, 1.82
    s = dict(kind='car', name='saloon2', L=L, W=W, H=1.44, cage=saloon_stations)
    s['wheels'] = car_wheels(L, 0.88, 1.02, 0.33, 1.56, w=0.22)
    s['windscreen'] = (1.45, 2.30)
    s['rearscreen'] = (3.15, 3.95)
    s['sideglass'] = (1.55, 3.6)
    s['bpillar'] = (2.73, 2.80)
    s['seams'] = [1.62, 2.77, 3.86]
    s['plates'] = (0.50, 0.60)
    s['mirror'] = (1.9, 1.0)
    s['handles'] = [2.45, 3.4]
    s['headlamp'] = (0.30, 0.3)  # band 3 faces up to u 0.30 and out past |x| 0.3
    s['taillamp'] = (0.30, 0.3, 0.93)
    return s


def build_cage_car(s, lod):
    """Builds spec s (with a `cage` station list) into a Builder."""
    L, W = s['L'], s['W']
    hw = W / 2
    ws, rs, sg, bp = s['windscreen'], s['rearscreen'], s['sideglass'], s['bpillar']

    hl, tl = s['headlamp'], s['taillamp']  # (u extent, min |x|) of the lamp zones in band 2

    def region(u, band, x):
        if band == 'cap':
            return 'paint'
        if band == 0:  # roof / bonnet / boot and the screens
            return 'glass' if ws[0] <= u <= ws[1] or rs[0] <= u <= rs[1] else 'paint'
        if band == 1:  # pillars (black) and drip rails
            if ws[0] <= u <= ws[1] or rs[0] <= u <= rs[1] or bp[0] <= u <= bp[1]:
                return 'detail'
            return 'paint'
        if band == 2:  # side glass
            if bp[0] <= u <= bp[1]:
                return 'detail'
            return 'glass' if sg[0] <= u <= sg[1] else 'paint'
        if band == 3:  # the lamps wrap the corners under the shoulder line
            if u <= hl[0] and abs(x) >= hl[1]:
                return 'lamp_head'
            if u >= L - tl[0] and abs(x) >= tl[1]:
                return 'lamp_tail'
            return 'paint'
        if band == 5 and (u < 0.06 or u > L - 0.06):
            return 'detail'  # black bumper lips
        if band >= 6:
            return 'floor'
        return 'paint'

    stations = s['cage']()
    o, mats = cage(stations, L, region)
    # Material slots: paint, trim, glass, detail, lamp (+ floor as detail).
    # Slots: the five game materials, then head and tail lamps apart so the
    # lamp colour can be set after subdivision.
    slots = ['paint', 'trim', 'glass', 'detail', 'lamp', 'lamp_head', 'lamp_tail', 'floor']
    for name in slots:
        o.data.materials.append(bpy.data.materials[name] if name in bpy.data.materials else bpy.data.materials.new(name))
    for p, m in zip(o.data.polygons, mats):
        p.material_index = slots.index(m)

    def along(a, b, u, x):
        if a == 'ring':  # edges round a station
            band = b
            if band == 0 and (abs(u - ws[0]) < 0.01 or abs(u - rs[1]) < 0.01):
                return 0.6  # windscreen base, rear screen base
            if band == 3 and (abs(u - hl[0]) < 0.01 or abs(u - (L - tl[0])) < 0.01) and abs(x) > min(hl[1], tl[1]):
                return 0.9  # lamp ends
            if u < 0.01 or u > L - 0.01:
                return 0.9  # nose and tail faces
            return 0.0
        if a != b:
            return 0.0
        if a == 3:
            return 1.0  # shoulder line
        if a == 5:
            return 0.9  # sill crease
        if a == 6:
            return 1.0  # sill bottom edge
        if a == 1:
            return 0.6 if (u < ws[0] or u > rs[1]) else 0.35  # bonnet/boot crease, drip rail
        if a == 2:
            return 0.7 if sg[0] <= u <= rs[1] else 0.3  # glass top
        if a == 4:
            return 0.9 if (u < hl[0] or u > L - tl[0]) else 0.0  # lamp bottoms
        return 0.0

    set_creases(o, stations, L, along)
    subdivide(o, 2 if lod == 0 else 1)

    # Wheel arches and, at full detail, the door and boot shut lines.
    cutters = []
    for wh in s['wheels']:
        R = wh['r'] + 0.055
        cutters.append(prim_cyl(R, 0.7, (hw - 0.0, y_of(L, wh['u']), wh['z']), (0, math.pi / 2, 0), 28))
        cutters.append(prim_cyl(R, 0.7, (-hw + 0.0, y_of(L, wh['u']), wh['z']), (0, math.pi / 2, 0), 28))
    if lod == 0:
        for su in s.get('seams', []):
            y = y_of(L, su)
            cutters.append(prim_box((2.4, 0.007, 0.78), (0, y, 0.67)))
        cutters.append(prim_box((1.45, 0.007, 0.4), (0, y_of(L, ws[0] - 0.03), 0.95)))  # bonnet shut line
        cutters.append(prim_box((1.5, 0.007, 0.4), (0, y_of(L, rs[1] + 0.03), 1.12)))  # boot lid
    cut(o, cutters)
    B = Builder()
    B.recalc = False
    add_body(B, o, {'paint': None, 'trim': None, 'glass': None, 'detail': BLACK, 'lamp': HEAD, 'lamp_head': HEAD, 'lamp_tail': TAIL, 'floor': BLACK})
    bpy.data.objects.remove(o)
    # Wheel wells.
    for wh in s['wheels']:
        for sx in (-1, 1):
            liner(B, sx * (hw + 0.01), y_of(L, wh['u']), wh['z'], wh['r'] + 0.07, 0.3, sx)
    # Lamps are body faces (band 2 at the ends); amber repeaters at the tail corners.
    yn, yt = y_of(L, 0.0), y_of(L, L)
    for sx in (-1, 1):
        box(B, 'lamp', AMBER, (0.06, 0.1, 0.1), (sx * (hw - 0.03), yt + 0.1, s['taillamp'][2]), 0.01, 1, rot=(0, 0, sx * 0.3))
    # Grille, number plates, fog lamp recesses and exhausts.
    box(B, 'detail', BLACK, (0.80, 0.06, 0.10), (0, yn - 0.03, 0.705), 0.01, 1)
    box(B, 'trim', None, (0.84, 0.03, 0.015), (0, yn - 0.02, 0.76), 0.0)
    box(B, 'trim', None, (0.84, 0.03, 0.015), (0, yn - 0.02, 0.65), 0.0)
    box(B, 'detail', BLACK, (0.76, 0.06, 0.07), (0, yn + 0.03, 0.34), 0.01, 1)  # lower intake
    plates(B, dict(s, platefin=-0.025, platerin=-0.03), lod)
    for sx in (-1, 1):
        box(B, 'detail', BLACK, (0.18, 0.06, 0.06), (sx * 0.6, yn + 0.03, 0.34), 0.01, 1)
        cyl(B, 'detail', (0.3, 0.3, 0.31), 0.035, 0.1, (sx * 0.42, yt - 0.03, 0.25), (math.pi / 2, 0, 0), 10)
    if lod == 0:
        mirrors(B, s, lod, s['mirror'][0], s['mirror'][1])
        handles(B, s, s['handles'], 0.93, lambda u: hw)
        wipers(B, s, ws[0] + 0.06, 0.94)
        interior(B, s, ws[0] + 0.3, rs[1] - 0.3, 0.5, 1.12, hw * 0.78)
        driver(B, s, 2.25, 0.85, 0.38)
    else:
        mirrors(B, s, lod, s['mirror'][0], s['mirror'][1])
        interior(B, s, ws[0] + 0.3, rs[1] - 0.3, 0.5, 1.12, hw * 0.78)
    return B
