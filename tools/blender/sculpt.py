"""Hand-modelled props: a cage of cross-section rings lofted along a path,
smoothed by Catmull-Clark subdivision with creases where the real thing has
an edge, then painted per vertex and darkened with baked ambient occlusion.
Used by props.py for animals (the cow). Same conventions as props.py:
Blender Z-up, -Y is the front, origin on the ground.
"""
import math
import random

import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def V(x, y, z):
    return Vector((x, y, z))


def _sp(c, e):
    """Signed power: a superellipse coordinate."""
    return math.copysign(abs(c) ** (2 / e), c)


def ring(st, n):
    """One cross-section: n points on a superellipse in the station's local
    (across, up) plane. st: w (half width at the widest), hu/hd (height above
    and below the widest point), eu/ed (exponents: 2 round, 3+ boxy), tt/tb
    (fraction the top/bottom narrows, so withers and hooks can stand up out
    of a round barrel), dx (sideways shift of the widest point)."""
    w, hu, hd = st['w'], st['hu'], st['hd']
    eu, ed = st.get('eu', 2.0), st.get('ed', 2.0)
    tt, tb = st.get('tt', 0.0), st.get('tb', 0.0)
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        c, s = math.cos(t), math.sin(t)
        if s >= 0:
            h, e, tp = hu, eu, tt
        else:
            h, e, tp = hd, ed, tb
        x = w * _sp(c, e) * (1 - tp * abs(_sp(s, e)))
        z = h * _sp(s, e)
        pts.append((x + st.get('dx', 0.0), z))
    return pts


def loft(stations, n=16, caps=(True, True), name='loft'):
    """Lofts rings through stations into a quad mesh. Each station has a
    centre c (Vector), an across vector a and an up vector u (unit) plus the
    ring() fields. Returns the object (unsmoothed, unfinished)."""
    bm = bmesh.new()
    rings = []
    for st in stations:
        a, u = st['a'], st['u']
        vs = [bm.verts.new(st['c'] + a * x + u * z) for x, z in ring(st, n)]
        rings.append(vs)
    for r0, r1 in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
    if caps[0]:
        bm.faces.new(list(reversed(rings[0])))
    if caps[1]:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def subdivide(o, levels=1, creases=None):
    """Applies Catmull-Clark to o. creases: list of (edge test(v0, v1) ->
    weight) functions run over every edge first."""
    if creases:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        layer = bm.edges.layers.float.get('crease_edge') or bm.edges.layers.float.new('crease_edge')
        for e in bm.edges:
            w = 0.0
            for f in creases:
                w = max(w, f(e.verts[0].co, e.verts[1].co))
            e[layer] = w
        bm.to_mesh(o.data)
        bm.free()
    m = o.modifiers.new('sub', 'SUBSURF')
    m.levels = levels
    m.render_levels = levels
    m.use_creases = True
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.modifier_apply(modifier='sub')
    return o


def smooth_join(parts, name):
    """Joins the parts into one smooth-shaded object."""
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(parts) > 1:
        bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = o.data.name = name
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def decimate(o, tris):
    """Collapses o to about `tris` triangles."""
    have = sum(len(p.vertices) - 2 for p in o.data.polygons)
    if have <= tris:
        return o
    m = o.modifiers.new('dec', 'DECIMATE')
    m.ratio = tris / have
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.modifier_apply(modifier='dec')
    return o


def bake_ao(o, attr='Col', rays=32, dist=0.7, strength=0.7, ground=True, floor=0.3):
    """Multiplies each corner colour by ambient occlusion against the object
    itself (and the ground), so creases, armpits and the belly darken."""
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    occ = bmesh.new()
    occ.from_mesh(me)
    if ground:
        gv = [occ.verts.new(p) for p in ((-9, -9, 0), (9, -9, 0), (9, 9, 0), (-9, 9, 0))]
        occ.faces.new(gv)
    tree = BVHTree.FromBMesh(occ)
    rng = random.Random(5)
    dirs = []
    for i in range(rays):
        a = 2 * math.pi * (i + rng.random()) / rays
        r = math.sqrt((i + 0.5) / rays)
        dirs.append(Vector((math.cos(a) * r, math.sin(a) * r, math.sqrt(max(0, 1 - r * r)))))
    bm.verts.ensure_lookup_table()
    bm.normal_update()
    ao = []
    for v in bm.verts:
        n = v.normal if v.normal.length > 0.5 else Vector((0, 0, 1))
        q = Vector((0, 0, 1)).rotation_difference(n)
        hit = 0.0
        src = v.co + n * 0.006
        for d in dirs:
            loc, _, _, h = tree.ray_cast(src, q @ d, dist)
            if loc is not None:
                hit += 1 - (h / dist) ** 2
        ao.append(max(floor, 1 - strength * hit / rays))
    occ.free()
    bm.free()
    col = me.color_attributes[attr]
    for p in me.polygons:
        for li, vi in zip(p.loop_indices, p.vertices):
            c = col.data[li].color
            k = ao[vi]
            col.data[li].color = (c[0] * k, c[1] * k, c[2] * k, 1)
    return o
