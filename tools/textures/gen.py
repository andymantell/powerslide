"""Generates the tileable ground textures in src/assets/textures.

Each surface gets two WebP files:
  <name>_albedo.webp  RGB albedo (sRGB), A = height (used for height blending)
  <name>_normal.webp  RGB tangent-space normal

Run from the repo root with a Python that has numpy, scipy and pillow:
  python tools/textures/gen.py [names...]
Biomes can add palettes here and regenerate; everything is seeded so the
output is reproducible.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
from noise import blur, fbm, hexcol, lerp, normal_from_height, perlin, smoothstep, warp, worley  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'assets', 'textures')
N = 1024


def save(name, albedo, height, normal, quality=88):
    os.makedirs(OUT, exist_ok=True)
    a = np.clip(albedo, 0, 1)
    h = np.clip(height, 0, 1)
    rgba = np.dstack([a, h])
    Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), 'RGBA').save(
        os.path.join(OUT, f'{name}_albedo.webp'), quality=quality, alpha_quality=60, method=6)
    Image.fromarray((np.clip(normal, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGB').save(
        os.path.join(OUT, f'{name}_normal.webp'), quality=quality, method=6)
    print('wrote', name)


def norm01(x):
    return (x - x.min()) / (x.max() - x.min() + 1e-9)


def strokes(size, count, seed, length, width, angle_spread, colour_fn, base=None, scale=4):
    """Draws short blade-like strokes with wrap-around. Returns (rgb, height)."""
    big = size * scale // 4
    rng = np.random.default_rng(seed)
    img = Image.new('RGB', (big, big), (0, 0, 0)) if base is None else Image.fromarray((base * 255).astype(np.uint8)).resize((big, big))
    hgt = Image.new('L', (big, big), 0)
    d = ImageDraw.Draw(img)
    dh = ImageDraw.Draw(hgt)
    k = big / size
    for _ in range(count):
        x, y = rng.uniform(0, big, 2)
        ang = rng.normal(0, angle_spread) + rng.choice([0, np.pi])
        ln = rng.uniform(*length) * k
        x2 = x + np.cos(ang) * ln
        y2 = y + np.sin(ang) * ln
        c, hv = colour_fn(rng)
        w = max(1, int(round(rng.uniform(*width) * k)))
        for ox in (-big, 0, big):
            for oy in (-big, 0, big):
                if (0 <= x + ox < big or 0 <= x2 + ox < big) and (0 <= y + oy < big or 0 <= y2 + oy < big):
                    d.line([(x + ox, y + oy), (x2 + ox, y2 + oy)], fill=c, width=w)
                    dh.line([(x + ox, y + oy), (x2 + ox, y2 + oy)], fill=hv, width=w)
    img = img.resize((size, size), Image.LANCZOS)
    hgt = hgt.resize((size, size), Image.LANCZOS)
    return np.asarray(img) / 255.0, np.asarray(hgt) / 255.0


def grass(name='grass', pal=None, seed=1, blades=(5, 16), count=70000):
    pal = pal or dict(soil='#3a3122', dark='#30431b', mid='#4b6127', light='#6f853b', dry='#9a9058')
    soil, dark, mid, light, dry = (hexcol(pal[k]) for k in ('soil', 'dark', 'mid', 'light', 'dry'))
    macro = norm01(fbm(N, 4, 5, seed))
    clump = norm01(fbm(N, 16, 4, seed + 3))
    dryness = smoothstep(0.55, 0.85, norm01(fbm(N, 6, 4, seed + 7)))
    base = lerp(soil, dark, smoothstep(0.25, 0.5, clump))
    base = lerp(base, mid, smoothstep(0.5, 0.8, clump) * 0.6)

    def blade(rng):
        t = rng.random()
        c = lerp(dark, light, t ** 0.8)
        if rng.random() < 0.12:
            c = lerp(c, dry, rng.uniform(0.3, 0.8))
        c = c * rng.uniform(0.8, 1.15)
        return tuple(int(v * 255) for v in np.clip(c, 0, 1)), int(110 + t * 145)

    rgb, h = strokes(N, count, seed, blades, (1.0, 2.2), np.pi, blade, base=base, scale=8)
    # Tint by macro variation and dry patches.
    rgb = rgb * (0.85 + macro[..., None] * 0.3)
    lum = rgb.mean(-1, keepdims=True)
    rgb = lerp(rgb, lum * dry / dry.mean(), dryness * 0.55)
    if 'heather' in pal:
        # Moorland: low heather clumps (purple-brown) and rusty bracken.
        heather = smoothstep(0.55, 0.7, norm01(fbm(N, 8, 4, seed + 11))) * (0.6 + 0.4 * norm01(fbm(N, 64, 2, seed + 12)))
        rgb = lerp(rgb, hexcol(pal['heather']) * (0.8 + 0.4 * h[..., None]), heather[..., None] * 0.6)
        h = np.maximum(h, heather * 0.8)
    height = norm01(h * 0.75 + clump * 0.25)
    save(name, rgb, height, normal_from_height(blur(height, 1), 3.0), quality=72)


def moor():
    """Dartmoor: tussocky moor grass, bracken and heather."""
    grass('moor', dict(soil='#3a2d22', dark='#45481f', mid='#6b6a33', light='#a09a58', dry='#a26f3c', heather='#4f3a38'), seed=3)
    # Tussocks: tawny moor grass, gorse yellow in the flowering clumps.
    tuft('moor_tuft', dict(dark='#3c3a1f', mid='#605b35', light='#8a8150', dry='#94704a', flowers=['#e6b81a', '#d9a514']), seed=83)


def lawn():
    """Hillside Suburbs: short, even, well-watered lawn grass."""
    grass('lawn', dict(soil='#2f3a1c', dark='#3a5a1f', mid='#567a2c', light='#7a9e3e', dry='#97a050'), seed=5, blades=(3, 8), count=110000)
    # Garden tufts: long grass and a few daisies and dandelions.
    tuft('lawn_tuft', dict(dark='#36521c', mid='#55782b', light='#7da343', dry='#9da455', flowers=['#f4f4ee', '#f2cf1d']), seed=85)


def paving(name='paving', seed=91):
    """Pavement: 600 mm concrete flags (4 x 4 per 2.4 m tile), laid in
    staggered rows, each flag its own shade, with sandy joints, chewing-gum
    spots, a few cracks and dark weathering at the edges."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    cell = N / 4
    row = np.floor(yy / cell)
    sx = xx + (row % 2) * cell * 0.5  # stagger alternate rows
    col_i = np.floor(sx / cell) % 4
    fx, fy = (sx % cell) / cell, (yy % cell) / cell
    edge = np.minimum(np.minimum(fx, 1 - fx), np.minimum(fy, 1 - fy))
    joint = 1 - smoothstep(0.004, 0.012, edge)
    shade = rng.uniform(0.86, 1.08, (4, 4))[row.astype(int) % 4, col_i.astype(int)]
    tone = norm01(fbm(N, 8, 4, seed + 1))
    grain = fbm(N, 220, 2, seed + 2)
    base = hexcol('#a9a59c')
    col = base * shade[..., None] * (0.9 + tone[..., None] * 0.18) * (0.94 + grain[..., None] * 0.2)
    # Weathering darkens the rims of each flag; joints are dark sand and grit.
    col = col * (1 - (1 - smoothstep(0.0, 0.08, edge))[..., None] * 0.12)
    col = lerp(col, hexcol('#5e584c'), joint[..., None] * 0.85)
    # Chewing gum and drips: small pale and dark spots.
    spots = rng.random((N, N)) < 0.00012
    gum = blur(spots.astype(np.float32), 2) * 60
    col = lerp(col, hexcol('#c9c6bd'), np.clip(gum, 0, 1)[..., None] * 0.7)
    stain = smoothstep(0.62, 0.8, norm01(fbm(N, 12, 4, seed + 3)))
    col = col * (1 - stain[..., None] * 0.09)
    # Hairline cracks in a few flags.
    crack = smoothstep(0.993, 1.0, 1 - np.abs(fbm(N, 6, 2, seed + 4))) * (rng.random((4, 4))[row.astype(int) % 4, col_i.astype(int)] < 0.3)
    col = col * (1 - crack[..., None] * 0.2)
    h = norm01((1 - joint) * 0.8 + grain * 0.1 - crack * 0.3 + smoothstep(0.0, 0.05, edge) * 0.1)
    save(name, col, h, normal_from_height(h, 4.0))


def ridged(size, period, octaves, seed):
    s = np.zeros((size, size))
    amp, norm, p = 1.0, 0.0, period
    for o in range(octaves):
        if p > size // 2:
            break
        r = 1 - np.abs(perlin(size, p, seed + o * 31))
        s += amp * r * r
        norm += amp
        amp *= 0.5
        p *= 2
    return s / norm


def rock(name='rock', pal=None, seed=11, speckle=0.005, crystal=0.0):
    """Jointed rock as seen in a road cutting: bedding planes split into
    blocks by vertical joints, each block a slightly tilted facet with
    chamfered edges and dark open cracks between them."""
    pal = pal or dict(a='#6e6962', b='#8f887d', c='#3e3a36', stain='#7d5a3c', lichen='#8c8c5e', speck='#cfc9bd')
    a, b, c, stain, lichen, speck = (hexcol(pal[k]) for k in ('a', 'b', 'c', 'stain', 'lichen', 'speck'))
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    # Warp so beds undulate and joints wander.
    Y = (yy + fbm(N, 2, 4, seed) * 70 + fbm(N, 8, 3, seed + 1) * 6) % N
    X = (xx + fbm(N, 3, 4, seed + 2) * 40 + fbm(N, 6, 3, seed + 3) * 22 + (yy - N / 2) * 0.12 * fbm(N, 1, 1, seed + 4)) % N
    # Bed thicknesses that sum exactly to N so the texture tiles.
    th = rng.uniform(0.6, 1.6, 9)
    bounds = np.concatenate([[0], np.cumsum(th / th.sum() * N)])
    bed = np.clip(np.searchsorted(bounds, Y, 'right') - 1, 0, len(th) - 1)
    y0, y1 = bounds[bed], bounds[bed + 1]
    dy = np.minimum(Y - y0, y1 - Y)
    v = (Y - y0) / (y1 - y0)
    h = np.zeros((N, N), np.float32)
    dx = np.zeros((N, N), np.float32)
    u = np.zeros((N, N), np.float32)
    blk = np.zeros((N, N), np.float32)
    bedtone = np.zeros((N, N), np.float32)
    for k in range(len(th)):
        m = bed == k
        n = rng.integers(3, 7)
        jt = np.sort((rng.uniform(0, 1, n) * 0.6 + np.arange(n) / n) % 1.0 * N)
        jt = np.sort(jt)
        Xk = X[m]
        Xs = np.where(Xk < jt[0], Xk + N, Xk)
        edges = np.concatenate([jt, [jt[0] + N]])
        j = np.clip(np.searchsorted(edges, Xs, 'right') - 1, 0, n - 1)
        x0, x1 = edges[j], edges[j + 1]
        dx[m] = np.minimum(Xs - x0, x1 - Xs)
        u[m] = (Xs - x0) / (x1 - x0)
        r = rng.random((n, 4))
        blk[m] = r[j, 0]
        # Each block is a gently tilted facet.
        h[m] = 0.55 + (r[j, 0] - 0.5) * 0.3 + (r[j, 1] - 0.5) * 0.5 * (u[m] - 0.5) + (r[j, 2] - 0.5) * 0.4 * (v[m] - 0.5)
        bedtone[m] = rng.uniform(0.85, 1.12)
    # Ragged edges; some joints are tight and barely show.
    rag = fbm(N, 32, 3, seed + 12) * 7
    open_j = smoothstep(0.35, 0.65, norm01(fbm(N, 4, 3, seed + 13)))
    open_b = smoothstep(0.2, 0.5, norm01(fbm(N, 3, 3, seed + 14)))
    edge = np.minimum(dx + rag + (1 - open_j) * 30, dy + rag * 0.7 + (1 - open_b) * 30)
    # Chamfered block edges and open cracks.
    h = h * (0.6 + 0.4 * smoothstep(0, 18, edge))
    crack = (1 - smoothstep(0.5, 3.5, edge))
    detail = fbm(N, 48, 4, seed + 6)
    grain = fbm(N, 12, 4, seed + 7)
    f1, f2, _ = worley(N, 24, seed + 15)
    chips = smoothstep(0.0, 0.25, f2 - f1)
    h = h + detail * 0.1 + grain * 0.18 + chips * 0.06 + ridged(N, 8, 4, seed + 16) * 0.12
    h = norm01(blur(h, 1)) * (1 - crack * 0.6)
    tone = norm01(fbm(N, 4, 4, seed + 5))
    col = lerp(c, a, smoothstep(0.15, 0.55, h))
    col = lerp(col, b, smoothstep(0.55, 0.9, h) * (0.35 + tone * 0.65))
    col = col * (0.88 + blk[..., None] * 0.2) * bedtone[..., None] * (0.85 + grain[..., None] * 0.45)
    # Rust staining running down from the bedding cracks.
    row = perlin(N, 64, seed + 20)[0]
    streak = norm01(row[xx.astype(int)]) * np.exp(-(Y - y0) / 60)
    col = lerp(col, stain, smoothstep(0.35, 0.8, streak) * 0.45)
    sp = rng.random((N, N))
    col = lerp(col, speck, (sp > 1 - speckle) * 0.3)
    if crystal:
        # Coarse crystalline grain: pale feldspar and dark mica flecks.
        g = blur(np.random.default_rng(seed + 30).random((N, N)), 1)
        col = col * (1 + (norm01(g)[..., None] - 0.5) * crystal)
    col = lerp(col, c * 0.35, crack * 0.9)
    lich = smoothstep(0.68, 0.82, norm01(fbm(N, 10, 4, seed + 9))) * smoothstep(0.5, 0.7, h)
    col = lerp(col, lichen, lich * 0.45)
    save(name, col, h, normal_from_height(h, 7.0))


def granite():
    """Dartmoor granite: pale, coarse and speckled, with white and
    yellow lichen."""
    rock('granite', dict(a='#8b877f', b='#aaa59b', c='#4b4842', stain='#86745c', lichen='#c9c49a', speck='#e8e4da'), seed=17, speckle=0.02, crystal=0.9)


def stones(size, cells, seed, gap=0.06, round_=0.35, vary=0.0):
    """Angular stones from voronoi cells: returns (height 0..1 dome, cell id, mask).
    `vary` shrinks stones by a random amount per cell so they don't tessellate."""
    f1, f2, cid = worley(size, cells, seed, 0.95)
    edge = f2 - f1
    gap = gap + (cid * 37 % 1) * vary
    mask = smoothstep(gap, gap + 0.05, edge)
    dome = smoothstep(gap, gap + round_, edge)
    return dome * mask, cid, mask


def gravel(name='gravel', pal=None, seed=21, cells=22):
    pal = pal or dict(dirt='#6b5d4b', s1='#8c8478', s2='#a39a8c', s3='#6e675e', s4='#9a8670')
    dirt = hexcol(pal['dirt'])
    pals = np.stack([hexcol(pal[k]) for k in ('s1', 's2', 's3', 's4')])
    big, cid, m1 = stones(N, cells, seed, 0.06, 0.3, 0.3)
    small, cid2, m2 = stones(N, cells * 3, seed + 1, 0.08, 0.25, 0.35)
    sel = cid > 0.2  # some cells are dirt
    big = big * sel
    m1 = m1 * sel
    fine = fbm(N, 96, 3, seed + 3)
    h = np.maximum(big * (0.65 + cid * 0.35), small * 0.45 * (1 - m1)) + fine * 0.05
    h = norm01(h)
    sc = pals[(cid * 97).astype(int) % 4] * (0.8 + (cid * 7 % 1)[..., None] * 0.35)
    sc2 = pals[(cid2 * 89).astype(int) % 4] * (0.75 + (cid2 * 5 % 1)[..., None] * 0.35)
    dirtc = dirt * (0.8 + norm01(fbm(N, 8, 4, seed + 4))[..., None] * 0.35)
    col = lerp(dirtc, sc2, m2 * (1 - m1) * 0.85)
    col = lerp(col, sc, m1)
    shade = 0.6 + 0.4 * smoothstep(0.0, 0.6, h)
    col = col * shade[..., None] * (0.94 + fine[..., None] * 0.5)
    save(name, col, h, normal_from_height(h, 10.0))


def asphalt(name='asphalt', seed=31):
    # About 2.5 m of road per tile: angular aggregate in a worn binder.
    binder = hexcol('#3d3d3f')
    s1, cid, m1 = stones(N, 70, seed, 0.08, 0.25, 0.2)
    s2, cid2, m2 = stones(N, 150, seed + 1, 0.12, 0.2)
    sel1 = cid > 0.45
    sel2 = (cid2 > 0.55) * (1 - m1 * sel1)
    tone = norm01(fbm(N, 6, 4, seed + 2))
    fine = fbm(N, 160, 2, seed + 3)
    h = np.maximum(s1 * sel1 * (0.7 + cid * 0.3), s2 * sel2 * 0.5) + fine * 0.1
    h = norm01(blur(h, 1))
    v1 = 0.34 + (cid * 13 % 1) * 0.22
    v2 = 0.3 + (cid2 * 11 % 1) * 0.25
    col = binder * (0.85 + tone[..., None] * 0.3)
    col = lerp(col, np.stack([v2, v2, v2 * 1.02], -1), m2 * sel2 * 0.8)
    col = lerp(col, np.stack([v1, v1 * 0.98, v1 * 0.95], -1), m1 * sel1 * 0.9)
    col = col * (0.95 + fine[..., None] * 0.35)
    save(name, col, h, normal_from_height(h, 6.0))


def snow(name='snow', seed=41):
    h = norm01(fbm(N, 6, 6, seed) * 0.7 + fbm(N, 48, 3, seed + 1) * 0.3)
    col = lerp(hexcol('#c9d3e0'), hexcol('#f4f6fa'), smoothstep(0.2, 0.7, h))
    save(name, col, h, normal_from_height(h, 2.5))


def needles():
    """Pine Forest: a floor of fallen needles, with moss and the odd cone."""
    soil, dark, mid, light, moss = (hexcol(c) for c in ('#241b14', '#3a2b1f', '#5e4632', '#83674a', '#4a6327'))
    macro = norm01(fbm(N, 4, 5, 13))
    base = lerp(soil, dark, macro[..., None] * 0.8)

    def needle(rng):
        t = rng.random()
        c = lerp(dark, light, t ** 1.3) * rng.uniform(0.85, 1.1)
        return tuple(int(v * 255) for v in np.clip(c, 0, 1)), int(90 + t * 120)

    # Long thin needles lying every which way.
    rgb, h = strokes(N, 90000, 15, (10, 26), (0.7, 1.2), np.pi, needle, base=base, scale=8)
    mossy = smoothstep(0.5, 0.72, norm01(fbm(N, 6, 5, 17) + fbm(N, 48, 3, 23) * 0.35))[..., None]
    fine = norm01(fbm(N, 96, 3, 19))[..., None]
    rgb = lerp(rgb, moss * (0.6 + 0.6 * fine), mossy * 0.7)
    h = np.maximum(h, mossy[..., 0] * (0.5 + fine[..., 0] * 0.3))
    f1, _, cid = worley(N, 40, 21)
    cone = smoothstep(0.12, 0.06, f1) * (cid > 0.9)
    rgb = lerp(rgb, hexcol('#5a3a20') * (0.7 + 0.5 * fine), cone[..., None])
    h = np.maximum(h, cone)
    rgb = rgb * (0.88 + macro[..., None] * 0.24)
    height = norm01(h)
    save('needles', rgb, height, normal_from_height(blur(height, 1), 3.0), quality=72)
    # Ferns and bilberry under the pines.
    fern('fern_tuft', seed=87)


def fern(name='fern_tuft', seed=87, size=512):
    """Alpha-tested fern clump cards, side view: two tiles, bracken and a lighter fern."""
    S = size * 4
    rng = np.random.default_rng(seed)
    img = Image.new('RGBA', (S * 2, S), (0, 0, 0, 0))

    def c8(c, a=255):
        return tuple(int(v * 255) for v in np.clip(c, 0, 1)) + (a,)

    for tile, (dark, light) in enumerate(((hexcol('#25401a'), hexcol('#5c7f2c')), (hexcol('#3b5a1e'), hexcol('#86a440')))):
        part = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        d = ImageDraw.Draw(part)
        for _ in range(16 if tile == 0 else 22):
            # A frond arches up and out from the crown at the bottom centre.
            ang = -np.pi / 2 + rng.normal(0, 0.55)
            L = S * rng.uniform(0.45, 0.85)
            curl = rng.uniform(0.6, 1.4) * np.sign(np.cos(ang) + 1e-3)
            x, y = S * 0.5 + rng.normal(0, S * 0.03), S - 2
            n = 40
            pts = []
            for i in range(n + 1):
                t = i / n
                a = ang + curl * t * t
                pts.append((x, y, t, a))
                x += np.cos(a) * L / n
                y += np.sin(a) * L / n
            shade = rng.random()
            for x, y, t, a in pts[3:]:
                pl = S * 0.09 * np.sin(min(1.0, t * 1.15) * np.pi) * (1 - t * 0.5)
                for side in (-1, 1):
                    pa = a + side * 1.15
                    col = lerp(dark, light, 0.3 + 0.5 * shade + 0.2 * t) * rng.uniform(0.85, 1.1)
                    tip = (x + np.cos(pa) * pl, y + np.sin(pa) * pl + pl * 0.3)
                    d.line([(x, y), tip], fill=c8(col), width=max(2, int(S * 0.007 * (1 - t * 0.6))))
            d.line([(p[0], p[1]) for p in pts], fill=c8(dark * 0.8), width=max(2, int(S * 0.004)))
        img.paste(part, (tile * S, 0))
    img = img.resize((size * 2, size), Image.LANCZOS)
    arr = np.asarray(img) / 255.0
    rgb, alpha = arr[..., :3], arr[..., 3]
    rgb = np.where(alpha[..., None] > 0, rgb / np.maximum(alpha[..., None], 1e-3), 0)
    rgb = bleed(rgb, alpha)
    rgba = np.dstack([np.clip(rgb, 0, 1), alpha])
    Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), 'RGBA').save(
        os.path.join(OUT, f'{name}.webp'), quality=85, alpha_quality=80, method=6)
    print('wrote', name)


def bleed(rgb, alpha, passes=24):
    """Spreads opaque colours into transparent pixels so mipmaps don't fringe."""
    rgb = rgb.copy()
    known = alpha > 0.5
    for _ in range(passes):
        acc = np.zeros_like(rgb)
        cnt = np.zeros(alpha.shape)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            k = np.roll(known, (dy, dx), (0, 1))
            acc += np.roll(rgb, (dy, dx), (0, 1)) * k[..., None]
            cnt += k
        fill = (~known) & (cnt > 0)
        rgb[fill] = acc[fill] / cnt[fill][:, None]
        known = known | fill
    rgb[~known] = rgb[known].mean(0)
    return rgb


def twig(name='spruce_twig', pal=None, seed=51, size=512, needle=1.0, spread=(0.5, 1.3), branches=2, flowers=None):
    """Alpha-tested branch card: a spruce shoot seen from above, stem at the bottom centre.
    flowers: colours of small pea flowers dotted along the outer shoots (gorse)."""
    pal = pal or dict(dark='#16281a', light='#3d5a30', tip='#6c8a40', stem='#4a3426')
    dark, light, tip, stem = (hexcol(pal[k]) for k in ('dark', 'light', 'tip', 'stem'))
    S = size * 4
    rng = np.random.default_rng(seed)
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def c8(c, a=255):
        return tuple(int(v * 255) for v in np.clip(c, 0, 1)) + (a,)

    def shoot(x0, y0, ang, length, width, depth):
        # Needles first (behind), then the stem on top.
        n = int(length / (S * 0.006))
        pts = []
        x, y = x0, y0
        for i in range(n + 1):
            t = i / n
            a = ang + rng.normal(0, 0.03)
            pts.append((x, y, t, a))
            x += np.cos(a) * length / n
            y += np.sin(a) * length / n
        for x, y, t, a in pts:
            for side in (-1, 1):
                for _ in range(1 if rng.random() < 0.6 else 2):
                    na = a + side * rng.uniform(*spread)
                    nl = S * rng.uniform(0.022, 0.032) * needle * (1 - t * 0.35) * (width / 1.0)
                    shade = rng.random()
                    col = lerp(dark, light, shade)
                    col = lerp(col, tip, smoothstep(0.75, 1.0, t) * 0.7)
                    d.line([(x, y), (x + np.cos(na) * nl, y + np.sin(na) * nl)], fill=c8(col), width=max(2, int(S * 0.0035)))
        d.line([(p[0], p[1]) for p in pts], fill=c8(stem * 0.9), width=max(2, int(S * 0.004 * width)))
        if depth > 0:
            for i in range(3, n - 3, 3):
                x, y, t, a = pts[i]
                side = 1 if (i // 2) % 2 else -1
                shoot(x, y, a + side * rng.uniform(0.8, 1.15), length * (1 - t * 0.8) * rng.uniform(0.3, 0.45), width * 0.75, depth - 1)
        tips.extend(p for p in pts if p[2] > 0.25)

    tips = []
    shoot(S * 0.5, S * 0.98, -np.pi / 2, S * 0.9, 1.0, branches)
    if flowers:
        fc = [hexcol(c) for c in flowers]
        for _ in range(len(tips) // 8):
            x, y, t, a = tips[rng.integers(len(tips))]
            x, y = x + rng.normal(0, S * 0.012), y + rng.normal(0, S * 0.012)
            col = fc[rng.integers(len(fc))] * rng.uniform(0.8, 1.05)
            # A pea flower: a round standard petal over two small wings.
            r = S * rng.uniform(0.006, 0.009)
            for dx, dy, k in ((-0.7, 0.5, 0.6), (0.7, 0.5, 0.6), (0, -0.2, 1.0)):
                cx, cy, rr = x + dx * r, y + dy * r, r * k
                d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=c8(col * (0.85 if k < 1 else 1.0)))
    img = img.resize((size, size), Image.LANCZOS)
    arr = np.asarray(img) / 255.0
    rgb, alpha = arr[..., :3], arr[..., 3]
    rgb = np.where(alpha[..., None] > 0, rgb / np.maximum(alpha[..., None], 1e-3), 0)
    rgb = bleed(rgb, alpha)
    os.makedirs(OUT, exist_ok=True)
    rgba = np.dstack([np.clip(rgb, 0, 1), alpha])
    Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), 'RGBA').save(os.path.join(OUT, f'{name}.png'), optimize=True)
    print('wrote', name)


def gorse():
    """Gorse: dark, spiny shoots thick with yellow pea flowers."""
    twig('gorse_twig', dict(dark='#1e2e16', light='#3c5226', tip='#56702e', stem='#4a3e26'), seed=57, needle=0.8,
         spread=(0.3, 0.9), branches=2, flowers=['#f2c420', '#e8b417', '#f7d238'])


def pine_twig(name='pine_twig', seed=53, size=512):
    """Pine shoots: a fan of stout shoots, each a brush of long needles swept forward."""
    dark, light, tip, stem = (hexcol(c) for c in ('#1b3020', '#45663a', '#7f9c55', '#6a4a30'))
    S = size * 4
    rng = np.random.default_rng(seed)
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def c8(c, a=255):
        return tuple(int(v * 255) for v in np.clip(c, 0, 1)) + (a,)

    x0, y0 = S * 0.5, S * 0.98
    shoots = [(-np.pi / 2, 0.78)] + [(-np.pi / 2 + s * rng.uniform(0.35, 0.75), rng.uniform(0.45, 0.6)) for s in (-1, 1, -1, 1)]
    stems = []
    for ang, frac in shoots:
        # Side shoots start part way up the main one.
        bx, by = (x0, y0) if frac > 0.7 else (x0, y0 - S * rng.uniform(0.15, 0.35))
        L = S * frac
        n = 60
        pts = [(bx + np.cos(ang) * L * i / n, by + np.sin(ang) * L * i / n, i / n) for i in range(n + 1)]
        stems.append(pts)
        for x, y, t in pts[int(n * 0.12):]:
            for _ in range(5):
                na = ang + rng.choice((-1, 1)) * rng.uniform(0.15, 0.75)
                nl = S * rng.uniform(0.09, 0.14) * (1 - 0.35 * t)
                col = lerp(dark, light, rng.random()) 
                col = lerp(col, tip, smoothstep(0.7, 1.0, t) * 0.6)
                d.line([(x, y), (x + np.cos(na) * nl, y + np.sin(na) * nl)], fill=c8(col), width=max(2, int(S * 0.003)))
    for pts in stems:
        d.line([(p[0], p[1]) for p in pts[: int(len(pts) * 0.5)]], fill=c8(stem), width=int(S * 0.008))
    img = img.resize((size, size), Image.LANCZOS)
    arr = np.asarray(img) / 255.0
    rgb, alpha = arr[..., :3], arr[..., 3]
    rgb = np.where(alpha[..., None] > 0, rgb / np.maximum(alpha[..., None], 1e-3), 0)
    rgb = bleed(rgb, alpha)
    rgba = np.dstack([np.clip(rgb, 0, 1), alpha])
    Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), 'RGBA').save(os.path.join(OUT, f'{name}.png'), optimize=True)
    print('wrote', name)


# Broadleaf sprays for the ez-tree trees (tools/trees/build.mjs): a twig with
# its leaves seen from above, stem at the bottom centre like the conifer
# twigs. Each species sets the leaf outline, size, count and colours.
LEAVES = {
    # Pedunculate oak: lobed leaves in bunches at the shoot tips, dark green.
    'oak': dict(shape='lobed', lobes=4, n=80, length=(0.13, 0.2), width=0.5,
                pal=('#26391a', '#4d6b2a', '#6f8a3a'), stem='#4a3a2a', seed=71),
    # Ash: long compound leaves of paired leaflets, fresh mid green.
    'ash': dict(shape='pinnate', pairs=5, n=26, length=(0.24, 0.32), width=0.3,
                pal=('#30481d', '#5c7d30', '#86a24a'), stem='#5a5040', seed=72),
    # Rowan: smaller, toothed compound leaves and bunches of red berries.
    'rowan': dict(shape='pinnate', pairs=6, n=26, length=(0.2, 0.28), width=0.28, teeth=True,
                  pal=('#2c4319', '#557530', '#7a9640'), stem='#5a4a3a', berries='#b8321e', seed=73),
    # Silver birch: small, pointed, bright yellow-green leaves, many of them.
    'birch': dict(shape='ovate', n=150, length=(0.07, 0.1), width=0.62, tip=0.7, teeth=True,
                  pal=('#3a5320', '#6f8f33', '#a3b952'), stem='#3c2e26', seed=74),
    # Hawthorn: tiny, deeply lobed dark leaves, dense, with a few red haws.
    'hawthorn': dict(shape='lobed', lobes=3, n=190, length=(0.06, 0.085), width=0.75,
                     pal=('#1f3216', '#3f5c24', '#5c7a30'), stem='#3a2c22', berries='#8e1f18', seed=75),
}


def leaf_outline(shape, L, W, lobes=5, tip=0.5, teeth=False, rng=None, n=60):
    """Half-widths along a leaf of length L: returns (t, w) pairs."""
    out = []
    for i in range(n + 1):
        t = i / n
        if shape == 'ovate':
            w = np.sin(np.pi * t ** tip) * W * 0.5 * (1 - t ** 3)
        else:  # lobed
            w = np.sin(np.pi * t ** 0.75) * W * 0.5
            w *= 0.62 + 0.38 * abs(np.sin(t * np.pi * (lobes + 0.5)))
        if teeth and i % 3 == 0:
            w *= 0.9
        out.append((t * L, w))
    return out


def leaf_twig(name):
    sp = LEAVES[name]
    size = 512
    S = size * 4
    rng = np.random.default_rng(sp['seed'])
    dark, mid, light = (hexcol(c) for c in sp['pal'])
    stem = hexcol(sp['stem'])
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def c8(c, a=255):
        return tuple(int(v * 255) for v in np.clip(c, 0, 1)) + (a,)

    def blade(x, y, ang, L, W, shape, col):
        pts = leaf_outline(shape, L, W, sp.get('lobes', 5), sp.get('tip', 0.5), sp.get('teeth', False), rng)
        ca, sa = np.cos(ang), np.sin(ang)
        left = [(x + ca * a - sa * w, y + sa * a + ca * w) for a, w in pts]
        right = [(x + ca * a + sa * w, y + sa * a - ca * w) for a, w in pts[::-1]]
        d.polygon(left + right, fill=c8(col))
        # Paler midrib.
        d.line([(x, y), (x + ca * L * 0.85, y + sa * L * 0.85)], fill=c8(lerp(col, light, 0.5)), width=max(2, int(S * 0.002)))

    def leaf(x, y, ang, L):
        shade = rng.random()
        col = lerp(dark, mid, shade)
        col = lerp(col, light, rng.random() ** 3 * 0.8)
        if sp['shape'] == 'pinnate':
            # A rachis with paired leaflets and one at the tip.
            ca, sa = np.cos(ang), np.sin(ang)
            d.line([(x, y), (x + ca * L, y + sa * L)], fill=c8(lerp(col, stem, 0.5)), width=max(2, int(S * 0.003)))
            pairs = sp['pairs']
            for k in range(pairs):
                t = 0.18 + 0.78 * k / pairs
                px, py = x + ca * L * t, y + sa * L * t
                ll = L * 0.36 * (1 - 0.25 * t)
                for side in (-1, 1):
                    blade(px, py, ang + side * rng.uniform(0.7, 1.0), ll, ll * sp['width'], 'ovate', lerp(col, light, rng.random() * 0.25))
            blade(x + ca * L * 0.95, y + sa * L * 0.95, ang, L * 0.32, L * 0.32 * sp['width'], 'ovate', col)
        else:
            blade(x, y, ang, L, L * sp['width'], sp['shape'], col)

    # The twig: a main stem up the middle with side shoots, leaves along all
    # of them, more towards the tips.
    x0, y0 = S * 0.5, S * 0.98
    shoots = [(x0, y0, -np.pi / 2, S * 0.85)]
    for k in range(6):
        t = 0.2 + 0.12 * k
        side = 1 if k % 2 else -1
        shoots.append((x0, y0 - S * 0.85 * t, -np.pi / 2 + side * rng.uniform(0.7, 1.0), S * 0.85 * (1 - t) * rng.uniform(0.75, 0.95)))
    pts = []
    for sx, sy, ang, L in shoots:
        n = 30
        line = []
        a = ang
        x, y = sx, sy
        for i in range(n + 1):
            line.append((x, y))
            pts.append((x, y, a, i / n))
            a += rng.normal(0, 0.02)
            x += np.cos(a) * L / n
            y += np.sin(a) * L / n
        d.line(line, fill=c8(stem), width=max(2, int(S * 0.005)))
    order = rng.permutation(len(pts))
    placed = 0
    for idx in order:
        if placed >= sp['n']:
            break
        x, y, a, t = pts[idx]
        if t < 0.15 or rng.random() > 0.3 + 0.7 * t:
            continue
        L = S * rng.uniform(*sp['length'])
        blade_ang = a + rng.choice((-1, 1)) * rng.uniform(0.35, 1.2)
        # Keep the whole leaf on the card.
        ex, ey = x + np.cos(blade_ang) * L, y + np.sin(blade_ang) * L
        m = S * 0.03
        if not (m < ex < S - m and m < ey < S - m):
            continue
        leaf(x, y, blade_ang, L)
        placed += 1
    if 'berries' in sp:
        bc = hexcol(sp['berries'])
        tips = [p for p in pts if p[3] > 0.5]
        for _ in range(3):
            x, y, a, t = tips[rng.integers(len(tips))]
            for _ in range(9):
                bx, by = x + rng.normal(0, S * 0.02), y + rng.normal(0, S * 0.02)
                r = S * 0.009
                d.ellipse([bx - r, by - r, bx + r, by + r], fill=c8(lerp(bc, bc * 0.6, rng.random())))
    img = img.resize((size, size), Image.LANCZOS)
    arr = np.asarray(img) / 255.0
    rgb, alpha = arr[..., :3], arr[..., 3]
    rgb = np.where(alpha[..., None] > 0, rgb / np.maximum(alpha[..., None], 1e-3), 0)
    rgb = bleed(rgb, alpha)
    rgba = np.dstack([np.clip(rgb, 0, 1), alpha])
    Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), 'RGBA').save(os.path.join(OUT, f'{name}_leaves.png'), optimize=True)
    print('wrote', f'{name}_leaves')


def leaves():
    for name in LEAVES:
        leaf_twig(name)


def birch_bark(name='birch_bark', seed=62):
    """Silver birch: chalky white with dark horizontal lenticels and patches."""
    n = 512
    rng = np.random.default_rng(seed)
    white, grey, black = hexcol('#e9e5dc'), hexcol('#b9b4aa'), hexcol('#26231f')
    h = norm01(fbm(n, 8, 4, seed))
    col = lerp(grey, white, smoothstep(0.25, 0.7, h))
    marks = np.zeros((n, n))
    yy, xx = np.mgrid[0:n, 0:n]
    for _ in range(140):
        # Short dark dashes running around the trunk (u is around, v along).
        cx, cy = rng.integers(n), rng.integers(n)
        L, T = rng.uniform(15, 70), rng.uniform(1.5, 4)
        dx = (xx - cx + n // 2) % n - n // 2
        marks = np.maximum(marks, np.clip(1 - (dx / L) ** 2 - ((yy - cy) / T) ** 2, 0, 1))
    patches = smoothstep(0.7, 0.8, norm01(fbm(n, 6, 3, seed + 1)))
    dark = np.clip(np.maximum(marks * 1.6, patches), 0, 1)
    col = lerp(col, black, dark[..., None] * 0.9)
    hh = norm01(h * 0.3 + (1 - dark) * 0.7)
    old = N
    globals()['N'] = n
    save(name, col, hh, normal_from_height(hh, 4.0))
    globals()['N'] = old


def bark(name='bark', pal=None, seed=61):
    pal = pal or dict(dark='#2e231c', mid='#5a4636', light='#7d6a58')
    dark, mid, light = (hexcol(pal[k]) for k in ('dark', 'mid', 'light'))
    n = 512
    # Vertical plates separated by fissures.
    row = perlin(n, 10, seed)[0] * 0.6 + perlin(n, 24, seed + 1)[0] * 0.4
    xs = (np.arange(n)[None, :] + fbm(n, 3, 4, seed + 2) * 18).astype(int) % n
    plates = norm01(row[xs])
    horiz = norm01(fbm(n, 16, 3, seed + 3))
    fiss = smoothstep(0.45, 0.25, plates)
    h = norm01(plates * 0.7 + horiz * 0.2 + fbm(n, 64, 2, seed + 4) * 0.1 - fiss * 0.4)
    col = lerp(dark, mid, smoothstep(0.2, 0.6, h))
    col = lerp(col, light, smoothstep(0.65, 0.95, h) * horiz)
    old = N
    globals()['N'] = n
    save(name, col, h, normal_from_height(h, 6.0))
    globals()['N'] = old


def deck(name='deck', seed=71):
    """Board textures: bottom graphic (UV: u across, v nose to tail) and grip tape."""
    from PIL import ImageFont
    w, h = 256, 1024
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w]
    # Maple veneer: fine grain running along the board.
    grain = norm01(perlin(h, 8, seed)[:, :w] * 0.4 + fbm(h, 64, 3, seed + 1)[:, :w] * 0.6)
    grain = warp(np.tile(grain[:, :1], (1, w)) * 0.5 + grain * 0.5, fbm(h, 4, 3, seed + 2)[:, :w] * 6, 0)
    wood = lerp(hexcol('#c89a62'), hexcol('#e2bd8a'), grain)
    # Graphic: a bold diagonal band in red with cream pinstripes.
    t = (xx / w * 0.6 + yy / h * 2.2)
    band = smoothstep(0.02, 0.0, np.abs(((t + 0.25) % 1.0) - 0.5) - 0.18)
    pin = smoothstep(0.012, 0.0, np.abs(np.abs(((t + 0.25) % 1.0) - 0.5) - 0.2))
    col = lerp(wood, hexcol('#b3202a'), band * 0.95)
    col = lerp(col, hexcol('#f1e6cf'), pin)
    img = Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8))
    # Word mark along the length.
    try:
        font = ImageFont.truetype('/usr/share/fonts/opentype/inter/Inter-BlackItalic.otf', 120)
    except OSError:
        font = ImageFont.load_default()
    txt = Image.new('RGBA', (h, w), (0, 0, 0, 0))
    d = ImageDraw.Draw(txt)
    box = d.textbbox((0, 0), 'POWERSLIDE', font=font)
    d.text(((h - box[2]) / 2, (w - box[3]) / 2 - box[1] / 2), 'POWERSLIDE', font=font, fill=(20, 20, 22, 235))
    img = img.convert('RGBA')
    img.alpha_composite(txt.rotate(90, expand=True))
    col = np.asarray(img.convert('RGB')) / 255.0
    # Scuffs from slides and kerbs, mostly at the nose and tail.
    scuff = (fbm(h, 32, 3, seed + 5)[:, :w] > 0.35) * smoothstep(0.25, 0.0, np.minimum(yy / h, 1 - yy / h))
    col = lerp(col, wood * 0.9, scuff * 0.8)
    os.makedirs(OUT, exist_ok=True)
    Image.fromarray((np.clip(col, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, f'{name}_graphic.webp'), quality=85)
    # Grip tape: dark silicon-carbide grit.
    g = 0.05 + rng.random((h, w)) * 0.05 + (rng.random((h, w)) > 0.97) * 0.08
    g = blur(g, 0) if False else g
    Image.fromarray((np.clip(np.dstack([g, g, g * 1.05]), 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, f'{name}_grip.webp'), quality=80)
    print('wrote', name)


def tuft(name='grass_tuft', pal=None, seed=81, size=512):
    """Alpha-tested grass clump cards, side view, roots along the bottom edge.

    Two tiles side by side: plain grass, and grass with meadow flowers.
    """
    pal = pal or dict(dark='#2c4219', mid='#4d6a26', light='#7f9a44', dry='#a29a5c',
                      flowers=['#f2d23a', '#f4f1e6', '#b58fd8', '#e8a23a'])
    dark, mid, light, dry = (hexcol(pal[k]) for k in ('dark', 'mid', 'light', 'dry'))
    flowers = [hexcol(c) for c in pal['flowers']]
    S = size * 4
    rng = np.random.default_rng(seed)
    img = Image.new('RGBA', (S * 2, S), (0, 0, 0, 0))

    def c8(c, a=255):
        return tuple(int(v * 255) for v in np.clip(c, 0, 1)) + (a,)

    def blade(x0, h, lean, w):
        # Tapered, curved blade drawn as a polygon from root to tip.
        n = 12
        left, right = [], []
        for i in range(n + 1):
            t = i / n
            x = x0 + lean * t * t * h
            y = S - 2 - t * h * (1 - 0.25 * abs(lean) * t)
            ww = w * (1 - t) ** 0.8
            left.append((x - ww, y))
            right.append((x + ww, y))
        shade = rng.random()
        col = lerp(dark, mid, shade)
        if rng.random() < 0.15:
            col = lerp(col, dry, rng.uniform(0.3, 0.8))
        d.polygon(left + right[::-1], fill=c8(col))
        # Lighter upper half on the lit side.
        d.line(right[n // 3:], fill=c8(lerp(col, light, 0.5)), width=max(1, int(w * 0.5)))
        return left[-1]

    for tile in (0, 1):
        # Each tile is drawn on its own canvas so blades can't cross over.
        ox = 0
        part = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        d = ImageDraw.Draw(part)
        tips = []
        for _ in range(170):
            x0 = ox + S * 0.5 + rng.normal(0, S * 0.13)
            h = S * rng.uniform(0.35, 0.95) * (1 - abs(x0 - ox - S * 0.5) / S)
            lean = (x0 - ox - S * 0.5) / S * 1.1 + rng.normal(0, 0.18)
            tips.append(blade(x0, h, lean, S * rng.uniform(0.006, 0.011)))
        if tile == 1:
            for _ in range(9):
                x0 = ox + S * 0.5 + rng.normal(0, S * 0.12)
                h = S * rng.uniform(0.6, 0.92)
                lean = rng.normal(0, 0.15)
                tx, ty = blade(x0, h, lean, S * 0.005)
                fc = flowers[rng.integers(len(flowers))] * rng.uniform(0.85, 1.05)
                r = S * rng.uniform(0.022, 0.034)
                for k in range(6):
                    a = k / 6 * 2 * np.pi + rng.uniform(0, 0.5)
                    px, py = tx + np.cos(a) * r * 0.6, ty + np.sin(a) * r * 0.35
                    d.ellipse([px - r * 0.5, py - r * 0.3, px + r * 0.5, py + r * 0.3], fill=c8(fc))
                d.ellipse([tx - r * 0.25, ty - r * 0.2, tx + r * 0.25, ty + r * 0.2], fill=c8(hexcol('#c8901e')))
        img.paste(part, (tile * S, 0))
    img = img.resize((size * 2, size), Image.LANCZOS)
    arr = np.asarray(img) / 255.0
    rgb, alpha = arr[..., :3], arr[..., 3]
    rgb = np.where(alpha[..., None] > 0, rgb / np.maximum(alpha[..., None], 1e-3), 0)
    rgb = bleed(rgb, alpha)
    rgba = np.dstack([np.clip(rgb, 0, 1), alpha])
    Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), 'RGBA').save(
        os.path.join(OUT, f'{name}.webp'), quality=85, alpha_quality=80, method=6)
    print('wrote', name)


def sand(name='sand', seed=101):
    # About 5 m of beach per tile: wind ripples over fine grain, a few
    # darker damp hollows and the odd shell fleck.
    t = np.arange(N) / N
    x, y = np.meshgrid(t, t)
    w = fbm(N, 4, 3, seed)
    rip = 0.5 + 0.5 * np.sin(2 * np.pi * (x * 38 + y * 6 + w * 3.0))
    rip = rip ** 1.6 * smoothstep(-0.3, 0.4, fbm(N, 6, 3, seed + 1))
    grain = fbm(N, 256, 2, seed + 2)
    broad = norm01(fbm(N, 3, 4, seed + 3))
    h = norm01(rip * 0.55 + broad * 0.35 + grain * 0.1)
    col = lerp(hexcol('#b39a74'), hexcol('#dcc9a3'), smoothstep(0.15, 0.85, broad)[..., None])
    col = col * (0.9 + rip[..., None] * 0.12) * (0.97 + grain[..., None] * 0.22)
    f1, _, cid = worley(N, 90, seed + 4)
    fleck = (f1 < 0.09) * (cid > 0.93)
    col = lerp(col, hexcol('#efe8dc'), fleck[..., None] * 0.8)
    save(name, col, h, normal_from_height(blur(h, 1), 3.0), quality=75)


def sandstone():
    """Desert Canyon: red and orange sandstone in thick beds."""
    rock('sandstone', dict(a='#a2573a', b='#cf9165', c='#5a2a1a', stain='#7a3420', lichen='#c49a6c', speck='#ecd2ae'), seed=19, speckle=0.004)


def desert():
    """Desert Canyon: red sand and grit with pebbles, dry wisps of grass
    and the odd crust of cracked clay."""
    t = np.arange(N) / N
    broad = norm01(fbm(N, 3, 4, 111))
    grain = fbm(N, 256, 2, 112)
    ripple = 0.5 + 0.5 * np.sin(2 * np.pi * (np.meshgrid(t, t)[0] * 20 + fbm(N, 4, 3, 113) * 2.5))
    col = lerp(hexcol('#9a5434'), hexcol('#c98552'), smoothstep(0.2, 0.85, broad)[..., None])
    col = col * (0.95 + grain[..., None] * 0.2) * (0.97 + ripple[..., None] * 0.05)
    h = norm01(broad * 0.4 + grain * 0.15 + ripple * 0.1)
    # Cracked clay crust in the low patches.
    f1, f2, _ = worley(N, 30, 114)
    crust = smoothstep(0.62, 0.78, norm01(fbm(N, 5, 4, 115)))
    cracks = (1 - smoothstep(0.0, 0.05, f2 - f1)) * crust
    col = lerp(col, hexcol('#d9b08a'), crust[..., None] * 0.45)
    col = lerp(col, hexcol('#5a2c1a'), cracks[..., None] * 0.7)
    h = h * (1 - cracks * 0.5)
    # Pebbles.
    p1, _, pid = worley(N, 120, 116)
    peb = smoothstep(0.16, 0.08, p1) * (pid > 0.6)
    pc = lerp(hexcol('#6a3a28'), hexcol('#b89a80'), pid[..., None])
    col = lerp(col, pc, peb[..., None] * 0.9)
    h = np.maximum(h, peb * 0.9)
    save('desert', col, h, normal_from_height(blur(h, 1), 3.5), quality=75)
    tuft('desert_tuft', dict(dark='#6a5a32', mid='#93804a', light='#c4ae72', dry='#b08a58', flowers=['#e8c22a', '#d86a2a']), seed=89)


ALL = dict(gorse=gorse, grass=grass, rock=rock, gravel=gravel, asphalt=asphalt, snow=snow, twig=twig, bark=bark, deck=deck, tuft=tuft, moor=moor, granite=granite, lawn=lawn, paving=paving, sand=sand, needles=needles, pine_twig=pine_twig, sandstone=sandstone, desert=desert, leaves=leaves, birch_bark=birch_bark)

if __name__ == '__main__':
    # These now ship as library textures (tools/textures/library.py), so they
    # are only regenerated here when named. needles and desert also write
    # fern_tuft and desert_tuft: name them, then rerun library.py.
    from library import PICKS
    for n in sys.argv[1:] or [n for n in ALL if n not in PICKS]:
        ALL[n]()
