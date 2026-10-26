"""Builds the longboard in Blender: a top-mount freeride deck with concave and
kicks, reverse-kingpin trucks and 70 mm wheels. Exports
src/assets/models/board.glb with three meshes:

  deck   in board space: deck top at y = DECK_HEIGHT, nose towards -Z
  truck  origin on the axle, kingpin towards -Z (the game turns the front one)
  wheel  origin at the centre, axle along X

Materials are named (grip, wood, graphic, metal, bushing, urethane, core) and
replaced in the game. Built Z-up in Blender; the exporter converts to Y-up,
so Blender +Y becomes three.js -Z (the nose).

  python tools/blender/board.py
"""
import math
import os
import sys

import bpy  # noqa: I001 (bpy must load before bmesh/mathutils)
import bmesh

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'src', 'assets', 'models')

DECK_HEIGHT = 0.115
WHEEL_R = 0.036
TRUCK_Z = 0.36
LENGTH = 0.98
WIDTH = 0.245
THICK = 0.0125


def mat(name, colour, rough=0.6, metal=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*colour, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


def smooth(x0, x1, x):
    t = min(1.0, max(0.0, (x - x0) / (x1 - x0)))
    return t * t * (3 - 2 * t)


def deck():
    """Deck as a closed shell: grip top, graphic bottom, wood edge band."""
    nl, nw = 48, 14
    half = LENGTH / 2

    def width(v):  # v = -1..1 along the length
        a = abs(v)
        # Full width between the trucks, a gentle taper, then rounded ends.
        e = max(0.0, a - 0.7) / 0.3
        return WIDTH / 2 * (1 - 0.1 * smooth(0.35, 0.75, a)) * max(0.0, 1 - min(1.0, e) ** 2.2) ** 0.45 + 0.0005

    def top(u, v):  # u = -1..1 across
        a = abs(v)
        concave = 0.006 * u * u * (1 - smooth(0.75, 1.0, a))
        kick = 0.032 * smooth(0.74, 1.0, a) ** 2
        return DECK_HEIGHT + concave + kick

    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    grid_t, grid_b = [], []
    for i in range(nl + 1):
        v = -1 + 2 * i / nl
        w = width(v)
        rt, rb = [], []
        for j in range(nw + 1):
            u = -1 + 2 * j / nw
            x = u * w
            y = v * half
            z = top(u, v)
            rt.append(bm.verts.new((x, y, z)))
            rb.append(bm.verts.new((x * 0.985, y * 0.995, z - THICK)))
        grid_t.append(rt)
        grid_b.append(rb)
    gm, wm, km = (bpy.data.materials[n] for n in ('grip', 'wood', 'graphic'))
    bm_mats = [gm, wm, km]

    def quad(vs, uvs, mi):
        f = bm.faces.new(vs)
        f.material_index = mi
        for loop, c in zip(f.loops, uvs):
            loop[uv].uv = c
        return f

    for i in range(nl):
        for j in range(nw):
            u0, u1 = j / nw, (j + 1) / nw
            v0, v1 = i / nl, (i + 1) / nl
            quad((grid_t[i][j], grid_t[i][j + 1], grid_t[i + 1][j + 1], grid_t[i + 1][j]),
                 ((u0, v0), (u1, v0), (u1, v1), (u0, v1)), 0)
            quad((grid_b[i][j], grid_b[i + 1][j], grid_b[i + 1][j + 1], grid_b[i][j + 1]),
                 ((u0, v0), (u0, v1), (u1, v1), (u1, v0)), 2)
    # Edge band around the outline.
    ring = [(i, 0) for i in range(nl + 1)] + [(nl, j) for j in range(1, nw + 1)] + \
           [(i, nw) for i in range(nl - 1, -1, -1)] + [(0, j) for j in range(nw - 1, 0, -1)]
    for k in range(len(ring)):
        a = ring[k]
        b = ring[(k + 1) % len(ring)]
        t = k / len(ring) * 8
        quad((grid_t[a[0]][a[1]], grid_b[a[0]][a[1]], grid_b[b[0]][b[1]], grid_t[b[0]][b[1]]),
             ((t, 0), (t, 1), (t + 0.1, 1), (t + 0.1, 0)), 1)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('deck')
    bm.to_mesh(me)
    bm.free()
    for m in bm_mats:
        me.materials.append(m)
    o = bpy.data.objects.new('deck', me)
    bpy.context.scene.collection.objects.link(o)
    bev = o.modifiers.new('bevel', 'BEVEL')
    bev.width = 0.003
    bev.segments = 2
    bev.limit_method = 'ANGLE'
    bev.angle_limit = math.radians(50)
    return o


def add_prim(kind, name, mat_name, **kw):
    getattr(bpy.ops.mesh, f'primitive_{kind}_add')(**kw)
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(bpy.data.materials[mat_name])
    return o


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    # Keep the part's origin at the world origin (axle / wheel centre).
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return o


def bevel(o, w=0.002, seg=2):
    m = o.modifiers.new('bevel', 'BEVEL')
    m.width = w
    m.segments = seg
    m.limit_method = 'ANGLE'
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier='bevel')


def truck():
    """Reverse-kingpin truck. Origin on the axle; +Y here is towards the
    deck centre (three.js +Z), Z up."""
    deck_bottom = DECK_HEIGHT - THICK - WHEEL_R  # baseplate top above the axle
    parts = []
    # Baseplate: flat plate under the deck plus an angled body.
    p = add_prim('cube', 'plate', 'metal', size=1, location=(0, 0.012, deck_bottom - 0.004))
    p.scale = (0.064, 0.09, 0.008)
    bevel(p, 0.003)
    parts.append(p)
    body = add_prim('cube', 'body', 'metal', size=1, location=(0, 0.018, deck_bottom - 0.024))
    body.scale = (0.03, 0.05, 0.034)
    body.rotation_euler = (math.radians(-40), 0, 0)
    bevel(body, 0.006, 3)
    parts.append(body)
    # Kingpin and bushings (inboard side).
    kp = add_prim('cylinder', 'kingpin', 'metal', radius=0.0045, depth=0.06, vertices=12,
                  location=(0, 0.03, deck_bottom - 0.03), rotation=(math.radians(-40), 0, 0))
    parts.append(kp)
    for k, (dz, r) in enumerate(((-0.004, 0.0135), (0.022, 0.0125))):
        b = add_prim('cylinder', f'bushing{k}', 'bushing', radius=r, depth=0.014, vertices=20,
                     location=(0, 0.03 + dz * 0.64, deck_bottom - 0.03 + dz * 0.77), rotation=(math.radians(-40), 0, 0))
        bevel(b, 0.003, 2)
        parts.append(b)
    nut = add_prim('cylinder', 'nut', 'metal', radius=0.007, depth=0.008, vertices=6,
                   location=(0, 0.03 + 0.034 * 0.64, deck_bottom - 0.03 + 0.034 * 0.77), rotation=(math.radians(-40), 0, 0))
    parts.append(nut)
    # Hanger: a wide arch over the axle with a pivot arm into the baseplate.
    hb = add_prim('cube', 'hanger', 'metal', size=1, location=(0, 0.0, 0.009))
    hb.scale = (0.16, 0.026, 0.024)
    bevel(hb, 0.008, 3)
    parts.append(hb)
    arm = add_prim('cube', 'arm', 'metal', size=1, location=(0, -0.016, 0.024))
    arm.scale = (0.03, 0.04, 0.02)
    arm.rotation_euler = (math.radians(35), 0, 0)
    bevel(arm, 0.006, 2)
    parts.append(arm)
    axle = add_prim('cylinder', 'axle', 'metal', radius=0.004, depth=0.26, vertices=10,
                    location=(0, 0, 0), rotation=(0, math.radians(90), 0))
    parts.append(axle)
    for s in (-1, 1):
        n = add_prim('cylinder', f'axlenut{s}', 'metal', radius=0.0065, depth=0.007, vertices=6,
                     location=(s * 0.1545, 0, 0), rotation=(0, math.radians(90), 0))
        parts.append(n)
    o = join(parts, 'truck')
    for poly in o.data.polygons:
        poly.use_smooth = True
    bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
    return o


def wheel():
    """70 mm x 51 mm wheel: rounded lip profile lathed around X, with a core."""
    bm = bmesh.new()
    W = 0.051
    R = WHEEL_R
    # Profile (x along the axle, r radius), outer lip rounded, inner bore.
    prof = []
    for k in range(13):
        a = k / 12 * math.pi / 2
        prof.append((W / 2 - 0.009 + math.sin(a) * 0.009, R - 0.009 + math.cos(a) * 0.009))
    prof = list(reversed([(-x, r) for x, r in prof])) + prof
    prof = [(-W / 2 + 0.002, 0.015)] + prof + [(W / 2 - 0.002, 0.015)]
    segs = 28
    rings = []
    for k in range(segs):
        a = k / segs * math.tau
        rings.append([bm.verts.new((x, r * math.cos(a), r * math.sin(a))) for x, r in prof])
    for k in range(segs):
        r0, r1 = rings[k], rings[(k + 1) % segs]
        for i in range(len(prof) - 1):
            bm.faces.new((r0[i], r1[i], r1[i + 1], r0[i + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('wheel')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(bpy.data.materials['urethane'])
    o = bpy.data.objects.new('wheel', me)
    bpy.context.scene.collection.objects.link(o)
    for p in me.polygons:
        p.use_smooth = True
    # Core and bearing faces, slightly recessed in each side.
    parts = [o]
    for s in (-1, 1):
        c = add_prim('cylinder', f'core{s}', 'core', radius=0.019, depth=0.004, vertices=24,
                     location=(s * (W / 2 - 0.004), 0, 0), rotation=(0, math.radians(90), 0))
        b = add_prim('cylinder', f'bearing{s}', 'metal', radius=0.011, depth=0.005, vertices=16,
                     location=(s * (W / 2 - 0.0035), 0, 0), rotation=(0, math.radians(90), 0))
        parts += [c, b]
    w = join(parts, 'wheel')
    bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
    return w


if __name__ == '__main__':
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mat('grip', (0.02, 0.02, 0.02), 0.95)
    mat('wood', (0.55, 0.38, 0.22), 0.6)
    mat('graphic', (0.8, 0.2, 0.15), 0.5)
    mat('metal', (0.72, 0.73, 0.75), 0.35, 1.0)
    mat('bushing', (0.95, 0.55, 0.1), 0.6)
    mat('urethane', (0.95, 0.6, 0.15), 0.5)
    mat('core', (0.9, 0.9, 0.9), 0.5)
    d = deck()
    t = truck()
    w = wheel()
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'board.glb')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_materials='EXPORT', export_image_format='NONE',
                              export_normals=True, export_texcoords=True, export_apply=True, use_selection=True)
    for o in (d, t, w):
        print(o.name, len(o.data.polygons), 'faces')
    print('wrote', path)
    if len(sys.argv) > 1:
        # Assembled copy for previews (Blender +Y is the nose).
        for k, y in enumerate((TRUCK_Z, -TRUCK_Z)):
            tt = t.copy()
            tt.location = (0, y, WHEEL_R)
            tt.rotation_euler = (0, 0, 0 if y > 0 else math.pi)
            bpy.context.scene.collection.objects.link(tt)
            for x in (-0.125, 0.125):
                ww = w.copy()
                ww.location = (x, y, WHEEL_R)
                bpy.context.scene.collection.objects.link(ww)
        t.location.z = -1
        w.location.z = -1
        t.hide_set(True)
        w.hide_set(True)
        bpy.ops.object.select_all(action='DESELECT')
        for o in bpy.context.scene.objects:
            if o.location.z > -0.5:
                o.select_set(True)
        bpy.ops.export_scene.gltf(filepath=sys.argv[1], export_format='GLB', export_materials='EXPORT',
                                  export_image_format='NONE', use_selection=True)
