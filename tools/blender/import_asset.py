"""Converts downloaded third-party models (Poly Haven, Quaternius, Kenney and
the like) into our prop format, so they share the prop material, night and
weather effects and the triangle budget of the props we build ourselves.

For each model it:
  - imports the file (.gltf/.glb, .obj, .fbx or .blend) and joins its meshes,
  - turns it to face +Z in three.js (Blender -Y), sits it on the ground and
    centres its footprint,
  - scales it (to a height, a length, or by a factor),
  - bakes its colours (base colour times its texture, sampled per corner)
    into the vertex colour, then decimates it to its triangle budget,
  - sets each face's surface kind in UV u, as tools/blender/props.py does.

  python tools/blender/import_asset.py candidates.json out.glb [dl_dir] [id,...]

candidates.json is a list of entries (see tools/props/audition/candidates.json):
  id      mesh name in the output
  file    path to the model, relative to dl_dir
  pick    optional regex: only objects whose name matches
  yaw     degrees to turn it about the vertical, after import
  height / length / scale   how to size it (metres, metres, factor)
  budget  triangle budget
  kind    surface kind for every face (props.py numbering), or
  kinds   {material-name regex: kind}, first match wins, '*' for the rest
  smooth  smooth shading (scans) instead of flat (low-poly kits)
  tint    optional '#rrggbb' multiplied into the colour
"""
import json
import math
import os
import re
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
LIST, OUT = argv[0], argv[1]
DL = argv[2] if len(argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(LIST)), 'dl')
ONLY = set(argv[3].split(',')) if len(argv) > 3 else None


def srgb_to_linear(c):
    return np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)


def hexrgb(h):
    h = h.lstrip('#')
    return srgb_to_linear(np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]))


_images = {}


def image_array(img):
    """The image as a linear float array (h, w, 3), shrunk to at most 256 px."""
    if img.name in _images:
        return _images[img.name]
    w, h = img.size
    if not w or not h:
        _images[img.name] = None
        return None
    px = np.empty(w * h * img.channels, dtype=np.float32)
    img.pixels.foreach_get(px)
    a = px.reshape(h, w, img.channels)[:, :, :3]
    step = max(1, max(w, h) // 256)
    if step > 1:
        hh, ww = (h // step) * step, (w // step) * step
        a = a[:hh, :ww].reshape(hh // step, step, ww // step, step, 3).mean(axis=(1, 3))
    # Rows run bottom to top. Byte images come back as stored (sRGB); float
    # images are already linear.
    if not img.is_float and img.colorspace_settings.name.lower().startswith('srgb'):
        a = srgb_to_linear(a)
    _images[img.name] = a
    return a


def material_colour(mat):
    """(base colour factor, image array or None) for a material."""
    if mat is None:
        return np.ones(3), None
    if not mat.use_nodes:
        return np.array(mat.diffuse_color[:3]), None
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None:
        return np.array(mat.diffuse_color[:3]), None
    inp = bsdf.inputs['Base Color']
    col = np.array(inp.default_value[:3])
    img = None
    # Follow the link back (through mix or multiply nodes) to an image.
    # Skip data maps (normal, roughness) that a mix node may also pull in.
    stack = [l.from_node for l in inp.links]
    while stack:
        n = stack.pop(0)
        if n.type == 'TEX_IMAGE' and n.image and n.image.colorspace_settings.name != 'Non-Color':
            img = image_array(n.image)
            col = np.ones(3)
            break
        for i in n.inputs:
            stack.extend(l.from_node for l in i.links)
    return col, img


def import_file(path):
    ext = os.path.splitext(path)[1].lower()
    before = set(bpy.data.objects)
    if ext in ('.gltf', '.glb'):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == '.obj':
        bpy.ops.wm.obj_import(filepath=path)
    elif ext == '.fbx':
        bpy.ops.import_scene.fbx(filepath=path)
    elif ext == '.blend':
        with bpy.data.libraries.load(path) as (src, dst):
            dst.objects = src.objects
        for o in dst.objects:
            if o is not None:
                bpy.context.scene.collection.objects.link(o)
    else:
        raise ValueError(f'unknown format {path}')
    return [o for o in bpy.data.objects if o not in before]


def bake_colours(o, e):
    """Per-corner colour from each face's material and texture."""
    me = o.data
    uv = me.uv_layers.active
    n = len(me.loops)
    uvs = np.zeros(n * 2, dtype=np.float32)
    if uv:
        uv.data.foreach_get('uv', uvs)
    uvs = uvs.reshape(n, 2)
    mats = [material_colour(m) for m in me.materials] or [(np.ones(3), None)]
    # Textures the model file doesn't link (OBJ kits often leave them out).
    for mi, m in enumerate(me.materials):
        for rx, path in e.get('textures', {}).items():
            if m and re.search(rx, m.name, re.I):
                mats[mi] = (np.ones(3), image_array(bpy.data.images.load(os.path.join(DL, path))))
                break
    face_mat = np.zeros(len(me.polygons), dtype=np.int32)
    me.polygons.foreach_get('material_index', face_mat)
    loop_face = np.zeros(n, dtype=np.int32)
    for p in me.polygons:
        loop_face[p.loop_start:p.loop_start + p.loop_total] = p.index
    cols = np.ones((n, 3), dtype=np.float32)
    lm = face_mat[loop_face]
    for mi, (base, img) in enumerate(mats):
        sel = lm == mi
        if not sel.any():
            continue
        c = np.tile(base, (sel.sum(), 1))
        if img is not None:
            h, w, _ = img.shape
            u = np.mod(uvs[sel, 0], 1.0)
            v = np.mod(uvs[sel, 1], 1.0)
            c = c * img[np.clip((v * h).astype(int), 0, h - 1), np.clip((u * w).astype(int), 0, w - 1)]
        cols[sel] = c
    if e.get('tint'):
        cols *= hexrgb(e['tint'])
    # Replace any colours the model brought (scans use them as masks).
    while me.color_attributes:
        me.color_attributes.remove(me.color_attributes[0])
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    rgba = np.concatenate([cols, np.ones((n, 1), dtype=np.float32)], axis=1)
    attr.data.foreach_set('color', rgba.ravel())
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = 0


def kinds_for(o, e):
    """Surface kind per material slot."""
    names = [m.name if m else '' for m in o.data.materials] or ['']
    if 'kinds' not in e:
        return [e.get('kind', 0)] * len(names)
    out = []
    for nm in names:
        k = e['kinds'].get('*', 0)
        for rx, kk in e['kinds'].items():
            if rx != '*' and re.search(rx, nm, re.I):
                k = kk
                break
        out.append(k)
    return out


def convert(e):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _images.clear()  # image names repeat between files ('colormap')
    objs = import_file(os.path.join(DL, e['file']))
    meshes = [o for o in objs if o.type == 'MESH' and (not e.get('pick') or re.search(e['pick'], o.name))]
    if not meshes:
        raise RuntimeError(f"{e['id']}: no meshes in {e['file']} ({[o.name for o in objs]})")
    for o in objs:
        if o not in meshes and o.type == 'MESH':
            bpy.data.objects.remove(o)
    # Armatures and empties: keep the meshes where they stand.
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
        for m in list(o.modifiers):
            if m.type == 'ARMATURE':
                o.modifiers.remove(m)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1:
        bpy.ops.object.join()
    o = bpy.context.active_object
    for x in list(bpy.data.objects):
        if x is not o:
            bpy.data.objects.remove(x)
    me = o.data
    # Scans carry custom normals, which decimation scrambles; shade from the shape.
    if me.has_custom_normals:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    me.calc_loop_triangles()
    src_tris = len(me.loop_triangles)

    bake_colours(o, e)
    kinds = kinds_for(o, e)

    # Turn, size and place it.
    if e.get('yaw'):
        o.rotation_euler = (0, 0, math.radians(e['yaw']))
        bpy.ops.object.transform_apply(rotation=True)
    v = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get('co', v)
    v = v.reshape(-1, 3)
    lo, hi = v.min(0), v.max(0)
    s = e.get('scale', 1.0)
    if 'height' in e:
        s = e['height'] / (hi[2] - lo[2])
    elif 'length' in e:
        s = e['length'] / max(hi[0] - lo[0], hi[1] - lo[1])
    v = (v - [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]]) * s
    me.vertices.foreach_set('co', v.ravel())
    me.update()

    # Down to budget. Collapse carries the corner colours along.
    # Loose or split meshes can stop short, so go round again (merging seams).
    for k in range(4):
        me = o.data
        me.calc_loop_triangles()
        n = len(me.loop_triangles)
        if n <= e['budget']:
            break
        if k == 1:
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.mesh.remove_doubles(threshold=0.0005)
            bpy.ops.object.mode_set(mode='OBJECT')
        d = o.modifiers.new('dec', 'DECIMATE')
        d.decimate_type = 'COLLAPSE'
        d.ratio = e['budget'] / n
        d.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier='dec')
    me = o.data

    # Kind in UV u, as props.py does.
    fk = np.zeros(len(me.polygons), dtype=np.int32)
    me.polygons.foreach_get('material_index', fk)
    fk = np.array(kinds)[np.clip(fk, 0, len(kinds) - 1)]
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    uv = me.uv_layers.new(name='UVMap')
    lk = np.zeros(len(me.loops))
    for p in me.polygons:
        lk[p.loop_start:p.loop_start + p.loop_total] = fk[p.index]
    uvs = np.stack([(lk + 0.5) / 8, np.full_like(lk, 0.5)], axis=1)
    uv.data.foreach_set('uv', uvs.ravel())
    for p in me.polygons:
        p.use_smooth = bool(e.get('smooth'))
    me.materials.clear()
    o.name = me.name = e['id']
    me.update()
    me.calc_loop_triangles()
    tris = len(me.loop_triangles)
    v = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get('co', v)
    v = v.reshape(-1, 3)
    dims = [round(float(x), 2) for x in v.max(0) - v.min(0)]
    print(f"{e['id']}: {src_tris} -> {tris} tris, {dims[0]} x {dims[1]} m, {dims[2]} m tall")
    return o, {'id': e['id'], 'srcTris': src_tris, 'tris': tris, 'size': dims}


def main():
    entries = [e for e in json.load(open(LIST)) if not ONLY or e['id'] in ONLY]
    stats, keep = [], []
    tmp = OUT + '.parts'
    os.makedirs(tmp, exist_ok=True)
    # One file per model (a fresh scene each), then one glb of them all.
    for e in entries:
        try:
            o, st = convert(e)
        except Exception as err:  # a broken download shouldn't stop the rest
            print('FAILED', e['id'], err)
            continue
        p = os.path.join(tmp, e['id'] + '.glb')
        bpy.ops.export_scene.gltf(filepath=p, export_format='GLB', export_materials='NONE', export_normals=True,
                                  export_texcoords=True, export_apply=True, export_vertex_color='ACTIVE')
        stats.append(st)
        keep.append(p)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for p in keep:
        bpy.ops.import_scene.gltf(filepath=p)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_materials='NONE', export_normals=True,
                              export_texcoords=True, export_apply=True, export_vertex_color='ACTIVE')
    json.dump(stats, open(os.path.splitext(OUT)[0] + '.json', 'w'), indent=1)
    print('wrote', OUT, len(stats), 'models')


main()
