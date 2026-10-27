"""Generates src/assets/textures/props_detail.png, the shared detail map for
buildings, bridges and other props (see src/propmat.js).

Each channel is a tileable height/tone map, mean about 0.5, that the prop
shader uses to shade the prop's own colour and to bump its normal:
  R  planks: horizontal boards, 10 to a tile (the tile is 2 m)
  G  shingles: staggered rows of wooden shingles or tiles, 8 to a tile (2 m)
  B  masonry: rough coursed stone blocks (3 m)
  A  plaster: render with soft blotches and stains (4 m)

  python tools/textures/props.py
"""
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from noise import blur, fbm, perlin  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'assets', 'textures')
N = 512


def norm01(x):
    return (x - x.min()) / (x.max() - x.min() + 1e-9)


def rows(n, size, seed, min_w, max_w, stagger=True):
    """Per-pixel (row index, piece id, u within piece, v within row) for staggered courses."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:size, 0:size]
    rh = size / n
    row = (yy // rh).astype(int)
    v = (yy % rh) / rh
    pid = np.zeros((size, size))
    u = np.zeros((size, size))
    for r in range(n):
        # Random piece widths that wrap exactly across the tile.
        cuts = [0.0]
        while cuts[-1] < 1:
            cuts.append(cuts[-1] + rng.uniform(min_w, max_w))
        cuts = np.array(cuts) / cuts[-1]
        off = rng.uniform(0, 1) if stagger else 0
        sel = row == r
        x = ((xx[sel] / size) + off) % 1.0
        k = np.searchsorted(cuts, x, side='right') - 1
        pid[sel] = k * 7.31 + r * 13.7
        u[sel] = (x - cuts[k]) / (cuts[k + 1] - cuts[k])
    return row, pid, u, v


def tone(pid, seed):
    """A random value per piece id."""
    return (np.sin(pid * 12.9898 + seed * 78.233) * 43758.5453) % 1.0


def planks():
    row, pid, u, v = rows(10, N, 1, 0.5, 1.4)
    grain = perlin(N, 4, 2) * 0.5 + fbm(N, 16, 3, 3) * 0.4
    # Stretch the grain along the boards.
    yy, xx = np.mgrid[0:N, 0:N]
    streak = np.sin((yy / N * 10 * 6.28) * 3 + perlin(N, 6, 4) * 6 + tone(pid, 5) * 20) * 0.5
    h = 0.55 + (tone(pid, 1) - 0.5) * 0.35 + grain * 0.12 + streak * 0.06
    gap = np.minimum(v, 1 - v) * 10  # board edges
    end = np.minimum(u, 1 - u) * 40  # butt joints
    h *= np.clip(np.minimum(gap, end) * 1.2, 0.15, 1)
    return h


def shingles():
    row, pid, u, v = rows(8, N, 7, 0.12, 0.3)
    t = tone(pid, 3)
    # Each shingle is lit at its lower edge and shadowed under the next row.
    h = 0.45 + (t - 0.5) * 0.3 + v * 0.25 + fbm(N, 32, 3, 9) * 0.08
    side = np.minimum(u, 1 - u) * 30
    h *= np.clip(side, 0.3, 1)
    h *= np.clip((1 - v) * 14, 0.35, 1)
    return h


def masonry():
    row, pid, u, v = rows(9, N, 21, 0.18, 0.42)
    t = tone(pid, 7)
    lump = fbm(N, 24, 4, 23)
    # Rounded block faces with rough mortar joints between.
    eu = np.minimum(u, 1 - u) * 6
    ev = np.minimum(v, 1 - v) * 3
    face = np.clip(np.minimum(eu, ev), 0, 1) ** 0.5
    joint = face < 0.25 + lump * 0.2
    h = 0.5 + (t - 0.5) * 0.4 + lump * 0.2
    h = np.where(joint, 0.18 + lump * 0.1, h * (0.75 + 0.25 * face))
    return blur(h, 1)


def plaster():
    return 0.55 + fbm(N, 6, 5, 31) * 0.25 + fbm(N, 48, 3, 33) * 0.08


def main():
    chans = [norm01(c) * 0.9 + 0.05 for c in (planks(), shingles(), masonry(), plaster())]
    # Recentre each channel so its mean sits at 0.5 (keeps the prop colour honest).
    chans = [np.clip(c - c.mean() + 0.5, 0, 1) for c in chans]
    img = np.dstack(chans)
    os.makedirs(OUT, exist_ok=True)
    Image.fromarray((img * 255 + 0.5).astype(np.uint8), 'RGBA').save(os.path.join(OUT, 'props_detail.png'))
    print('wrote props_detail.png')


if __name__ == '__main__':
    main()
