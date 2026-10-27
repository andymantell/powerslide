"""Builds the downhill rider in Blender and exports src/assets/models/rider.glb.

  body     skinned one-piece race leathers (metaball body, auto-weighted),
           with the colour design baked into vertex colours
  helmet   full-face aero helmet with visor (rigid, parented to the head bone)
  shoeF/R  skate shoes (rigid, parented to the foot bones)
  gloveF/R gloves with slide pucks on the palms (rigid, parented to the hands)

The bones are listed in BONES below; RIDER_RIG in src/rider.js tells
SkeletonDriver how to aim each one from the RiderPose joints. The rigid parts
hang off bones, so they stay joined to the body in every pose. The bind pose is built
in RiderPose rig space: deck top at y = 0, facing +X, front (left) side at -Z.
Blender is Z-up, so a rig point (x, y, z) is Blender (x, -z, y).

  python tools/blender/rider.py
"""
import math
import os

import bpy  # noqa: I001
import bmesh
from mathutils import Quaternion, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'src', 'assets', 'models')


def R(x, y, z):
    """Rig space -> Blender space."""
    return Vector((x, -z, y))


# Bind-pose joints in rig space (standing, arms in a relaxed A-pose).
J = {
    'hip': (0.0, 0.95, 0.0),
    'hipF': (0.0, 0.95, -0.1), 'hipR': (0.0, 0.95, 0.1),
    # Knees and elbows slightly bent, so each limb has a clear bend direction.
    'kneeF': (0.04, 0.5, -0.11), 'kneeR': (0.04, 0.5, 0.11),
    'footF': (0.0, 0.05, -0.12), 'footR': (0.0, 0.05, 0.12),
    'chest': (0.0, 1.45, 0.0), 'neck': (0.0, 1.55, 0.0), 'head': (0.0, 1.73, 0.0),
    'shF': (0.0, 1.42, -0.19), 'shR': (0.0, 1.42, 0.19),
    'clav': (0.0, 1.42, 0.0),
    'elF': (-0.04, 1.14, -0.29), 'elR': (-0.04, 1.14, 0.29),
    'haF': (0.02, 0.87, -0.36), 'haR': (0.02, 0.87, 0.36),
}
J = {k: R(*v) for k, v in J.items()}
# Bone ends past the hands, feet (toes along +X) and head.
J['handTipF'] = J['haF'] + (J['haF'] - J['elF']).normalized() * 0.1
J['handTipR'] = J['haR'] + (J['haR'] - J['elR']).normalized() * 0.1
J['toeF'], J['toeR'] = J['footF'] + Vector((0.15, 0, 0)), J['footR'] + Vector((0.15, 0, 0))
J['headTop'] = J['head'] + Vector((0, 0, 0.12))

# bone name: (head joint, tail joint, parent)
BONES = {
    'hips': ('hip', None, None),
    'spine': ('hip', 'chest', 'hips'),
    'chest': ('chest', 'neck', 'spine'),
    'neck': ('neck', 'head', 'chest'),
    'head': ('head', 'headTop', 'neck'),
    'thighF': ('hipF', 'kneeF', 'hips'),
    'shinF': ('kneeF', 'footF', 'thighF'),
    'footF': ('footF', 'toeF', 'shinF'),
    'thighR': ('hipR', 'kneeR', 'hips'),
    'shinR': ('kneeR', 'footR', 'thighR'),
    'footR': ('footR', 'toeR', 'shinR'),
    'clavF': ('clav', 'shF', 'chest'),
    'upperArmF': ('shF', 'elF', 'clavF'),
    'forearmF': ('elF', 'haF', 'upperArmF'),
    'handF': ('haF', 'handTipF', 'forearmF'),
    'clavR': ('clav', 'shR', 'chest'),
    'upperArmR': ('shR', 'elR', 'clavR'),
    'forearmR': ('elR', 'haR', 'upperArmR'),
    'handR': ('haR', 'handTipR', 'forearmR'),
}
# Bones that shape the body's skin; the rest only carry rigid parts.
SKIN = ('hips', 'spine', 'chest', 'neck', 'thighF', 'shinF', 'thighR', 'shinR', 'clavF', 'upperArmF', 'forearmF',
        'clavR', 'upperArmR', 'forearmR')
# Segments the leathers design is laid out on (nearest one wins).
PAINT = ('spine', 'chest', 'neck', 'thighF', 'shinF', 'thighR', 'shinR', 'upperArmF', 'forearmF', 'upperArmR',
         'forearmR')

COL = {
    'red': (0.62, 0.035, 0.04),
    'white': (0.86, 0.86, 0.84),
    'black': (0.03, 0.03, 0.035),
    'grey': (0.25, 0.26, 0.28),
}


def mat(name, colour=(0.8, 0.8, 0.8), rough=0.5, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*colour, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


# A lone metaball's surface sits at about 0.58 of its radius (field
# (1 - (d/r)^2)^3 * stiffness 2 against threshold 0.6), so sizes below are
# visible half-extents and get scaled up by this.
MB = 1.72


def ellipsoid(mb, c, sx, sy, sz):
    """Metaball ellipsoid with the given visible half-extents."""
    sx, sy, sz = sx * MB, sy * MB, sz * MB
    m = max(sx, sy, sz)
    e = mb.elements.new()
    e.type = 'ELLIPSOID'
    e.co = c
    e.radius = m
    e.size_x, e.size_y, e.size_z = sx / m, sy / m, sz / m
    return e


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length, t


def body():
    mb = bpy.data.metaballs.new('body')
    mb.resolution = 0.018
    mb.render_resolution = 0.018
    mb.threshold = 0.6
    ob = bpy.data.objects.new('bodyMB', mb)
    bpy.context.scene.collection.objects.link(ob)

    def capsule(a, b, r, stiff=2.0):
        e = mb.elements.new()
        e.type = 'CAPSULE'
        mid = (a + b) / 2
        d = b - a
        e.co = mid
        e.radius = r * MB
        e.size_x = d.length / 2
        e.rotation = Vector((1, 0, 0)).rotation_difference(d.normalized())
        e.stiffness = stiff
        return e

    def ellip(c, sx, sy, sz, r=None, stiff=2.0):
        # Ellipsoid sizes scale the radius, so pass half-extents and normalise.
        sx, sy, sz = sx * MB, sy * MB, sz * MB
        m = max(sx, sy, sz)
        e = mb.elements.new()
        e.type = 'ELLIPSOID'
        e.co = c
        e.radius = m
        e.size_x, e.size_y, e.size_z = sx / m, sy / m, sz / m
        e.stiffness = stiff
        return e

    def taper(a, b, r0, r1, n=6, stiff=2.0):
        for i in range(n):
            t0, t1 = i / n, (i + 1) / n
            capsule(a.lerp(b, t0), a.lerp(b, t1), r0 + (r1 - r0) * (t0 + t1) / 2, stiff)

    # Legs: thigh tapers to the knee, calf bulges then narrows to the ankle.
    for s in 'FR':
        taper(J['hip' + s], J['knee' + s], 0.092, 0.062)
        k, f = J['knee' + s], J['foot' + s]
        taper(k, k.lerp(f, 0.35), 0.062, 0.064, 3)
        taper(k.lerp(f, 0.35), f, 0.064, 0.044, 3)
        sh, el, ha = J['sh' + s], J['el' + s], J['ha' + s]
        taper(sh, el, 0.058, 0.048, 3)
        taper(el, ha, 0.048, 0.036, 3)
        # Deltoid with its armour cup.
        ellip(sh + Vector((0, 0, -0.01)), 0.064, 0.068, 0.062)
    hip, neck = J['hip'], J['neck']
    up = (neck - hip).normalized()
    # Pelvis and seat, waist, rib cage, upper chest (wider across than deep).
    # Overlapping elements fuse and swell, so the torso parts are trimmed a bit.
    k = 1.04
    # Half-extents: (front-back, side to side, height).
    ellip(hip + up * 0.03 + Vector((-0.01, 0, 0)), 0.1 * k, 0.16 * k, 0.12 * k)
    ellip(hip + up * 0.2, 0.095 * k, 0.135 * k, 0.14 * k)
    ellip(hip + up * 0.36 + Vector((0.01, 0, 0)), 0.11 * k, 0.16 * k, 0.15 * k)
    ellip(hip + up * 0.49, 0.09 * k, 0.19 * k, 0.08 * k)
    # Aero hump on the upper back.
    ellip(hip + up * 0.47 + Vector((-0.1, 0, 0)), 0.06, 0.1, 0.13)
    # Neck runs up into the helmet, thick enough to read as neck and collar.
    capsule(neck - up * 0.06, neck + up * 0.1, 0.068)
    # Trapezius sloping from the neck out to the shoulders.
    ellip(hip + up * 0.55, 0.075, 0.13, 0.05)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.convert(target='MESH')
    o = bpy.context.active_object
    o.name = 'body'
    # Trim the open ends: remove anything below the ankle (inside the shoe)
    # and above the neck (inside the helmet), and beyond the wrist (glove).
    bm = bmesh.new()
    bm.from_mesh(o.data)
    kill = []
    for v in bm.verts:
        p = v.co
        if p.z < J['footF'].z - 0.01:
            kill.append(v)
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(o.data)
    bm.free()
    dec = o.modifiers.new('dec', 'DECIMATE')
    dec.ratio = 0.8
    bpy.ops.object.modifier_apply(modifier='dec')
    sm = o.modifiers.new('smooth', 'SMOOTH')
    sm.factor = 0.4
    sm.iterations = 6
    bpy.ops.object.modifier_apply(modifier='smooth')
    for p in o.data.polygons:
        p.use_smooth = True
    paint_leathers(o)
    o.data.materials.append(mat('leather', (1, 1, 1), 0.45))
    return o


def paint_leathers(o):
    """Race-leather design: red suit, white shoulders, arm and leg stripes,
    black hips, collar, knee sliders and lower legs.

    Rather than colours, each vertex stores signed distances (metres, scaled
    and offset to 0..1) to the edge of the white (R) and black (G) panels.
    Distances interpolate linearly across triangles, so the game's shader can
    threshold them at 0.5 for crisp panel edges on a coarse mesh."""
    me = o.data
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    K = 8.0  # 1 / metres of distance range either side of an edge

    def enc(d):
        return max(0.0, min(1.0, 0.5 + d * K))

    for v in me.vertices:
        p = v.co
        white = black = -1.0
        dl = {}
        for k in PAINT:
            a, b, _ = BONES[k]
            dl[k] = seg_dist(p, J[a], J[b])
        limb = min(dl, key=lambda k: dl[k][0])
        t = dl[limb][1]
        a, b, _ = BONES[limb]
        ln = (J[b] - J[a]).length
        s = limb[-1]
        if limb.startswith(('shin', 'thigh')):
            kv = p - J['knee' + s]
            # Knee slider: a disc on the front of the knee.
            black = max(black, min(0.085 - kv.length, kv.x - 0.005))
        if limb.startswith('shin'):
            black = max(black, (t - 0.5) * ln)
        elif limb.startswith('thigh'):
            # White stripe down the outside of each thigh.
            side = p - J['hip' + s].lerp(J['knee' + s], t)
            outward = 1 if s == 'F' else -1  # front leg's outside is Blender +Y
            white = min(side.y * outward - 0.045, 0.035 - abs(side.x))
        elif limb.startswith('upperArm'):
            white = (0.45 - t) * ln
        elif limb.startswith('forearm'):
            black = (t - 0.75) * ln
        else:  # torso
            h = (p - J['hip']).dot((J['neck'] - J['hip']).normalized())
            black = max(0.12 - h, h - 0.56)
            white = min(h - 0.42, 0.56 - h)
            # Hump stripe down the back.
            black = max(black, min(-0.06 - p.x, 0.035 - abs(p.y), h - 0.15))
        attr.data[v.index].color = (enc(white), enc(black), 0, 1)


def armature(body_obj):
    arm = bpy.data.armatures.new('rig')
    ob = bpy.data.objects.new('rig', arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for name, (a, b, parent) in BONES.items():
        bone = arm.edit_bones.new(name)
        bone.head = J[a]
        bone.tail = J[b] if b else J[a] + Vector((0, 0, 0.1))
        if parent:
            bone.parent = eb[parent]
        bone.use_deform = name in SKIN
        eb[name] = bone
    bpy.ops.object.mode_set(mode='OBJECT')
    # Automatic (heat) weights.
    bpy.ops.object.select_all(action='DESELECT')
    body_obj.select_set(True)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    return ob


def attach(rig, o, bone, at, rot=None):
    """Places a rigid part at its bind position and parents it to a bone."""
    if rot:
        o.rotation_mode = 'QUATERNION'
        o.rotation_quaternion = rot
    o.location = at
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    rig.data.bones.active = rig.data.bones[bone]
    bpy.ops.object.parent_set(type='BONE', keep_transform=True)


def helmet():
    """Full-face aero helmet: shell with a tapered tail, chin bar and visor."""
    head = J['head']
    mb = bpy.data.metaballs.new('helmet')
    mb.resolution = 0.012
    o = bpy.data.objects.new('helmetMB', mb)
    bpy.context.scene.collection.objects.link(o)
    ellipsoid(mb, head + Vector((0, 0, 0.01)), 0.135, 0.118, 0.135)
    # Aero tail sweeping back and down.
    for a, b, r in (((-0.04, 0.01), (-0.13, -0.02), 0.085), ((-0.12, -0.02), (-0.2, -0.05), 0.05)):
        t = mb.elements.new()
        t.type = 'CAPSULE'
        pa = head + Vector((a[0], 0, a[1]))
        pb = head + Vector((b[0], 0, b[1]))
        t.co = (pa + pb) / 2
        t.size_x = (pb - pa).length / 2
        t.rotation = Vector((1, 0, 0)).rotation_difference((pb - pa).normalized())
        t.radius = r * MB * 0.8
    ellipsoid(mb, head + Vector((0.075, 0, -0.095)), 0.07, 0.1, 0.055)
    # Convert only this object: converting applies modifiers (e.g. the body's skin).
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target='MESH')
    shell = bpy.context.active_object
    shell.name = 'helmet'
    dec = shell.modifiers.new('dec', 'DECIMATE')
    dec.ratio = 0.35
    bpy.ops.object.modifier_apply(modifier='dec')
    for p in shell.data.polygons:
        p.use_smooth = True
    # Design as distance fields like the leathers (R red stripe, G black):
    # white shell, red centre stripe front to back, black lower rim.
    col = shell.data.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    for v in shell.data.vertices:
        d = v.co - head
        red = min(0.03 - abs(d.y), d.z + 0.02)
        black = max(-0.1 - d.z, min(-0.06 - d.z, 0.02 - d.x))
        col.data[v.index].color = (max(0.0, min(1.0, 0.5 + red * 8)), max(0.0, min(1.0, 0.5 + black * 8)), 0, 1)
    shell.data.materials.append(mat('helmetShell', (0.9, 0.9, 0.9), 0.25))
    shell.data.materials.append(mat('visor', (0.05, 0.06, 0.08), 0.05, 0.6))
    # Visor: a smooth curved patch just proud of the shell's front.
    bm = bmesh.new()
    rows = []
    na, ne = 16, 6
    for i in range(ne + 1):
        el = math.radians(-30 + 48 * i / ne)
        row = []
        for j in range(na + 1):
            az = math.radians(-58 + 116 * j / na)
            c = head + Vector((0, 0, 0.01))
            row.append(bm.verts.new(c + Vector((0.139 * math.cos(el) * math.cos(az), 0.122 * math.cos(el) * math.sin(az), 0.139 * math.sin(el)))))
        rows.append(row)
    for i in range(ne):
        for j in range(na):
            f = bm.faces.new((rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]))
            f.material_index = 1
            f.smooth = True
    bm.from_mesh(shell.data)
    bm.to_mesh(shell.data)
    bm.free()
    # Shift so the origin is the head joint (the game places it there).
    shell.data.transform(__import__('mathutils').Matrix.Translation(-head))
    return shell


def shoe():
    """Low skate shoe, origin at the ankle, toe along +X (rig facing), sole
    0.05 below. Rings along the foot with a rounded heel and toe, so nothing
    sticks out behind the ankle."""
    bm = bmesh.new()
    sole = -0.05
    heel, toe = -0.055, 0.2
    n, m = 20, 16
    rings = []
    for k in range(n + 1):
        t = k / n
        x = heel + t * (toe - heel)
        # Half width: narrow heel, wide forefoot, rounded toe.
        w = 0.036 + 0.014 * math.sin(min(1.0, t / 0.75) * math.pi * 0.6)
        # Upper: collar just above the ankle, sloping down to a low toe box.
        top = 0.03 - 0.036 * max(0.0, (t - 0.3) / 0.7) ** 0.9
        # Round the ends off in plan and in height (heel 3 cm, toe 4 cm).
        d = min(x - heel, toe - x)
        r = 0.03 if x - heel < toe - x else 0.045
        e = math.sqrt(max(0.0, 1 - (max(0.0, r - d) / r) ** 2))
        e = max(e, 0.15)
        h = top - sole
        ring = []
        for j in range(m):
            a = j / m * math.tau
            y = math.cos(a) * w * e
            z = sole + h * (0.5 + 0.5 * math.sin(a) * e) if math.sin(a) > 0 else sole + h * 0.5 * (1 + math.sin(a))
            ring.append(bm.verts.new((x, y, max(z, sole))))
        rings.append(ring)
    for i in range(n):
        for j in range(m):
            bm.faces.new((rings[i][j], rings[i][(j + 1) % m], rings[i + 1][(j + 1) % m], rings[i + 1][j]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('shoe')
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new('shoe', me)
    bpy.context.scene.collection.objects.link(o)
    me.materials.append(mat('shoeUpper', (0.04, 0.04, 0.05), 0.7))
    me.materials.append(mat('shoeSole', (0.85, 0.83, 0.78), 0.8))
    for p in me.polygons:
        p.use_smooth = True
        if p.center.z < sole + 0.012:
            p.material_index = 1
    return o


def glove():
    """Glove with a slide puck on the palm. Origin at the wrist, fingers
    along +Z (Blender), i.e. down the forearm direction; palm faces -Y."""
    mb = bpy.data.metaballs.new('glove')
    mb.resolution = 0.008
    o = bpy.data.objects.new('gloveMB', mb)
    bpy.context.scene.collection.objects.link(o)
    ellipsoid(mb, (0, 0, 0.06), 0.05, 0.026, 0.055)
    ellipsoid(mb, (0, 0.008, 0.13), 0.046, 0.022, 0.05)
    cuff = mb.elements.new()
    cuff.type = 'CAPSULE'
    cuff.co = (0, 0, 0.0)
    cuff.radius = 0.04 * MB
    cuff.size_x = 0.02
    cuff.rotation = Vector((1, 0, 0)).rotation_difference(Vector((0, 0, 1)))
    # Convert only this object: converting applies modifiers (e.g. the body's skin).
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.convert(target='MESH')
    g = bpy.context.active_object
    g.name = 'glove'
    for p in g.data.polygons:
        p.use_smooth = True
    g.data.materials.append(mat('gloveLeather', (0.06, 0.06, 0.07), 0.6))
    bpy.ops.mesh.primitive_cylinder_add(radius=0.048, depth=0.012, vertices=24, location=(0, -0.03, 0.08),
                                        rotation=(math.pi / 2, 0, 0))
    puck = bpy.context.active_object
    puck.data.materials.append(mat('puck', (0.1, 0.3, 0.85), 0.35))
    bpy.ops.object.select_all(action='DESELECT')
    g.select_set(True)
    puck.select_set(True)
    bpy.context.view_layer.objects.active = g
    bpy.ops.object.join()
    g = bpy.context.active_object
    dec = g.modifiers.new('dec', 'DECIMATE')
    dec.ratio = 0.5
    bpy.ops.object.modifier_apply(modifier='dec')
    return g


if __name__ == '__main__':
    bpy.ops.wm.read_factory_settings(use_empty=True)
    b = body()
    rig = armature(b)
    h = helmet()
    # Sat a little low on the head joint so it nests down onto the neck.
    attach(rig, h, 'head', J['head'] + Vector((0, 0, -0.025)))
    s = shoe()
    s2 = s.copy()
    bpy.context.scene.collection.objects.link(s2)
    for o, side in ((s, 'F'), (s2, 'R')):
        o.name = 'shoe' + side
        attach(rig, o, 'foot' + side, J['foot' + side])
    g = glove()
    g2 = g.copy()
    bpy.context.scene.collection.objects.link(g2)
    for o, side in ((g, 'F'), (g2, 'R')):
        o.name = 'glove' + side
        # Fingers on down the forearm, palm (puck) towards the body.
        fwd = (J['ha' + side] - J['el' + side]).normalized()
        q = Vector((0, 0, 1)).rotation_difference(fwd)
        if side == 'R':
            q = Quaternion(fwd, math.pi) @ q
        attach(rig, o, 'hand' + side, J['ha' + side], q)
    for o in (b, h, s, g):
        print(o.name, len(o.data.polygons), 'faces')
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'rider.glb')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_materials='EXPORT', export_image_format='NONE',
                              export_normals=True, export_texcoords=False, export_apply=False, use_selection=True,
                              export_skins=True, export_vertex_color='ACTIVE')
    print('wrote', path)
