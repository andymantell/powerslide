"""Converts CC0 library textures (Poly Haven, ambientCG) into the game's format.

Same layout as gen.py writes:
  <name>_albedo.webp  RGB albedo (sRGB), A = height (from the displacement map)
  <name>_normal.webp  RGB tangent-space normal (OpenGL, +Y up, as three.js wants)

Each library texture covers a known patch of ground (Poly Haven lists it;
ambientCG doesn't, so we assume 2 m). The shaders tile every surface at a
fixed size (TILE, metres), so a smaller source is repeated k x k inside the
output to keep its real scale.

  python tools/textures/library.py <out dir> [<name>=<src>:<id> ...]
e.g. python tools/textures/library.py src/assets/textures grass=acg:Grass004
With no pairs it rebuilds every texture in PICKS (the ones the game ships;
credits.json lists them). gen.py leaves these alone.
<src> is ph (Poly Haven) or acg (ambientCG). Downloads are cached in
tools/textures/.cache (not committed). Snow keeps the generated height in its
alpha: the ground shader reads snow's alpha as general-purpose noise.
"""
import io
import json
import os
import subprocess
import sys
import zipfile

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '.cache')
GAME = os.path.join(HERE, '..', '..', 'src', 'assets', 'textures')

# Metres per texture tile in the shaders (ground.js, roadmat.js). Bark wraps
# a trunk by UV, so it isn't scaled.
TILE = dict(grass=3.0, lawn=3.0, moor=3.0, needles=3.0, desert=3.0, sand=5.0, snow=8.3, gravel=2.2,
            asphalt=1.33, paving=2.4, rock=6.25, granite=6.25, sandstone=6.25, bark=None)
SIZE = dict(bark=512)
# Andy's picks from the texture audition (2026-10-28).
PICKS = dict(gravel='acg:Gravel040', needles='ph:forest_leaves_04', rock='acg:Rock028', granite='acg:Rock020',
             sandstone='ph:tiger_rock', desert='ph:dry_ground_rocks', sand='acg:Ground079S', paving='ph:pavement_01',
             bark='acg:Bark014')
ACG_SIZE_M = 2.0


def fetch(url, path):
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        data = subprocess.run(['curl', '-sSfL', url], capture_output=True, check=True).stdout
        with open(path + '.part', 'wb') as f:
            f.write(data)
        os.replace(path + '.part', path)
    return path


def polyhaven(id, res='2k'):
    files = json.loads(subprocess.run(['curl', '-sSfL', f'https://api.polyhaven.com/files/{id}'], capture_output=True, check=True).stdout)
    info = json.loads(subprocess.run(['curl', '-sSfL', f'https://api.polyhaven.com/info/{id}'], capture_output=True, check=True).stdout)
    get = lambda key, fmt: Image.open(fetch(files[key][res][fmt]['url'], os.path.join(CACHE, 'ph', id, f'{key}_{res}.{fmt}')))
    return dict(albedo=get('Diffuse', 'jpg'), normal=get('nor_gl', 'jpg'), height=get('Displacement', 'png'),
                metres=info['dimensions'][0] / 1000, author=', '.join(info.get('authors', {})))


def ambientcg(id, res='2K'):
    z = zipfile.ZipFile(fetch(f'https://ambientcg.com/get?file={id}_{res}-JPG.zip', os.path.join(CACHE, 'acg', f'{id}_{res}-JPG.zip')))
    pick = lambda suffix: Image.open(io.BytesIO(z.read(next(n for n in z.namelist() if n.endswith(suffix)))))
    return dict(albedo=pick('_Color.jpg'), normal=pick('_NormalGL.jpg'), height=pick('_Displacement.jpg'),
                metres=ACG_SIZE_M, author='ambientCG (Lennart Demes)')


def tiled(im, size, k, mode):
    cell = im.convert(mode).resize((size // k, size // k), Image.LANCZOS)
    out = Image.new(mode, (size // k * k,) * 2)
    for y in range(k):
        for x in range(k):
            out.paste(cell, (x * cell.width, y * cell.height))
    return out.resize((size, size), Image.LANCZOS) if out.width != size else out


def convert(name, src, id, out):
    s = polyhaven(id) if src == 'ph' else ambientcg(id)
    size = SIZE.get(name, 1024)
    k = max(1, round(TILE[name] / s['metres'])) if TILE.get(name) else 1
    alb = tiled(s['albedo'], size, k, 'RGB')
    nrm = tiled(s['normal'], size, k, 'RGB')
    if name == 'snow':
        hgt = Image.open(os.path.join(GAME, 'snow_albedo.webp')).getchannel('A').resize((size, size))
    else:
        h = np.asarray(tiled(s['height'], size, k, 'F'), dtype=np.float32)
        lo, hi = np.percentile(h, [1, 99])
        hgt = Image.fromarray((np.clip((h - lo) / (hi - lo + 1e-6), 0, 1) * 255 + 0.5).astype(np.uint8), 'L')
    os.makedirs(out, exist_ok=True)
    rgba = alb.copy()
    rgba.putalpha(hgt)
    rgba.save(os.path.join(out, f'{name}_albedo.webp'), quality=85, alpha_quality=60, method=6)
    nrm.save(os.path.join(out, f'{name}_normal.webp'), quality=85, method=6)
    print(f'wrote {name} from {src}:{id} ({s["metres"]:.2f} m, {k}x{k} per tile)')
    return dict(metres=s['metres'], repeat=k, author=s['author'])


if __name__ == '__main__':
    out = sys.argv[1]
    for arg in sys.argv[2:] or [f'{k}={v}' for k, v in PICKS.items()]:
        name, ref = arg.split('=')
        convert(name, *ref.split(':'), out)
