"""Tileable noise helpers for the texture generators (numpy only)."""
import numpy as np


def perlin(size, period, seed=0):
    """Periodic gradient noise in [-1, 1]-ish; `period` lattice cells across."""
    rng = np.random.default_rng(seed)
    ang = rng.uniform(0, 2 * np.pi, (period, period))
    gx, gy = np.cos(ang), np.sin(ang)
    t = np.arange(size) / size * period
    x, y = np.meshgrid(t, t)
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    fx, fy = x - x0, y - y0
    x0 %= period
    y0 %= period
    x1 = (x0 + 1) % period
    y1 = (y0 + 1) % period

    def dot(ix, iy, dx, dy):
        return gx[iy, ix] * dx + gy[iy, ix] * dy

    n00 = dot(x0, y0, fx, fy)
    n10 = dot(x1, y0, fx - 1, fy)
    n01 = dot(x0, y1, fx, fy - 1)
    n11 = dot(x1, y1, fx - 1, fy - 1)
    u = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
    v = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
    return (n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v


def fbm(size, period, octaves=5, seed=0, gain=0.5, lac=2):
    s = np.zeros((size, size))
    a = 1.0
    norm = 0.0
    p = period
    for o in range(octaves):
        if p > size // 2:
            break
        s += a * perlin(size, p, seed + o * 101)
        norm += a
        a *= gain
        p *= lac
    return s / norm


def worley(size, cells, seed=0, jitter=1.0):
    """Periodic cellular noise. Returns (F1, F2, cell_id) with distances in cell units."""
    rng = np.random.default_rng(seed)
    pts = rng.uniform(0.5 - jitter / 2, 0.5 + jitter / 2, (cells, cells, 2))
    ids = rng.random((cells, cells))
    t = (np.arange(size) + 0.5) / size * cells
    x, y = np.meshgrid(t, t)
    cx = np.floor(x).astype(int)
    cy = np.floor(y).astype(int)
    f1 = np.full((size, size), 9.0)
    f2 = np.full((size, size), 9.0)
    cid = np.zeros((size, size))
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            nx = cx + ox
            ny = cy + oy
            wx = nx % cells
            wy = ny % cells
            px = nx + pts[wy, wx, 0]
            py = ny + pts[wy, wx, 1]
            d = np.hypot(x - px, y - py)
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d))
            cid = np.where(closer, ids[wy, wx], cid)
            f1 = np.where(closer, d, f1)
    return f1, f2, cid


def warp(img, dx, dy):
    """Sample img (H, W[, C]) at offsets dx, dy (pixels), wrapping."""
    h, w = img.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    sx = (xx + dx) % w
    sy = (yy + dy) % h
    x0 = np.floor(sx).astype(int)
    y0 = np.floor(sy).astype(int)
    fx = sx - x0
    fy = sy - y0
    x1 = (x0 + 1) % w
    y1 = (y0 + 1) % h
    if img.ndim == 3:
        fx = fx[..., None]
        fy = fy[..., None]
    a = img[y0, x0] * (1 - fx) + img[y0, x1] * fx
    b = img[y1, x0] * (1 - fx) + img[y1, x1] * fx
    return a * (1 - fy) + b * fy


def blur(img, r):
    """Wrapping box blur (3 passes ~ gaussian)."""
    out = img.astype(np.float64)
    for _ in range(3):
        for axis in (0, 1):
            acc = np.zeros_like(out)
            for k in range(-r, r + 1):
                acc += np.roll(out, k, axis=axis)
            out = acc / (2 * r + 1)
    return out


def normal_from_height(h, strength):
    """Tangent-space normal map (RGB 0..1) from a wrapping height field."""
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength
    n = np.stack([-dx, dy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def lerp(a, b, t):
    t = np.asarray(t)
    a = np.asarray(a)
    b = np.asarray(b)
    if t.ndim == 2 and (a.ndim != 2 or b.ndim != 2) and (a.ndim in (1, 3) or b.ndim in (1, 3)):
        t = t[..., None]
    return np.asarray(a) * (1 - t) + np.asarray(b) * t


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def hexcol(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])
