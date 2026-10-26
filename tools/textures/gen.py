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


def grass(name='grass', pal=None, seed=1):
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

    rgb, h = strokes(N, 70000, seed, (5, 16), (1.0, 2.2), np.pi, blade, base=base, scale=8)
    # Tint by macro variation and dry patches.
    rgb = rgb * (0.85 + macro[..., None] * 0.3)
    lum = rgb.mean(-1, keepdims=True)
    rgb = lerp(rgb, lum * dry / dry.mean(), dryness * 0.55)
    height = norm01(h * 0.75 + clump * 0.25)
    save(name, rgb, height, normal_from_height(blur(height, 1), 3.0), quality=72)


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


def rock(name='rock', pal=None, seed=11):
    pal = pal or dict(a='#6a655f', b='#8a847a', c='#46423e', stain='#7a5f45', lichen='#8a8a62', speck='#c9c3b8')
    a, b, c, stain, lichen, speck = (hexcol(pal[k]) for k in ('a', 'b', 'c', 'stain', 'lichen', 'speck'))
    wx = fbm(N, 3, 5, seed) * 60
    wy = fbm(N, 3, 5, seed + 1) * 60
    rid = warp(ridged(N, 4, 6, seed + 2), wx, wy)
    facet = norm01(warp(fbm(N, 5, 6, seed + 4, gain=0.6), wx * 0.5, wy * 0.5))
    detail = fbm(N, 64, 3, seed + 6)
    f1, f2, cid = worley(N, 6, seed + 7)
    f1, f2, cid = warp(f1, wx, wy), warp(f2, wx, wy), warp(cid, wx, wy)
    mask = smoothstep(0.55, 0.7, norm01(fbm(N, 5, 3, seed + 3)))
    crack = (1 - smoothstep(0.0, 0.03, f2 - f1)) * mask
    # Faceted, blocky relief: terrace the facet noise a little.
    terr = facet * 5
    terr = (np.floor(terr) + smoothstep(0.0, 0.35, terr - np.floor(terr))) / 5
    h = terr * 0.4 + rid * 0.45 + detail * 0.15 - crack * 0.4
    h = norm01(blur(h, 1))
    # Vertical streaks (water and iron staining) for the side projections.
    row = perlin(N, 48, seed + 20)[0]
    xs = (np.arange(N)[None, :] + fbm(N, 4, 3, seed + 21) * 25).astype(int) % N
    streak = norm01(row[xs])
    tone = norm01(fbm(N, 3, 4, seed + 5))
    col = lerp(c, a, smoothstep(0.1, 0.5, h))
    col = lerp(col, b, smoothstep(0.45, 0.85, h) * (0.3 + tone * 0.7))
    col = col * (0.75 + tone[..., None] * 0.4) * (0.88 + detail[..., None] * 0.5)
    col = lerp(col, stain, smoothstep(0.6, 0.9, streak) * 0.35 * tone)
    col = col * (0.9 + streak[..., None] * 0.15)
    sp = np.random.default_rng(seed).random((N, N))
    col = lerp(col, speck, (sp > 0.994) * 0.3)
    col = lerp(col, c * 0.4, crack * 0.9)
    # Shadowed recesses.
    col = col * (0.7 + 0.3 * smoothstep(0.05, 0.4, h))[..., None]
    lich = smoothstep(0.65, 0.82, norm01(fbm(N, 12, 4, seed + 9))) * smoothstep(0.4, 0.65, h)
    col = lerp(col, lichen, lich * 0.4)
    save(name, col, h, normal_from_height(h, 9.0))


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


def twig(name='spruce_twig', pal=None, seed=51, size=512):
    """Alpha-tested branch card: a spruce shoot seen from above, stem at the bottom centre."""
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
                    na = a + side * rng.uniform(0.5, 1.3)
                    nl = S * rng.uniform(0.022, 0.032) * (1 - t * 0.35) * (width / 1.0)
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

    shoot(S * 0.5, S * 0.98, -np.pi / 2, S * 0.9, 1.0, 2)
    img = img.resize((size, size), Image.LANCZOS)
    arr = np.asarray(img) / 255.0
    rgb, alpha = arr[..., :3], arr[..., 3]
    rgb = np.where(alpha[..., None] > 0, rgb / np.maximum(alpha[..., None], 1e-3), 0)
    rgb = bleed(rgb, alpha)
    os.makedirs(OUT, exist_ok=True)
    rgba = np.dstack([np.clip(rgb, 0, 1), alpha])
    Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), 'RGBA').save(os.path.join(OUT, f'{name}.png'), optimize=True)
    print('wrote', name)


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


ALL = dict(grass=grass, rock=rock, gravel=gravel, asphalt=asphalt, snow=snow, twig=twig, bark=bark)

if __name__ == '__main__':
    for n in sys.argv[1:] or ALL:
        ALL[n]()
