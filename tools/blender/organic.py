"""Smooth one-piece shapes for living things (cows, fans): metaball capsules
and ellipsoids fused into one surface, converted to a mesh, thinned out and
painted per vertex. Used by props.py; same conventions (Blender -Y is the
front, origin on the ground).
"""
import bmesh
import bpy
from mathutils import Vector

from props import PAINT, hexrgb

# A lone metaball's surface sits at about 0.58 of its radius (see rider.py),
# so the sizes below are visible half-extents, scaled up by this.
MB = 1.72


def V(x, y, z):
    return Vector((x, y, z))


class Blob:
    def __init__(self, res=0.03):
        self.mb = bpy.data.metaballs.new('blob')
        self.mb.resolution = res
        self.mb.render_resolution = res
        self.mb.threshold = 0.6
        self.ob = bpy.data.objects.new('blob', self.mb)
        bpy.context.scene.collection.objects.link(self.ob)

    def capsule(self, a, b, r, stiff=2.0):
        a, b = Vector(a), Vector(b)
        e = self.mb.elements.new()
        d = b - a
        if d.length < 1e-4:
            e.type = 'BALL'
        else:
            e.type = 'CAPSULE'
            e.size_x = d.length / 2
            e.rotation = Vector((1, 0, 0)).rotation_difference(d.normalized())
        e.co = (a + b) / 2
        e.radius = r * MB
        e.stiffness = stiff
        return e

    def taper(self, a, b, r0, r1, n=4, stiff=2.0):
        a, b = Vector(a), Vector(b)
        for i in range(n):
            t0, t1 = i / n, (i + 1) / n
            self.capsule(a.lerp(b, t0), a.lerp(b, t1), r0 + (r1 - r0) * (t0 + t1) / 2, stiff)

    def ellip(self, c, sx, sy, sz, stiff=2.0, rot=None):
        sx, sy, sz = sx * MB, sy * MB, sz * MB
        m = max(sx, sy, sz)
        e = self.mb.elements.new()
        e.type = 'ELLIPSOID'
        e.co = Vector(c)
        e.radius = m
        e.size_x, e.size_y, e.size_z = sx / m, sy / m, sz / m
        e.stiffness = stiff
        if rot is not None:
            e.rotation = rot
        return e

    def mesh(self, finish, colour, ratio=0.35, kind=PAINT, cut=None):
        """Converts to a mesh, keeps `ratio` of the faces, and paints each
        corner colour(position) (a hex string). cut(p): drop vertices where
        true. finish: the caller's props.finish (props.py may be running as
        __main__, a separate copy of the module with its own part list)."""
        bpy.ops.object.select_all(action='DESELECT')
        bpy.context.view_layer.objects.active = self.ob
        self.ob.select_set(True)
        bpy.ops.object.convert(target='MESH')
        o = bpy.context.active_object
        if cut:
            bm = bmesh.new()
            bm.from_mesh(o.data)
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if cut(v.co)], context='VERTS')
            bm.to_mesh(o.data)
            bm.free()
        if ratio < 1:
            m = o.modifiers.new('dec', 'DECIMATE')
            m.ratio = ratio
            bpy.ops.object.modifier_apply(modifier='dec')
        finish(o, kind, '#ffffff', smooth=True)
        return paint(o, colour)


def paint(o, colour):
    """Recolours every corner of a finished part by colour(position)."""
    attr = o.data.color_attributes['Col']
    cache = {}
    for loop in o.data.loops:
        h = colour(o.data.vertices[loop.vertex_index].co)
        if h not in cache:
            cache[h] = hexrgb(h)
        attr.data[loop.index].color = cache[h]
    return o


def mix(a, b, t):
    """Blends two hex colours."""
    t = max(0.0, min(1.0, t))
    ca = [int(a[i:i + 2], 16) for i in (1, 3, 5)]
    cb = [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return '#' + ''.join(f'{round(x + (y - x) * t):02x}' for x, y in zip(ca, cb))
