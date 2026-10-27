"""Builds the traffic: cars, vans, 4x4s, pickups, lorries, buses, tractors and
motorbikes. Exports src/assets/models/vehicles.glb.

Every vehicle is two meshes, `<type>_lod0` and `<type>_lod1`, made of up to
five named materials that the game swaps for shared, instanced ones:

  paint   body colour, tinted per car in the game
  trim    bumpers, grilles, roof rails, lorry boxes: tinted per car too
  glass   windows
  detail  everything with a fixed colour, held in the vertex colours
  lamp    head and tail lights; vertex colour says which (the game lights them)

Vertex colours also carry baked ambient occlusion, so arches, sills and
gaps darken without any lighting cost. Wheels are not in the body meshes:
they're shared unit-size meshes (`wheel_<style>_lod0/1`, radius 1, width 1,
axle along X) that the game instances for every car and spins. Each
`_lod0` node carries a `meta` extra (JSON) with its size, wheels and lamps.

Car bodies are lofted: a cross-section ring is swept along the car from a
side profile (roof, belt and sill lines) and a plan width, with the wheel
arches cut into the lower ring and the nose and tail closed by a gridded
fascia, so lamps, grilles and number plates are just material zones.

Built Z-up in Blender with the nose towards +Y; the exporter turns that into
three.js Y-up with the nose towards -Z.

  python tools/blender/vehicles.py [only_type] [preview.glb]
"""
import json
import math
import os
import random
import subprocess
import sys

import bpy  # noqa: I001 (bpy must load before bmesh/mathutils)
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'src', 'assets', 'models')

MATS = ['paint', 'trim', 'glass', 'detail', 'lamp']
MI = {n: i for i, n in enumerate(MATS)}

# Fixed colours in the detail material (linear-ish sRGB, darkened by AO later).
BLACK = (0.035, 0.035, 0.038)
RUBBER = (0.02, 0.02, 0.022)
GREY = (0.16, 0.16, 0.17)
STEEL = (0.45, 0.46, 0.48)
CHROME = (0.75, 0.76, 0.78)
PLATE_W = (0.86, 0.86, 0.84)
PLATE_Y = (0.9, 0.7, 0.08)
INTERIOR = (0.05, 0.05, 0.055)
LEATHER = (0.06, 0.055, 0.05)
# Lamp colours: the game tells them apart by green (head > 0.8, tail < 0.2).
HEAD = (1.0, 0.97, 0.9)
TAIL = (1.0, 0.04, 0.03)
AMBER = (1.0, 0.45, 0.02)
SIGN = (1.0, 0.85, 0.3)  # lit taxi sign / bus destination board


def mat(name, colour, rough=0.5, metal=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*colour, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


def make_materials():
    mat('paint', (0.6, 0.08, 0.06), 0.3, 0.4)
    mat('trim', (0.05, 0.05, 0.05), 0.4, 0.3)
    mat('glass', (0.02, 0.03, 0.04), 0.05, 0.8)
    mat('detail', (0.5, 0.5, 0.5), 0.7)
    mat('lamp', (1, 1, 1), 0.2)


# ---------------------------------------------------------------- mesh builder
class Builder:
    """Collects faces with a material and a per-face colour into one bmesh."""

    def __init__(self):
        self.bm = bmesh.new()
        self.col = {}  # face -> rgb
        self.recalc = True

    def verts(self, pts):
        return [self.bm.verts.new(p) for p in pts]

    def face(self, vs, m, colour=None):
        # Skip faces collapsed to a line or point.
        uniq = []
        for v in vs:
            if all((v.co - u.co).length > 1e-6 for u in uniq):
                uniq.append(v)
        if len(uniq) < 3:
            return None
        try:
            f = self.bm.faces.new(uniq)
        except ValueError:
            return None
        f.material_index = MI[m]
        self.col[f] = colour or (1, 1, 1)
        return f

    def add_object(self, obj, m, colour=None, matrix=None):
        """Appends another mesh object's geometry, all in one material."""
        me = obj.data
        vmap = []
        mw = matrix or obj.matrix_world
        for v in me.vertices:
            vmap.append(self.bm.verts.new(mw @ v.co))
        for p in me.polygons:
            f = self.face([vmap[i] for i in p.vertices], m, colour)
            if f:
                f.smooth = p.use_smooth

    def finish(self, name, smooth_angle=35):
        bm = self.bm
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        if self.recalc:
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.normal_update()
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        # Colours per face corner, written from the per-face table (bmesh face
        # handles survive remove_doubles; faces map 1:1 to polygons).
        cols = [self.col.get(f, (1, 1, 1)) for f in bm.faces]
        bm.free()
        attr = me.color_attributes.new('Color', 'FLOAT_COLOR', 'CORNER')
        for p in me.polygons:
            c = cols[p.index]
            for li in p.loop_indices:
                attr.data[li].color = (*c, 1)
        me.color_attributes.active_color = attr
        o = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(o)
        for m in MATS:
            me.materials.append(bpy.data.materials[m])
        for p in me.polygons:
            p.use_smooth = True
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.ops.object.shade_auto_smooth(angle=math.radians(smooth_angle))
        bpy.ops.object.convert(target='MESH')
        return o


def interp(keys, u):
    """Smooth piecewise interpolation through (u, value) keys."""
    if u <= keys[0][0]:
        return keys[0][1]
    for (u0, v0), (u1, v1) in zip(keys, keys[1:]):
        if u <= u1:
            t = (u - u0) / max(1e-9, u1 - u0)
            t = t * t * (3 - 2 * t)
            return v0 + (v1 - v0) * t
    return keys[-1][1]


def lerp(a, b, t):
    return a + (b - a) * t


def clamp(x, a, b):
    return max(a, min(b, x))


# ---------------------------------------------------------------- lofted body
def body(B, s, lod):
    """Lofts a body from spec s into builder B. u runs from the nose (0) to
    the tail (L); Blender y = L/2 - u, so the nose is +Y."""
    L, W = s['L'], s['W']
    hw = W / 2
    top, belt, sill = s['top'], s['belt'], s['sill']
    # The nose and tail must stand tall enough to carry their lamps, or the
    # fascia ends below them and the car has no eyes.
    for end, zones in ((0, s['front']), (L, s['rear'])):
        zl = max((zn[3] for zn in zones if zn[4] == 'lamp' and zn[3] < 2), default=0)
        if zl and interp(top, end) < zl + 0.03:
            lift = lambda prof, h: sorted([(u, max(z, h - abs(u - end) * 0.12)) for u, z in prof if abs(u - end) > 0.02] + [(end, h)])
            top = lift(top, zl + 0.05)
            belt = lift(belt, zl + 0.035)
    plan = s.get('plan', [(0, 1), (L, 1)])
    roofw = s.get('roofw', 0.78) + s.get('roofwiden', 0.05)  # roof half width as a fraction of the body
    bulge = s.get('bulge', 0.035)
    endr = s.get('endr', (0.32, 0.3))  # plan corner radius at nose and tail
    endk = s.get('endk', (0.86, 0.9))  # width left at the very ends
    wheels = s['wheels']
    archr = s.get('archr', 0.05)  # arch clearance over the tyre
    liner = s.get('liner', 0.3)
    glass_rows = s.get('glass', True)

    def halfw(u):
        w = hw * interp(plan, u)
        for end, d in ((0, u), (1, L - u)):
            r = endr[end]
            if d < r:
                t = 1 - d / r
                w *= 1 - (1 - endk[end]) * t ** 2.2
        return w

    def arch(u):
        z = -1.0
        for wh in wheels:
            du = u - wh['u']
            R = wh['r'] + archr
            if abs(du) < R:
                z = max(z, wh['z'] + math.sqrt(R * R - du * du) * (1.0 if abs(du) < R * 0.98 else 0.6))
        return z

    # Stations along the car: denser at the ends, at seams and over the arches.
    step = 0.09 if lod == 0 else 0.32
    us = set()
    n = max(4, int(L / step))
    for i in range(n + 1):
        us.add(round(L * i / n, 4))
    ends = [0.0, 0.015, 0.05, 0.1, 0.17, 0.26, 0.36] if lod == 0 else [0.0, 0.08, 0.25]
    for e in ends:
        us.add(e)
        us.add(round(L - e, 4))
    for wh in wheels:
        R = wh['r'] + archr
        k = 14 if lod == 0 else 5
        for i in range(k + 1):
            a = math.pi * i / k
            us.add(round(wh['u'] - R * math.cos(a), 4))
    seam_faces = set()
    if lod == 0:
        for su in s.get('seams', []):
            us.add(round(su, 4))
            us.add(round(su + 0.012, 4))
            seam_faces.add(round(su, 4))
    for k in ('windscreen', 'rearscreen'):
        if s.get(k):
            us.update(round(x, 4) for x in s[k])
    for a, b in s.get('windows', []):
        us.update((round(a, 4), round(b, 4)))
    for band in s.get('bands', []):
        us.update((round(band[0], 4), round(band[1], 4)))
    us.update(round(x, 4) for x in s.get('stations', []))
    us = sorted(x for x in us if 0 <= x <= L)
    dedup = [us[0]]
    for x in us[1:]:
        if x - dedup[-1] > 0.004:
            dedup.append(x)
    us = dedup

    # Heights of the side rows (below the belt). Lamp bands get their own rows
    # so lamp and grille zones have clean edges.
    side_h = sorted(set(round(h, 3) for h in s.get('rows', [])))
    if lod == 1:
        side_h = side_h[::2]

    def ring(u):
        """One side of the cross-section, bottom centre to roof centre, as
        (x, z, zone) points; zone names the band above that point."""
        w = halfw(u)
        zb = interp(sill, u)
        zs = interp(belt, u)
        zt = max(interp(top, u), zs + 0.02)
        za = arch(u)
        pts = []
        pts.append((0.0, zb + 0.02, 'under'))
        xi = max(0.1, w - liner)
        pts.append((xi, zb, 'under'))
        za_eff = max(zb, za)
        pts.append((xi, za_eff, 'liner' if za > zb else 'under'))
        z_low = max(zb + 0.07, za_eff)
        pts.append((w * 0.965, z_low, 'side'))
        span = zs - zb
        for h in side_h:
            z = max(h, z_low + 0.01)
            z = min(z, zs - 0.01)
            z = max(z, pts[-1][1] + 0.002)  # rows squeezed out over an arch
            t = (z - zb) / max(span, 1e-3)
            x = w * (1 - bulge + bulge * math.sin(math.pi * clamp(t * 0.9 + 0.1, 0, 1)))
            pts.append((x, z, 'side'))
        pts.append((w * (1 - bulge * 0.6), zs - 0.012, 'side'))
        pts.append((w * (1 - bulge * 1.4), zs, 'glassbelt'))
        # Greenhouse amount: 0 over the bonnet and boot, 1 under the roof.
        g = clamp((zt - zs - 0.1) / 0.3, 0, 1)
        if not glass_rows:
            g = 0
        wr = w * roofw
        rnd = s.get('roofround', 0.055)
        cabin = [
            (w * (1 - bulge * 1.4) - 0.015, zs + 0.025),
            (wr + 0.02, zt - 0.1),
            (wr, zt - rnd),
            (wr - rnd * 0.7, zt - 0.012),
            (wr * 0.5, zt),
            (0.0, zt + 0.006),
        ]
        # Over the bonnet and boot: a wide, gently crowned surface.
        bx = [0.95, 0.88, 0.74, 0.56, 0.3, 0.0]
        bz = [0.1, 0.45, 0.72, 0.88, 0.97, 1.0]
        crown = s.get('crown', 0.04)
        zones = ['glass', 'glasstop', 'roofedge', 'roof', 'roof', 'roof']
        for (cx, cz), fx, fz, zn in zip(cabin, bx, bz, zones):
            x = lerp(w * fx, cx, g)
            z = lerp(zs + (zt - zs) * fz + crown * fz, cz, g)
            pts.append((x, z, zn))
        return pts, g

    rings = []
    for u in us:
        pts, g = ring(u)
        rings.append((u, pts, g))
    nr = len(rings[0][1])
    assert all(len(r[1]) == nr for r in rings), 'ring sizes differ'

    def in_ranges(u, ranges):
        return any(a <= u <= b for a, b in ranges)

    windows = s.get('windows', [])
    ws = s.get('windscreen')
    rs = s.get('rearscreen')
    pillar = s.get('pillar', 'paint')

    def zone_mat(zone, um, z, g, side_face=True):
        if zone == 'under':
            return 'detail', BLACK
        if zone == 'liner':
            return 'detail', RUBBER
        if zone in ('side', 'belt'):
            for band in s.get('bands', []):  # bumpers, rubbing strips
                if band[0] <= um <= band[1] and band[2] <= z <= band[3]:
                    return band[4], band[5] if len(band) > 5 else None
            if s.get('livery'):
                hit = s['livery'](um, z)
                if hit:
                    return hit
            return 'paint', None
        if zone == 'glassbelt':
            if g > 0.5 and (in_ranges(um, windows)):
                return 'trim', None
            return 'paint', None
        if zone in ('glass', 'glasstop'):
            if g > 0.3 and in_ranges(um, windows):
                return 'glass', None
            # Beside the windscreen: the screen wraps round to a slim pillar
            # on the roof corner, not a broad painted wedge.
            if g > 0.3 and ws and ws[0] <= um <= ws[1]:
                if zone == 'glass':
                    return 'glass', None
                return pillar, (BLACK if pillar == 'detail' else None)
            if g > 0.3 and rs and rs[0] <= um <= rs[1]:
                return pillar, (BLACK if pillar == 'detail' else None)
            return 'paint', None
        if zone in ('roofedge', 'roof'):
            if ws and ws[0] <= um <= ws[1]:
                return 'glass', None
            if rs and rs[0] <= um <= rs[1]:
                return 'glass', None
            for z0, z1, zm, zc in s.get('roofzones', []):
                if z0 <= um <= z1:
                    return zm, zc
            return (s.get('roofmat', 'paint') if g > 0.5 else 'paint'), None
        return 'paint', None

    # Build both sides. Vertex grid: rings x (2*nr - 2) around (shared centre points).
    grid = []
    for u, pts, g in rings:
        y = L / 2 - u
        right = [(x, y, z) for x, z, _ in pts]
        left = [(-x, y, z) for x, z, _ in reversed(pts[1:-1])]
        loop = B.verts(right + left)
        grid.append(loop)
    M = len(grid[0])

    def zone_of(k):
        # Ring index k: 0..nr-1 right side upward, then back down on the left.
        if k < nr:
            return k
        return nr - 2 - (k - nr)

    for i in range(len(rings) - 1):
        u0, pts0, g0 = rings[i]
        u1, pts1, g1 = rings[i + 1]
        um = (u0 + u1) / 2
        g = (g0 + g1) / 2
        seam = round(u0, 4) in seam_faces
        for k in range(M):
            k1 = (k + 1) % M
            if k == nr - 1 or k1 == 0:
                # Across the roof centre / under the floor between halves.
                pass
            idx = zone_of(k) if k < nr - 1 else zone_of(k1)
            if k >= nr - 1:
                idx = zone_of(k1)
            zone = pts0[min(idx, nr - 1)][2]
            z = (grid[i][k].co.z + grid[i][k1].co.z) / 2
            m, c = zone_mat(zone, um, z, g)
            if seam and zone in ('side', 'belt', 'glassbelt') and m == 'paint':
                m, c = 'detail', BLACK
            if seam and zone in ('roof', 'roofedge') and m == 'paint' and s.get('seamroof'):
                m, c = 'detail', BLACK
            # Lamps that wrap round the corners.
            for lamp in s.get('lamps', []):
                if lamp['u0'] <= um <= lamp['u1'] and lamp['z0'] <= z <= lamp['z1'] and zone in ('side', 'belt'):
                    m, c = 'lamp', lamp['c']
            verts = [grid[i][k], grid[i][k1], grid[i + 1][k1], grid[i + 1][k]]
            B.face(verts, m, c)

    # Fascias: grid across each end, sharing the end rings' vertices.
    for end in (0, 1):
        loop = grid[0] if end == 0 else grid[-1]
        u, pts, g = rings[0] if end == 0 else rings[-1]
        cols = s.get('fasciacols', [0.82, 0.62, 0.42, 0.2, 0.0]) if lod == 0 else [0.6, 0.0]
        # Row r: right vertex loop[r], left vertex loop[M - r] (r = 1..nr-2).
        rows = []
        for r in range(nr):
            if r == 0 or r == nr - 1:
                rows.append([loop[r]])
                continue
            vr = loop[r]
            vl = loop[M - r]
            row = [vr]
            # Interior points between the two ring vertices.
            fr = [c / cols[0] if cols[0] else 0 for c in cols]
            inner = fr[1:] + [-f for f in reversed(fr[1:-1])] if fr[-1] == 0 else fr[1:] + [-f for f in reversed(fr[1:])]
            x0 = vr.co.x
            for f in inner:
                row.append(B.bm.verts.new((x0 * f, vr.co.y, vr.co.z)))
            row.append(vl)
            rows.append(row)
        zone_spec = s['front'] if end == 0 else s['rear']
        for r in range(nr - 1):
            a, b = rows[r], rows[r + 1]
            z = (a[0].co.z + b[0].co.z) / 2
            if len(a) == 1 or len(b) == 1:
                row = b if len(a) == 1 else a
                pole = a[0] if len(a) == 1 else b[0]
                for j in range(len(row) - 1):
                    xm = (row[j].co.x + row[j + 1].co.x) / 2
                    m, c = fascia_mat(zone_spec, abs(xm) / max(1e-3, abs(row[0].co.x)), z, row[0].co.x)
                    vs = [pole, row[j], row[j + 1]] if len(a) == 1 else [row[j], row[j + 1], pole]
                    if end == 0:
                        vs = list(reversed(vs))
                    B.face(vs, m, c)
                continue
            for j in range(len(a) - 1):
                xm = (a[j].co.x + a[j + 1].co.x) / 2
                m, c = fascia_mat(zone_spec, abs(xm) / max(1e-3, abs(a[0].co.x)), z, a[0].co.x)
                vs = [a[j], a[j + 1], b[j + 1], b[j]]
                if end == 0:
                    vs = list(reversed(vs))
                B.face(vs, m, c)
    return rings


def fascia_mat(spec, xf, z, hw):
    """Material for a fascia cell at |x|/halfwidth xf and height z."""
    for zn in spec:
        x0, x1, z0, z1 = zn[0], zn[1], zn[2], zn[3]
        if x0 <= xf <= x1 and z0 <= z <= z1:
            return zn[4], (zn[5] if len(zn) > 5 else None)
    return 'paint', None


# ---------------------------------------------------------------- primitives
def box(B, m, c, size, loc, bevel=0.0, segs=1, rot=(0, 0, 0), smooth=False):
    """A (bevelled) box added straight into builder B."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel > 0:
        mod = o.modifiers.new('bev', 'BEVEL')
        mod.width = bevel
        mod.segments = segs
        mod.limit_method = 'NONE'
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.ops.object.convert(target='MESH')
    if smooth:
        for p in o.data.polygons:
            p.use_smooth = True
    B.add_object(o, m, c)
    bpy.data.objects.remove(o)


def cyl(B, m, c, r, depth, loc, rot=(0, 0, 0), verts=12, r2=None, smooth=True):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=verts, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=depth, vertices=verts, location=loc, rotation=rot)
    o = bpy.context.active_object
    if smooth:
        for p in o.data.polygons:
            p.use_smooth = len(p.vertices) == 4
    B.add_object(o, m, c)
    bpy.data.objects.remove(o)


def sphere(B, m, c, r, loc, scale=(1, 1, 1), segs=12, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=segs, ring_count=rings)
    o = bpy.context.active_object
    o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    for p in o.data.polygons:
        p.use_smooth = True
    B.add_object(o, m, c)
    bpy.data.objects.remove(o)


def tube(B, m, c, pts, r, verts=8):
    """A tube through a polyline of points (frames, bars, exhausts)."""
    for a, b in zip(pts, pts[1:]):
        a, b = Vector(a), Vector(b)
        d = b - a
        mid = (a + b) / 2
        q = d.to_track_quat('Z', 'Y')
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d.length + r * 0.8, vertices=verts, location=mid)
        o = bpy.context.active_object
        o.rotation_mode = 'QUATERNION'
        o.rotation_quaternion = q
        bpy.ops.object.transform_apply(rotation=True)
        for p in o.data.polygons:
            p.use_smooth = len(p.vertices) == 4
        B.add_object(o, m, c)
        bpy.data.objects.remove(o)


def limb(B, m, c, a, b, rx, ry, seg=(10, 7)):
    """An ellipsoid spanning a..b (cross-section radii rx across, ry deep)."""
    a, b = Vector(a), Vector(b)
    d = b - a
    half = d.length / 2 + min(rx, ry) * 0.6
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=(0, 0, 0), segments=seg[0], ring_count=seg[1])
    o = bpy.context.active_object
    o.scale = (rx, ry, half)
    bpy.ops.object.transform_apply(scale=True)
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = d.to_track_quat('Z', 'Y')
    o.location = (a + b) / 2
    bpy.ops.object.transform_apply(rotation=True, location=True)
    for p in o.data.polygons:
        p.use_smooth = True
    B.add_object(o, m, c)
    bpy.data.objects.remove(o)


def y_of(s, u):
    return s['L'] / 2 - u


# ---------------------------------------------------------------- shared details
def plates(B, s, lod, uk=False):
    """Number plates front and rear, on the fascia."""
    L = s['L']
    pf, pr = s.get('plates', (0.45, 0.55))
    if pf and getattr(s.get('front'), 'plate', None):
        pf = s['front'].plate
    w, h = (0.52, 0.11)
    if pf:
        box(B, 'detail', PLATE_W, (w, 0.015, h), (0, L / 2 + 0.005 - s.get('platefin', 0.0), pf), 0.004 if lod == 0 else 0)
    if pr:
        box(B, 'detail', PLATE_Y, (w, 0.015, h), (0, -L / 2 - 0.005 + s.get('platerin', 0.0), pr), 0.004 if lod == 0 else 0)


def mirrors(B, s, lod, u, z, out=0.13, m='paint'):
    for sx in (-1, 1):
        x = s['W'] / 2 * sx
        y = y_of(s, u)
        if lod == 0:
            box(B, m, None, (out, 0.06, 0.1), (x + sx * out * 0.35, y, z + 0.04), 0.02, 2)
            box(B, 'glass', None, (out * 0.8, 0.01, 0.08), (x + sx * out * 0.38, y - 0.032, z + 0.04))
            box(B, 'detail', BLACK, (0.05, 0.04, 0.03), (x - sx * 0.01, y + 0.01, z))
        else:
            box(B, m, None, (out, 0.06, 0.1), (x + sx * out * 0.35, y, z + 0.04))


def handles(B, s, us, z, w_at):
    for u in us:
        for sx in (-1, 1):
            box(B, 'trim', None, (0.02, 0.16, 0.035), (sx * (w_at(u) + 0.003), y_of(s, u), z), 0.008, 1)


def roof_rails(B, s, u0, u1, z, x):
    for sx in (-1, 1):
        tube(B, 'trim', None, [(sx * x, y_of(s, u0), z - 0.02), (sx * x, y_of(s, u0 + 0.12), z + 0.04),
                                (sx * x, y_of(s, u1 - 0.12), z + 0.04), (sx * x, y_of(s, u1), z - 0.02)], 0.018, 6)


def wipers(B, s, u, z):
    for x in (-0.35, 0.2):
        box(B, 'detail', BLACK, (0.5, 0.018, 0.012), (x, y_of(s, u), z), rot=(0, 0, 0.1))


def driver(B, s, u, z, x):
    """A shadowy driver behind the glass: head and shoulders."""
    y = y_of(s, u)
    sphere(B, 'detail', INTERIOR, 0.1, (x, y, z + 0.32), (1, 1, 1.15), 8, 6)
    box(B, 'detail', INTERIOR, (0.42, 0.24, 0.32), (x, y, z), 0.06, 1)


def interior(B, s, u0, u1, z0, z1, w):
    """A dark interior block so the cabin isn't hollow through the glass."""
    box(B, 'detail', INTERIOR, (w * 2 - 0.12, u1 - u0, z1 - z0), (0, y_of(s, (u0 + u1) / 2), (z0 + z1) / 2))


# ---------------------------------------------------------------- AO bake
def bake_ao(obj, wheels, rays=24, dist=0.9, strength=0.6):
    """Multiplies each face corner's colour by ambient occlusion, sampled per
    vertex against the body and its wheels."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    occ = bmesh.new()
    occ.from_mesh(me)
    for wh in wheels:
        r, w = wh['r'], wh['w']
        for sx in ((-1, 1) if not wh.get('centre') else (0,)):
            m = bmesh.ops.create_cone(occ, cap_ends=True, segments=12, radius1=r, radius2=r, depth=w)
            x = sx * wh['x']
            bmesh.ops.rotate(occ, verts=m['verts'], cent=(0, 0, 0), matrix=__import__('mathutils').Matrix.Rotation(math.pi / 2, 3, 'Y'))
            bmesh.ops.translate(occ, verts=m['verts'], vec=(x, wh['y'], wh['z']))
    # Ground plane.
    gv = [occ.verts.new(p) for p in ((-20, -20, 0), (20, -20, 0), (20, 20, 0), (-20, 20, 0))]
    occ.faces.new(gv)
    tree = BVHTree.FromBMesh(occ)
    rng = random.Random(3)
    dirs = []
    for i in range(rays):
        # Cosine-weighted hemisphere (z up), rotated per normal below.
        a = 2 * math.pi * (i + rng.random()) / rays
        r = math.sqrt((i + 0.5) / rays)
        dirs.append(Vector((math.cos(a) * r, math.sin(a) * r, math.sqrt(max(0, 1 - r * r)))))
    bm.verts.ensure_lookup_table()
    ao = []
    for v in bm.verts:
        n = v.normal if v.normal.length > 0.5 else Vector((0, 0, 1))
        q = Vector((0, 0, 1)).rotation_difference(n)
        hit = 0.0
        o = v.co + n * 0.008
        for d in dirs:
            dd = q @ d
            loc, _, _, h = tree.ray_cast(o, dd, dist)
            if loc is not None:
                hit += 1 - (h / dist) ** 2
        ao.append(1 - strength * hit / rays)
    occ.free()
    attr = me.color_attributes['Color']
    for p in me.polygons:
        for li, vi in zip(p.loop_indices, p.vertices):
            c = attr.data[li].color
            k = ao[vi] if p.material_index != MI['lamp'] else 1.0
            k = max(0.18, k) ** 1.1
            attr.data[li].color = (c[0] * k, c[1] * k, c[2] * k, 1)
    bm.free()


# ---------------------------------------------------------------- wheels
def wheel_mesh(style, lod):
    """Unit wheel: radius 1, width 1, axle along X, centred. The rim is trim
    (tinted per car); the tyre is detail."""
    B = Builder()
    B.recalc = False
    seg = 28 if lod == 0 else 12
    if style == 'bike':
        rim_r, prof = 0.78, [(0.0, 0.78), (0.22, 0.86), (0.4, 0.95), (0.5, 1.0)]
    elif style in ('truck', 'tractor'):
        rim_r, prof = 0.55, [(0.0, 0.55), (0.06, 0.6), (0.1, 0.9), (0.2, 0.98), (0.5, 1.0)]
    else:
        rim_r, prof = 0.64, [(0.0, 0.64), (0.06, 0.68), (0.1, 0.86), (0.22, 0.97), (0.5, 1.0)]
    # Tyre: lathe the profile (x across, r) round the axle, both halves.
    prof2 = [(x - 0.5, r) for x, r in prof] + [(0.5 - x, r) for x, r in reversed(prof[:-1])]
    if lod == 1:
        prof2 = prof2[::2] + ([prof2[-1]] if len(prof2) % 2 == 0 else [])
    lugs = style == 'tractor'
    rows = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        row = []
        for x, r in prof2:
            rr = r
            if lugs and r > 0.95 and lod == 0:
                # Chevron lugs on tractor tyres.
                ph = (a * seg / (2 * math.pi) + abs(x) * 3) % 1
                rr = r + (0.06 if ph < 0.5 else 0)
            row.append((x, math.cos(a) * rr, math.sin(a) * rr))
        rows.append(B.verts(row))
    for i in range(seg):
        a, b = rows[i], rows[(i + 1) % seg]
        for j in range(len(a) - 1):
            B.face([a[j], a[j + 1], b[j + 1], b[j]], 'detail', RUBBER)
    # Rim faces on both sides.
    for sx in (-1, 1):
        x_out = sx * 0.42
        x_in = sx * 0.3
        c = Vector((x_in, 0, 0))
        n = seg
        outer = B.verts([(sx * 0.5, math.cos(2 * math.pi * i / n) * rim_r, math.sin(2 * math.pi * i / n) * rim_r) for i in range(n)])
        lip = B.verts([(x_out, math.cos(2 * math.pi * i / n) * rim_r * 0.97, math.sin(2 * math.pi * i / n) * rim_r * 0.97) for i in range(n)])
        for i in range(n):
            f = [outer[i], outer[(i + 1) % n], lip[(i + 1) % n], lip[i]]
            B.face(f if sx > 0 else list(reversed(f)), 'trim')
        if style == 'bike':
            # Spoked: a thin hub and spoke bars.
            hub = B.verts([(sx * 0.15, math.cos(2 * math.pi * i / n) * 0.12, math.sin(2 * math.pi * i / n) * 0.12) for i in range(n)])
            centre = B.verts([(sx * 0.18, 0, 0)])[0]
            for i in range(n):
                f = [hub[i], hub[(i + 1) % n], centre]
                B.face(f if sx > 0 else list(reversed(f)), 'trim')
            if sx > 0 and lod == 0:
                for k in range(5):
                    a = 2 * math.pi * k / 5
                    tube(B, 'trim', None, [(0.08, math.cos(a) * 0.1, math.sin(a) * 0.1), (0.08, math.cos(a + 0.3) * rim_r * 0.96, math.sin(a + 0.3) * rim_r * 0.96)], 0.035, 5)
                    tube(B, 'trim', None, [(-0.08, math.cos(a) * 0.1, math.sin(a) * 0.1), (-0.08, math.cos(a + 0.3) * rim_r * 0.96, math.sin(a + 0.3) * rim_r * 0.96)], 0.035, 5)
            continue
        # Dish: rings from the lip in to the hub, with spoke windows on alloys.
        spokes = {'alloy': 5, 'alloy2': 10, 'steel': 0, 'van': 0, 'truck': 0, 'tractor': 0}[style]
        radii = [rim_r * 0.97, rim_r * 0.82, rim_r * 0.45, rim_r * 0.22]
        depth = [x_out, x_in + sx * 0.02, x_in + sx * 0.09, x_in + sx * 0.12]
        if style in ('truck', 'tractor'):
            depth = [x_out, x_in - sx * 0.05, x_in - sx * 0.05, x_in]
        prev = lip
        for k in range(1, len(radii)):
            ring = B.verts([(depth[k], math.cos(2 * math.pi * i / n) * radii[k], math.sin(2 * math.pi * i / n) * radii[k]) for i in range(n)])
            for i in range(n):
                m, col = 'trim', None
                if spokes and k == 2 and lod == 0:
                    # Window between spokes: dark, recessed.
                    ph = (i + 0.5) / n * spokes % 1
                    if 0.22 < ph < 0.78:
                        m, col = 'detail', BLACK
                if style == 'tractor' and k == 1:
                    m, col = 'trim', None
                f = [prev[i], prev[(i + 1) % n], ring[(i + 1) % n], ring[i]]
                B.face(f if sx > 0 else list(reversed(f)), m, col)
            prev = ring
        centre = B.verts([(depth[-1] + sx * 0.02, 0, 0)])[0]
        for i in range(n):
            f = [prev[i], prev[(i + 1) % n], centre]
            B.face(f if sx > 0 else list(reversed(f)), 'trim' if style != 'truck' else 'detail', None if style != 'truck' else GREY)
        if style in ('steel', 'van', 'truck') and lod == 0:
            # Wheel nuts.
            for k in range(5 if style != 'truck' else 8):
                a = 2 * math.pi * k / (5 if style != 'truck' else 8)
                cyl(B, 'detail', CHROME, 0.035, 0.04, (depth[-1] + sx * 0.03, math.cos(a) * 0.15, math.sin(a) * 0.15), (0, math.pi / 2, 0), 6)
    o = B.finish(f'wheel_{style}_lod{lod}', 40)
    return o


# ---------------------------------------------------------------- vehicle specs
def car_wheels(L, front_u, rear_u, r, track, z=None, w=0.2):
    z = r if z is None else z
    return [{'u': front_u, 'r': r, 'z': z, 'w': w, 'x': track / 2}, {'u': L - rear_u, 'r': r, 'z': z, 'w': w, 'x': track / 2}]


def lamp_spec(u0, u1, z0, z1, c):
    return {'u0': u0, 'u1': u1, 'z0': z0, 'z1': z1, 'c': c}


class Zones(list):
    """Fascia zones, plus where the number plate goes (plate z)."""
    plate = None


def std_front(lamp_z, grille_z, bumper_z, intake=True, lamp_x=0.46, tall=False):
    """Fascia zones: (x0, x1, z0, z1, material, colour) as fractions of half
    width. Lamps joined by a slim grille, a body-colour bumper carrying the
    plate, and a lower intake with corner vents."""
    gz0 = grille_z[0] if tall else max(grille_z[0], lamp_z[0] + 0.015)
    z = Zones([
        (lamp_x, 1.01, lamp_z[0], lamp_z[1], 'lamp', HEAD),
        (0.0, lamp_x, gz0, lamp_z[1] - 0.012, 'trim', None),
        (0.0, 0.58, 0.19, bumper_z - 0.04, 'detail', BLACK) if intake else (0, 0, 9, 9, 'paint'),
        (0.74, 0.93, 0.21, bumper_z - 0.06, 'detail', BLACK) if intake else (0, 0, 9, 9, 'paint'),
        (0.0, 1.01, 0.0, 0.18, 'detail', BLACK),
    ])
    z.plate = bumper_z - 0.12 if tall else (bumper_z + lamp_z[0]) / 2
    return z


def std_rear(lamp_z, bumper_z, lamp_x=0.6, dark=None):
    z = [
        (lamp_x, 1.01, lamp_z[0], lamp_z[1], 'lamp', TAIL),
        (0.0, 1.01, 0.0, bumper_z, 'detail', BLACK),
    ]
    if dark:
        z.insert(0, dark)
    return z


def spec_hatch():
    L, W = 4.05, 1.76
    r = 0.31
    s = dict(kind='car', name='hatch', L=L, W=W, H=1.47)
    s['wheels'] = car_wheels(L, 0.8, 0.68, r, 1.52)
    s['top'] = [(0, 0.8), (0.12, 0.85), (0.5, 0.91), (0.95, 0.98), (1.85, 1.42), (2.15, 1.47), (3.3, 1.45), (3.72, 1.38), (3.98, 1.08), (4.05, 1.0)]
    s['belt'] = [(0, 0.78), (0.15, 0.83), (0.95, 0.95), (1.8, 0.98), (3.5, 1.02), (3.95, 1.0), (4.05, 0.98)]
    s['sill'] = [(0, 0.24), (0.3, 0.2), (L - 0.3, 0.2), (L, 0.26)]
    s['plan'] = [(0, 0.9), (0.5, 0.97), (1.2, 1), (3.2, 1), (L, 0.94)]
    s['roofw'] = 0.8
    s['windscreen'] = (0.97, 1.84)
    s['rearscreen'] = (3.66, 3.96)
    s['windows'] = [(1.9, 2.62), (2.7, 3.38)]
    s['seams'] = [0.95, 2.66, 3.42]
    s['rows'] = [0.35, 0.5, 0.63, 0.75, 0.86]
    s['front'] = std_front((0.63, 0.75), (0.42, 0.63), 0.36)
    s['rear'] = std_rear((0.82, 0.96), 0.42, 0.55)
    s['lamps'] = [lamp_spec(0, 0.2, 0.63, 0.75, HEAD), lamp_spec(L - 0.1, L, 0.82, 0.96, TAIL)]
    s['bands'] = [(0, 0.3, 0.2, 0.36, 'detail', BLACK), (L - 0.3, L, 0.2, 0.42, 'detail', BLACK)]
    s['plates'] = (0.44, 0.58)
    s['mirror'] = (1.95, 0.99)
    s['handles'] = [2.3, 3.08]
    s['rails'] = None
    s['spoiler'] = True
    return s


def spec_city():
    s = spec_hatch()
    L, W = 3.6, 1.66
    s.update(name='city', L=L, W=W, H=1.5)
    s['wheels'] = car_wheels(L, 0.66, 0.55, 0.29, 1.44)
    s['top'] = [(0, 0.78), (0.1, 0.83), (0.4, 0.88), (0.75, 0.95), (1.55, 1.46), (1.85, 1.52), (3.0, 1.49), (3.35, 1.42), (3.55, 1.1), (3.6, 1.02)]
    s['belt'] = [(0, 0.76), (0.12, 0.8), (0.75, 0.93), (1.6, 0.97), (3.2, 1.0), (3.6, 0.97)]
    s['windscreen'] = (0.77, 1.52)
    s['rearscreen'] = (3.3, 3.54)
    s['windows'] = [(1.58, 2.3), (2.38, 3.04)]
    s['seams'] = [0.75, 2.34, 3.08]
    s['rear'] = std_rear((0.85, 1.05), 0.42, 0.55)
    s['lamps'] = [lamp_spec(0, 0.18, 0.63, 0.75, HEAD), lamp_spec(L - 0.1, L, 0.85, 1.05, TAIL)]
    s['bands'] = [(0, 0.25, 0.2, 0.34, 'detail', BLACK), (L - 0.25, L, 0.2, 0.4, 'detail', BLACK)]
    s['mirror'] = (1.62, 0.98)
    s['handles'] = [2.05, 2.78]
    s['roofmat'] = 'paint'
    return s


def spec_saloon():
    L, W = 4.75, 1.82
    r = 0.33
    s = dict(kind='car', name='saloon', L=L, W=W, H=1.44)
    s['wheels'] = car_wheels(L, 0.88, 1.02, r, 1.58)
    s['top'] = [(0, 0.74), (0.12, 0.8), (0.6, 0.9), (1.45, 1.0), (2.3, 1.4), (2.6, 1.44), (3.25, 1.42), (3.95, 1.08), (4.5, 1.04), (4.75, 0.98)]
    s['belt'] = [(0, 0.72), (0.15, 0.78), (1.45, 0.97), (2.3, 1.0), (3.9, 1.05), (4.6, 1.03), (4.75, 0.98)]
    s['sill'] = [(0, 0.25), (0.3, 0.2), (L - 0.3, 0.2), (L, 0.28)]
    s['plan'] = [(0, 0.86), (0.5, 0.97), (1.3, 1), (3.6, 1), (L, 0.93)]
    s['roofw'] = 0.79
    s['windscreen'] = (1.47, 2.28)
    s['rearscreen'] = (3.3, 3.92)
    s['windows'] = [(2.34, 3.06), (3.12, 3.7)]
    s['seams'] = [1.45, 3.09, 3.95]
    s['seamroof'] = True
    s['rows'] = [0.36, 0.5, 0.62, 0.74, 0.84, 0.94]
    s['front'] = std_front((0.62, 0.74), (0.5, 0.62), 0.36)
    s['rear'] = std_rear((0.82, 0.96), 0.45, 0.5)
    s['lamps'] = [lamp_spec(0, 0.22, 0.62, 0.74, HEAD), lamp_spec(L - 0.16, L, 0.82, 0.98, TAIL)]
    s['bands'] = [(0, 0.3, 0.2, 0.33, 'detail', BLACK), (L - 0.3, L, 0.2, 0.42, 'detail', BLACK)]
    s['plates'] = (0.44, 0.6)
    s['mirror'] = (2.36, 0.99)
    s['handles'] = [2.75, 3.5]
    return s


def spec_estate():
    s = spec_saloon()
    L = 4.8
    s.update(name='estate', L=L, H=1.5)
    s['wheels'] = car_wheels(L, 0.88, 1.02, 0.33, 1.58)
    s['top'] = [(0, 0.74), (0.12, 0.8), (0.6, 0.9), (1.45, 1.0), (2.3, 1.42), (2.6, 1.47), (4.35, 1.44), (4.64, 1.36), (4.76, 1.08), (4.8, 1.0)]
    s['belt'] = [(0, 0.72), (0.15, 0.78), (1.45, 0.97), (2.3, 1.0), (4.6, 1.05), (4.8, 1.02)]
    s['rearscreen'] = (4.6, 4.76)
    s['windows'] = [(2.34, 3.06), (3.12, 3.75), (3.83, 4.48)]
    s['seams'] = [1.45, 3.09, 3.79, 4.66]
    s['seamroof'] = False
    s['rear'] = std_rear((0.86, 1.02), 0.45, 0.55)
    s['lamps'] = [lamp_spec(0, 0.22, 0.62, 0.74, HEAD), lamp_spec(L - 0.12, L, 0.86, 1.04, TAIL)]
    s['rails'] = (2.3, 4.5)
    return s


def spec_coupe():
    L, W = 4.45, 1.85
    s = dict(kind='car', name='coupe', L=L, W=W, H=1.28)
    s['wheels'] = car_wheels(L, 0.92, 0.8, 0.33, 1.6)
    s['top'] = [(0, 0.66), (0.12, 0.71), (0.6, 0.78), (1.45, 0.87), (2.3, 1.24), (2.6, 1.28), (3.1, 1.23), (3.95, 0.96), (4.35, 0.93), (4.45, 0.88)]
    s['belt'] = [(0, 0.64), (0.15, 0.69), (1.45, 0.86), (2.3, 0.9), (3.9, 0.94), (4.45, 0.88)]
    s['sill'] = [(0, 0.2), (0.3, 0.16), (L - 0.3, 0.16), (L, 0.24)]
    s['plan'] = [(0, 0.84), (0.6, 0.97), (1.4, 1), (3.2, 1.0), (L, 0.92)]
    s['roofw'] = 0.72
    s['windscreen'] = (1.47, 2.26)
    s['rearscreen'] = (3.14, 3.9)
    s['windows'] = [(2.32, 3.08)]
    s['seams'] = [1.45, 3.12]
    s['seamroof'] = True
    s['rows'] = [0.3, 0.44, 0.54, 0.64, 0.76]
    s['front'] = std_front((0.54, 0.64), (0.3, 0.52), 0.3, lamp_x=0.5)
    s['rear'] = std_rear((0.7, 0.84), 0.38, 0.45)
    s['lamps'] = [lamp_spec(0, 0.24, 0.54, 0.64, HEAD), lamp_spec(L - 0.18, L, 0.7, 0.86, TAIL)]
    s['bands'] = [(0, 0.3, 0.16, 0.28, 'detail', BLACK), (L - 0.3, L, 0.16, 0.34, 'detail', BLACK)]
    s['plates'] = (0.4, 0.55)
    s['mirror'] = (2.33, 0.9)
    s['handles'] = [2.85]
    s['spoiler'] = 'boot'
    s['pillar'] = 'paint'
    return s


def spec_suv():
    L, W = 4.6, 1.88
    r = 0.37
    s = dict(kind='car', name='suv', L=L, W=W, H=1.7)
    s['wheels'] = car_wheels(L, 0.92, 0.88, r, 1.62)
    s['top'] = [(0, 0.98), (0.12, 1.03), (0.5, 1.08), (1.25, 1.16), (2.05, 1.64), (2.35, 1.7), (4.1, 1.67), (4.45, 1.58), (4.57, 1.22), (4.6, 1.14)]
    s['belt'] = [(0, 0.96), (0.15, 1.01), (1.25, 1.13), (2.0, 1.16), (4.3, 1.2), (4.6, 1.16)]
    s['sill'] = [(0, 0.38), (0.35, 0.32), (L - 0.35, 0.32), (L, 0.42)]
    s['plan'] = [(0, 0.9), (0.5, 0.98), (1.2, 1), (3.6, 1), (L, 0.96)]
    s['roofw'] = 0.82
    s['windscreen'] = (1.27, 2.02)
    s['rearscreen'] = (4.42, 4.57)
    s['windows'] = [(2.1, 2.9), (2.98, 3.64), (3.72, 4.28)]
    s['seams'] = [1.25, 2.94, 3.68, 4.5]
    s['rows'] = [0.45, 0.6, 0.72, 0.86, 0.98, 1.06]
    s['front'] = std_front((0.86, 0.98), (0.62, 0.86), 0.56)
    s['rear'] = std_rear((0.98, 1.14), 0.56, 0.55)
    s['lamps'] = [lamp_spec(0, 0.2, 0.86, 0.98, HEAD), lamp_spec(L - 0.12, L, 0.98, 1.15, TAIL)]
    # Black cladding round the arches and sills.
    s['bands'] = [(0, L, 0.3, 0.46, 'detail', GREY)]
    s['plates'] = (0.56, 0.72)
    s['mirror'] = (2.1, 1.18)
    s['handles'] = [2.45, 3.25]
    s['rails'] = (2.1, 4.3)
    s['archr'] = 0.1
    return s


def spec_utility():
    """Boxy farm 4x4: upright screen, flat sides, spare wheel on the back."""
    L, W = 4.2, 1.79
    r = 0.4
    s = dict(kind='car', name='utility', L=L, W=W, H=1.98)
    s['wheels'] = car_wheels(L, 0.66, 0.8, r, 1.5)
    s['top'] = [(0, 1.0), (0.06, 1.12), (1.15, 1.17), (1.35, 1.2), (1.48, 1.92), (1.6, 1.97), (4.15, 1.97), (4.2, 1.9)]
    s['belt'] = [(0, 0.98), (0.06, 1.1), (1.2, 1.17), (1.5, 1.22), (4.2, 1.22)]
    s['sill'] = [(0, 0.48), (0.3, 0.45), (L - 0.3, 0.45), (L, 0.5)]
    s['plan'] = [(0, 0.92), (0.3, 0.97), (1.2, 1), (L, 1)]
    s['endr'] = (0.12, 0.08)
    s['endk'] = (0.92, 0.96)
    s['bulge'] = 0.012
    s['roofw'] = 0.9
    s['roofround'] = 0.04
    s['crown'] = 0.0
    s['windscreen'] = (1.37, 1.47)
    s['rearscreen'] = None
    s['windows'] = [(1.55, 2.35), (2.45, 3.2), (3.3, 4.12)]
    s['seams'] = [1.4, 2.4, 3.25]
    s['seamroof'] = True
    s['rows'] = [0.6, 0.8, 0.98, 1.1]
    s['front'] = [(0.6, 0.86, 0.86, 1.04, 'lamp', HEAD), (0.0, 0.6, 0.7, 1.08, 'trim', None), (0.0, 1.01, 0.0, 0.62, 'detail', BLACK)]
    s['rear'] = [(0.82, 1.01, 0.72, 0.98, 'lamp', TAIL), (0.0, 1.01, 0.0, 0.6, 'detail', BLACK), (0.0, 0.7, 1.4, 1.85, 'glass', None)]
    s['lamps'] = []
    s['bands'] = [(0, L, 0.42, 0.56, 'detail', BLACK)]
    s['plates'] = (0.62, 0.68)
    s['mirror'] = (1.45, 1.25)
    s['handles'] = [2.2, 3.0]
    s['archr'] = 0.06
    s['liner'] = 0.32
    s['spare'] = True
    s['bullbar'] = True
    s['roofmat'] = 'trim'
    return s


def spec_pickup():
    L, W = 5.3, 1.86
    r = 0.38
    s = dict(kind='car', name='pickup', L=L, W=W, H=1.82)
    s['wheels'] = car_wheels(L, 0.92, 1.2, r, 1.58)
    s['top'] = [(0, 1.1), (0.12, 1.15), (1.3, 1.24), (2.0, 1.76), (2.25, 1.8), (3.2, 1.78), (3.28, 1.3), (5.3, 1.24)]
    s['belt'] = [(0, 1.08), (0.12, 1.13), (1.3, 1.21), (2.0, 1.22), (3.3, 1.23), (5.3, 1.24)]
    s['sill'] = [(0, 0.44), (0.3, 0.4), (L - 0.3, 0.4), (L, 0.5)]
    s['plan'] = [(0, 0.92), (0.4, 0.98), (1.0, 1), (L, 1)]
    s['endr'] = (0.3, 0.1)
    s['endk'] = (0.85, 0.97)
    s['roofw'] = 0.82
    s['windscreen'] = (1.33, 1.97)
    s['rearscreen'] = (3.2, 3.28)
    s['windows'] = [(2.04, 2.64), (2.72, 3.12)]
    s['seams'] = [1.3, 2.68, 3.18, 3.36]
    s['rows'] = [0.55, 0.66, 0.8, 0.96, 1.08, 1.16]
    s['front'] = std_front((0.96, 1.08), (0.66, 1.06), 0.6, lamp_x=0.62, tall=True)
    s['rear'] = std_rear((0.85, 1.15), 0.6, 0.86)
    s['lamps'] = [lamp_spec(0, 0.16, 0.96, 1.08, HEAD), lamp_spec(L - 0.06, L, 0.85, 1.15, TAIL)]
    s['bands'] = [(0, L, 0.36, 0.5, 'detail', BLACK)]
    s['plates'] = (0.66, 0.7)
    s['mirror'] = (2.1, 1.24)
    s['handles'] = [2.4, 3.0]
    s['bed'] = (3.3, 5.24)
    s['roofzones'] = [(3.32, 5.25, 'detail', BLACK)]  # tonneau cover over the bed
    s['archr'] = 0.08
    return s


def spec_van():
    L, W = 5.3, 2.0
    r = 0.35
    s = dict(kind='van', name='van', L=L, W=W, H=2.45)
    s['wheels'] = car_wheels(L, 0.82, 1.05, r, 1.72, w=0.21)
    s['top'] = [(0, 0.82), (0.12, 0.98), (0.75, 1.18), (0.9, 1.22), (1.5, 2.3), (1.85, 2.42), (5.15, 2.42), (5.3, 2.36)]
    s['belt'] = [(0, 0.8), (0.12, 0.96), (0.9, 1.2), (1.6, 1.24), (5.3, 1.26)]
    s['sill'] = [(0, 0.34), (0.3, 0.32), (L - 0.3, 0.34), (L, 0.4)]
    s['plan'] = [(0, 0.9), (0.4, 0.98), (1.1, 1), (L, 1)]
    s['endr'] = (0.35, 0.08)
    s['endk'] = (0.86, 0.97)
    s['bulge'] = 0.02
    s['roofw'] = 0.9
    s['roofround'] = 0.12
    s['crown'] = 0.02
    s['windscreen'] = (0.93, 1.48)
    s['rearscreen'] = None
    s['windows'] = [(1.52, 2.3)]
    s['seams'] = [0.9, 2.36, 3.5]
    s['rows'] = [0.48, 0.66, 0.84, 1.0, 1.12]
    s['front'] = std_front((0.86, 1.04), (0.6, 0.86), 0.5, lamp_x=0.62)
    s['rear'] = [(0.86, 1.01, 0.6, 1.25, 'lamp', TAIL), (0.0, 1.01, 0.0, 0.5, 'detail', BLACK), (-0.01, 0.025, 0.5, 2.3, 'detail', BLACK), (0.15, 0.75, 1.55, 2.1, 'glass', None)]
    s['lamps'] = [lamp_spec(0, 0.2, 0.86, 1.04, HEAD)]
    s['bands'] = [(0, L, 0.3, 0.48, 'detail', BLACK), (3.0, 4.6, 1.02, 1.07, 'detail', BLACK)]
    s['plates'] = (0.6, 0.42)
    s['mirror'] = (1.55, 1.25)
    s['mirrorsize'] = 0.2
    s['handles'] = [2.0]
    s['ladder'] = True
    s['liner'] = 0.34
    return s


def spec_camper():
    s = spec_van()
    s.update(name='camper', H=2.8)
    L = s['L']
    s['top'] = [(0, 0.82), (0.12, 0.98), (0.75, 1.18), (0.9, 1.22), (1.5, 2.3), (1.75, 2.75), (5.1, 2.78), (5.3, 2.7)]
    s['windows'] = [(1.52, 2.3), (3.3, 4.2)]
    s['bands'] = [(0, L, 0.3, 0.48, 'detail', BLACK), (2.4, L, 1.4, 1.48, 'trim', None)]
    s['ladder'] = False
    s['camper'] = True
    return s


def spec_minibus():
    s = spec_van()
    s.update(name='minibus', kind='van')
    s['windows'] = [(1.52, 2.3), (2.4, 3.3), (3.4, 4.3), (4.4, 5.1)]
    s['ladder'] = False
    s['rear'] = [(0.86, 1.01, 0.6, 1.25, 'lamp', TAIL), (0.0, 1.01, 0.0, 0.5, 'detail', BLACK), (0.1, 0.8, 1.45, 2.15, 'glass', None)]
    return s


def spec_taxi():
    s = spec_saloon()
    s.update(name='taxi')
    s['sign'] = True
    return s


def spec_box_lorry():
    """Rigid 7.5 t box lorry: forward-control cab, box body in trim colour."""
    L, W = 7.6, 2.3
    r = 0.46
    s = dict(kind='lorry', name='lorry', L=L, W=W, H=3.4)
    s['wheels'] = car_wheels(L, 1.05, 2.1, r, 1.96, w=0.26)
    for w in s['wheels']:
        w['style'] = 'truck'
    s['top'] = [(0, 2.56), (0.12, 2.68), (0.3, 2.72), (2.0, 2.72), (2.1, 2.62)]
    s['belt'] = [(0, 1.5), (0.4, 1.55), (2.1, 1.55)]
    s['sill'] = [(0, 0.55), (0.3, 0.5), (2.1, 0.55)]
    s['L_cab'] = 2.1
    s['plan'] = [(0, 0.94), (0.3, 1), (2.1, 1)]
    s['endr'] = (0.18, 0.05)
    s['endk'] = (0.9, 0.98)
    s['bulge'] = 0.01
    s['roofw'] = 0.92
    s['roofround'] = 0.1
    s['crown'] = 0.0
    s['windscreen'] = (0.0, 0.0)
    s['rearscreen'] = None
    s['windows'] = [(0.25, 1.3)]
    s['seams'] = [1.4]
    s['rows'] = [0.7, 0.9, 1.1, 1.3]
    s['front'] = [(0.0, 0.92, 1.62, 2.45, 'glass', None), (0.66, 0.9, 0.82, 1.0, 'lamp', HEAD), (0.0, 0.66, 0.9, 1.45, 'detail', GREY),
                  (0.0, 1.01, 0.0, 0.8, 'detail', GREY)]
    s['rear'] = [(0.0, 1.01, 0.0, 9, 'detail', BLACK)]
    s['lamps'] = []
    s['bands'] = [(0, 2.1, 0.45, 0.7, 'detail', GREY)]
    s['plates'] = (0.6, None)
    s['mirror'] = (0.45, 1.75)
    s['mirrorsize'] = 0.28
    s['handles'] = []
    s['archr'] = 0.1
    s['liner'] = 0.4
    s['box'] = (2.25, L, 3.4, 0.95)  # u0, u1, top z, floor z
    s['cabover'] = True
    return s


def spec_tipper():
    s = spec_box_lorry()
    s.update(name='tipper', H=3.0)
    s['box'] = None
    s['tipper'] = (2.3, s['L'] - 0.05, 2.25, 1.1)
    return s


def spec_bus():
    L, W = 10.6, 2.5
    r = 0.5
    s = dict(kind='bus', name='bus', L=L, W=W, H=3.05)
    s['wheels'] = car_wheels(L, 2.4, 3.0, r, 2.1, w=0.28)
    for w in s['wheels']:
        w['style'] = 'truck'
    s['top'] = [(0, 2.85), (0.25, 3.0), (0.6, 3.05), (L - 0.4, 3.05), (L, 2.9)]
    s['belt'] = [(0, 1.1), (0.3, 1.15), (L, 1.15)]
    s['sill'] = [(0, 0.32), (0.3, 0.28), (L - 0.3, 0.28), (L, 0.36)]
    s['plan'] = [(0, 0.96), (0.4, 1), (L, 1)]
    s['endr'] = (0.12, 0.12)
    s['endk'] = (0.94, 0.94)
    s['bulge'] = 0.006
    s['roofw'] = 0.93
    s['roofround'] = 0.15
    s['crown'] = 0.0
    s['windscreen'] = None
    s['rearscreen'] = None
    s['windows'] = [(0.5, 1.6), (2.9, 4.1), (4.2, 5.5), (5.6, 6.9), (7.0, 8.3), (8.4, 9.9)]
    s['pillar'] = 'detail'
    s['seams'] = [1.65, 2.6]
    s['rows'] = [0.5, 0.7, 0.9, 1.05]
    s['front'] = [(0.0, 0.94, 1.12, 2.55, 'glass', None), (0.0, 0.8, 2.62, 2.92, 'lamp', SIGN), (0.68, 0.94, 0.55, 0.75, 'lamp', HEAD),
                  (0.0, 1.01, 0.0, 0.42, 'detail', GREY)]
    s['rear'] = [(0.8, 1.01, 0.6, 1.4, 'lamp', TAIL), (0.0, 1.01, 0.0, 0.45, 'detail', GREY), (0.1, 0.9, 1.9, 2.6, 'glass', None)]
    s['lamps'] = []
    s['bands'] = [(0, L, 0.28, 0.45, 'detail', GREY), (1.65, 2.6, 0.45, 2.7, 'glass', None)]
    s['plates'] = (0.5, 0.55)
    s['mirror'] = (0.2, 2.2)
    s['mirrorsize'] = 0.3
    s['handles'] = []
    s['archr'] = 0.08
    s['liner'] = 0.4
    s['door'] = (1.65, 2.6)
    return s


# ---------------------------------------------------------------- batch 2
BLUE = (0.05, 0.25, 1.0)  # blue lamps: green between head and tail, so they flash on the amber channel
HIVIS_Y = (0.85, 0.8, 0.05)
HIVIS_G = (0.1, 0.5, 0.15)
POLICE_B = (0.03, 0.12, 0.55)
FIRE_Y = (0.9, 0.75, 0.1)
WHITE = (0.85, 0.85, 0.83)


def battenburg(u0, u1, z0, z1, a, b, size=0.6, rows=2):
    """Checked livery between u0..u1 and z0..z1 in colours a and b."""
    h = (z1 - z0) / rows

    def f(u, z):
        if u0 <= u <= u1 and z0 <= z <= z1:
            i = int((u - u0) / size) + int((z - z0) / h)
            return 'detail', (a if i % 2 == 0 else b)
        return None
    return f


def checks(u0, u1, size=0.6):
    return [u0 + k * size for k in range(int((u1 - u0) / size) + 1)] + [u1]


def lightbar(B, s, u, z, lod, w=1.1):
    """Roof light bar: two blue lamps on a black base."""
    L = s.get('L_full', s['L'])
    y = L / 2 - u
    box(B, 'detail', BLACK, (w, 0.28, 0.05), (0, y, z + 0.025))
    for sx in (-1, 1):
        box(B, 'lamp', BLUE, (w * 0.42, 0.24, 0.1), (sx * w * 0.26, y, z + 0.1), 0.03 if lod == 0 else 0, 2)


def spec_police():
    s = spec_estate()
    s.update(name='police')
    L = s['L']
    s['livery'] = battenburg(0.15, L - 0.15, 0.48, 0.86, POLICE_B, HIVIS_Y)
    s['stations'] = checks(0.15, L - 0.15)
    s['rows'] = sorted(set(s['rows'] + [0.48, 0.67, 0.86]))
    s['lightbar'] = (2.9, None)
    s['rails'] = None
    return s


def spec_ambulance():
    s = spec_van()
    s.update(name='ambulance', H=2.5)
    L = s['L']
    s['top'] = [(0, 0.82), (0.12, 0.98), (0.75, 1.18), (0.9, 1.22), (1.5, 2.3), (1.8, 2.48), (5.15, 2.5), (5.3, 2.44)]
    s['windows'] = [(1.52, 2.3)]
    s['ladder'] = False
    s['livery'] = battenburg(2.4, L - 0.1, 0.55, 1.15, HIVIS_G, HIVIS_Y, 0.5)
    s['stations'] = checks(2.4, L - 0.1, 0.5)
    s['rows'] = sorted(set(s['rows'] + [0.55, 0.85, 1.15]))
    s['front'] = s['front'] + [(0.0, 1.01, 0.45, 0.6, 'detail', HIVIS_G)]
    s['lightbar'] = (1.9, None)
    s['beacons'] = [(L - 0.15, 2.5)]
    return s


def spec_fire():
    s = spec_box_lorry()
    s.update(name='fire', H=3.3, L=8.4)
    L = s['L']
    s['wheels'] = car_wheels(L, 1.2, 2.3, 0.48, 1.98, w=0.28)
    for w in s['wheels']:
        w['style'] = 'truck'
    # A long crew cab.
    s['L_cab'] = 3.1
    s['top'] = [(0, 2.5), (0.12, 2.64), (0.3, 2.7), (3.0, 2.7), (3.1, 2.62)]
    s['belt'] = [(0, 1.5), (0.4, 1.55), (3.1, 1.55)]
    s['sill'] = [(0, 0.55), (0.3, 0.5), (3.1, 0.55)]
    s['plan'] = [(0, 0.94), (0.3, 1), (3.1, 1)]
    s['windows'] = [(0.25, 1.3), (1.5, 2.9)]
    s['seams'] = [1.4]
    s['bands'] = [(0, 3.1, 0.45, 0.7, 'detail', GREY), (0, 3.1, 1.25, 1.36, 'detail', FIRE_Y)]
    s['box'] = (3.2, L, 2.95, 0.95)
    s['lockers'] = True
    s['lightbar'] = (0.5, None)
    s['fireladder'] = True
    return s


def spec_icecream():
    s = spec_van()
    s.update(name='icecream', H=3.1)
    L = s['L']
    s['top'] = [(0, 0.82), (0.12, 0.98), (0.75, 1.18), (0.9, 1.22), (1.5, 2.3), (1.62, 2.6), (1.9, 2.72), (5.2, 2.72), (5.3, 2.62)]
    s['windows'] = [(1.52, 2.3)]
    s['ladder'] = False
    # Serving hatch on the kerb side, with a pastel stripe along the body.
    s['windows'] = [(1.52, 2.3), (2.7, 4.2)]
    s['bands'] = [(0, L, 0.3, 0.48, 'detail', BLACK), (0.3, L - 0.1, 0.62, 0.78, 'trim', None)]
    s['rows'] = sorted(set(s['rows'] + [0.62, 0.78]))
    s['cone'] = (1.6, 2.72)
    return s


def spec_horsebox():
    s = spec_box_lorry()
    s.update(name='horsebox', H=3.2)
    L = s['L']
    s['box'] = (2.25, L, 3.2, 0.95)
    s['horse'] = True
    return s


def spec_decker():
    """Double-decker bus: lower windows are bands below the belt, the upper
    deck is the greenhouse."""
    s = spec_bus()
    L = 10.4
    s.update(name='decker', L=L, H=4.35)
    s['wheels'] = car_wheels(L, 2.3, 2.6, 0.5, 2.1, w=0.28)
    for w in s['wheels']:
        w['style'] = 'truck'
    s['top'] = [(0, 4.1), (0.3, 4.32), (0.7, 4.38), (L - 0.4, 4.38), (L, 4.2)]
    s['belt'] = [(0, 2.55), (L, 2.55)]
    s['sill'] = [(0, 0.32), (0.3, 0.28), (L - 0.3, 0.28), (L, 0.36)]
    s['windows'] = [(0.25, 1.9), (2.0, 3.6), (3.7, 5.3), (5.4, 7.0), (7.1, 8.7), (8.8, 10.1)]
    lower = [(2.6, 3.9), (4.0, 5.4), (5.5, 6.9), (7.0, 8.4), (8.5, 10.0)]
    s['bands'] = [(0, L, 0.28, 0.45, 'detail', GREY)] + [(a, b, 1.25, 2.2, 'glass', None) for a, b in lower] + [(1.65, 2.5, 0.45, 2.3, 'glass', None)]
    s['rows'] = [0.5, 0.7, 1.0, 1.25, 1.6, 2.2, 2.35]
    s['front'] = [(0.0, 0.94, 2.65, 3.9, 'glass', None), (0.0, 0.94, 1.15, 2.35, 'glass', None), (0.0, 0.8, 3.92, 4.18, 'lamp', SIGN),
                  (0.68, 0.94, 0.55, 0.75, 'lamp', HEAD), (0.0, 1.01, 0.0, 0.42, 'detail', GREY)]
    s['rear'] = [(0.8, 1.01, 0.6, 1.4, 'lamp', TAIL), (0.0, 1.01, 0.0, 0.45, 'detail', GREY), (0.1, 0.9, 2.8, 3.9, 'glass', None)]
    s['door'] = (1.65, 2.5)
    s['decker'] = True
    return s


def spec_supercar():
    L, W = 4.55, 1.98
    s = dict(kind='car', name='supercar', L=L, W=W, H=1.16)
    s['wheels'] = [{'u': 1.05, 'r': 0.33, 'z': 0.33, 'w': 0.24, 'x': 0.84}, {'u': L - 0.95, 'r': 0.355, 'z': 0.355, 'w': 0.3, 'x': 0.82}]
    s['top'] = [(0, 0.46), (0.1, 0.56), (0.9, 0.7), (1.3, 0.78), (2.05, 1.12), (2.4, 1.16), (2.85, 1.1), (3.6, 0.98), (4.4, 0.95), (4.55, 0.88)]
    s['belt'] = [(0, 0.44), (0.12, 0.54), (1.3, 0.76), (2.1, 0.86), (3.5, 0.94), (4.55, 0.86)]
    s['sill'] = [(0, 0.16), (0.3, 0.12), (L - 0.3, 0.13), (L, 0.2)]
    s['plan'] = [(0, 0.86), (0.7, 0.96), (1.5, 0.97), (2.4, 0.94), (3.4, 1.0), (L, 0.95)]
    s['roofw'] = 0.6
    s['bulge'] = 0.05
    s['windscreen'] = (1.32, 2.05)
    s['rearscreen'] = (2.9, 3.55)
    s['windows'] = [(2.1, 2.85)]
    s['seams'] = [1.3, 2.9]
    s['seamroof'] = True
    s['rows'] = [0.24, 0.36, 0.48, 0.58, 0.68, 0.78]
    s['front'] = [(0.5, 1.01, 0.4, 0.5, 'lamp', HEAD), (0.0, 0.7, 0.14, 0.32, 'detail', BLACK), (0.0, 1.01, 0.0, 0.14, 'detail', BLACK)]
    s['rear'] = [(0.3, 1.01, 0.72, 0.8, 'lamp', TAIL), (0.0, 1.01, 0.0, 0.42, 'detail', BLACK), (0.0, 0.8, 0.5, 0.68, 'detail', GREY)]
    s['lamps'] = [lamp_spec(0, 0.28, 0.4, 0.5, HEAD), lamp_spec(L - 0.1, L, 0.72, 0.82, TAIL)]
    # Side air intakes behind the doors.
    s['bands'] = [(2.95, 3.45, 0.42, 0.7, 'detail', BLACK), (0, L, 0.12, 0.2, 'detail', BLACK)]
    s['plates'] = (0.3, 0.6)
    s['mirror'] = (2.1, 0.86)
    s['handles'] = []
    s['wing'] = True
    s['archr'] = 0.05
    s['liner'] = 0.32
    return s


def spec_roadster():
    """Open two-seater: no roof, a framed screen and two heads."""
    L, W = 3.95, 1.74
    s = dict(kind='car', name='roadster', L=L, W=W, H=1.22)
    s['wheels'] = car_wheels(L, 0.82, 0.7, 0.31, 1.5, w=0.21)
    s['top'] = [(0, 0.55), (0.12, 0.64), (1.4, 0.82), (1.6, 0.86), (3.3, 0.88), (3.85, 0.82), (3.95, 0.75)]
    s['belt'] = [(0, 0.53), (0.12, 0.62), (1.4, 0.8), (1.6, 0.84), (3.3, 0.86), (3.95, 0.74)]
    s['sill'] = [(0, 0.2), (0.3, 0.16), (L - 0.3, 0.16), (L, 0.24)]
    s['plan'] = [(0, 0.86), (0.6, 0.98), (1.2, 1), (3.0, 1), (L, 0.93)]
    s['glass'] = False
    s['windscreen'] = None
    s['rearscreen'] = None
    s['windows'] = []
    s['seams'] = [1.55, 2.6]
    s['rows'] = [0.3, 0.44, 0.56, 0.66, 0.74]
    s['front'] = std_front((0.56, 0.68), (0.3, 0.5), 0.3, lamp_x=0.55)
    s['rear'] = std_rear((0.66, 0.78), 0.36, 0.55)
    s['lamps'] = [lamp_spec(0, 0.22, 0.56, 0.68, HEAD), lamp_spec(L - 0.1, L, 0.66, 0.78, TAIL)]
    s['bands'] = [(0, 0.3, 0.16, 0.28, 'detail', BLACK), (L - 0.3, L, 0.16, 0.34, 'detail', BLACK)]
    # Cockpit cut-out: interior colour over the seats.
    s['roofzones'] = [(1.62, 2.75, 'detail', LEATHER)]
    s['plates'] = (0.4, 0.55)
    s['mirror'] = (1.65, 0.86)
    s['handles'] = []
    s['open'] = (1.62, 2.75)
    return s


def spec_gt():
    """Long-bonnet fastback GT."""
    L, W = 4.75, 1.92
    s = dict(kind='car', name='gt', L=L, W=W, H=1.33)
    s['wheels'] = car_wheels(L, 0.95, 0.85, 0.34, 1.62, w=0.25)
    s['top'] = [(0, 0.6), (0.12, 0.7), (1.5, 0.86), (1.85, 0.9), (2.5, 1.29), (2.8, 1.33), (3.2, 1.28), (4.4, 0.96), (4.75, 0.9)]
    s['belt'] = [(0, 0.58), (0.12, 0.68), (1.85, 0.88), (2.6, 0.92), (4.2, 0.96), (4.75, 0.9)]
    s['sill'] = [(0, 0.22), (0.3, 0.17), (L - 0.3, 0.17), (L, 0.26)]
    s['plan'] = [(0, 0.85), (0.6, 0.96), (1.4, 0.98), (3.0, 0.99), (3.7, 1.0), (L, 0.94)]
    s['roofw'] = 0.7
    s['bulge'] = 0.045
    s['windscreen'] = (1.88, 2.5)
    s['rearscreen'] = (3.25, 4.25)
    s['windows'] = [(2.55, 3.2)]
    s['seams'] = [1.86, 3.25]
    s['seamroof'] = True
    s['rows'] = [0.3, 0.44, 0.56, 0.66, 0.76, 0.84]
    s['front'] = std_front((0.58, 0.7), (0.3, 0.56), 0.3, lamp_x=0.55)
    s['rear'] = std_rear((0.76, 0.9), 0.4, 0.4)
    s['lamps'] = [lamp_spec(0, 0.25, 0.58, 0.7, HEAD), lamp_spec(L - 0.12, L, 0.76, 0.9, TAIL)]
    s['bands'] = [(0, 0.3, 0.17, 0.28, 'detail', BLACK), (L - 0.3, L, 0.17, 0.36, 'detail', BLACK)]
    s['plates'] = (0.4, 0.58)
    s['mirror'] = (2.6, 0.92)
    s['handles'] = [3.0]
    s['spoiler'] = 'boot'
    s['exhausts'] = True
    return s


SPECS = {
    'city': spec_city, 'hatch': spec_hatch, 'saloon': spec_saloon, 'estate': spec_estate, 'coupe': spec_coupe,
    'suv': spec_suv, 'utility': spec_utility, 'pickup': spec_pickup, 'taxi': spec_taxi,
    'van': spec_van, 'minibus': spec_minibus, 'camper': spec_camper,
    'lorry': spec_box_lorry, 'tipper': spec_tipper, 'bus': spec_bus,
    'police': spec_police, 'ambulance': spec_ambulance, 'fire': spec_fire, 'icecream': spec_icecream,
    'horsebox': spec_horsebox, 'decker': spec_decker, 'supercar': spec_supercar, 'roadster': spec_roadster, 'gt': spec_gt,
}


# ---------------------------------------------------------------- assemble a lofted vehicle
def build_lofted(s, lod):
    B = Builder()
    L, W = s['L'], s['W']
    cab_only = 'L_cab' in s
    if cab_only:
        # Loft just the cab; the body behind is built from boxes.
        s = dict(s)
        s['L_full'] = L
        s['L'] = s['L_cab']
        shift = (L - s['L_cab']) / 2  # cab's centre is ahead of the vehicle's
        cab_wheels = [dict(w) for w in s['wheels'] if w['u'] < s['L_cab']]
        s_cab = dict(s, wheels=cab_wheels)
        rings = body(B, s_cab, lod)
        for v in B.bm.verts:
            v.co.y += shift
    else:
        rings = body(B, s, lod)
        shift = 0
    Lf = s.get('L_full', s['L'])

    def yf(u):  # y on the full vehicle, u from its nose
        return Lf / 2 - u

    hw_at = lambda u: W / 2 * interp(s.get('plan', [(0, 1), (Lf, 1)]), u)  # noqa: E731
    plates(B, dict(s, L=Lf), lod)
    if s.get('mirror'):
        mu, mz = s['mirror']
        sz = s.get('mirrorsize', 0.14)
        for sx in (-1, 1):
            x = hw_at(mu) * sx
            y = yf(mu)
            box(B, 'paint' if s['kind'] == 'car' else 'detail', None if s['kind'] == 'car' else BLACK,
                (sz, 0.07, sz * (0.75 if s['kind'] == 'car' else 1.6)), (x + sx * sz * 0.55, y, mz + 0.06), 0.02 if lod == 0 else 0, 2)
            if lod == 0:
                box(B, 'glass', None, (sz * 0.85, 0.01, sz * (0.6 if s['kind'] == 'car' else 1.45)), (x + sx * sz * 0.58, y - 0.036, mz + 0.06))
                box(B, 'detail', BLACK, (0.06, 0.05, 0.04), (x - sx * 0.005, y + 0.01, mz))
    if lod == 0:
        for hu in s.get('handles', []):
            belt_z = interp(s['belt'], hu) - 0.08
            for sx in (-1, 1):
                box(B, 'trim', None, (0.02, 0.15, 0.03), (sx * (hw_at(hu) * (1 - s.get('bulge', 0.035) * 0.5) + 0.004), yf(hu), belt_z), 0.008, 1)
    if s.get('rails'):
        u0, u1 = s['rails']
        zt = interp(s['top'], (u0 + u1) / 2)
        roof_rails(B, dict(s, L=Lf), u0, u1, zt + 0.02, W / 2 * s.get('roofw', 0.8) * 0.82)
    if s.get('spoiler') is True and lod == 0:
        u = s['rearscreen'][0] - 0.05
        z = interp(s['top'], u)
        box(B, 'paint', None, (W * s.get('roofw', 0.8) * 0.9, 0.22, 0.04), (0, yf(u + 0.05), z + 0.01), 0.015, 2, rot=(-0.15, 0, 0))
    if s.get('spoiler') == 'boot':
        z = interp(s['top'], Lf - 0.12)
        box(B, 'paint', None, (W * 0.7, 0.16, 0.03), (0, yf(Lf - 0.1), z + 0.03), 0.01 if lod == 0 else 0, 1)
    if s.get('sign'):
        u = 2.75
        z = interp(s['top'], u)
        box(B, 'lamp', SIGN, (0.55, 0.16, 0.14), (0, yf(u), z + 0.08), 0.03 if lod == 0 else 0, 2)
        box(B, 'detail', BLACK, (0.6, 0.2, 0.025), (0, yf(u), z + 0.01))
    if s.get('ladder') and lod == 0:
        z = interp(s['top'], 3.0) + 0.06
        for sx in (-1, 1):
            tube(B, 'trim', None, [(sx * 0.62, yf(2.0), z - 0.05), (sx * 0.62, yf(2.1), z), (sx * 0.62, yf(Lf - 0.25), z), (sx * 0.62, yf(Lf - 0.15), z - 0.05)], 0.02, 6)
        for k in range(7):
            tube(B, 'trim', None, [(-0.62, yf(2.2 + k * 0.45), z), (0.62, yf(2.2 + k * 0.45), z)], 0.015, 5)
    if s.get('camper'):
        # Pop-top roof line and a bike rack.
        z = interp(s['top'], 3.0)
        box(B, 'trim', None, (W * 0.86, 3.0, 0.08), (0, yf(3.6), z + 0.03), 0.03 if lod == 0 else 0, 2)
    if s.get('spare'):
        cyl(B, 'detail', RUBBER, 0.36, 0.22, (0, yf(Lf) - 0.13, 1.2), (math.pi / 2, 0, 0), 20 if lod == 0 else 10)
        cyl(B, 'detail', STEEL, 0.2, 0.24, (0, yf(Lf) - 0.13, 1.2), (math.pi / 2, 0, 0), 12 if lod == 0 else 6)
    if s.get('bullbar'):
        tube(B, 'detail', BLACK, [(-0.6, yf(0) + 0.08, 0.55), (-0.6, yf(0) + 0.14, 1.05), (0.6, yf(0) + 0.14, 1.05), (0.6, yf(0) + 0.08, 0.55)], 0.035, 8 if lod == 0 else 5)
        tube(B, 'detail', BLACK, [(-0.6, yf(0) + 0.12, 0.8), (0.6, yf(0) + 0.12, 0.8)], 0.03, 8 if lod == 0 else 5)
    if s.get('bed'):
        u0, u1 = s['bed']
        zb = interp(s['belt'], u0) - 0.55
        # Bed floor and tailgate inner, plus a roll bar.
        box(B, 'detail', BLACK, (W - 0.2, u1 - u0 - 0.1, 0.04), (0, yf((u0 + u1) / 2), zb))
        if lod == 0:
            tube(B, 'trim', None, [(-W / 2 + 0.15, yf(u0 + 0.12), zb + 0.6), (-W / 2 + 0.2, yf(u0 + 0.12), zb + 1.05), (W / 2 - 0.2, yf(u0 + 0.12), zb + 1.05), (W / 2 - 0.15, yf(u0 + 0.12), zb + 0.6)], 0.035, 8)
    if s.get('box'):
        u0, u1, zt, zf = s['box']
        # Chassis rails and the box, slightly wider than the cab.
        box(B, 'detail', BLACK, (0.9, u1 - u0 + 0.6, 0.25), (0, yf((u0 + u1) / 2) + 0.3, 0.75))
        box(B, 'trim', None, (W + 0.04, u1 - u0, zt - zf), (0, yf((u0 + u1) / 2), (zt + zf) / 2), 0.04 if lod == 0 else 0, 2)
        if lod == 0:
            # Roller-shutter lines on the back, rubbing strip, lamps.
            for k in range(8):
                box(B, 'detail', GREY, (W - 0.16, 0.02, 0.012), (0, yf(u1) - 0.005, zf + 0.25 + k * 0.28))
            box(B, 'detail', BLACK, (W + 0.06, u1 - u0 - 0.1, 0.05), (0, yf((u0 + u1) / 2), zf + 0.1))
            box(B, 'detail', GREY, (0.06, u1 - u0 - 2.7, 0.18), (W / 2 - 0.12, yf((u0 + u1) / 2 + 0.25), 0.7))
            box(B, 'detail', GREY, (0.06, u1 - u0 - 2.7, 0.18), (-W / 2 + 0.12, yf((u0 + u1) / 2 + 0.25), 0.7))
        for sx in (-1, 1):
            box(B, 'lamp', TAIL, (0.28, 0.04, 0.14), (sx * (W / 2 - 0.25), yf(u1) - 0.02, zf - 0.12))
        box(B, 'detail', PLATE_Y, (0.52, 0.015, 0.11), (0, yf(u1) - 0.01, zf - 0.15))
        box(B, 'detail', BLACK, (W - 0.1, 0.1, 0.1), (0, yf(u1) + 0.05, zf - 0.3))
        # Fuel tank and wheel mudguards over the rear axle.
        box(B, 'detail', GREY, (0.5, 0.9, 0.45), (W / 2 - 0.45, yf(3.2), 0.8), 0.06 if lod == 0 else 0, 2)
    if s.get('tipper'):
        u0, u1, zt, zf = s['tipper']
        box(B, 'detail', BLACK, (0.9, u1 - u0 + 0.6, 0.25), (0, yf((u0 + u1) / 2) + 0.3, 0.75))
        hw = W / 2
        t = 0.06
        yc = yf((u0 + u1) / 2)
        Lb = u1 - u0
        box(B, 'trim', None, (W, Lb, t), (0, yc, zf), 0.01 if lod == 0 else 0)
        for sx in (-1, 1):
            box(B, 'trim', None, (t, Lb, zt - zf), (sx * (hw - t / 2), yc, (zt + zf) / 2), 0.01 if lod == 0 else 0)
        box(B, 'trim', None, (W, t, zt - zf + 0.25), (0, yf(u0) - t / 2, (zt + zf) / 2 + 0.12), 0.01 if lod == 0 else 0)
        box(B, 'trim', None, (W, t, zt - zf), (0, yf(u1) + t / 2, (zt + zf) / 2), 0.01 if lod == 0 else 0)
        # Gravel load, and ribs.
        box(B, 'detail', (0.32, 0.29, 0.25), (W - 0.15, Lb - 0.15, 0.1), (0, yc, zt - 0.25), 0.04 if lod == 0 else 0, 2)
        if lod == 0:
            for k in range(6):
                for sx in (-1, 1):
                    box(B, 'trim', None, (0.05, 0.06, zt - zf), (sx * (hw + 0.01), yf(u0 + 0.3 + k * (Lb - 0.6) / 5), (zt + zf) / 2))
        for sx in (-1, 1):
            box(B, 'lamp', TAIL, (0.26, 0.04, 0.14), (sx * (hw - 0.25), yf(u1) - 0.05, zf - 0.1))
        box(B, 'detail', PLATE_Y, (0.52, 0.015, 0.11), (0, yf(u1) - 0.04, zf - 0.15))
    if s.get('cabover') and lod == 0:
        # Grab handles, steps and a sun visor.
        box(B, 'trim', None, (W * 0.88, 0.12, 0.05), (0, yf(0) - 0.12, 2.5), 0.02, 1, rot=(0.3, 0, 0))
        for sx in (-1, 1):
            box(B, 'detail', BLACK, (0.4, 0.25, 0.04), (sx * (W / 2 - 0.25), yf(0.35), 0.55))
    if s.get('door') and lod == 0:
        u0, u1 = s['door']
        box(B, 'detail', BLACK, (0.03, 0.03, 2.3), (W / 2 + 0.005, yf((u0 + u1) / 2), 1.55))
    if s['kind'] == 'bus':
        # Route number board on the back and a roof pod.
        box(B, 'trim', None, (W * 0.7, 2.8, 0.18), (0, yf(Lf - 2.0), interp(s['top'], Lf - 2.0) + 0.07), 0.05 if lod == 0 else 0, 2)
    if s.get('lightbar'):
        u, z = s['lightbar']
        z = interp(s['top'], u) if z is None else z
        lightbar(B, dict(s, L_full=Lf), u, z, lod, 1.15 if s['kind'] != 'lorry' else 1.6)
    for u, z in s.get('beacons', []):
        for sx in (-1, 1):
            box(B, 'lamp', BLUE, (0.14, 0.1, 0.12), (sx * (W / 2 - 0.15), yf(u), z + 0.06), 0.02 if lod == 0 else 0, 1)
    if s.get('lockers') and lod == 0:
        u0, u1, zt, zf = s['box']
        for k in range(4):
            uu = u0 + 0.3 + k * (u1 - u0 - 0.6) / 4
            for sx in (-1, 1):
                for j in range(9):
                    box(B, 'detail', GREY, (0.012, (u1 - u0 - 0.6) / 4 - 0.1, 0.012), (sx * (W / 2 + 0.025), yf(uu + (u1 - u0 - 0.6) / 8), zf + 0.4 + j * 0.17))
        for sx in (-1, 1):
            box(B, 'detail', FIRE_Y, (0.012, u1 - u0, 0.1), (sx * (W / 2 + 0.03), yf((u0 + u1) / 2), zf + 0.2))
    if s.get('fireladder'):
        u0, u1, zt, zf = s['box']
        z = zt + 0.25
        for sx in (-1, 1):
            tube(B, 'detail', CHROME, [(sx * 0.45, yf(u0 - 2.2), z), (sx * 0.45, yf(u1 - 0.2), z)], 0.035, 6 if lod == 0 else 4)
        if lod == 0:
            for k in range(int((u1 - u0 + 2.0) / 0.3)):
                tube(B, 'detail', CHROME, [(-0.45, yf(u0 - 2.1 + k * 0.3), z), (0.45, yf(u0 - 2.1 + k * 0.3), z)], 0.018, 4)
        box(B, 'detail', GREY, (0.3, 0.6, 0.25), (0, yf(u1 - 0.5), zt + 0.12))
    if s.get('cone'):
        u, z = s['cone']
        cyl(B, 'detail', (0.82, 0.6, 0.3), 0.22, 0.75, (0, yf(u), z + 0.4), (math.pi, 0, 0), 12 if lod == 0 else 6, r2=0.02)
        sphere(B, 'detail', (0.95, 0.75, 0.82), 0.25, (0, yf(u), z + 0.85), segs=12 if lod == 0 else 8, rings=8 if lod == 0 else 5)
        sphere(B, 'detail', (0.55, 0.05, 0.08), 0.06, (0, yf(u), z + 1.1), segs=8, rings=5)
    if s.get('horse'):
        u0, u1, zt, zf = s['box']
        for sx in (-1, 1):
            for k in range(3):
                box(B, 'glass', None, (0.02, 0.6, 0.35), (sx * (W / 2 + 0.03), yf(u0 + 0.8 + k * 1.6), zt - 0.45))
            box(B, 'detail', BLACK, (0.02, u1 - u0 - 0.2, 0.06), (sx * (W / 2 + 0.03), yf((u0 + u1) / 2), zf + 0.6))
        # Ramp outline on the back.
        box(B, 'detail', BLACK, (W - 0.2, 0.03, 0.04), (0, yf(u1) - 0.03, zf + 1.6))
    if s.get('wing'):
        u = Lf - 0.2
        z = interp(s['top'], u)
        box(B, 'detail', BLACK, (W * 0.85, 0.28, 0.025), (0, yf(u), z + 0.22), 0.01 if lod == 0 else 0, 1, rot=(0.12, 0, 0))
        for sx in (-1, 1):
            box(B, 'detail', BLACK, (0.03, 0.12, 0.22), (sx * W * 0.32, yf(u), z + 0.1))
    if s.get('exhausts') or s.get('wing'):
        for sx in (-1, 1):
            cyl(B, 'detail', CHROME, 0.045, 0.12, (sx * 0.45, yf(Lf) + 0.02, 0.28), (math.pi / 2, 0, 0), 10 if lod == 0 else 6)
    if s.get('open'):
        u0, u1 = s['open']
        zb = interp(s['belt'], u0)
        # Framed screen, roll hoops and two heads.
        box(B, 'detail', BLACK, (W * 0.8, 0.04, 0.03), (0, yf(u0 - 0.02), zb + 0.32), rot=(-0.5, 0, 0))
        box(B, 'glass', None, (W * 0.78, 0.01, 0.3), (0, yf(u0 - 0.1), zb + 0.17), rot=(-0.5, 0, 0))
        for sx in (-1, 1):
            sphere(B, 'detail', (0.45, 0.32, 0.25), 0.1, (sx * 0.38, yf(u0 + 0.75), zb + 0.42), (1, 1.05, 1.15), 10 if lod == 0 else 6, 6 if lod == 0 else 4)
            sphere(B, 'detail', (0.12, 0.08, 0.05) if sx < 0 else (0.5, 0.35, 0.15), 0.105, (sx * 0.38, yf(u0 + 0.78), zb + 0.47), (1, 1.05, 0.7), 10 if lod == 0 else 6, 6 if lod == 0 else 4)
            box(B, 'detail', (0.2, 0.25, 0.35) if sx < 0 else (0.6, 0.15, 0.12), (0.36, 0.2, 0.3), (sx * 0.38, yf(u0 + 0.8), zb + 0.15), 0.06 if lod == 0 else 0, 1)
            tube(B, 'paint', None, [(sx * 0.38 - 0.16, yf(u1 - 0.05), zb), (sx * 0.38 - 0.12, yf(u1 - 0.05), zb + 0.3), (sx * 0.38 + 0.12, yf(u1 - 0.05), zb + 0.3), (sx * 0.38 + 0.16, yf(u1 - 0.05), zb)], 0.025, 6 if lod == 0 else 4)
        box(B, 'detail', BLACK, (W * 0.72, 0.3, 0.12), (0, yf(u0 + 0.2), zb - 0.02))  # dash
    # Dark interior and a driver behind the screen.
    if s['kind'] in ('car', 'van') and lod == 0 and not s.get('open'):
        ws = s['windscreen']
        u_d = (ws[1] + 0.55) if ws else 1.0
        zb = interp(s['belt'], u_d)
        z_top = interp(s['top'], u_d)
        w = hw_at(u_d)
        # Start the interior where the roof clears it, or it pokes through
        # the roof above the windscreen as a dark brow.
        u_i = ws[1] - 0.1
        while u_i < u_d and interp(s['top'], u_i) < z_top - 0.02:
            u_i += 0.03
        interior(B, dict(s, L=Lf), u_i, (s['rearscreen'][0] if s.get('rearscreen') else Lf) - 0.2, zb - 0.25, z_top - 0.08, w * 0.88)
        driver(B, dict(s, L=Lf), u_d + 0.15, min(zb + 0.05, z_top - 0.58), -0.38 if s.get('uk') else 0.38)
    if s.get('cabover') or s['kind'] == 'bus':
        if lod == 0:
            u_d = 0.7 if s['kind'] != 'bus' else 0.8
            z0, z1 = (0.7, interp(s['top'], 2.0) - 0.25) if s['kind'] == 'bus' else (interp(s['belt'], 0.4) - 0.2, 2.6)
            interior(B, dict(s, L=Lf), 0.25, s['L'] - 0.15 if s['kind'] != 'bus' else Lf - 0.3, z0, z1, W / 2 * 0.9)
            driver(B, dict(s, L=Lf), u_d, interp(s['belt'], u_d) + 0.1, 0.5)
    return B


# ---------------------------------------------------------------- tractor and motorbikes
def build_tractor(lod):
    B = Builder()
    s = dict(kind='tractor', name='tractor', L=4.2, W=2.2, H=2.95)
    L = s['L']
    yf = lambda u: L / 2 - u  # noqa: E731
    seg = 2 if lod == 0 else 0
    rr, rf = 0.78, 0.5
    s['wheels'] = [{'u': 0.75, 'r': rf, 'z': rf, 'w': 0.32, 'x': 0.85, 'style': 'tractor'},
                   {'u': 3.1, 'r': rr, 'z': rr, 'w': 0.48, 'x': 0.86, 'style': 'tractor'}]
    # Bonnet and engine block (paint), sump and chassis (grey).
    box(B, 'paint', None, (0.86, 2.0, 0.78), (0, yf(1.15), 1.25), 0.08 if lod == 0 else 0, seg)
    box(B, 'trim', None, (0.8, 0.12, 0.62), (0, yf(0.12), 1.22), 0.03 if lod == 0 else 0, 1)  # grille
    box(B, 'detail', GREY, (0.7, 2.4, 0.45), (0, yf(1.4), 0.72), 0.04 if lod == 0 else 0, 1)
    box(B, 'detail', GREY, (0.5, 0.6, 0.35), (0, yf(0.05), 0.55))  # front weights
    for sx in (-1, 1):
        box(B, 'lamp', HEAD, (0.14, 0.04, 0.09), (sx * 0.28, yf(0.06), 1.45))
    # Cab: floor, four posts, roof, glass panes.
    cy = yf(2.9)
    cw, cl, cz0, cz1 = 1.5, 1.45, 1.2, 2.85
    box(B, 'detail', GREY, (cw, cl, 0.12), (0, cy, cz0), 0.02 if lod == 0 else 0)
    box(B, 'paint', None, (cw + 0.1, cl + 0.15, 0.12), (0, cy, cz1), 0.05 if lod == 0 else 0, seg)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(B, 'detail', BLACK, (0.06, 0.06, cz1 - cz0), (sx * (cw / 2 - 0.03), cy + sy * (cl / 2 - 0.03), (cz0 + cz1) / 2))
    for sx in (-1, 1):
        box(B, 'glass', None, (0.012, cl - 0.1, cz1 - cz0 - 0.5), (sx * (cw / 2 - 0.03), cy, (cz0 + cz1) / 2 + 0.2))
    for sy in (-1, 1):
        box(B, 'glass', None, (cw - 0.1, 0.012, cz1 - cz0 - 0.45), (0, cy + sy * (cl / 2 - 0.03), (cz0 + cz1) / 2 + 0.17))
    # Seat, wheel and a driver.
    box(B, 'detail', BLACK, (0.5, 0.45, 0.12), (0, cy - 0.2, 1.6), 0.03 if lod == 0 else 0)
    driver(B, s, 3.05, 1.75, 0)
    # Rear mudguards (paint) over the big wheels, small ones at the front.
    for sx in (-1, 1):
        for k in range(6 if lod == 0 else 3):
            a0 = math.pi * k / (6 if lod == 0 else 3)
            a1 = math.pi * (k + 1) / (6 if lod == 0 else 3)
            R = rr + 0.1
            p0 = (sx * 0.86, yf(3.1) + math.cos(a0) * R, rr + math.sin(a0) * R)
            p1 = (sx * 0.86, yf(3.1) + math.cos(a1) * R, rr + math.sin(a1) * R)
            mid = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2)
            ln = math.hypot(p1[1] - p0[1], p1[2] - p0[2])
            ang = math.atan2(p1[2] - p0[2], p1[1] - p0[1])
            box(B, 'paint', None, (0.55, ln + 0.02, 0.04), mid, rot=(ang, 0, 0))
        box(B, 'paint', None, (0.36, 0.7, 0.04), (sx * 0.85, yf(0.75), rf * 2 + 0.12), 0.01 if lod == 0 else 0)
    # Exhaust stack, rear linkage, tail lamps and a yellow beacon on the roof.
    tube(B, 'detail', BLACK, [(0.32, yf(0.6), 1.6), (0.32, yf(0.6), 2.55)], 0.05, 10 if lod == 0 else 6)
    box(B, 'detail', GREY, (0.9, 0.5, 0.4), (0, yf(3.9), 0.9), 0.03 if lod == 0 else 0)
    for sx in (-1, 1):
        box(B, 'lamp', TAIL, (0.1, 0.04, 0.16), (sx * 0.95, yf(3.6) - 0.3, 1.75))
    box(B, 'lamp', AMBER, (0.12, 0.12, 0.12), (0.5, cy, cz1 + 0.12), 0.03 if lod == 0 else 0, 1)
    box(B, 'detail', PLATE_Y, (0.4, 0.015, 0.1), (0, yf(L) - 0.02, 0.85))
    return s, B


def build_bike(lod, style):
    """Motorbike with its rider. style: 'sport' (full fairing) or 'tourer'."""
    B = Builder()
    L = 2.1
    s = dict(kind='bike', name='bike_' + style, L=L, W=0.8, H=1.6)
    yf = lambda u: L / 2 - u  # noqa: E731
    r = 0.31
    s['wheels'] = [{'u': 0.32, 'r': r, 'z': r, 'w': 0.12, 'x': 0, 'centre': True, 'style': 'bike'},
                   {'u': 1.75, 'r': r, 'z': r, 'w': 0.17, 'x': 0, 'centre': True, 'style': 'bike'}]
    seg = 2 if lod == 0 else 0
    sv = 10 if lod == 0 else 6
    # Forks, swing arm, engine block, exhaust.
    for sx in (-1, 1):
        tube(B, 'trim', None, [(sx * 0.09, yf(0.32), r), (sx * 0.09, yf(0.55), 0.98)], 0.03, sv)
        tube(B, 'detail', GREY, [(sx * 0.1, yf(1.1), 0.42), (sx * 0.1, yf(1.75), r)], 0.035, sv)
    box(B, 'detail', GREY, (0.36, 0.55, 0.42), (0, yf(1.0), 0.48), 0.06 if lod == 0 else 0, seg)
    box(B, 'detail', STEEL, (0.4, 0.3, 0.3), (0, yf(0.88), 0.5), 0.05 if lod == 0 else 0, seg)
    tube(B, 'detail', CHROME, [(0.14, yf(0.85), 0.32), (0.18, yf(1.2), 0.28), (0.2, yf(1.65), 0.5), (0.2, yf(2.0), 0.62)], 0.05, sv)
    # Mudguard, tank, seat, tail.
    box(B, 'paint', None, (0.14, 0.4, 0.05), (0, yf(0.3), r * 2 + 0.06), 0.02 if lod == 0 else 0, seg, rot=(0.15, 0, 0))
    sphere(B, 'paint', None, 0.25, (0, yf(1.0), 0.95), (0.95, 1.45, 0.62), 14 if lod == 0 else 8, 8 if lod == 0 else 5)
    box(B, 'detail', LEATHER, (0.28, 0.6, 0.1), (0, yf(1.55), 0.9), 0.04 if lod == 0 else 0, seg)
    box(B, 'paint', None, (0.24, 0.55, 0.16), (0, yf(1.85), 0.95), 0.06 if lod == 0 else 0, seg, rot=(-0.25, 0, 0))
    box(B, 'lamp', TAIL, (0.14, 0.03, 0.05), (0, yf(2.1) + 0.01, 0.98))
    box(B, 'detail', PLATE_Y, (0.2, 0.012, 0.14), (0, yf(2.05), 0.75), rot=(0.4, 0, 0))
    if style == 'sport':
        # Full fairing and a screen.
        sphere(B, 'paint', None, 0.3, (0, yf(0.62), 0.78), (0.8, 1.25, 1.0), 14 if lod == 0 else 8, 8 if lod == 0 else 5)
        box(B, 'glass', None, (0.3, 0.25, 0.012), (0, yf(0.52), 1.12), rot=(-0.85, 0, 0))
        box(B, 'trim', None, (0.4, 0.5, 0.25), (0, yf(1.0), 0.6), 0.08 if lod == 0 else 0, seg)
        box(B, 'lamp', HEAD, (0.2, 0.05, 0.08), (0, yf(0.37), 0.86), 0.02 if lod == 0 else 0, 1, rot=(-0.4, 0, 0))
        hb_z, hb_y = 0.98, 0.62
    else:
        cyl(B, 'trim', None, 0.1, 0.08, (0, yf(0.42), 0.98), (math.pi / 2, 0, 0), sv)
        cyl(B, 'lamp', HEAD, 0.085, 0.02, (0, yf(0.37), 0.98), (math.pi / 2, 0, 0), sv)
        hb_z, hb_y = 1.1, 0.6
    tube(B, 'detail', BLACK, [(-0.36, yf(hb_y), hb_z), (0.36, yf(hb_y), hb_z)], 0.018, 6)
    for sx in (-1, 1):
        box(B, 'detail', BLACK, (0.08, 0.04, 0.06), (sx * 0.3, yf(hb_y - 0.05), hb_z + 0.12), 0.01 if lod == 0 else 0)
    # Rider: leathers in trim colour, helmet in paint, dark boots and gloves,
    # built from overlapping ellipsoids so the body reads as one soft shape.
    seg = (12, 8) if lod == 0 else (7, 5)
    lean = 0.8 if style == 'sport' else 0.38  # forward lean, rad from upright
    hip = Vector((0, yf(1.52), 1.02))
    up = Vector((0, math.sin(lean), math.cos(lean)))
    sh = hip + up * 0.52
    head = sh + up * 0.2 + Vector((0, 0.06, 0.06 if style == 'sport' else 0.03))
    limb(B, 'trim', None, hip - up * 0.04, sh + up * 0.06, 0.2, 0.15, seg)  # torso, deeper than wide
    limb(B, 'trim', None, hip + Vector((0, -0.04, -0.02)), hip + Vector((0, 0.05, 0.06)), 0.19, 0.17, seg)  # seat
    sphere(B, 'paint', None, 0.145, tuple(head), (0.95, 1.08, 1.0), 14 if lod == 0 else 8, 9 if lod == 0 else 5)
    # Visor: a dark band across the front of the helmet.
    sphere(B, 'glass', None, 0.13, tuple(head + Vector((0, 0.045, -0.005))), (0.92, 1.0, 0.5), 12 if lod == 0 else 7, 6 if lod == 0 else 4)
    for sx in (-1, 1):
        shp = sh + Vector((sx * 0.19, -0.02, -0.04))
        hand = Vector((sx * 0.3, yf(hb_y - 0.04), hb_z + 0.03))
        elbow = shp + (hand - shp) * 0.5 + Vector((sx * 0.08, -0.02, -0.08 if style == 'sport' else -0.04))
        limb(B, 'trim', None, shp, elbow, 0.07, 0.07, seg)
        limb(B, 'trim', None, elbow, hand, 0.06, 0.06, seg)
        sphere(B, 'detail', BLACK, 0.055, tuple(hand), (1, 1.2, 0.9), 8, 5)
        hp = hip + Vector((sx * 0.13, 0.02, 0))
        knee = Vector((sx * 0.21, yf(1.12), 0.84 if style == 'sport' else 0.74))
        foot = Vector((sx * 0.17, yf(1.38), 0.42))
        limb(B, 'trim', None, hp, knee, 0.095, 0.095, seg)
        limb(B, 'detail', LEATHER, knee, foot, 0.07, 0.07, seg)
        box(B, 'detail', BLACK, (0.1, 0.25, 0.11), tuple(foot + Vector((0, 0.06, -0.04))), 0.03 if lod == 0 else 0, 1)
    return s, B


# ---------------------------------------------------------------- export
def finish_vehicle(s, B, lod):
    o = B.finish(f"{s['name']}_lod{lod}")
    wheels = []
    for wh in s['wheels']:
        wheels.append({'x': wh['x'], 'y': s['L'] / 2 - wh['u'], 'z': wh['z'], 'r': wh['r'], 'w': wh['w'],
                       'style': wh.get('style', s.get('wheel', 'alloy')), 'centre': wh.get('centre', False)})
    bake_ao(o, wheels, rays=24 if lod == 0 else 12)
    if lod == 0:
        lo = [min(v.co[i] for v in o.data.vertices) for i in range(3)]
        hi = [max(v.co[i] for v in o.data.vertices) for i in range(3)]
        # Meta in three.js axes: x right, y up, z towards the tail.
        meta = {
            # W is the body (for collisions); mirrors stick out past it.
            'kind': s['kind'], 'L': round(hi[1] - lo[1], 3), 'W': round(s.get('W_body', s['W']) if s['kind'] not in ('bike', 'tractor') else hi[0] - lo[0], 3),
            'H': round(hi[2], 3),
            'wheels': [{'x': round(w['x'], 3), 'y': round(w['z'], 3), 'z': round(-w['y'], 3), 'r': w['r'], 'w': w['w'],
                        'style': w['style'], 'centre': w['centre']} for w in wheels],
        }
        # Headlamp positions for the light pools (front-most lamp faces).
        heads = [p.center for p in o.data.polygons if p.material_index == MI['lamp']
                 and o.data.color_attributes['Color'].data[p.loop_indices[0]].color[1] > 0.8]
        if heads:
            front = max(c.y for c in heads)
            hz = sum(c.z for c in heads) / len(heads)
            hx = max(abs(c.x) for c in heads)
            meta['head'] = {'x': round(hx * 0.8, 3), 'y': round(hz, 3), 'z': round(-front, 3)}
        tails = [p.center for p in o.data.polygons if p.material_index == MI['lamp']
                 and o.data.color_attributes['Color'].data[p.loop_indices[0]].color[1] < 0.2]
        if tails:
            back = min(c.y for c in tails)
            tz = sum(c.z for c in tails) / len(tails)
            tx = max(abs(c.x) for c in tails)
            meta['tail'] = {'x': round(tx * 0.85, 3), 'y': round(tz, 3), 'z': round(-back, 3)}
        o['meta'] = json.dumps(meta)
    print(o.name, len(o.data.polygons), 'faces')
    return o


WHEEL_STYLES = ['alloy', 'alloy2', 'steel', 'van', 'truck', 'tractor', 'bike']


def default_wheel(s):
    return {'van': 'van', 'lorry': 'truck', 'bus': 'truck'}.get(s['kind'], 'alloy')


def build_all(only=None):
    objs = []
    for style in WHEEL_STYLES:
        if only and only != 'wheels' and not only.startswith('wheel'):
            break
        for lod in (0, 1):
            objs.append(wheel_mesh(style, lod))
    names = list(SPECS) + ['tractor', 'bike_sport', 'bike_tourer']
    for name in names:
        if only and only not in (name, 'all') and only != 'cars':
            continue
        for lod in (0, 1):
            if name == 'tractor':
                s, B = build_tractor(lod)
            elif name.startswith('bike'):
                s, B = build_bike(lod, name.split('_')[1])
            else:
                s = SPECS[name]()
                for w in s['wheels']:
                    w.setdefault('style', default_wheel(s))
                    if s['kind'] in ('car', 'van'):
                        # Tyres flush with the body sides, not tucked inside.
                        w['x'] = max(w['x'], s['W'] / 2 - w['w'] / 2 - 0.012)
                B = build_lofted(s, lod)
            objs.append(finish_vehicle(s, B, lod))
    return objs


def export(path, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    kw = dict(filepath=path, export_format='GLB', export_materials='EXPORT', export_image_format='NONE',
              export_normals=True, export_texcoords=False, export_apply=True, use_selection=True, export_extras=True)
    try:
        bpy.ops.export_scene.gltf(**kw, export_vertex_color='ACTIVE')
    except TypeError:
        bpy.ops.export_scene.gltf(**kw, export_colors=True)


def preview_scene(objs, path):
    """Lays the lod0 vehicles out in a row on their wheels for a preview."""
    bpy.ops.object.select_all(action='DESELECT')
    x = 0
    out = []
    wheels = {o.name: o for o in objs if o.name.startswith('wheel_') and o.name.endswith('lod0')}
    for o in objs:
        if o.name.startswith('wheel_') or not o.name.endswith('lod0'):
            continue
        meta = json.loads(o['meta'])
        o.location.x = x
        out.append(o)
        for w in meta['wheels']:
            for sx in ((-1, 1) if not w['centre'] else (0,)):
                wo = wheels[f"wheel_{w['style']}_lod0"].copy()
                wo.location = (x + sx * w['x'], -w['z'], w['y'])
                wo.scale = (w['w'], w['r'], w['r'])
                bpy.context.scene.collection.objects.link(wo)
                out.append(wo)
        x += meta['W'] + 1.2
    for o in out:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_materials='EXPORT', export_image_format='NONE',
                              use_selection=True, export_vertex_color='ACTIVE')


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.endswith('.glb')]
    prev = [a for a in sys.argv[1:] if a.endswith('.glb')]
    only = args[0] if args else None
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()
    objs = build_all(only)
    if not only:
        os.makedirs(OUT, exist_ok=True)
        path = os.path.join(OUT, 'vehicles.glb')
        raw = path + '.raw.glb'
        export(raw, objs)
        # Quantise and meshopt-compress (the game decodes with MeshoptDecoder).
        subprocess.run(['npx', '--yes', '@gltf-transform/cli@4.5.1', 'meshopt', raw, path], check=True, cwd=ROOT)
        print('wrote', path, os.path.getsize(raw) // 1024, '->', os.path.getsize(path) // 1024, 'KB')
        os.remove(raw)
    if prev:
        if only:
            objs += [wheel_mesh(st, 0) for st in WHEEL_STYLES]
        preview_scene(objs, prev[0])
        print('wrote preview', prev[0])
