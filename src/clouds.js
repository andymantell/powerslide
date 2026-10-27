// Tileable 3D noise for the volumetric clouds, built once at start-up.
// R: Perlin-Worley shape noise (billowy blobs), G: Worley fbm detail used to
// erode the edges into wisps. Both tile over the whole volume, so the sky
// shader samples it with repeat wrapping at two scales.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

// Periodic gradient noise on an integer lattice of `period` cells.
function perlin3(period, rand) {
  const n = period;
  const g = new Float32Array(n * n * n * 3);
  for (let i = 0; i < n * n * n; i++) {
    const z = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    g[i * 3] = Math.cos(a) * r;
    g[i * 3 + 1] = Math.sin(a) * r;
    g[i * 3 + 2] = z;
  }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    let out = 0;
    const u = fade(xf), v = fade(yf), w = fade(zf);
    for (let c = 0; c < 8; c++) {
      const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
      const k = ((((xi + dx) % n) + n) % n) + ((((yi + dy) % n) + n) % n) * n + ((((zi + dz) % n) + n) % n) * n * n;
      const dot = g[k * 3] * (xf - dx) + g[k * 3 + 1] * (yf - dy) + g[k * 3 + 2] * (zf - dz);
      out += dot * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
    }
    return out;
  };
}

// Periodic Worley noise: distance to the nearest feature point, one per cell.
function worley3(period, rand) {
  const n = period;
  const pts = new Float32Array(n * n * n * 3);
  for (let i = 0; i < pts.length; i++) pts[i] = rand();
  return (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let best = 9;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const cx = xi + dx, cy = yi + dy, cz = zi + dz;
          const k = (((cx % n) + n) % n) + (((cy % n) + n) % n) * n + (((cz % n) + n) % n) * n * n;
          const px = cx + pts[k * 3] - x, py = cy + pts[k * 3 + 1] - y, pz = cz + pts[k * 3 + 2] - z;
          const d = px * px + py * py + pz * pz;
          if (d < best) best = d;
        }
      }
    }
    return Math.min(1, Math.sqrt(best));
  };
}

export function cloudNoise(size = 64) {
  const rand = mulberry32(7331);
  const p = [perlin3(4, rand), perlin3(8, rand), perlin3(16, rand)];
  const w = [worley3(4, rand), worley3(8, rand), worley3(16, rand), worley3(32, rand)];
  const n = size * size * size;
  const raw = new Float32Array(n * 2);
  const remap = (v, a, b, c, d) => c + ((v - a) / (b - a)) * (d - c);
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size, v = y / size, s = z / size;
        const pf = (p[0](u * 4, v * 4, s * 4) * 0.6 + p[1](u * 8, v * 8, s * 8) * 0.28 + p[2](u * 16, v * 16, s * 16) * 0.12) * 0.9 + 0.5;
        const wf = 1 - (w[0](u * 4, v * 4, s * 4) * 0.62 + w[1](u * 8, v * 8, s * 8) * 0.26 + w[2](u * 16, v * 16, s * 16) * 0.12);
        // Perlin-Worley: Perlin's continuity, Worley's billows.
        const shape = Math.min(1, Math.max(0, remap(pf, wf - 1, 1, 0, 1)));
        const detail = 1 - (w[1](u * 8, v * 8, s * 8) * 0.5 + w[2](u * 16, v * 16, s * 16) * 0.3 + w[3](u * 32, v * 32, s * 32) * 0.2);
        const i = (x + y * size + z * size * size) * 2;
        raw[i] = shape;
        raw[i + 1] = detail;
      }
    }
  }
  // Stretch each channel to fill 0..1, so cloud cover maps evenly onto it.
  const data = new Uint8Array(n * 2);
  for (let c = 0; c < 2; c++) {
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) v[i] = raw[i * 2 + c];
    v.sort();
    const lo = v[Math.floor(n * 0.01)], hi = v[Math.floor(n * 0.995)];
    for (let i = 0; i < n; i++) data[i * 2 + c] = Math.round(Math.min(1, Math.max(0, (raw[i * 2 + c] - lo) / (hi - lo))) * 255);
  }
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RGFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}
