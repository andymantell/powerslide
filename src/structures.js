// Road structures and set pieces a level places in its "features": bridges
// over gorges, covered timber bridges, avalanche galleries, streams with
// waterfalls, lakes, gondola lifts and bunting. Each one may shape the
// terrain (terrain.mods), keep trees off (terrain.block), add props, and
// build its own meshes, which share the prop material (src/propmat.js).
//
// Order, per level: plan() (terrain shaping and props), then the props'
// terraces, then build() once the terrain is final (piers need its height).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { spanRange, SPAN_TYPES, RAIL_OFFSET, HALF_WIDTH } from './road.js';
import { createPropMaterial } from './propmat.js';
import { mulberry32, clamp } from './noise.js';
import { Props } from './props.js';
import { ENV } from './sky.js';
import { waterTime } from './ground.js';
import { lampSpots } from './lamps.js';

const PAINT = 0, PLANKS = 1, SHINGLES = 2, MASONRY = 3, PLASTER = 4, GLASS = 5, METAL = 6, EMISSIVE = 7, LEAVES = 8, PAVING = 9, TARMAC = 10;
// Structure half width: the parapet's inner face sits at the guardrail line
// (set per level, as narrow-lane biomes move the guardrail in).
let W = 5.45;
const STONE = '#9d968a';
const COPING = '#b9b3a7';
const CONCRETE = '#b3afa6';
const TIMBER = '#6e4a2c';
const ROOF = '#4e4038';

const _c = new THREE.Color();
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- geometry
// Non-indexed triangles with flat normals, a colour and a surface kind.
class Geo {
  constructor() {
    this.p = [];
    this.n = [];
    this.c = [];
    this.u = [];
    this.parts = [];
  }

  tri(a, b, c, kind, col) {
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    _c.set(col);
    const k = (kind + 0.5) / 8;
    for (const v of [a, b, c]) {
      this.p.push(v.x, v.y, v.z);
      this.n.push(nx, ny, nz);
      this.c.push(_c.r, _c.g, _c.b);
      this.u.push(k, 0.5);
    }
  }

  // A quad, flipped if needed so its normal points away from `inside`.
  quad(a, b, c, d, kind, col, inside) {
    if (inside) {
      const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      const m = new THREE.Vector3().addVectors(a, c).multiplyScalar(0.5).sub(inside);
      if (n.dot(m) < 0) [b, d] = [d, b];
    }
    this.tri(a, b, c, kind, col);
    this.tri(a, c, d, kind, col);
  }

  // A box from its centre, with half-extents along two horizontal axes (ax,
  // az, unit vectors) and a vertical range y0..y1.
  box(cx, cz, y0, y1, ax, hx, az, hz, kind, col) {
    const P = (sx, sz, y) => new THREE.Vector3(cx + ax.x * hx * sx + az.x * hz * sz, y, cz + ax.z * hx * sx + az.z * hz * sz);
    const c = new THREE.Vector3(cx, (y0 + y1) / 2, cz);
    const v = [P(-1, -1, y0), P(1, -1, y0), P(1, 1, y0), P(-1, 1, y0), P(-1, -1, y1), P(1, -1, y1), P(1, 1, y1), P(-1, 1, y1)];
    for (const [a, b, cc, d] of [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]) {
      this.quad(v[a], v[b], v[cc], v[d], kind, col, c);
    }
  }

  // Adds a three.js geometry (e.g. an ExtrudeGeometry) after transforming it.
  add(g, matrix, kind, col) {
    g = g.index ? g.toNonIndexed() : g;
    g.applyMatrix4(matrix);
    const n = g.attributes.position.count;
    _c.set(col);
    const color = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      color.set([_c.r, _c.g, _c.b], i * 3);
      uv[i * 2] = (kind + 0.5) / 8;
      uv[i * 2 + 1] = 0.5;
    }
    g.setAttribute('color', new THREE.BufferAttribute(color, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'uv'].includes(k)) g.deleteAttribute(k);
    this.parts.push(g);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    const all = this.p.length ? [g, ...this.parts] : this.parts;
    if (!all.length) return null;
    const out = all.length > 1 ? mergeGeometries(all) : all[0];
    out.computeBoundingSphere();
    return out;
  }
}

// Sweeps a closed cross-section along the road from s0 to s1. `poly` is a
// list of [d, h] points: d across the road (+ right), h above the road
// surface. Caps both ends unless told not to.
function sweep(geo, road, s0, s1, poly, kind, col, { step = 2, caps = true } = {}) {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const [a, b] = poly[i], [c, d] = poly[(i + 1) % poly.length];
    area += a * d - c * b;
  }
  if (area < 0) poly = [...poly].reverse();
  const n = Math.max(1, Math.ceil((s1 - s0) / step));
  const f = {};
  const ring = (s) => {
    road.sample(s, f);
    return poly.map(([d, h]) => new THREE.Vector3(f.x + f.rightX * d, f.y + h, f.z + f.rightZ * d));
  };
  let prev = ring(s0);
  const first = prev;
  for (let i = 1; i <= n; i++) {
    const cur = ring(s0 + ((s1 - s0) * i) / n);
    for (let k = 0; k < poly.length; k++) {
      const k2 = (k + 1) % poly.length;
      // Counter-clockwise section: (A, C, B) faces outward (see notes above).
      geo.tri(prev[k], cur[k2], prev[k2], kind, col);
      geo.tri(prev[k], cur[k], cur[k2], kind, col);
    }
    prev = cur;
  }
  if (caps) {
    const tris = THREE.ShapeUtils.triangulateShape(poly.map(([d, h]) => new THREE.Vector2(d, h)), []);
    road.sample(s0, f);
    const back = new THREE.Vector3(-f.dirX, 0, -f.dirZ);
    capEnds(geo, first, tris, back, kind, col);
    road.sample(s1, f);
    capEnds(geo, prev, tris, new THREE.Vector3(f.dirX, 0, f.dirZ), kind, col);
  }
}

function capEnds(geo, ring, tris, out, kind, col) {
  for (const [a, b, c] of tris) {
    const n = new THREE.Vector3().subVectors(ring[b], ring[a]).cross(new THREE.Vector3().subVectors(ring[c], ring[a]));
    if (n.dot(out) >= 0) geo.tri(ring[a], ring[b], ring[c], kind, col);
    else geo.tri(ring[a], ring[c], ring[b], kind, col);
  }
}

// Unit vectors along and across the road at s, and the road point.
function frame(road, s) {
  const f = road.sample(s, {});
  return { f, along: new THREE.Vector3(f.dirX, 0, f.dirZ), across: new THREE.Vector3(f.rightX, 0, f.rightZ) };
}

// ---------------------------------------------------------------- water
function waterTextures() {
  const N = 256;
  const h = new Float32Array(N * N);
  const rnd = mulberry32(7);
  const waves = Array.from({ length: 24 }, () => [rnd() * 6.28, 1 + Math.floor(rnd() * 6), Math.floor(rnd() * 9) - 4, rnd()]);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let v = 0;
      for (const [ph, fx, fy, a] of waves) v += Math.sin(((x * fx + y * (fy * 2 + 6)) / N) * 6.2832 + ph) * a / (fx + Math.abs(fy) + 1);
      h[y * N + x] = v;
    }
  }
  const nor = new Uint8Array(N * N * 4);
  const foam = new Uint8Array(N * N * 4);
  let lo = Infinity, hi = -Infinity;
  for (const v of h) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const dx = h[y * N + ((x + 1) % N)] - h[y * N + ((x + N - 1) % N)];
      const dy = h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x];
      const l = Math.hypot(dx * 2, dy * 2, 1);
      nor.set([(-dx * 2 / l * 0.5 + 0.5) * 255, (-dy * 2 / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255, 255], i * 4);
      const t = (h[i] - lo) / (hi - lo);
      const fv = Math.min(255, Math.max(0, (t * 1.6 - 0.35) * 255));
      foam.set([fv, fv, fv, 255], i * 4);
    }
  }
  const mk = (data, srgb) => {
    const t = new THREE.DataTexture(data, N, N);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  };
  return { normal: mk(nor, false), foam: mk(foam, true) };
}

// ---------------------------------------------------------------- structures
export class Structures {
  constructor(scene, renderer, road, terrain, props, boulders) {
    this.scene = scene;
    this.road = road;
    this.terrain = terrain;
    this.props = props;
    this.boulders = boulders;
    this.mat = createPropMaterial(renderer);
    this.group = new THREE.Group();
    scene.add(this.group);
    const tex = waterTextures();
    this.waterNormal = tex.normal;
    // Lakes: still, reflective water.
    this.lakeMat = new THREE.MeshStandardMaterial({ color: '#3f6e72', roughness: 0.06, metalness: 0, normalMap: tex.normal, normalScale: new THREE.Vector2(0.35, 0.35) });
    // Streams and falls: vertex colour runs from clear water to white foam.
    this.flowTex = tex.foam.clone();
    this.flowTex.needsUpdate = true;
    this.streamMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0, normalMap: tex.normal, normalScale: new THREE.Vector2(0.6, 0.6), transparent: true });
    this.streamMat.onBeforeCompile = (sh) => {
      sh.uniforms.tFoam = { value: tex.foam };
      sh.uniforms.uFlow = this.flowUniform = { value: 0 };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFlowUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFlowUv = uv;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tFoam;\nuniform float uFlow;\nvarying vec2 vFlowUv;')
        .replace(
          '#include <map_fragment>',
          `float foamA = texture2D(tFoam, vec2(vFlowUv.x * 0.6, vFlowUv.y * 0.12 - uFlow)).r;
          float foamB = texture2D(tFoam, vec2(vFlowUv.x * 0.9 + 0.4, vFlowUv.y * 0.2 - uFlow * 1.6)).r;
          // vColor.r carries how fast the water runs: 0 calm, 1 a fall.
          float rush = vColor.r;
          float foam = clamp(mix(foamA * 0.35, max(foamA, foamB) * 1.2, rush) + rush * 0.35, 0.0, 1.0);
          diffuseColor.rgb = mix(vec3(0.05, 0.13, 0.14), vec3(0.92, 0.95, 0.96), foam);
          // A ford is a few centimetres of peaty water over the road: you see
          // the tarmac through it, tinted brown, with streaks of foam.
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.16, 0.1, 0.05), vec3(0.85, 0.85, 0.8), foam), vColor.g);
          diffuseColor.a = mix(1.0, 0.35 + foam * 0.55, vColor.g);`,
        )
        .replace('#include <color_fragment>', '')
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.08, 0.6, foam);');
    };
    this.waterMeshes = [];
    this.gondolas = [];
    this.time = 0;
  }

  clear() {
    for (const o of [...this.group.children]) {
      this.group.remove(o);
      o.geometry?.dispose();
      if (o.isInstancedMesh) o.dispose();
    }
    if (this.rockSet) this.boulders.remove(this.rockSet);
    this.rockSet = null;
    for (const job of this.endless || []) if (job.rocks) this.boulders.remove(job.rocks);
    this.endless = [];
    this.gondolas = [];
    this.lines = [];
    lampSpots.length = 0;
  }

  // Terrain shaping and props for the level's features. Needs the road built.
  plan(level) {
    this.clear();
    this.level = level;
    this.seaLevel = this.props.seaLevel = null;
    this.rand = mulberry32((level?.seed ?? 1) + 4242);
    this.rocks = [];
    this.todo = [];
    W = RAIL_OFFSET + 0.55;
    if (!level) return;
    const start = this.road.start;
    for (const f of level.features || []) {
      const plan = PLANS[f.type];
      if (!plan) continue;
      const [a, b] = SPAN_TYPES[f.type] || f.from !== undefined ? spanRange(f) : [f.at ?? 0, f.at ?? 0];
      const job = { f, s0: start + a, s1: start + b };
      plan.call(this, job);
      this.todo.push(job);
    }
  }

  // Endless: one feature at a time, as the road is generated. f is a level
  // feature (distances from the start line). Returns the job to build once
  // the stretch's props are shaped; its terrain mods are kept on the job so
  // prune() can drop them later.
  add(f) {
    if (!PLANS[f.type]) return null;
    if (!this.rand) this.rand = mulberry32(4242);
    this.rocks = [];
    this.endless ||= [];
    const start = this.road.start;
    const [a, b] = SPAN_TYPES[f.type] || f.from !== undefined ? spanRange(f) : [f.at ?? 0, f.at ?? 0];
    const job = { f, s0: start + a, s1: start + b };
    const mods = this.terrain.mods.length;
    PLANS[f.type].call(this, job);
    job.mods = this.terrain.mods.slice(mods);
    return job;
  }

  buildJob(job) {
    const before = new Set(this.group.children);
    BUILDS[job.f.type]?.call(this, job);
    job.objects = this.group.children.filter((o) => !before.has(o));
    if (this.rocks.length) {
      job.rocks = new Float32Array(this.rocks);
      this.boulders.add(job.rocks);
      this.rocks = [];
    }
    this.endless.push(job);
  }

  // A cattle grid under s: the board rattles over it.
  rattleAt(s) {
    for (const j of this.todo || []) if (j.f.type === 'grid' && Math.abs(s - j.s0) < 1.4) return true;
    for (const j of this.endless || []) if (j.f.type === 'grid' && Math.abs(s - j.s0) < 1.4) return true;
    return false;
  }

  // The speed hump under s, if any.
  bumpAt(s) {
    for (const j of this.todo || []) if (j.f.type === 'bump' && Math.abs(s - j.s0) < BUMP_LEN / 2) return j;
    return null;
  }

  // The side wind at s (m/s, + blowing to the road's right) from a level's
  // `gusts`: a breeze with gusts every few seconds that build over a second
  // or so, hold, and die away.
  windAt(s, time) {
    for (const j of this.todo || []) {
      if (j.f.type !== 'gusts' || s < j.s0 - 30 || s > j.s1 + 30) continue;
      const f = j.f, top = f.strength ?? 14;
      const fade = smooth(j.s0 - 30, j.s0, s) * (1 - smooth(j.s1, j.s1 + 30, s));
      const period = f.every ?? 7;
      const ph = (time + (f.phase ?? 0)) / period;
      const k = Math.floor(ph), u = ph - k;
      // Each gust has its own strength, from the level's seed and its number.
      const r = Math.abs(Math.sin(k * 12.9898 + j.s0 * 0.071) * 43758.5453) % 1;
      const g = smooth(0.15, 0.35, u) * (1 - smooth(0.55, 0.85, u)) * (0.6 + 0.4 * r);
      const side = f.side === 'left' ? -1 : 1;
      return side * fade * (top * 0.18 + top * 0.82 * g);
    }
    return 0;
  }

  // How deep the water is over the road at s (a ford), 0 when dry.
  waterAt(s) {
    for (const j of this.todo || []) {
      if (j.f.type !== 'ford' || s < j.s0 - 12 || s > j.s1 + 12) continue;
      return Math.max(0, j.level - this.road.sample(s, this._w || (this._w = {})).y);
    }
    return 0;
  }

  // Endless: drops the structures that ended more than `behind` m back.
  prune(s, behind = 600) {
    const old = (this.endless || []).filter((j) => j.s1 < s - behind);
    if (!old.length) return;
    for (const job of old) {
      for (const o of job.objects) {
        this.group.remove(o);
        o.geometry?.dispose();
        if (o.isInstancedMesh) o.dispose();
      }
      if (job.rocks) this.boulders.remove(job.rocks);
      this.terrain.mods = this.terrain.mods.filter((m) => !job.mods.includes(m));
    }
    this.endless = this.endless.filter((j) => !old.includes(j));
  }

  // Meshes, once the terrain mods (including building terraces) are final.
  build() {
    for (const job of this.todo || []) BUILDS[job.f.type]?.call(this, job);
    if (this.rocks?.length) {
      this.rockSet = new Float32Array(this.rocks);
      this.boulders.add(this.rockSet);
    }
  }

  mesh(geo, cast = true) {
    const g = geo.build();
    if (!g) return null;
    const m = new THREE.Mesh(g, this.mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  update(dt) {
    this.time += dt;
    if (this.flowUniform) this.flowUniform.value = (this.time * 0.35) % 100;
    this.waterNormal.offset.set(this.time * 0.01, this.time * 0.013);
    waterTime.value = this.time;
    for (const g of this.gondolas) g.update(this.time);
  }

  // Side roads coming in on a side (-1 left, +1 right): where each meets
  // the main road (s), from junctions and mini roundabouts.
  mouths(side) {
    const out = [];
    for (const j of [...(this.todo || []), ...(this.endless || [])]) {
      const t = j.f.type;
      if (t === 'roundabout' || (t === 'junction' && (j.f.side === 'left' ? -1 : 1) === side)) out.push(j.s0);
    }
    return out;
  }

  // Side roads traffic can pull out of: { s, side, roundabout, ox, oz, ux,
  // uz, vx, vz, L, y(t) } where (ux, uz) points out along the side road and
  // y(t) is its height t m out from the main road's centre line.
  sideRoads() {
    const out = [];
    for (const j of this.todo || []) {
      const arms = j.f.type === 'junction' ? [j] : j.f.type === 'roundabout' ? j.arms || [] : [];
      for (const a of arms) {
        if (a.ux === undefined) continue;
        out.push({ s: j.s0, side: a.side, roundabout: j.f.type === 'roundabout', ox: a.ox, oz: a.oz, ux: a.ux, uz: a.uz, vx: a.vx, vz: a.vz, L: a.L, y: (tt) => junctionY(a, tt) });
      }
    }
    return out;
  }

  // Whether a side road comes in within `w` m of s on that side.
  mouthAt(s, side, w) {
    return this.mouths(side).some((m) => Math.abs(s - m) < SIDE_HALF + w);
  }

  // s0..s1 split into the runs left between side roads on that side, each
  // mouth `half` m either side of its middle.
  openRuns(s0, s1, side, half) {
    const cuts = this.mouths(side).filter((m) => m + half > s0 && m - half < s1).sort((a, b) => a - b);
    const runs = [];
    let a = s0;
    for (const m of cuts) {
      if (m - half > a + 0.5) runs.push([a, m - half]);
      a = Math.max(a, m + half);
    }
    if (s1 > a + 0.5) runs.push([a, s1]);
    return runs;
  }

  // Half-buried boulders along a stream bed.
  rock(x, z, sc) {
    const y = this.terrain.heightAt(x, z);
    this.rocks.push(x, y - sc * 0.35, z, sc, this.rand() * 6.28, (this.rand() - 0.5) * 0.6, Math.floor(this.rand() * 8));
  }
}

// ---------------------------------------------------------------- terrain shaping
// A gorge across the road between s0 and s1, `depth` deep under its middle,
// widening as it runs away from the road. Mountain side climbs, valley side
// falls, as the natural slope does.
function gorge(road, s0, s1, depth) {
  const ramp = Math.min(30, (s1 - s0) * 0.35);
  return (x, z, f, h) => {
    const s = f.index;
    const spread = f.dist * 0.35;
    if (s < s0 - spread - 10 || s > s1 + spread + 10) return h;
    const m = smooth(s0 - spread - 5, s0 + ramp, s) * (1 - smooth(s1 - ramp, s1 + spread + 5, s));
    // V-shaped floor: deepest along the middle line of the gorge.
    const mid = (s0 + s1) / 2;
    const v = 1 - 0.35 * Math.abs(s - mid) / ((s1 - s0) / 2 + spread + 1);
    return h - depth * m * v * (1 - smooth(120, 600, f.dist) * 0.6);
  };
}

// A channel along a polyline [x, z, ...], depth(t) at distance t along it.
function channel(pts, width, depthAt) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]);
    maxX = Math.max(maxX, pts[i]);
    minZ = Math.min(minZ, pts[i + 1]);
    maxZ = Math.max(maxZ, pts[i + 1]);
  }
  const R = width + 10;
  const cum = [0];
  for (let i = 2; i < pts.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]));
  return (x, z, f, h) => {
    if (x < minX - R || x > maxX + R || z < minZ - R || z > maxZ + R) return h;
    let best = Infinity, bt = 0;
    for (let i = 0; i < pts.length - 2; i += 2) {
      const ax = pts[i], az = pts[i + 1], ex = pts[i + 2] - ax, ez = pts[i + 3] - az;
      const l2 = ex * ex + ez * ez;
      const t = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / l2));
      const d = Math.hypot(ax + ex * t - x, az + ez * t - z);
      if (d < best) {
        best = d;
        bt = cum[i / 2] + t * Math.sqrt(l2);
      }
    }
    if (best > R) return h;
    return h - depthAt(bt, h) * (1 - smooth(width * 0.5, R, best));
  };
}

// Water can't run uphill: walking down a river line from its high end, cuts
// a bed through any rise of up to 6 m, and ends the river at a bigger one.
// Returns the (possibly shortened) line, high end first.
function settle(terrain, pts, width) {
  const n = pts.length / 2;
  const at = (i) => [pts[i * 2], pts[i * 2 + 1]];
  const order = [...Array(n).keys()];
  if (terrain.heightAt(...at(n - 1)) > terrain.heightAt(...at(0))) order.reverse();
  const keep = [], bed = [];
  let y = Infinity;
  for (const i of order) {
    const [x, z] = at(i);
    const h = terrain.heightAt(x, z);
    if (h - y > 6) break;
    y = Math.min(y - 0.1, h);
    keep.push(x, z);
    bed.push(y);
  }
  // Cut down to the bed wherever the ground stands above it.
  terrain.mods.push(channel(keep, width, (t, h) => Math.max(0, h - bed[Math.min(bed.length - 1, Math.round(t / segLen(keep)))] + 0.4)));
  return keep;
}

function segLen(pts) {
  return Math.hypot(pts[2] - pts[0], pts[3] - pts[1]) || 1;
}

// How far (up to `max` m) a line across the road at s can run on `side`
// before it comes within 18 m of another stretch of the road.
function clearRun(road, s, side, max) {
  const f = road.sample(s, {});
  const q = {};
  for (let d = 10; d <= max; d += 5) {
    const g = road.field(f.x + f.rightX * d * side, f.z + f.rightZ * d * side, q);
    if (g.dist < 18 && Math.abs(g.index - s) > 60) return Math.max(20, d - 20);
  }
  return max;
}

// A line of points across the road at s, from d = a to d = b, every `step` m.
function acrossLine(road, s, a, b, step = 6) {
  const f = road.sample(s, {});
  const pts = [];
  const n = Math.ceil(Math.abs(b - a) / step);
  for (let i = 0; i <= n; i++) {
    const d = a + ((b - a) * i) / n;
    pts.push(f.x + f.rightX * d, f.z + f.rightZ * d);
  }
  return pts;
}

// Which side the mountain is on along a stretch: +1 right, -1 left.
function mountainSide(road, s0, s1) {
  let c = 0;
  for (let s = s0; s <= s1; s += 5) c += road.c[Math.round(s)];
  return c >= 0 ? 1 : -1;
}

// ---------------------------------------------------------------- plans
export const PLANS = {
  // { type: 'gusts', from, to, side, strength, every } Side-wind gusts
  // across the road (structures.windAt), blowing towards `side` (right), up
  // to `strength` m/s (14) every `every` s (7). Windsocks mark them.
  gusts() {},

  // { type: 'bridge', from, to, depth } A stone viaduct over a gorge with a river.
  bridge(job) {
    const { f } = job;
    const depth = f.depth ?? 25;
    this.terrain.mods.push(gorge(this.road, job.s0, job.s1, depth));
    job.mid = (job.s0 + job.s1) / 2;
    job.up = mountainSide(this.road, job.s0, job.s1);
    if (f.river !== false) {
      job.river = settle(this.terrain, acrossLine(this.road, job.mid, job.up * clearRun(this.road, job.mid, job.up, 400), -job.up * clearRun(this.road, job.mid, -job.up, 500), 8), 8);
      for (let i = 0; i < job.river.length; i += 2) this.terrain.block(job.river[i], job.river[i + 1], 8);
    }
  },

  // { type: 'covered', from, to } A roofed timber bridge over a stream.
  covered(job) {
    job.mid = (job.s0 + job.s1) / 2;
    job.up = mountainSide(this.road, job.s0, job.s1);
    this.terrain.mods.push(gorge(this.road, job.s0 + 2, job.s1 - 2, job.f.depth ?? 6));
    job.river = acrossLine(this.road, job.mid, job.up * 250, -job.up * 400, 6);
    for (let i = 0; i < job.river.length; i += 2) this.terrain.block(job.river[i], job.river[i + 1], 6);
  },

  // { type: 'stream', at, span, fall } A stream (with a waterfall above the
  // road when `fall`) under a short stone arch bridge.
  stream(job) {
    const { f } = job;
    job.mid = this.road.start + f.at;
    job.up = mountainSide(this.road, job.mid - 20, job.mid + 20);
    // It stops short of any other stretch of road (the leg above or below a
    // hairpin), which it would otherwise cross without a bridge.
    const top = clearRun(this.road, job.mid, job.up, f.fall ? 140 : 60);
    const bottom = clearRun(this.road, job.mid, -job.up, 350);
    job.river = acrossLine(this.road, job.mid, job.up * top, -job.up * bottom, 5);
    // Deep under the bridge, a gully elsewhere.
    const L = top + bottom;
    this.terrain.mods.push(channel(job.river, 5, (t) => 2 + 5 * (1 - smooth(10, 26, Math.abs(t - top)))));
    job.river = settle(this.terrain, job.river, 5);
    for (let i = 0; i < job.river.length; i += 2) this.terrain.block(job.river[i], job.river[i + 1], 5);
    job.L = L;
  },

  // { type: 'flat', from, to, width, keep } Gentle ground either side of the road,
  // for a village or a farm: no cuttings or drops within `width` m (60).
  flat(job) {
    const { s0, s1 } = job;
    const W = job.f.width ?? 60;
    this.terrain.mods.push((x, z, f, h) => {
      const s = f.index;
      if (s < s0 - 40 || s > s1 + 40 || f.dist > W + 30) return h;
      const w = smooth(s0 - 40, s0, s) * (1 - smooth(s1, s1 + 40, s)) * (1 - smooth(W, W + 30, f.dist));
      // A gentle rise away from the road, with a little of the old shape
      // left (`keep`, 0.12).
      const want = f.roadY - 0.25 + Math.max(0, f.dist - 8) * 0.05 + (h - f.roadY) * (job.f.keep ?? 0.12);
      return h + (want - h) * w;
    });
  },

  // { type: 'gallery', from, to } A concrete avalanche gallery: wall and
  // roof on the mountain side, pillars on the valley side.
  gallery(job) {
    const up = (job.up = job.f.side === 'left' ? -1 : job.f.side === 'right' ? 1 : mountainSide(this.road, job.s0, job.s1));
    const { s0, s1 } = job;
    // Backfill over the roof so it reads as cut into the slope.
    this.terrain.mods.push((x, z, f, h) => {
      const s = f.index;
      if (s < s0 - 30 || s > s1 + 30 || f.dist > 40) return h;
      if (f.side !== up) return h;
      // It starts rising behind the back wall, under the roof, so no slope
      // of the terrain mesh can poke through the wall.
      const m = smooth(s0 - 25, s0 + 4, s) * (1 - smooth(s1 - 4, s1 + 25, s)) * smooth(7.5, 9.5, f.dist) * (1 - smooth(14, 40, f.dist));
      return Math.max(h, h + (f.roadY + 7.4 - h) * m);
    });
  },

  // { type: 'lake', from, to, side, near, far } A lake beside the road.
  lake(job) {
    const { f } = job;
    const side = f.side === 'left' ? -1 : f.side === 'right' ? 1 : -mountainSide(this.road, job.s0, job.s1);
    const near = f.near ?? 18, far = f.far ?? 220;
    let lo = Infinity;
    for (let s = job.s0; s <= job.s1; s += 4) lo = Math.min(lo, this.road.y[Math.round(s)]);
    const level = (job.level = lo - (f.below ?? 2.5));
    Object.assign(job, { side, near, far });
    const { s0, s1 } = job;
    const road = this.road;
    this.terrain.mods.push((x, z, fd, h) => {
      const s = fd.index;
      if (s < s0 - 80 || s > s1 + 80 || fd.dist > far + 80) return h;
      if (fd.side !== side) return h;
      const region = smooth(s0 - 70, s0 - 20, s) * (1 - smooth(s1 + 20, s1 + 70, s)) * smooth(near - 12, near - 4, fd.dist) * (1 - smooth(far + 30, far + 80, fd.dist));
      if (region <= 0) return h;
      const inner = smooth(s0, s0 + 50, s) * (1 - smooth(s1 - 50, s1, s)) * smooth(near, near + 25, fd.dist) * (1 - smooth(far - 50, far, fd.dist));
      // "beach": a gentle shelf from just past the road down into the water.
      if (f.beach) {
        const b = Math.max(level - 3 - 6 * inner, fd.roadY - 0.35 - Math.max(0, fd.dist - near + 8) * 0.07);
        return h + (b - h) * region;
      }
      let t = Math.max(h, level + 0.6);
      t += (level - 2.5 - 9 * inner - t) * inner;
      return h + (t - h) * region;
    });
    // Sets with a shore texture (sand in the suburbs) lay it on the low
    // ground round the water: 1 on the beach, fading out up the bank.
    if (this.terrain.groundSet?.shore) {
      this.terrain.mods.at(-1).cover = (x, z, fd, h, out) => {
        const s = fd.index;
        if (s < s0 - 80 || s > s1 + 80 || fd.side !== side || fd.dist < near - 14 || fd.dist > far + 80) return;
        // From just past the prom railing down to the water, but not up the
        // banks above the road.
        const region = smooth(s0 - 70, s0 - 20, s) * (1 - smooth(s1 + 20, s1 + 70, s)) * smooth(near - 9, near - 7, fd.dist);
        out.sand = Math.max(out.sand, region * (1 - smooth(fd.roadY + 0.4, fd.roadY + 1.4, h)));
        out.wet = Math.max(out.wet, region * (1 - smooth(level + 0.2, level + 0.9, h)));
      };
    }
    // Keep trees out of the water.
    const fr = {};
    for (let s = s0; s <= s1; s += 15) {
      road.sample(s, fr);
      for (let d = near + 6; d < far; d += 15) this.terrain.block(fr.x + fr.rightX * d * side, fr.z + fr.rightZ * d * side, 14);
    }
  },

  // { type: 'sea', side, near, below, beach, heads, coves } The sea along one side of the
  // whole road, `below` m (40) under the road's lowest point: past `near` m
  // (16, wandering in and out in coves and headlands) the land falls away
  // in a cliff to rocks and the odd strip of sand. `beach` lays a gentle
  // shelf of sand down to the water instead, all along or over [from, to]. The land rises on the other
  // side, and the sea side gets the guardrail.
  sea(job) {
    const { f } = job;
    const road = this.road;
    const side = (job.side = f.side === 'left' ? -1 : 1);
    let lo = Infinity;
    const end = Math.min(road.count, Math.round((road.finish ?? road.count) + 40));
    for (let i = Math.round(road.start); i < end; i++) lo = Math.min(lo, road.y[i]);
    const level = (job.level = this.seaLevel = this.props.seaLevel = lo - (f.below ?? 40));
    const near = f.near ?? 16;
    for (let i = 0; i < road.count; i++) road.c[i] = -side;
    // Coves and headlands: how far the cliff edge is from the road at s.
    const ph = (this.level?.seed ?? 1) * 0.37;
    // `heads`: [at, d, width] headlands reaching d m out at `at`, for a
    // lighthouse or a castle to stand on; `coves`: [at, width] bays where
    // the cliff edge comes right up to the road.
    const S = road.start;
    const heads = (f.heads || []).map(([at, d, w = 60]) => [S + at, d, w]);
    const coves = (f.coves || []).map(([at, w = 60, sand = 0]) => [S + at, w, sand]);
    // How much of a sandy cove's beach is at s, 0..1.
    const sandAt = (s) => {
      let k = 0;
      for (const [at, w, sand] of coves) if (sand) k = Math.max(k, Math.exp(-(((s - at) / (w * 0.8)) ** 2)));
      return k;
    };
    const beach = f.beach === true ? true : f.beach ? [S + f.beach[0], S + f.beach[1]] : null;
    const beachAt = (s) => (beach ? (beach === true ? 1 : smooth(beach[0] - 60, beach[0], s) * (1 - smooth(beach[1], beach[1] + 60, s))) : 0);
    job.beachAt = beachAt;
    const edge = (job.edge = (s) => {
      let e = Math.max(0, 9 * Math.sin(s * 0.0071 + ph) + 6 * Math.sin(s * 0.019 + ph * 2.3) + 3 * Math.sin(s * 0.047 + ph * 1.7));
      // Small bays and buttresses so the edge is never a smooth line.
      e += 2.5 + 2.5 * Math.sin(s * 0.11 + ph * 3.1) + 1.5 * Math.sin(s * 0.27 + ph * 5.3);
      // A beach runs straight along the prom.
      e = near + e * (1 - beachAt(s));
      for (const [at, w] of coves) e += (near - 2 - e) * Math.exp(-(((s - at) / w) ** 2));
      for (const [at, d, w] of heads) e = Math.max(e, d * Math.exp(-(((s - at) / w) ** 2)));
      return e;
    });
    const n2 = this.terrain.noise2;
    this.terrain.mods.push((x, z, fd, h) => {
      if (fd.side !== side) return h;
      const e = edge(fd.index);
      if (fd.dist < e - 4) return h;
      // A beach (all along, or [from, to]): a gentle shelf of sand from
      // just past the road down into the water.
      const wb = beachAt(fd.index);
      let yb = h;
      if (wb > 0) {
        const b = Math.max(level - 3 - Math.max(0, fd.dist - e - 40) * 0.08, fd.roadY - 0.35 - Math.max(0, fd.dist - e + 4) * 0.06);
        yb = h + (Math.min(h, b) - h) * smooth(e - 4, e + 2, fd.dist);
        if (wb >= 1) return yb;
      }
      // The cliff: a steep, broken rock face about half as wide as it is
      // high, down to boulders at the foot and the sea bed beyond.
      const top = Math.min(h, fd.roadY - 0.6);
      const H = top - level + 2;
      // Sheer in places, steep broken slopes in others, with ribs and
      // gullies running down the face and a ledge or two.
      const steep = 0.5 + 0.5 * n2(fd.index / 70, 3.7);
      const run = Math.max(6, H * (0.22 + 0.4 * steep));
      const t = Math.min(1, Math.max(0, (fd.dist - e) / run));
      const jag = n2(x / 13, z / 13) * 0.22 + n2(x / 4.5, z / 4.5) * 0.07;
      const ledge = 0.06 * smooth(0.35, 0.45, t) * (1 - smooth(0.5, 0.6, t)) * (n2(fd.index / 40, 9.1) > 0 ? 1 : 0);
      const face = top - H * Math.min(1, Math.max(0, Math.pow(t, 0.75) - ledge + jag * Math.sin(Math.PI * t) * 1.6));
      let bed = level - 2 - Math.min(26, Math.max(0, fd.dist - e - run) * 0.18);
      // A sandy cove: the beach shelves gently from the cliff foot into the sea.
      const sand = sandAt(fd.index);
      if (sand > 0) bed += (level + 1.2 - Math.max(0, fd.dist - e - run) * 0.045 - bed) * sand;
      const y = t < 1 ? Math.max(face, bed) : bed;
      const yc = Math.min(h, y + (h - y) * (1 - smooth(e - 4, e, fd.dist)));
      return yc + (yb - yc) * wb;
    });
    // Sand on the beach, and wet rock and sand at the waterline.
    const shore = !!this.terrain.groundSet?.shore;
    this.terrain.mods.at(-1).cover = (x, z, fd, h, out) => {
      if (fd.side !== side) return;
      if (beach && shore && fd.dist > edge(fd.index) - 3) {
        out.sand = Math.max(out.sand, beachAt(fd.index) * smooth(edge(fd.index) - 3, edge(fd.index) + 1, fd.dist));
      }
      if (h > level + 3) return;
      if (shore) out.sand = Math.max(out.sand, 1 - smooth(level + 1.2, level + 2.6, h));
      out.wet = Math.max(out.wet, 1 - smooth(level + 0.1, level + 0.8, h));
      // Surf: a band from just under the water up the foot of the cliff.
      out.foam = Math.max(out.foam, smooth(level - 1.5, level - 0.3, h) * (1 - smooth(level + 1.5, level + 3.5, h)));
    };
    // Keep trees off the cliff face and out of the water.
    const fr = {};
    for (let s = 0; s < road.count; s += 15) {
      road.sample(s, fr);
      const e = edge(s);
      for (let d = e - 2; d < e + 70; d += 14) this.terrain.block(fr.x + fr.rightX * d * side, fr.z + fr.rightZ * d * side, 12);
    }
  },

  // { type: 'turbines', from, to, side, d, every } A row of wind turbines
  // `d` m (70) off the road every `every` m (110), rotors turning.
  turbines(job) {
    const { f } = job;
    const side = f.side === 'left' ? -1 : 1;
    job.list = [];
    for (let s = job.s0, k = 0; s <= job.s1; s += f.every ?? 110, k++) {
      const p = Props.at(this.road, s, side * ((f.d ?? 70) + (k % 2) * 25 + this.rand() * 10), 0);
      this.props.add('turbine', p.x, p.z, p.yaw);
      job.list.push(p);
    }
  },

  // { type: 'viaduct', from, to, side, d, drop, every } A granite railway
  // viaduct striding straight across a cove `d` m (60) out on `side`, its
  // deck `drop` m (14) below the road's lowest point along it, carried into
  // the cliffs either end on embankments and cuttings; a train crosses every
  // `every` s (30).
  viaduct(job) {
    const { f } = job;
    const road = this.road;
    const side = f.side === 'left' ? -1 : 1;
    const d = side * (f.d ?? 60);
    const a = road.sample(job.s0, {}), b = road.sample(job.s1, {});
    const A = { x: a.x + a.rightX * d, z: a.z + a.rightZ * d }, B = { x: b.x + b.rightX * d, z: b.z + b.rightZ * d };
    let lo = Infinity;
    for (let s = job.s0; s <= job.s1; s += 4) lo = Math.min(lo, road.y[Math.round(s)]);
    const top = (job.top = lo - (f.drop ?? 14));
    const L = Math.hypot(B.x - A.x, B.z - A.z);
    const ux = (B.x - A.x) / L, uz = (B.z - A.z) / L;
    Object.assign(job, { A, ux, uz, L });
    // Embankments and cuttings carry the line on beyond the ends.
    const ext = 90;
    this.terrain.mods.push((x, z, fd, h) => {
      const t = (x - A.x) * ux + (z - A.z) * uz;
      if (t > -ext && t < L + ext && (t < 0 || t > L)) {
        const perp = Math.abs((x - A.x) * -uz + (z - A.z) * ux);
        if (perp > 60) return h;
        const want = top - 0.3;
        const w = (1 - smooth(4.5, 4.5 + Math.abs(h - want) * 1.6 + 1, perp)) * (1 - smooth(ext - 30, ext, t < 0 ? -t : t - L));
        return h + (want - h) * w;
      }
      return h;
    });
    const n = Math.round(L / 18);
    const step = L / n;
    const yaw = Math.atan2(-uz, ux);
    for (let k = 0; k <= n; k++) {
      const t = k * step;
      this.props.add('viaduct_bay', A.x + ux * t, A.z + uz * t, yaw, 1, top);
      this.terrain.block(A.x + ux * t, A.z + uz * t, 6);
    }
  },

  // { type: 'cableway', at, angle, length } A gondola lift crossing over the road.
  cableway(job) {
    const { f } = job;
    const at = this.road.start + f.at;
    const fr = this.road.sample(at, {});
    const a = ((f.angle ?? 15) * Math.PI) / 180;
    // The line runs across the road, turned by `angle`.
    const ux = fr.rightX * Math.cos(a) + fr.dirX * Math.sin(a);
    const uz = fr.rightZ * Math.cos(a) + fr.dirZ * Math.sin(a);
    const L = f.length ?? 900;
    const yaw = Math.atan2(ux, uz);
    job.line = { ox: fr.x, oz: fr.z, ux, uz, L, yaw };
    // Supports: stations at both ends, pylons between, kept off the road.
    const sup = [];
    const field = {};
    const n = Math.max(2, Math.round(L / 140));
    for (let i = 0; i <= n; i++) {
      let t = -L / 2 + (L * i) / n;
      const x = fr.x + ux * t, z = fr.z + uz * t;
      if (i > 0 && i < n && this.road.field(x, z, field).dist < 22) continue;
      sup.push({ t, x, z, end: i === 0 || i === n });
    }
    job.sup = sup;
    for (const s of sup) {
      if (s.end) {
        const p = this.props.add('station', s.x, s.z, yaw + (s.t < 0 ? Math.PI : 0));
        s.prop = p;
      } else {
        s.prop = this.props.add('pylon', s.x, s.z, yaw + Math.PI / 2);
        this.terrain.block(s.x, s.z, 5);
      }
    }
  },

  // { type: 'walls', from, to, side } Dry-stone walls along the lane, on
  // both sides or one ("side": "left" / "right"). You can crash into them.
  walls(job) {
    edgeBlock.call(this, job);
  },

  // { type: 'hedge', from, to, side } Devon hedge banks: stone-faced earth
  // banks topped with hedge, taller than you.
  hedge(job) {
    edgeBlock.call(this, job);
  },

  // { type: 'grid', at } A cattle grid across the road, with wall ends, a
  // gate beside it and a warning sign before it. It rattles as you cross.
  grid(job) {
    const road = this.road;
    const s = job.s0;
    const side = road.drive || 1;
    const fr = road.sample(s, {});
    // The gate stands beside the grid on the verge.
    // It hangs in the line of the wall, in the gap the grid's wall ends
    // leave for it (see BUILDS.grid), swinging away from the grid.
    for (const k of [-1, 1]) {
      const d = k * (RAIL_OFFSET + 0.4);
      const g = road.sample(s + k * GATE_AT, {});
      this.props.add('gate', g.x + g.rightX * d, g.z + g.rightZ * d, Math.atan2(-g.dirZ, g.dirX) + (k < 0 ? Math.PI : 0));
    }
    const ws = s - 60;
    if (ws > road.start + 20) {
      const w = road.sample(ws, {});
      const d = side * (HALF_WIDTH + 1.3);
      this.props.add('sign_grid', w.x + w.rightX * d, w.z + w.rightZ * d, Math.atan2(-w.dirX, -w.dirZ));
    }
  },

  // { type: 'ford', at, span } The lane dips through a stream (shape the
  // dip with the pieces' grades). The water slows you down.
  ford(job) {
    const road = this.road;
    const span = job.f.span ?? 14;
    job.s0 = job.s0 - span / 2;
    job.s1 = job.s0 + span;
    job.mid = (job.s0 + job.s1) / 2;
    let low = Infinity;
    const f = {};
    for (let s = job.s0 - 10; s <= job.s1 + 10; s++) low = Math.min(low, road.sample(s, f).y);
    job.level = low + 0.2;
    job.up = mountainSide(this.road, job.mid - 20, job.mid + 20);
    const top = clearRun(road, job.mid, job.up, 120);
    const bottom = clearRun(road, job.mid, -job.up, 200);
    // The stream bed runs into the dip from both sides at water level.
    const line = acrossLine(road, job.mid, job.up * top, -job.up * bottom, 5);
    this.terrain.mods.push(channel(line, 5, (t, h) => Math.max(0, h - (job.level - 0.5 - Math.max(0, Math.abs(t - top) - 12) * 0.02))));
    job.river = settle(this.terrain, line, 5);
    for (let i = 0; i < job.river.length; i += 2) this.terrain.block(job.river[i], job.river[i + 1], 5);
    const ws = job.s0 - 60;
    if (ws > road.start + 20) {
      const w = road.sample(ws, {});
      const d = (road.drive || 1) * (HALF_WIDTH + 1.3);
      this.props.add('sign_ford', w.x + w.rightX * d, w.z + w.rightZ * d, Math.atan2(-w.dirX, -w.dirZ));
    }
  },

  // { type: 'bunting', at, count, every } Strings of flags across the road.
  bunting(job) {
    const { f } = job;
    job.poles = [];
    for (let k = 0; k < (f.count ?? 3); k++) {
      const s = this.road.start + f.at + k * (f.every ?? 14);
      const fr = this.road.sample(s, {});
      const pair = [];
      for (const side of [-1, 1]) {
        const d = side * 6.4;
        const x = fr.x + fr.rightX * d, z = fr.z + fr.rightZ * d;
        pair.push(this.props.add('flagpole', x, z, 0));
      }
      job.poles.push(pair);
    }
  },

  // { type: 'street', from, to, side } A suburban street edge: kerb,
  // pavement and front-garden walls, hedges and fences, with lampposts.
  // The kerb is what stops you (barrier 'kerb'). "style": "city" leaves out
  // the gardens and levels the ground further back for city blocks;
  // "prom" is a seafront promenade.
  street(job) {
    const { s0, s1 } = job;
    const sides = edgeSides(job);
    const P = HALF_WIDTH + PAVE + 0.4;
    // Level the pavement with the road, then let the gardens blend back
    // into the hillside behind.
    this.terrain.mods.push((x, z, f, h) => {
      const s = f.index;
      if (s < s0 - 12 || s > s1 + 12 || f.dist > P + 60 || !sides.includes(f.side)) return h;
      // A promenade has no gardens: past its railing the ground is the beach's.
      // A city street's blocks need level ground further back.
      const back = job.f.style === 'prom' ? [P + 0.5, P + 3] : job.f.style === 'city' ? [P + 30, P + 60] : [P + 16, P + 34];
      const w = smooth(s0 - 12, s0, s) * (1 - smooth(s1, s1 + 12, s)) * (1 - smooth(back[0], back[1], f.dist));
      // Under the pavement the ground sits just below it; gardens a touch up.
      return h + (f.roadY + (f.dist < HALF_WIDTH + PAVE + 0.2 ? -0.15 : 0.05) - h) * w;
    });
    const fr = {};
    for (const side of sides) {
      for (let s = s0 + 6 + (side > 0 ? 16 : 0); s < s1 - 4; s += 34) {
        if (this.mouthAt(s, side, 4)) continue;
        this.road.sample(s, fr);
        const d = side * (HALF_WIDTH + 0.55);
        this.props.add('lamppost', fr.x + fr.rightX * d, fr.z + fr.rightZ * d, Math.atan2(-fr.rightX * side, -fr.rightZ * side));
      }
      for (let s = s0; s <= s1; s += 4) {
        this.road.sample(s, fr);
        const d = side * (HALF_WIDTH + 3);
        this.terrain.block(fr.x + fr.rightX * d, fr.z + fr.rightZ * d, 3);
      }
    }
  },

  // { type: 'junction', at, side, length } A side road joining at a T, with
  // give-way lines where it meets the main road. Cars pull out of it.
  junction(job) {
    const road = this.road;
    const side = job.f.side === 'left' ? -1 : 1;
    const m = road.sample(job.s0, {});
    const L = job.f.length ?? 60;
    const ux = m.rightX * side, uz = m.rightZ * side;
    const ex = m.x + ux * (HALF_WIDTH + L), ez = m.z + uz * (HALF_WIDTH + L);
    // The side road climbs or falls with the hill, no steeper than 1 in 8.
    const rise = clamp(this.terrain.heightAt(ex, ez) - m.y, -0.12 * L, 0.12 * L);
    Object.assign(job, { side, L, ox: m.x, oz: m.z, ux, uz, vx: m.dirX, vz: m.dirZ, y0: m.y, rise });
    const W = SIDE_HALF + PAVE + 0.3;
    this.terrain.mods.push((x, z, f, h) => {
      const t = (x - m.x) * ux + (z - m.z) * uz;
      // The main road's own verge and pavement are its business.
      if (t < HALF_WIDTH + PAVE + 0.2 || t > HALF_WIDTH + L + 20) return h;
      const n = Math.abs((x - m.x) * m.dirX + (z - m.z) * m.dirZ);
      if (n > W + 14) return h;
      const w = (1 - smooth(W, W + 14, n)) * (1 - smooth(HALF_WIDTH + L, HALF_WIDTH + L + 20, t));
      return h + (junctionY(job, t) + (n < SIDE_HALF + PAVE ? -0.15 : 0.05) - h) * w;
    });
    for (let t = HALF_WIDTH + 4; t < HALF_WIDTH + L; t += 4) {
      for (const k of [-1, 1]) this.terrain.block(m.x + ux * t + m.dirX * k * 2, m.z + uz * t + m.dirZ * k * 2, 4);
    }
    // Houses down the side road, facing it.
    for (let t = HALF_WIDTH + 16; t < HALF_WIDTH + L - 6; t += 15) {
      for (const k of [-1, 1]) {
        const x = m.x + ux * t + m.dirX * k * 14, z = m.z + uz * t + m.dirZ * k * 14;
        const type = ['semi', 'semi_b', 'semi_c', 'bungalow'][Math.floor(this.rand() * 4)];
        this.props.add(type, x, z, Math.atan2(-m.dirX * k, -m.dirZ * k));
      }
    }
  },

  // { type: 'roundabout', at } A mini roundabout: a painted white dome in
  // the middle and side roads off both sides.
  roundabout(job) {
    for (const side of ['left', 'right']) {
      const j = { f: { ...job.f, type: 'junction', side, length: job.f.length ?? 50 }, s0: job.s0, s1: job.s1 };
      PLANS.junction.call(this, j);
      (job.arms ||= []).push(j);
    }
  },

  // { type: 'zebra', at } A zebra crossing: stripes, zigzags and a flashing
  // Belisha beacon each side.
  zebra(job) {
    const fr = this.road.sample(job.s0, {});
    for (const side of [-1, 1]) {
      const d = side * (HALF_WIDTH + 0.45);
      job.beacons ||= [];
      job.beacons.push(this.props.add('belisha', fr.x + fr.rightX * d + fr.dirX * 1.8, fr.z + fr.rightZ * d + fr.dirZ * 1.8, 0));
    }
  },

  // { type: 'bump', at } A speed hump across the road.
  bump() {},

  // { type: 'railbridge', at, span } The road dips under a brick railway
  // bridge on an embankment; a train rumbles over now and then.
  railbridge(job) {
    const road = this.road;
    const at = (job.s0 + job.s1) / 2;
    const m = road.sample(at, {});
    const top = m.y + RAIL_CLEAR + 1.0;
    Object.assign(job, { at, ox: m.x, oz: m.z, ux: m.rightX, uz: m.rightZ, vx: m.dirX, vz: m.dirZ, top });
    // The embankment: a flat-topped bank along the railway, slopes 1 in 1.5,
    // cut away where the road goes under it.
    this.terrain.mods.push((x, z, f, h) => {
      const n = Math.abs((x - m.x) * m.dirX + (z - m.z) * m.dirZ);
      if (n > 30) return h;
      const t = Math.abs((x - m.x) * m.rightX + (z - m.z) * m.rightZ);
      if (t > RAIL_LINE + 40) return h;
      // Bank up to the railway, or cut down to it where the hill is higher.
      const slope = Math.max(0, n - 4) / 1.5;
      const want = h < top ? Math.max(h, top - slope) : Math.min(h, top + slope);
      const w = (1 - smooth(RAIL_LINE, RAIL_LINE + 40, t)) * smooth(RAIL_OFFSET + 0.5, RAIL_OFFSET + 2, t);
      return h + (want - h) * w;
    });
  },

  // ---------------------------------------------------------------- forest
  // { type: 'tunneltree', at } A giant redwood standing over the road, with a
  // tunnel cut through its trunk that the road runs through. Its walls are
  // what you crash into.
  tunneltree(job) {
    const at = (job.s0 + job.s1) / 2;
    const m = this.road.sample(at, {});
    job.at = at;
    // Level ground round the foot of the trunk, at the road's height.
    this.terrain.mods.push((x, z, f, h) => {
      const r = Math.hypot(x - m.x, z - m.z);
      if (r > 30) return h;
      return h + (m.y - 0.2 - h) * (1 - smooth(14, 30, r));
    });
    this.props.add('tunnel_tree', m.x, m.z, Math.atan2(-m.dirZ, m.dirX), 1, m.y - 0.05);
    this.terrain.block(m.x, m.z, 13);
  },

  // { type: 'trestle', at, height } An old timber railway trestle crossing
  // high over the road (`height` m, 14), on banks where the ground reaches it.
  trestle(job) {
    const road = this.road;
    const at = job.s0;
    const m = road.sample(at, {});
    const top = m.y + (job.f.height ?? 14);
    // How far out each side the valley stays below the rails.
    const ext = {};
    for (const side of [-1, 1]) {
      let t = 10;
      while (t < 130 && this.terrain.heightAt(m.x + m.rightX * side * t, m.z + m.rightZ * side * t) < top - 1) t += 4;
      ext[side] = t;
    }
    Object.assign(job, { ox: m.x, oz: m.z, ux: m.rightX, uz: m.rightZ, vx: m.dirX, vz: m.dirZ, top, ext });
    this.terrain.mods.push((x, z, f, h) => {
      const n = Math.abs((x - m.x) * m.dirX + (z - m.z) * m.dirZ);
      if (n > 32) return h;
      const tt = (x - m.x) * m.rightX + (z - m.z) * m.rightZ;
      const t = Math.abs(tt);
      const e = ext[tt < 0 ? -1 : 1];
      if (t > e + 60) return h;
      const slope = Math.max(0, n - 4) / 1.4;
      // A bank up to the rails beyond the trestle's ends; a notch cut for
      // them wherever the hill is higher.
      const bank = smooth(e - 8, e + 2, t) * (1 - smooth(e + 40, e + 60, t));
      let want = h;
      if (h < top) want = h + (Math.max(h, top - slope) - h) * bank;
      else want = Math.min(h, top + slope);
      return h + (want - h) * smooth(RAIL_OFFSET + 1, RAIL_OFFSET + 4, t);
    });
    for (const side of [-1, 1]) for (let t = 6; t < ext[side] + 30; t += 5) this.terrain.block(m.x + m.rightX * side * t, m.z + m.rightZ * side * t, 4);
  },

  // { type: 'logbridge', from, to } A bridge of logs over a rushing river,
  // with log rails.
  logbridge(job) {
    job.mid = (job.s0 + job.s1) / 2;
    job.up = mountainSide(this.road, job.s0, job.s1);
    this.terrain.mods.push(gorge(this.road, job.s0 + 2, job.s1 - 2, job.f.depth ?? 8));
    job.river = acrossLine(this.road, job.mid, job.up * clearRun(this.road, job.mid, job.up, 300), -job.up * clearRun(this.road, job.mid, -job.up, 450), 6);
    for (let i = 0; i < job.river.length; i += 2) this.terrain.block(job.river[i], job.river[i + 1], 8);
  },

  // { type: 'firebreak', at, width } A wide strip cleared of trees across
  // the road and up the hills either side.
  firebreak(job) {
    const w = job.f.width ?? 30;
    const pts = acrossLine(this.road, job.s0, -500, 500, w / 3);
    for (let i = 0; i < pts.length; i += 2) this.terrain.block(pts[i], pts[i + 1], w / 2);
  },

  // { type: 'burnt', from, to, far } A stretch where a forest fire went
  // through: no living trees out to `far` m (dress it with snags).
  burnt(job) {
    const far = job.f.far ?? 220;
    const { s0, s1 } = job;
    // Scorched ground (see ground.js), fading out at the ends and edges.
    const mark = (x, z, f, h) => h;
    mark.cover = (x, z, fd, h, out) => {
      const s = fd.index;
      if (s < s0 - 60 || s > s1 + 60 || fd.dist > far + 40) return;
      out.burn = Math.max(out.burn, smooth(s0 - 60, s0 + 20, s) * (1 - smooth(s1 - 20, s1 + 60, s)) * (1 - smooth(far - 40, far + 40, fd.dist)));
    };
    this.terrain.mods.push(mark);
    const fr = {};
    for (let s = job.s0; s <= job.s1; s += 14) {
      this.road.sample(s, fr);
      for (let d = -far; d <= far; d += 14) this.terrain.block(fr.x + fr.rightX * d, fr.z + fr.rightZ * d, 11);
    }
  },

  // { type: 'clearing', from, to, far } Trees felled out to `far` m: a
  // logging yard or a clearing.
  clearing(job) {
    PLANS.burnt.call(this, job);
  },

  // ---------------------------------------------------------------- canyon
  // { type: 'arch', at, span } The road runs under a natural rock arch; its
  // feet are what you crash into.
  arch(job) {
    const at = (job.s0 + job.s1) / 2;
    const m = this.road.sample(at, {});
    this.terrain.mods.push((x, z, f, h) => {
      const r = Math.hypot(x - m.x, z - m.z);
      if (r > 34) return h;
      return h + (m.y - 0.3 - h) * (1 - smooth(20, 34, r));
    });
    this.props.add('rock_arch', m.x, m.z, Math.atan2(-m.rightZ, m.rightX), 1, m.y - 0.2);
    this.terrain.block(m.x, m.z, 20);
  },

  // { type: 'slot', from, to, height } Sheer rock walls `height` m high (40)
  // close in on both sides, right beside the road.
  slot(job) {
    const { s0, s1 } = job;
    const H = job.f.height ?? 40;
    const inner = RAIL_OFFSET + 0.6;
    this.terrain.mods.push((x, z, f, h) => {
      const s = f.index;
      if (s < s0 - 40 || s > s1 + 40 || f.dist > 90) return h;
      // Only behind the built walls, which taper off over the last few
      // metres: past them a lone ridge of ground would stand like a fin.
      const along = smooth(s0 - 6, s0 + 14, s) * (1 - smooth(s1 - 14, s1 + 6, s));
      // Up from the verge to the top in a few metres, then the canyon rim
      // eases back into the hills.
      const wall = f.roadY + H * smooth(inner + 5, inner + 9, f.dist) * (0.85 + 0.15 * Math.sin(s * 0.11 + f.side * 2));
      const want = Math.max(h, wall);
      return h + (want - h) * along * (1 - smooth(50, 90, f.dist));
    });
    for (let s = s0; s <= s1; s += 14) {
      const fr = this.road.sample(s, {});
      for (const side of [-1, 1]) this.terrain.block(fr.x + fr.rightX * side * (inner + 4), fr.z + fr.rightZ * side * (inner + 4), 6);
    }
  },

  // { type: 'dam', from, to, side, depth } The road runs along the crest of a
  // concrete dam: the reservoir on `side` (add a lake there), and a drop of
  // `depth` m (70) on the other.
  dam(job) {
    const { s0, s1 } = job;
    const wet = job.f.side === 'right' ? 1 : -1;
    const depth = job.f.depth ?? 70;
    job.wet = wet;
    job.depth = depth;
    this.terrain.mods.push((x, z, f, h) => {
      const s = f.index;
      if (s < s0 - 60 || s > s1 + 60 || f.side === wet || f.dist > 400) return h;
      const along = smooth(s0 - 50, s0 + 5, s) * (1 - smooth(s1 - 5, s1 + 50, s));
      // Just under the dam's downstream face (see BUILDS.dam), then the
      // canyon floor beyond its foot.
      const t = Math.min(1, Math.max(0, (f.dist - W - 0.2) / (depth * 0.7)) ** (1 / 1.6));
      // The face is steepest at the top, so the ground drops well clear there.
      const want = Math.min(h, f.roadY - 2.8 - (depth + 1) * t - 8 * smooth(W - 1.5, W + 1, f.dist) * (1 - t));
      return h + (want - h) * along;
    });
    // No rocks or scrub on the concrete.
    const fr = {};
    for (let s = s0; s <= s1; s += 8) {
      this.road.sample(s, fr);
      for (let d = W + 4; d < W + depth * 0.7 + 4; d += 8) this.terrain.block(fr.x - fr.rightX * wet * d, fr.z - fr.rightZ * wet * d, 7);
    }
  },

  // { type: 'railway', from, to, d, every } A railway alongside the road `d` m
  // out (+ right), curving away at the end, with a long freight train.
  railway(job) {
    const road = this.road;
    const d = job.f.d ?? 22;
    const k = Math.sign(d) || 1;
    const pts = [], ys = [];
    const fr = {};
    for (let s = job.s0; s <= job.s1; s += 4) {
      road.sample(s, fr);
      pts.push(fr.x + fr.rightX * d, fr.z + fr.rightZ * d);
      ys.push(fr.y - 1.0);
    }
    // Then away across the desert, gently curving off.
    road.sample(job.s1, fr);
    let x = pts[pts.length - 2], z = pts[pts.length - 1], dx = fr.dirX, dz = fr.dirZ, y = ys[ys.length - 1];
    const grade = (ys[ys.length - 1] - ys[Math.max(0, ys.length - 10)]) / 36;
    for (let i = 0; i < 70; i++) {
      dx += fr.rightX * k * 0.014;
      dz += fr.rightZ * k * 0.014;
      const l = Math.hypot(dx, dz);
      dx /= l;
      dz /= l;
      x += dx * 4;
      z += dz * 4;
      y += grade * 4 * Math.max(0, 1 - i / 30);
      pts.push(x, z);
      ys.push(y);
    }
    job.pts = pts;
    job.ys = ys;
    this.terrain.mods.push(railBed(pts, ys, 5));
    for (let i = 0; i < pts.length; i += 6) this.terrain.block(pts[i], pts[i + 1], 6);
  },

  // { type: 'raildeck', at, span, angle, every } The road bridges a railway
  // in a cutting below; a freight train passes under every `every` s.
  raildeck(job) {
    const road = this.road;
    const at = (job.s0 + job.s1) / 2;
    const m = road.sample(at, {});
    const a = ((job.f.angle ?? 70) * Math.PI) / 180;
    // Along the line: turned `angle` from the road direction.
    const ux = m.dirX * Math.cos(a) + m.rightX * Math.sin(a), uz = m.dirZ * Math.cos(a) + m.rightZ * Math.sin(a);
    const railY = m.y - (job.f.depth ?? 8.5);
    const pts = [], ys = [];
    for (let t = -500; t <= 500; t += 5) {
      pts.push(m.x + ux * t, m.z + uz * t);
      ys.push(railY + Math.abs(t) * 0.004);
    }
    Object.assign(job, { at, pts, ys, railY });
    this.terrain.mods.push(railBed(pts, ys, 7));
    for (let i = 0; i < pts.length; i += 6) this.terrain.block(pts[i], pts[i + 1], 7);
  },

  // { type: 'dust', at, wind } Sand blowing across the road in gusts, from
  // the left unless `wind` is 'right'.
  dust() {},

  // { type: 'smoke', at, d, h, side } Smoke curling up from a chimney `h` m
  // above the ground at (at, d) ("side": "valley" as for props).
  smoke() {},

  // ---------------------------------------------------------------- city
  // { type: 'tram', from, to } Tram rails set in both lanes, with poles and
  // overhead wires.
  tram() {},

  // { type: 'lights', from, to, every, style } Strings of lights across the
  // street between the building fronts: red paper lanterns ("lanterns") or
  // fairy lights ("fairy").
  lights() {},

  // { type: 'suspension', from, to, depth, river } A lit suspension bridge
  // over a river `river` m wide (160) whose water lies `depth` m (28) below
  // the deck. Keep the road straight and nearly level across it.
  suspension(job) {
    const { s0, s1, f } = job;
    const mid = (s0 + s1) / 2;
    const o = this.road.sample(mid, {});
    const Wr = (f.river ?? 160) / 2;
    const level = (job.level = o.y - (f.depth ?? 28));
    const Lh = (s1 - s0) / 2;
    Object.assign(job, { mid, o, Wr });
    this.terrain.mods.push((x, z, fd, h) => {
      const t = Math.abs((x - o.x) * o.dirX + (z - o.z) * o.dirZ);
      if (t > Lh + 80) return h;
      const n = Math.abs((x - o.x) * o.rightX + (z - o.z) * o.rightZ);
      const fade = 1 - smooth(900, 1300, n);
      // The river bed, a quay a few metres above the water, then the banks
      // climbing back to the street at the bridge ends.
      const want = t < Wr ? level - 6 : level + 3 + Math.max(0, t - Wr - 14) * ((o.y - level) / Math.max(20, Lh + 30 - Wr));
      return h + (Math.min(h, want) - h) * fade;
    });
    // Boats moored along the banks and out on the water.
    const boats = f.boats ?? 3;
    for (let k = 0; k < boats; k++) {
      const n = (k % 2 ? 1 : -1) * (60 + k * 70);
      const t = (k % 2 ? -1 : 1) * (Wr - 14);
      const x = o.x + o.rightX * n + o.dirX * t, z = o.z + o.rightZ * n + o.dirZ * t;
      this.props.add(k % 2 ? 'riverboat_b' : 'riverboat', x, z, Math.atan2(o.dirX, o.dirZ) + Math.PI / 2, 1, level);
    }
  },

  // { type: 'underpass', from, to } An orange-lit tunnel under the city:
  // tiled walls, a roof with a paved square on top, fans, and retaining
  // walls down the cutting either end.
  underpass(job) {
    const { s0, s1 } = job;
    const R = 6.2;
    const wall = HALF_WIDTH + 1.25;
    this.terrain.mods.push((x, z, f, h) => {
      const s = f.index;
      if (s < s0 - 70 || s > s1 + 70 || f.dist > 90) return h;
      const ends = smooth(s0 - 70, s0 - 60, s) * (1 - smooth(s1 + 60, s1 + 70, s));
      // Nothing inside the walls (the ground the road would otherwise cut
      // through), then the city up level with the roof beyond them.
      if (f.dist < wall + 6) return h + (Math.min(h, f.roadY - 0.4) - h) * ends;
      const ramp = smooth(s0 - 60, s0, s) * (1 - smooth(s1, s1 + 60, s));
      const want = f.roadY + (R + 0.3) * ramp * smooth(wall + 6, wall + 10, f.dist) + Math.max(0, f.dist - 30) * 0.05;
      return h + (want - h) * ends * (1 - smooth(60, 90, f.dist));
    });
    const fr = {};
    for (let s = s0 - 60; s <= s1 + 60; s += 10) {
      this.road.sample(s, fr);
      for (const side of [-1, 1]) this.terrain.block(fr.x + fr.rightX * side * 14, fr.z + fr.rightZ * side * 14, 10);
    }
  },

  // { type: 'fair', at, d } A riverside fair: a turning ferris wheel and a
  // merry-go-round on level ground at `d` m from the road.
  fair(job) {
    const f = job.f;
    const at = this.road.start + f.at;
    const d = f.d ?? 40;
    const sd = Math.sign(d) || 1;
    this.terrain.mods.push((x, z, fd, h) => {
      const s = fd.index;
      if (s < at - 120 || s > at + 120 || fd.side !== sd || fd.dist > Math.abs(d) + 60) return h;
      const w = smooth(at - 120, at - 70, s) * (1 - smooth(at + 70, at + 120, s)) * smooth(HALF_WIDTH + 2, HALF_WIDTH + 8, fd.dist) * (1 - smooth(Math.abs(d) + 35, Math.abs(d) + 60, fd.dist));
      return h + (fd.roadY - 0.3 - h) * w;
    });
    const p = Props.at(this.road, at, d, 'along');
    job.wheel = { x: p.x, z: p.z, yaw: p.yaw };
    this.props.add('ferris_legs', p.x, p.z, p.yaw);
    const q = Props.at(this.road, at + 45, d * 0.8, 0);
    job.carousel = { x: q.x, z: q.z };
    this.terrain.block(q.x, q.z, 9);
  },

  // { type: 'harbour', from, to, side, near } Docks: a quay wall `near` m
  // (30) out from the road with deep water beyond, a container ship moored
  // along it and cranes on the quay.
  harbour(job) {
    const { s0, s1, f } = job;
    const side = (job.side = f.side === 'left' ? -1 : 1);
    const near = (job.near = f.near ?? 30);
    let lo = Infinity;
    for (let s = s0; s <= s1; s += 4) lo = Math.min(lo, this.road.y[Math.round(s)]);
    // On the coast it shares the sea's water.
    const level = (job.level = this.seaLevel ?? lo - 3);
    const fishing = (job.fishing = f.style === 'fishing');
    Object.assign(job, { far: near + 400 });
    this.terrain.mods.push((x, z, fd, h) => {
      const s = fd.index;
      if (s < s0 - 60 || s > s1 + 60 || fd.side !== side || fd.dist < HALF_WIDTH + 1) return h;
      const along = smooth(s0 - 60, s0 - 10, s) * (1 - smooth(s1 + 10, s1 + 60, s));
      const inner = s > s0 && s < s1;
      // The quay apron at street level, then a sheer drop into the water.
      const want = fd.dist < near ? fd.roadY - 0.3 : inner ? level - 8 : h;
      return h + (want - h) * (fd.dist < near ? along : 1) * (1 - smooth(near + 380, near + 420, fd.dist));
    });
    const fr = {};
    for (let s = s0; s <= s1; s += 15) {
      this.road.sample(s, fr);
      for (let d = near + 8; d < near + 400; d += 15) this.terrain.block(fr.x + fr.rightX * d * side, fr.z + fr.rightZ * d * side, 14);
    }
    for (let s = s0 + 8; s < s1; s += 16) {
      this.road.sample(s, fr);
      const d = side * (near - 1.0);
      this.props.add('bollard_quay', fr.x + fr.rightX * d, fr.z + fr.rightZ * d, 0, 1, fr.y - 0.26);
    }
    const mid = (s0 + s1) / 2;
    if (fishing) {
      // Boats moored off the quay, a light on the end of each arm, and pots
      // and fish boxes on the quay.
      const arm = (job.arm = f.arm ?? 70);
      const boats = ['boat_a', 'boat_b', 'boat_c', 'boat_d'];
      let k = 0;
      for (let s = s0 + 14; s < s1 - 10; s += 17, k++) {
        const b = Props.at(this.road, s, side * (near + 6 + (k % 2) * 9 + this.rand() * 4), 'along');
        this.props.add(boats[k % 4], b.x, b.z, b.yaw + (this.rand() - 0.5) * 0.5, 1, level);
      }
      for (const s of [s0, s1]) {
        const l = Props.at(this.road, s, side * (near + arm - 3), 0);
        this.props.add('harbour_light', l.x, l.z, l.yaw, 1, this.road.sample(s, fr).y - 0.25);
      }
      for (let s = s0 + 10; s < s1 - 6; s += 23) {
        const p = Props.at(this.road, s, side * (near - 3 - this.rand() * 3), this.rand() * 360);
        this.props.add(this.rand() < 0.6 ? 'lobster_pots' : 'fish_boxes', p.x, p.z, p.yaw, 1, this.road.sample(s, fr).y - 0.26);
      }
      return;
    }
    const ship = Props.at(this.road, mid, side * (near + 18), 'along');
    this.props.add('ship', ship.x, ship.z, ship.yaw, 1, level);
    const cranes = f.cranes ?? 3;
    for (let k = 0; k < cranes; k++) {
      const c = Props.at(this.road, mid - 60 + k * 60, side * (near - 12), 180);
      this.props.add('crane', c.x, c.z, c.yaw);
    }
  },
};

// ---------------------------------------------------------------- builds
const BUILDS = {

  tunneltree() {},
  arch() {},

  // Banded sandstone cliffs either side, built as geometry so the strata
  // run level (the terrain behind them carries the rim).
  slot(job) {
    const { s0, s1 } = job;
    const H = job.f.height ?? 40;
    const inner = RAIL_OFFSET + 0.6;
    const geo = new Geo();
    const rnd = mulberry32(Math.round(s0));
    const REDS = ['#9a4a2e', '#b0603a', '#c27a4a', '#8a3e26', '#a85a36', '#d09060'];
    const bands = Array.from({ length: 12 }, () => REDS[Math.floor(rnd() * REDS.length)]);
    const ph = [rnd() * 6, rnd() * 6, rnd() * 6];
    const fr = {};
    const rows = Math.ceil(H / 2.5);
    for (const side of [-1, 1]) {
      let prev = null;
      for (let s = s0 - 6; s <= s1 + 6.01; s += 2.5) {
        this.road.sample(s, fr);
        const ends = smooth(s0 - 6, s0 + 6, s) * (1 - smooth(s1 - 6, s1 + 6, s));
        const ring = [];
        for (let i = 0; i <= rows; i++) {
          const h = (i / rows) * H * (0.85 + 0.15 * Math.sin(s * 0.11 + side * 2)) * ends;
          // Ledges and bulges, the face leaning back a little with height.
          const d = inner + 0.3 + 1.2 * (0.5 + 0.5 * Math.sin(s * 0.21 + h * 0.15 + ph[0] + side)) + 0.6 * Math.sin(h * 0.9 + ph[1]) ** 2 + h * 0.05 + (1 - ends) * 6;
          ring.push(new THREE.Vector3(fr.x + fr.rightX * side * d, fr.y - 1.5 + h, fr.z + fr.rightZ * side * d));
        }
        if (prev) {
          for (let i = 0; i < rows; i++) {
            const hm = (prev[i].y + ring[i + 1].y) / 2 - fr.y;
            const col = bands[Math.floor(Math.max(0, hm + 2 * Math.sin(s * 0.05 + ph[2])) / (H / 10)) % bands.length];
            const c = new THREE.Vector3(fr.x, prev[i].y, fr.z);
            geo.quad(prev[i], ring[i], ring[i + 1], prev[i + 1], PLASTER, col, c);
          }
        }
        prev = ring;
      }
    }
    this.mesh(geo);
  },

  dam(job) {
    const { s0, s1, wet, depth } = job;
    const road = this.road;
    const geo = new Geo();
    const dry = -wet;
    deckAndParapets(geo, road, s0, s1, MASONRY, CONCRETE);
    // The downstream face curving down to the canyon floor, and the
    // upstream face into the water.
    const face = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      face.push([dry * (W + 0.2 + depth * 0.7 * t ** 1.6), -1.3 - depth * t]);
    }
    sweep(geo, road, s0, s1, [[dry * W, -1.3], ...face, [dry * W, -depth - 1.3]], PLASTER, CONCRETE, { step: 4 });
    sweep(geo, road, s0, s1, [[wet * W, -1.3], [wet * (W + 0.5), -1.3], [wet * (W + 9), -24], [wet * W, -24]], MASONRY, '#a8a090', { step: 4 });
    // Expansion joints down the face.
    for (let s = s0 + 12; s < s1 - 6; s += 15) {
      const { f, along, across } = frame(road, s);
      for (let i = 0; i < 8; i++) {
        const [d0, h0] = face[i], [d1, h1] = face[i + 1];
        const a = new THREE.Vector3(f.x + across.x * d0, f.y + h0, f.z + across.z * d0);
        const b = new THREE.Vector3(f.x + across.x * d1, f.y + h1, f.z + across.z * d1);
        strut(geo, a.addScaledVector(across, dry * 0.05), b.addScaledVector(across, dry * 0.05), 0.12, MASONRY, '#9a9284');
      }
    }
    this.mesh(geo);
  },

  railway(job) {
    track.call(this, job.pts, job.ys);
    freight.call(this, job.pts, job.ys, { every: job.f.every ?? 70, speed: job.f.speed ?? 16, cars: job.f.cars ?? 14, phase: job.f.phase ?? 0 });
  },

  raildeck(job) {
    const road = this.road;
    const span = job.f.span ?? 18;
    const s0 = job.at - span / 2, s1 = job.at + span / 2;
    const geo = new Geo();
    deckAndParapets(geo, road, s0, s1, MASONRY, CONCRETE);
    // Concrete abutments down into the cutting either side of the line.
    for (const s of [s0, s1]) {
      const { f, along, across } = frame(road, s);
      geo.box(f.x, f.z, job.railY - 1, f.y - 1.3, along, 1.2, across, W + 0.4, MASONRY, CONCRETE);
    }
    const { f, along, across } = frame(road, job.at);
    for (const k of [-1, 1]) {
      const c = new THREE.Vector3(f.x, 0, f.z).addScaledVector(across, k * (W - 0.6));
      geo.box(c.x, c.z, f.y - 2.9, f.y - 1.3, along, span / 2, across, 0.5, MASONRY, '#a8a090');
    }
    this.mesh(geo);
    track.call(this, job.pts, job.ys);
    freight.call(this, job.pts, job.ys, { every: job.f.every ?? 40, speed: 20, cars: 10, phase: job.f.phase ?? 6 });
  },

  dust(job) {
    const f = job.f;
    const s = this.road.start + f.at;
    const fr = this.road.sample(s, {});
    const tex = smokeTexture();
    const puffs = [];
    const N = 10;
    for (let i = 0; i < N; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: f.color ?? '#d8a878', transparent: true, depthWrite: false, opacity: 0 }));
      this.group.add(sp);
      puffs.push(sp);
    }
    const dir = f.wind === 'right' ? -1 : 1;
    this.gondolas.push({
      update: (time) => {
        for (let i = 0; i < N; i++) {
          const ph = (time * 0.12 + i / N) % 1;
          const along = Math.sin(i * 12.9) * 12;
          const across = dir * (-16 + ph * 32);
          const sp = puffs[i];
          const y = this.terrain.heightAt(fr.x + fr.rightX * across + fr.dirX * along, fr.z + fr.rightZ * across + fr.dirZ * along);
          sp.position.set(fr.x + fr.rightX * across + fr.dirX * along, Math.max(y, fr.y) + 0.4 + ph * 1.2, fr.z + fr.rightZ * across + fr.dirZ * along);
          const r = 1.5 + ph * 3;
          sp.scale.set(r * 1.8, r * 0.7, 1);
          sp.material.opacity = Math.sin(ph * Math.PI) * 0.45 * (0.5 + 0.5 * Math.sin(time * 0.7 + i));
        }
      },
    });
  },

  trestle(job) {
    const { ox, oz, ux, uz, vx, vz, top, ext } = job;
    const geo = new Geo();
    const P = (t, n, y) => new THREE.Vector3(ox + ux * t + vx * n, y, oz + uz * t + vz * n);
    const U = new THREE.Vector3(ux, 0, uz), V = new THREE.Vector3(vx, 0, vz);
    const BENT = '#5e4532', DECK = '#4e3b2c', RUST = '#6b4b3a';
    const gap = RAIL_OFFSET + 2.5;
    // Bents every 5 m across the valley, skipping the road.
    for (const side of [-1, 1]) {
      for (let t = gap; t <= ext[side] + 2; t += 5) {
        const tt = side * t;
        const g = Math.min(this.terrain.heightAt(P(tt, -2, 0).x, P(tt, -2, 0).z), this.terrain.heightAt(P(tt, 2, 0).x, P(tt, 2, 0).z)) - 0.3;
        const H = top - 0.5 - g;
        if (H < 0.8) continue;
        const spread = 1.3 + H * 0.12;
        // Two vertical inner posts and two battered outer posts.
        for (const n of [-0.55, 0.55]) strut(geo, P(tt, n, g), P(tt, n, top - 0.5), 0.14, PLANKS, BENT);
        for (const k of [-1, 1]) strut(geo, P(tt, k * spread, g), P(tt, k * 1.3, top - 0.5), 0.15, PLANKS, BENT);
        // Sills and girts, with X bracing between them.
        const tiers = Math.max(1, Math.round(H / 5));
        for (let i = 0; i <= tiers; i++) {
          const y = g + (H * i) / tiers;
          const w = spread + (1.3 - spread) * (i / tiers);
          strut(geo, P(tt, -w - 0.2, y), P(tt, w + 0.2, y), 0.1, PLANKS, BENT);
          if (i < tiers) {
            const y2 = g + (H * (i + 1)) / tiers, w2 = spread + (1.3 - spread) * ((i + 1) / tiers);
            strut(geo, P(tt, -w, y), P(tt, w2, y2), 0.07, PLANKS, BENT);
            strut(geo, P(tt, w, y), P(tt, -w2, y2), 0.07, PLANKS, BENT);
          }
        }
        // Longitudinal braces to the next bent.
        if (t + 5 <= ext[side] + 2) for (const n of [-1.3, 1.3]) strut(geo, P(tt, n, top - 2.5), P(tt + side * 5, n, top - 2.5), 0.08, PLANKS, BENT);
      }
    }
    const t0 = -ext[-1] - 6, t1 = ext[1] + 6;
    // Deep girders over the road, the stringers, the ties and two rusty rails.
    for (const n of [-0.9, 0.9]) {
      const a = P(-gap - 0.5, n, 0), b = P(gap + 0.5, n, 0);
      geo.box((a.x + b.x) / 2, (a.z + b.z) / 2, top - 1.6, top - 0.5, U, gap + 0.5, V, 0.2, PLANKS, DECK);
      const c = P(t0, n, 0), d = P(t1, n, 0);
      geo.box((c.x + d.x) / 2, (c.z + d.z) / 2, top - 0.5, top - 0.15, U, (t1 - t0) / 2, V, 0.25, PLANKS, DECK);
    }
    for (let t = t0; t <= t1; t += 0.65) {
      const c = P(t, 0, 0);
      geo.box(c.x, c.z, top - 0.15, top, U, 0.12, V, 1.4, PLANKS, '#3e2f24');
    }
    for (const n of [-0.72, 0.72]) {
      const c = P((t0 + t1) / 2, n, 0);
      geo.box(c.x, c.z, top, top + 0.16, U, (t1 - t0) / 2, V, 0.04, METAL, RUST);
    }
    for (const n of [-1.45, 1.45]) {
      const c = P((t0 + t1) / 2, n, 0);
      geo.box(c.x, c.z, top, top + 0.22, U, (t1 - t0) / 2, V, 0.1, PLANKS, DECK);
    }
    this.mesh(geo);
  },

  logbridge(job) {
    const { s0, s1 } = job;
    const road = this.road;
    const geo = new Geo();
    const w = W - 0.2;
    // Plank deck on great log stringers, log rails on log posts.
    sweep(geo, road, s0 - 1, s1 + 1, [[-w - 0.3, -0.35], [w + 0.3, -0.35], [w + 0.3, -0.02], [-w - 0.3, -0.02]], PLANKS, '#6a4c34');
    for (let k = -3; k <= 3; k++) {
      const d = (k / 3) * (w - 0.2);
      sweep(geo, road, s0 - 3, s1 + 3, logSection(d, -0.85, 0.5), PLANKS, k % 2 ? '#5a4030' : '#634634', { step: 3 });
    }
    for (const side of [-1, 1]) {
      const o = side * w;
      sweep(geo, road, s0, s1, logSection(o, 0.95, 0.17), PLANKS, '#6e5038', { step: 2 });
      sweep(geo, road, s0, s1, logSection(o, 0.45, 0.12), PLANKS, '#6e5038', { step: 2 });
      const n = Math.round((s1 - s0) / 3);
      for (let i = 0; i <= n; i++) {
        const { f, along, across } = frame(road, s0 + ((s1 - s0) * i) / n);
        geo.box(f.x + across.x * o, f.z + across.z * o, f.y - 0.4, f.y + 1.15, along, 0.16, across, 0.16, PLANKS, '#5a4030');
      }
    }
    // Crib piers of crossed logs at each bank.
    for (const s of [s0, s1]) {
      const { f, along, across } = frame(road, s);
      for (let i = 0; i < 8; i++) {
        const y = f.y - 1.1 - i * 0.5;
        if (i % 2) geo.box(f.x, f.z, y - 0.5, y, along, 1.4, across, 0.25, PLANKS, '#4e3829');
        else for (const k of [-1, 1]) geo.box(f.x + along.x * k * 1.2, f.z + along.z * k * 1.2, y - 0.5, y, along, 0.25, across, w + 0.6, PLANKS, '#5a4030');
      }
    }
    this.mesh(geo);
    river.call(this, job.river, 7);
  },

  firebreak() {},
  burnt() {},
  clearing() {},

  smoke(job) {
    const f = job.f;
    const s = this.road.start + f.at;
    let d = f.d ?? 0;
    if (f.side === 'valley' || f.side === 'mountain') d = Math.abs(d) * ((this.road.c[Math.round(s)] || 0) > 0 ? 1 : -1) * (f.side === 'valley' ? -1 : 1);
    const p = Props.at(this.road, s, d);
    // "y": "sea": spray off the rocks at sea level.
    const y = (f.y === 'sea' && this.seaLevel != null ? this.seaLevel : this.terrain.heightAt(p.x, p.z)) + (f.h ?? 8);
    const tex = smokeTexture();
    const puffs = [];
    const N = 22;
    // Unlit sprites, so dim them to suit the light: grey wisps by day, faint
    // at night.
    const col = new THREE.Color(f.color ?? '#d8d4cc').multiplyScalar(1 - Math.max(0, ENV.night - 0.5) * 1.5);
    const rnd = mulberry32(Math.round(s * 7));
    for (let i = 0; i < N; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: col, transparent: true, depthWrite: false, opacity: 0 }));
      sp.userData.smoke = true;
      sp.userData.base = p;
      sp.userData.j = [rnd(), rnd(), rnd()];
      this.group.add(sp);
      puffs.push(sp);
    }
    const rate = 0.06, drift = new THREE.Vector3(1, 0, 0.4).normalize();
    if (f.style === 'spray') {
      // Waves bursting on the rocks: white spray flung up in bursts every
      // few seconds, here and there round the spot, falling back as it fades.
      this.gondolas.push({
        update: (time) => {
          for (let i = 0; i < N; i++) {
            const sp = puffs[i];
            const [j0, j1, j2] = sp.userData.j;
            const ph = (time * (0.16 + j2 * 0.05) + j0) % 1;
            const k = Math.floor(time * (0.16 + j2 * 0.05) + j0);
            const a = (j1 + k * 0.618) * 6.283, rr = 3 + ((j0 * 7 + k * 0.37) % 1) * 9;
            const up = Math.max(0, ph * 16 - ph * ph * 14);
            const r = (2 + ph * 7) * (0.8 + j1 * 0.4);
            sp.position.set(p.x + Math.cos(a) * rr, y + up, p.z + Math.sin(a) * rr);
            sp.scale.set(r, r * 0.8, 1);
            sp.material.opacity = ph < 0.6 ? Math.min(1, ph * 12) * (1 - ph / 0.6) * 0.9 : 0;
            sp.material.rotation = j0 * 6.3;
          }
        },
      });
      return;
    }
    this.gondolas.push({
      update: (time) => {
        for (let i = 0; i < N; i++) {
          const ph = (time * rate + i / N) % 1;
          const sp = puffs[i];
          const [j0, j1, j2] = sp.userData.j;
          // Rises straight out of the chimney, then leans over in the wind
          // and spreads as it thins.
          const up = ph * 22, lean = ph * ph * 18;
          const wob = Math.sin(time * 0.4 + j0 * 9) * ph * 2.2;
          const r = (1.1 + ph * 8.5) * (0.85 + j1 * 0.3);
          sp.position.set(p.x + drift.x * lean - drift.z * wob, y + 0.4 + up, p.z + drift.z * lean + drift.x * wob);
          sp.scale.set(r, r, 1);
          sp.material.opacity = Math.min(1, ph * 7) * (1 - ph) * (0.85 + j2 * 0.15);
          sp.material.rotation = j0 * 6.3 + ph * (j1 - 0.5) * 1.6;
        }
      },
    });
  },

  bridge(job) {
    const { s0, s1 } = job;
    const geo = new Geo();
    const road = this.road;
    deckAndParapets(geo, road, s0, s1, MASONRY, STONE);
    // Arched spans between piers, about 14 m apart.
    const n = Math.max(1, Math.round((s1 - s0) / 14));
    const L = (s1 - s0) / n;
    const pierW = 2.4;
    const R = (L - pierW) / 2;
    const vSpring = -1.3 - 0.9 - R;
    for (let i = 0; i < n; i++) {
      const sa = s0 + i * L, sb = sa + L;
      archSpan(geo, road, sa, sb, R, pierW, vSpring, STONE);
    }
    for (let i = 0; i <= n; i++) {
      const s = s0 + i * L;
      const { f, along, across } = frame(road, s);
      const ground = Math.min(this.terrain.heightAt(f.x + across.x * W, f.z + across.z * W), this.terrain.heightAt(f.x - across.x * W, f.z - across.z * W), this.terrain.heightAt(f.x, f.z));
      const top = f.y + vSpring + 0.2;
      if (ground < top) geo.box(f.x, f.z, ground - 3, top, along, pierW / 2, across, W + 0.25, MASONRY, STONE);
    }
    this.mesh(geo);
    if (job.river) river.call(this, job.river, 7);
  },

  covered(job) {
    const { s0, s1 } = job;
    const road = this.road;
    const geo = new Geo();
    const w = W - 0.2;
    // Deck, low plank walls, posts, a beam and the gable roof.
    sweep(geo, road, s0 - 1, s1 + 1, [[-w - 0.3, -1.2], [w + 0.3, -1.2], [w + 0.3, -0.02], [-w - 0.3, -0.02]], PLANKS, '#5a3f28');
    for (const side of [-1, 1]) {
      const o = side * w;
      sweep(geo, road, s0, s1, [[o - side * 0.12, -0.02], [o + side * 0.06, -0.02], [o + side * 0.06, 1.25], [o - side * 0.12, 1.25]], PLANKS, TIMBER);
      sweep(geo, road, s0, s1, [[o - side * 0.25, 3.55], [o + side * 0.1, 3.55], [o + side * 0.1, 3.9], [o - side * 0.25, 3.9]], PLANKS, '#5a3f28');
      sweep(geo, road, s0, s1, [[o - side * 0.15, 1.25], [o + side * 0.08, 1.25], [o + side * 0.08, 1.4], [o - side * 0.15, 1.4]], PLANKS, '#5a3f28');
    }
    const ridge = 6.0, eave = 3.75, ov = 0.9;
    for (const side of [-1, 1]) {
      const e = side * (w + ov);
      sweep(geo, road, s0 - 1.2, s1 + 1.2, [[0, ridge], [0, ridge + 0.25], [e, eave - 0.2 + 0.25], [e, eave - 0.2]], SHINGLES, ROOF);
    }
    // Gable boards at each portal, above the beam.
    for (const s of [s0, s1]) {
      sweep(geo, road, s - 0.15, s + 0.15, [[-w, 3.9], [w, 3.9], [0, ridge - 0.05]], PLANKS, TIMBER);
    }
    // Posts every 2.5 m with knee braces.
    const count = Math.round((s1 - s0) / 2.5);
    for (let i = 0; i <= count; i++) {
      const s = s0 + ((s1 - s0) * i) / count;
      const { f, along, across } = frame(road, s);
      for (const side of [-1, 1]) {
        const x = f.x + across.x * side * w, z = f.z + across.z * side * w;
        geo.box(x, z, f.y - 0.02, f.y + 3.6, along, 0.12, across, 0.12, PLANKS, '#5a3f28');
      }
    }
    // Stone abutments down into the stream bed.
    for (const s of [s0, s1]) {
      const { f, along, across } = frame(road, s);
      geo.box(f.x, f.z, f.y - 9, f.y - 1.1, along, 1.6, across, w + 0.6, MASONRY, STONE);
    }
    this.mesh(geo);
    river.call(this, job.river, 4.5);
  },

  stream(job) {
    const road = this.road;
    const span = job.f.span ?? 18;
    const s0 = job.mid - span / 2, s1 = job.mid + span / 2;
    const geo = new Geo();
    deckAndParapets(geo, road, s0, s1, MASONRY, STONE);
    const R = (span - 3) / 2;
    archSpan(geo, road, s0, s1, R, 3, -1.3 - 0.8 - R, STONE);
    for (const s of [s0, s1]) {
      const { f, along, across } = frame(road, s);
      geo.box(f.x, f.z, f.y - 12, f.y - 1.3 - 0.8 - R + 0.1, along, 1.6, across, W + 0.2, MASONRY, STONE);
    }
    this.mesh(geo);
    river.call(this, job.river, 3.2, !!job.f.fall);
  },

  gallery(job) {
    const { s0, s1, up } = job;
    const road = this.road;
    const geo = new Geo();
    const H = 6.2;
    const back = up * 4.95;
    // Back wall, roof slab running into the slope, valley-side parapet.
    sweep(geo, road, s0, s1, [[back, -0.1], [back + up * 0.8, -0.1], [back + up * 0.8, H], [back, H]], PLASTER, CONCRETE);
    sweep(geo, road, s0, s1, [[-up * 5.9, H], [up * 9.5, H], [up * 9.5, H + 0.9], [-up * 5.9, H + 0.9]], PLASTER, CONCRETE);
    sweep(geo, road, s0, s1, [[-up * 4.95, -0.1], [-up * 5.6, -0.1], [-up * 5.6, 1.0], [-up * 4.95, 1.0]], PLASTER, CONCRETE);
    // Darker ceiling soffit and a run of lamps down the middle.
    sweep(geo, road, s0 + 0.5, s1 - 0.5, [[-up * 5.0, H - 0.25], [up * 4.9, H - 0.25], [up * 4.9, H - 0.01], [-up * 5.0, H - 0.01]], PAINT, '#55524c', { caps: false });
    for (let s = s0 + 6; s < s1 - 3; s += 12) {
      const { f, along, across } = frame(road, s);
      geo.box(f.x, f.z, f.y + H - 0.4, f.y + H - 0.25, along, 0.8, across, 0.15, EMISSIVE, '#ffd9a0');
    }
    // Valley-side pillars and portal beams.
    const count = Math.max(2, Math.round((s1 - s0) / 6));
    for (let i = 0; i <= count; i++) {
      const s = s0 + ((s1 - s0) * i) / count;
      const { f, along, across } = frame(road, s);
      const x = f.x - across.x * up * 5.35, z = f.z - across.z * up * 5.35;
      geo.box(x, z, f.y - 2.5, f.y + H, along, 0.35, across, 0.45, PLASTER, CONCRETE);
    }
    for (const s of [s0, s1]) {
      const { f, along, across } = frame(road, s);
      geo.box(f.x + across.x * up * 1.8, f.z + across.z * up * 1.8, f.y + H - 0.6, f.y + H + 1.3, along, 0.5, across, 7.8, PLASTER, '#a8a499');
    }
    this.mesh(geo);
  },

  lake(job) {
    const { s0, s1, side, near, far, level } = job;
    const road = this.road;
    const pos = [];
    const idx = [];
    const ds = 10, dd = 12;
    const ns = Math.ceil((s1 - s0 + 120) / ds), nd = Math.ceil((far + 60 - (near - 8)) / dd);
    const f = {};
    for (let i = 0; i <= ns; i++) {
      road.sample(s0 - 60 + i * ds, f);
      for (let j = 0; j <= nd; j++) {
        const d = side * (near - 8 + j * dd);
        pos.push(f.x + f.rightX * d, level, f.z + f.rightZ * d);
      }
    }
    for (let i = 0; i < ns; i++) {
      for (let j = 0; j < nd; j++) {
        const a = i * (nd + 1) + j, b = a + 1, c = a + nd + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // Up-facing normals everywhere, whichever way the grid winds.
    const nrm = g.attributes.normal;
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
    const uv = new Float32Array((pos.length / 3) * 2);
    for (let i = 0; i < pos.length / 3; i++) {
      uv[i * 2] = pos[i * 3] / 14;
      uv[i * 2 + 1] = pos[i * 3 + 2] / 14;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    // Winding: make sure the top faces up.
    const m = new THREE.Mesh(g, this.lakeMat);
    this.lakeMat.side = THREE.DoubleSide;
    m.receiveShadow = true;
    this.group.add(m);
  },

  sea(job) {
    // Boulders fallen from the cliff, along its foot at the waterline.
    const road = this.road;
    const fr = {};
    for (let s = road.start - 200; s < Math.min(road.count, (road.finish ?? road.count) + 300); s += 9) {
      if (job.beachAt(s) > 0.3) continue;
      road.sample(s, fr);
      const e = job.edge(s);
      for (let d = e; d < e + 120; d += 3) {
        const x = fr.x + fr.rightX * d * job.side, z = fr.z + fr.rightZ * d * job.side;
        if (this.terrain.heightAt(x, z) > job.level + 1.2) continue;
        const n = 1 + Math.floor(this.rand() * 3);
        for (let k = 0; k < n; k++) {
          const a = this.rand() * 6.28, r = this.rand() * 6;
          this.rock(x + Math.cos(a) * r + fr.rightX * job.side * 3, z + Math.sin(a) * r + fr.rightZ * job.side * 3, 1.2 + this.rand() * this.rand() * 4);
        }
        break;
      }
    }
    // One big sheet of water out to the horizon, centred on the road.
    const m = road.sample(road.count / 2, {});
    const g = new THREE.PlaneGeometry(24000, 24000, 1, 1);
    g.rotateX(-Math.PI / 2);
    g.translate(m.x, job.level, m.z);
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 22, pos.getZ(i) / 22);
    this.seaMat ||= seaMaterial(this.waterNormal, job.f.color);
    const sea = new THREE.Mesh(g, this.seaMat);
    sea.receiveShadow = true;
    this.group.add(sea);
  },

  cableway(job) {
    const { line, sup } = job;
    const geo = new Geo();
    // Cable attach heights.
    for (const s of sup) {
      s.y = s.prop.y ?? this.terrain.heightAt(s.x, s.z);
      s.top = s.y + (s.end ? 8.6 : 18.2);
    }
    // Make sure the cable clears the road where it crosses (t = 0).
    for (let i = 0; i < sup.length - 1; i++) {
      const a = sup[i], b = sup[i + 1];
      if (a.t <= 0 && b.t >= 0) {
        const k = (0 - a.t) / (b.t - a.t);
        const y = a.top + (b.top - a.top) * k - (b.t - a.t) * 0.03 * 4 * k * (1 - k);
        const need = this.road.sample(this.road.start + job.f.at, {}).y + 14;
        if (y < need) {
          const lift = need - y;
          for (const s of [a, b]) {
            if (!s.end) {
              s.prop.scale = 1 + lift / 18;
              s.top += lift;
            }
          }
        }
      }
    }
    const cables = [];
    for (const off of [-3, 3]) {
      const pts = [];
      for (let i = 0; i < sup.length - 1; i++) {
        const a = sup[i], b = sup[i + 1];
        const steps = 16;
        for (let k = i === 0 ? 0 : 1; k <= steps; k++) {
          const u = k / steps;
          const t = a.t + (b.t - a.t) * u;
          const y = a.top + (b.top - a.top) * u - (b.t - a.t) * 0.03 * 4 * u * (1 - u);
          pts.push(new THREE.Vector3(line.ox + line.ux * t - line.uz * off, y, line.oz + line.uz * t + line.ux * off));
        }
      }
      cables.push(pts);
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#2a2d30' }));
      this.group.add(l);
    }
    // Cabins: an InstancedMesh moving round the loop.
    const cabin = this.props.geos.get('gondola');
    if (cabin) {
      const N = Math.max(6, Math.round(line.L / 70));
      const im = new THREE.InstancedMesh(cabin, this.mat, N * 2);
      im.castShadow = true;
      im.frustumCulled = false;
      this.group.add(im);
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const one = new THREE.Vector3(1, 1, 1);
      const P = new THREE.Vector3();
      const at = (pts, u) => {
        const f = Math.min(pts.length - 1.001, Math.max(0, u * (pts.length - 1)));
        const i = Math.floor(f);
        return P.lerpVectors(pts[i], pts[i + 1], f - i);
      };
      this.gondolas.push({
        update: (time) => {
          for (let k = 0; k < N * 2; k++) {
            const dir = k < N ? 1 : -1;
            let u = ((k % N) / N + (time * 5) / line.L) % 1;
            if (dir < 0) u = 1 - u;
            at(cables[k < N ? 0 : 1], u);
            q.setFromAxisAngle(up, line.yaw + (dir < 0 ? Math.PI : 0));
            m4.compose(P, q, one);
            im.setMatrixAt(k, m4);
          }
          im.instanceMatrix.needsUpdate = true;
        },
      });
    }
    this.mesh(geo);
  },

  walls(job) {
    const geo = new Geo();
    for (const side of edgeSides(job)) edgeRun.call(this, geo, job, side, 'wall');
    this.mesh(geo);
  },

  hedge(job) {
    const geo = new Geo();
    for (const side of edgeSides(job)) edgeRun.call(this, geo, job, side, 'hedge');
    this.mesh(geo);
  },

  grid(job) {
    const road = this.road;
    const geo = new Geo();
    const s = job.s0;
    const { along, across } = frame(road, s);
    // Right across the verges to the walls, so nothing can walk round it.
    const hw = RAIL_OFFSET + 0.06;
    // Dark pit, concrete ends and the steel bars across it, each at the
    // road's height where it lies, so the grid follows the slope.
    const at = (k) => road.sample(s + k, {});
    for (let k = -1.2; k <= 1.21; k += 0.4) {
      const p = at(k);
      // The road is drawn right across, so the pit's dark mouth sits just
      // on top of it: looking between the bars you see black, not tarmac.
      geo.box(p.x, p.z, p.y - 0.5, p.y + 0.015, along, 0.21, across, hw, PAINT, '#000000');
    }
    for (const k of [-1, 1]) {
      const p = at(k * 1.45);
      geo.box(p.x, p.z, p.y - 0.5, p.y + 0.03, along, 0.18, across, hw, PLASTER, CONCRETE);
    }
    for (let k = -1.2; k <= 1.21; k += 0.2) {
      const p = at(k);
      geo.box(p.x, p.z, p.y - 0.06, p.y + 0.05, along, 0.025, across, hw, METAL, '#6d7175');
    }
    // Walls along both sides, right by the grid, with a gap for the gate
    // just past it (on the right after the grid, on the left before it).
    for (const side of [-1, 1]) {
      const d = side * (RAIL_OFFSET + 0.4);
      const runs = side > 0 ? [[-GRID_WALL, GATE_AT - 0.1], [GATE_AT + 4.0, GRID_WALL]] : [[-GRID_WALL, -GATE_AT - 4.0], [-GATE_AT + 0.1, GRID_WALL]];
      for (const [r0, r1] of runs) {
        // Rough stones in courses, ragged at the top, each sat at the road's
        // height beside it.
        for (let y = -0.8; y < 1.0; y += 0.3) {
          for (let u = r0; u < r1 - 0.1;) {
            const m = Math.min(u + 0.45 + this.rand() * 0.45, r1);
            const c = road.sample(s + (u + m) / 2, {});
            const ctr = new THREE.Vector3(c.x + c.rightX * d, c.y + y, c.z + c.rightZ * d);
            lump(geo, ctr, { x: c.dirX, z: c.dirZ }, { x: c.rightX, z: c.rightZ }, (m - u) / 2 + 0.03, 0.36, 0.34 + (y > 0.8 ? this.rand() * 0.15 : 0), STONES[Math.floor(this.rand() * STONES.length)], this.rand);
            u = m;
          }
        }
      }
    }
    this.mesh(geo);
  },

  ford(job) {
    const road = this.road;
    // A sheet of water over the dipped road and its verges, where the road
    // lies below the water; the stream carries on either side.
    const pos = [], col = [], uv = [], idx = [];
    const f = {};
    let a = job.mid, b = job.mid;
    while (a > job.s0 - 30 && road.sample(a - 1, f).y < job.level + 0.05) a--;
    while (b < job.s1 + 30 && road.sample(b + 1, f).y < job.level + 0.05) b++;
    a -= 1.5;
    b += 1.5;
    const n = Math.max(1, Math.ceil((b - a) / 1.5));
    const e = RAIL_OFFSET + 2.5;
    const across = [-e, -e * 0.6, -e * 0.3, 0, e * 0.3, e * 0.6, e];
    for (let i = 0; i <= n; i++) {
      const s = a + ((b - a) * i) / n;
      road.sample(s, f);
      for (const d of across) {
        pos.push(f.x + f.rightX * d, job.level, f.z + f.rightZ * d);
        // Rushing water where it pours across the road (g: shallow, see-through).
        col.push(0.12, 1, 0);
        uv.push(d / 4, s / 4);
      }
      if (i < n) {
        for (let k = 0; k < across.length - 1; k++) {
          const a = i * across.length + k, b = a + across.length;
          idx.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, this.streamMat);
    this.streamMat.side = THREE.DoubleSide;
    m.receiveShadow = true;
    this.group.add(m);
    river.call(this, job.river, 4, false);
  },

  bunting(job) {
    const pos = [];
    const col = [];
    const colors = ['#d62c3a', '#f5d23d', '#2b6cb0', '#ffffff', '#3a9d5d'].map((c) => new THREE.Color(c));
    for (const [a, b] of job.poles) {
      const ya = (a.y ?? this.terrain.heightAt(a.x, a.z)) + 6.6, yb = (b.y ?? this.terrain.heightAt(b.x, b.z)) + 6.6;
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.floor(L / 0.7);
      for (let i = 0; i < n; i++) {
        const u0 = (i + 0.1) / n, u1 = (i + 0.9) / n, um = (i + 0.5) / n;
        const p = (u) => [a.x + (b.x - a.x) * u, ya + (yb - ya) * u - 1.4 * 4 * u * (1 - u), a.z + (b.z - a.z) * u];
        const p0 = p(u0), p1 = p(u1), pm = p(um);
        pos.push(...p0, ...p1, pm[0], pm[1] - 0.45, pm[2]);
        const c = colors[i % colors.length];
        for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 }));
    this.group.add(m);
  },

  street(job) {
    const geo = new Geo();
    const rand = this.rand;
    for (const side of edgeSides(job)) {
      // Runs of kerb and pavement, broken where a side road comes in.
      for (const [a, b] of this.openRuns(job.s0, job.s1, side, SIDE_HALF + 0.15)) {
        const o = side * HALF_WIDTH;
        sweep(geo, this.road, a, b, [[o, -0.25], [o + side * 0.15, -0.25], [o + side * 0.15, 0.12], [o, 0.12]], PAVING, '#c4c1b9', { step: 1 });
      }
      for (const [a, b] of this.openRuns(job.s0, job.s1, side, SIDE_HALF + 0.15)) {
        const o = side * (HALF_WIDTH + 0.15);
        sweep(geo, this.road, a, b, [[o, -0.3], [o + side * (PAVE - 0.15), -0.3], [o + side * (PAVE - 0.15), 0.1], [o, 0.1]], PAVING, '#a3a19b', { step: 1 });
      }
      // Front gardens: a wall, hedge or fence each, with a gap for the drive.
      // A city street has none: the paving runs on back to the buildings.
      if (job.f.style === 'city') {
        for (const [a, b] of this.openRuns(job.s0, job.s1, side, SIDE_HALF + PAVE + 0.5)) {
          const o = side * (HALF_WIDTH + PAVE);
          sweep(geo, this.road, a, b, [[o, -0.4], [o + side * 9, -0.4], [o + side * 9, 0.08], [o, 0.08]], PAVING, '#94918a', { step: 2 });
        }
        continue;
      }
      const g = side * (HALF_WIDTH + PAVE + 0.25);
      const styles = job.f.style === 'prom' ? ['railing'] : ['brick', 'brick', 'hedge', 'picket', 'hedge', 'low'];
      for (const [a, b] of this.openRuns(job.s0, job.s1, side, SIDE_HALF + PAVE + 0.5)) {
        let s = a;
        while (s < b - 1) {
          const plot = job.f.style === 'prom' ? b - s : 9 + rand() * 6;
          const e = Math.min(b, s + plot - (job.f.style === 'prom' ? 0 : 3));
          if (e - s > 1) gardenEdge(geo, this.road, s, e, g, side, styles[Math.floor(rand() * styles.length)], rand);
          s += plot;
        }
      }
    }
    this.mesh(geo);
  },

  junction(job) {
    const geo = new Geo();
    junctionMesh.call(this, geo, job);
    this.mesh(geo);
  },

  roundabout(job) {
    const geo = new Geo();
    for (const arm of job.arms) junctionMesh.call(this, geo, arm);
    // The painted mini-roundabout: a white dome with a ring of give-way
    // dashes on each approach.
    const f = this.road.sample(job.s0, {});
    const R = 1.4;
    const c = new THREE.Vector3(f.x, f.y + 0.02, f.z);
    for (let k = 0; k < 16; k++) {
      const a0 = (k / 16) * Math.PI * 2, a1 = ((k + 1) / 16) * Math.PI * 2;
      const p0 = new THREE.Vector3(f.x + Math.cos(a0) * R, f.y + 0.02, f.z + Math.sin(a0) * R);
      const p1 = new THREE.Vector3(f.x + Math.cos(a1) * R, f.y + 0.02, f.z + Math.sin(a1) * R);
      geo.tri(new THREE.Vector3(c.x, f.y + 0.08, c.z), p1, p0, PAINT, '#f2f2ee');
    }
    for (const k of [-1, 1]) {
      const g = this.road.sample(job.s0 + k * 7, {});
      dashes(geo, g, -HALF_WIDTH + 0.2, HALF_WIDTH - 0.2, 0, 0.6, 0.3, 0.3, '#f2f2ee');
    }
    this.mesh(geo);
  },

  zebra(job) {
    const geo = new Geo();
    const road = this.road;
    // Stripes across the road, then zigzags along both kerbs either side.
    for (let k = -2; k <= 2; k += 1) {
      const f = road.sample(job.s0 + k, {});
      stripe(geo, f, -HALF_WIDTH + 0.3, HALF_WIDTH - 0.3, 0.25, '#f4f4f0');
    }
    for (const dir of [-1, 1]) {
      for (const side of [-1, 1]) {
        let prev = null;
        for (let i = 0; i <= 8; i++) {
          const f = road.sample(job.s0 + dir * (3.2 + i * 1.2), {});
          const d = side * (HALF_WIDTH - 0.35 - (i % 2) * 0.35);
          const p = new THREE.Vector3(f.x + f.rightX * d, f.y + crownAt(d) + 0.018, f.z + f.rightZ * d);
          if (prev) line(geo, prev, p, 0.1, '#f4f4f0');
          prev = p;
        }
      }
    }
    this.mesh(geo, false);
    // Belisha beacons blink.
    const beacons = job.beacons.filter(Boolean);
    if (beacons.length) {
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffa23a' }));
      const lamps = beacons.map((b) => {
        const l = glow.clone();
        l.position.set(b.x, (b.y ?? this.terrain.heightAt(b.x, b.z)) + 3.1, b.z);
        this.group.add(l);
        return l;
      });
      this.gondolas.push({ update: (time) => lamps.forEach((l) => (l.visible = time % 1 < 0.5)) });
    }
  },

  bump(job) {
    const geo = new Geo();
    const road = this.road;
    // A round-topped hump, 3.7 m long and 7 cm high, the road's colour,
    // with white triangles painted on its approach slope.
    const n = 8;
    const ring = (k) => {
      const u = k / n;
      const f = road.sample(job.s0 + (u - 0.5) * BUMP_LEN, {});
      const y = f.y + BUMP_H * Math.sin(Math.PI * u) - 0.005;
      return { f, y };
    };
    let prev = ring(0);
    for (let k = 1; k <= n; k++) {
      const cur = ring(k);
      for (let i = 0; i < 8; i++) {
        const d0 = -HALF_WIDTH + ((2 * HALF_WIDTH) * i) / 8, d1 = -HALF_WIDTH + ((2 * HALF_WIDTH) * (i + 1)) / 8;
        const pt = (r, d) => new THREE.Vector3(r.f.x + r.f.rightX * d, r.y + crownAt(d), r.f.z + r.f.rightZ * d);
        const white = k <= n / 2 && i % 2 === 0 && (k === 2 || k === 3);
        geo.quad(pt(prev, d0), pt(prev, d1), pt(cur, d1), pt(cur, d0), PAINT, white ? '#ecebe6' : '#3b3c3f', new THREE.Vector3(prev.f.x, prev.y - 5, prev.f.z));
      }
      prev = cur;
    }
    this.mesh(geo, false);
  },

  railbridge(job) {
    const geo = new Geo();
    const road = this.road;
    const { at, top } = job;
    const BRICK = '#8e4a36';
    // Abutments either side of the road, a deck across, and parapets.
    for (const side of [-1, 1]) {
      const d0 = side * (RAIL_OFFSET - 0.05), d1 = side * (RAIL_OFFSET + 1.6);
      for (let s = at - 5; s < at + 5; s += 1) {
        const a = road.sample(s, {}), b = road.sample(s + 1, {});
        const p = (f, d, y) => new THREE.Vector3(f.x + f.rightX * d, y, f.z + f.rightZ * d);
        const base = Math.min(a.y, b.y) - 1;
        geo.quad(p(a, d0, base), p(b, d0, base), p(b, d0, top - 1.1), p(a, d0, top - 1.1), MASONRY, BRICK, p(a, d1, base));
      }
    }
    const f = road.sample(at, {});
    const W = RAIL_OFFSET + 2;
    const along = new THREE.Vector3(f.dirX, 0, f.dirZ), across = new THREE.Vector3(f.rightX, 0, f.rightZ);
    geo.box(f.x, f.z, top - 1.25, top - 0.05, along, 4.2, across, W, MASONRY, BRICK);
    // Arch-ish soffit band, string course and parapets.
    geo.box(f.x, f.z, top - 1.45, top - 1.2, along, 4.3, across, W + 0.1, PLASTER, '#7b6e62');
    for (const k of [-1, 1]) {
      const x = f.x + f.dirX * k * 4.0, z = f.z + f.dirZ * k * 4.0;
      geo.box(x, z, top - 0.05, top + 1.0, along, 0.22, across, W + 18, MASONRY, BRICK);
      geo.box(x, z, top + 1.0, top + 1.12, along, 0.3, across, W + 18, PLASTER, COPING);
    }
    // Ballast and rails across the top, running on along the embankment.
    const L = RAIL_LINE;
    geo.box(f.x, f.z, top - 0.05, top + 0.05, across, L, along, 2.2, PAINT, '#6d665c');
    for (const k of [-0.75, 0.75]) {
      const x = f.x + f.dirX * k, z = f.z + f.dirZ * k;
      geo.box(x, z, top + 0.05, top + 0.2, across, L, along, 0.04, METAL, '#8a8580');
    }
    // A sign on the bridge with its clearance.
    for (const k of [-1, 1]) {
      const x = f.x + f.dirX * k * 4.25, z = f.z + f.dirZ * k * 4.25;
      geo.box(x, z, top - 0.95, top - 0.45, along, 0.03, across, 0.7, PAINT, '#f2f0ea');
      geo.box(x, z, top - 0.9, top - 0.5, along, 0.035, across, 0.6, PAINT, '#c4161c');
    }
    this.mesh(geo);
    // The train: a few carriages crossing every so often.
    const car = this.props.geos.get('train_car');
    if (car) {
      const N = 4;
      const im = new THREE.InstancedMesh(car, this.mat, N);
      im.castShadow = true;
      im.frustumCulled = false;
      this.group.add(im);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), P = new THREE.Vector3();
      const dir = (job.f.train ?? 1) >= 0 ? 1 : -1;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-f.rightZ * dir, f.rightX * dir));
      const period = job.f.every ?? 24, speed = 22;
      this.gondolas.push({
        update: (time) => {
          const t = ((time + (job.f.phase ?? 4)) % period) * speed - L;
          for (let k = 0; k < N; k++) {
            const u = (t - k * 20.5) * dir;
            // Out of sight beyond the ends of the line.
            P.set(f.x + f.rightX * u, Math.abs(u) > L ? -1e4 : top + 0.2, f.z + f.rightZ * u);
            m4.compose(P, q, one);
            im.setMatrixAt(k, m4);
          }
          im.instanceMatrix.needsUpdate = true;
        },
      });
    }
  },

  // ---------------------------------------------------------------- city
  tram(job) {
    const { s0, s1 } = job;
    const geo = new Geo();
    const lane = HALF_WIDTH - 0.75;
    // Grooved rails, two to a lane, flush with the tarmac.
    for (const c of [-lane / 2, lane / 2]) {
      for (const g of [-0.7175, 0.7175]) {
        const d = c + g;
        const h = crownAt(d) + 0.006;
        sweep(geo, this.road, s0, s1, [[d - 0.05, h - 0.02], [d + 0.05, h - 0.02], [d + 0.05, h], [d - 0.05, h]], METAL, '#8a8c8e', { step: 2, caps: false });
        sweep(geo, this.road, s0, s1, [[d - 0.012, h - 0.01], [d + 0.012, h - 0.01], [d + 0.012, h + 0.002], [d - 0.012, h + 0.002]], PAINT, '#141414', { step: 2, caps: false });
      }
    }
    // Poles in pairs, span wires across and a contact wire over each lane,
    // sagging a little between the spans.
    const fr = {};
    const poles = [];
    for (let s = s0 + 10; s < s1; s += 32) {
      this.road.sample(s, fr);
      const pair = [-1, 1].map((side) => {
        const d = side * (HALF_WIDTH + 1.35);
        const x = fr.x + fr.rightX * d, z = fr.z + fr.rightZ * d;
        const y = this.terrain.heightAt(x, z);
        strut(geo, new THREE.Vector3(x, Math.min(y, fr.y) - 0.5, z), new THREE.Vector3(x, fr.y + 7.6, z), 0.1, METAL, '#2a3a32');
        return new THREE.Vector3(x, fr.y + 6.9, z);
      });
      strut(geo, pair[0], pair[1], 0.012, METAL, '#1e1e1e');
      poles.push({ s, f: { ...fr } });
    }
    for (let i = 0; i + 1 < poles.length; i++) {
      for (const c of [-lane / 2, lane / 2]) {
        const n = 6;
        let prev = null;
        for (let k = 0; k <= n; k++) {
          const s = poles[i].s + ((poles[i + 1].s - poles[i].s) * k) / n;
          this.road.sample(s, fr);
          const p = new THREE.Vector3(fr.x + fr.rightX * c, fr.y + 5.9 - 0.25 * Math.sin((k / n) * Math.PI), fr.z + fr.rightZ * c);
          if (prev) strut(geo, prev, p, 0.012, METAL, '#1e1e1e');
          prev = p;
        }
      }
    }
    this.mesh(geo);
  },

  lights(job) {
    const { s0, s1, f } = job;
    const geo = new Geo();
    const fairy = f.style === 'fairy';
    const every = f.every ?? (fairy ? 6 : 9);
    const reach = HALF_WIDTH + PAVE + 0.4;
    const fr = {};
    const cols = fairy ? ['#ffe2a0'] : ['#ff2a14', '#ff3a1a', '#ff6a1a'];
    let k = 0;
    for (let s = s0; s <= s1; s += every, k++) {
      this.road.sample(s, fr);
      // Lanterns hang straight across; fairy lights zigzag from one side to
      // the other and back down the street.
      const s2 = fairy ? Math.min(s1, s + every) : s;
      const fb = this.road.sample(s2, {});
      const flip = fairy && k % 2 ? -1 : 1;
      const y = fairy ? 5.6 : 7.2;
      const a = new THREE.Vector3(fr.x - fr.rightX * reach * flip, fr.y + y, fr.z - fr.rightZ * reach * flip);
      const b = new THREE.Vector3(fb.x + fb.rightX * reach * flip, fb.y + y, fb.z + fb.rightZ * reach * flip);
      const L = a.distanceTo(b);
      const n = Math.floor(L / (fairy ? 0.5 : 1.5));
      const sag = fairy ? 1.0 : 1.4;
      const at = (u) => new THREE.Vector3().lerpVectors(a, b, u).setY(a.y + (b.y - a.y) * u - sag * 4 * u * (1 - u));
      let prev = at(0);
      for (let i = 1; i <= 12; i++) {
        const p = at(i / 12);
        strut(geo, prev, p, 0.01, METAL, '#1a1a1a');
        prev = p;
      }
      const along = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
      const across = new THREE.Vector3(-along.z, 0, along.x);
      for (let i = 1; i < n; i++) {
        const p = at(i / n);
        const col = cols[(i + k) % cols.length];
        if (fairy) {
          geo.box(p.x, p.z, p.y - 0.14, p.y - 0.04, along, 0.05, across, 0.05, EMISSIVE, col);
        } else {
          // A paper lantern: a fat red body, gold caps and a tassel.
          geo.box(p.x, p.z, p.y - 0.75, p.y - 0.15, along, 0.26, across, 0.26, EMISSIVE, col);
          geo.box(p.x, p.z, p.y - 0.7, p.y - 0.2, along, 0.32, across, 0.18, EMISSIVE, col);
          geo.box(p.x, p.z, p.y - 0.15, p.y - 0.05, along, 0.14, across, 0.14, PAINT, '#c89a2a');
          geo.box(p.x, p.z, p.y - 0.85, p.y - 0.75, along, 0.14, across, 0.14, PAINT, '#c89a2a');
          geo.box(p.x, p.z, p.y - 1.15, p.y - 0.85, along, 0.03, across, 0.03, PAINT, '#d8302a');
        }
      }
    }
    this.mesh(geo, false);
  },

  suspension(job) {
    const { s0, s1, mid, Wr, level } = job;
    const geo = new Geo();
    const road = this.road;
    const RED = '#b8432c';
    const w = HALF_WIDTH + 2.4; // to the outside of the walkways
    // Deck: a steel box with a stiffening truss either side, walkways and railings.
    sweep(geo, road, s0, s1, [[-w, -2.6], [w, -2.6], [w, -0.05], [-w, -0.05]], METAL, '#5a5c5e');
    for (const side of [-1, 1]) {
      const o = side * HALF_WIDTH;
      sweep(geo, road, s0, s1, [[o, -0.1], [o + side * 2.3, -0.1], [o + side * 2.3, 0.18], [o, 0.18]], PAVING, '#9a968e');
      sweep(geo, road, s0, s1, [[o + side * 2.2, 1.05], [o + side * 2.4, 1.05], [o + side * 2.4, 1.15], [o + side * 2.2, 1.15]], METAL, RED);
      sweep(geo, road, s0, s1, [[o + side * 2.2, 0.5], [o + side * 2.4, 0.5], [o + side * 2.4, 0.56], [o + side * 2.2, 0.56]], METAL, RED);
      sweep(geo, road, s0, s1, [[o, 0.18], [o + side * 0.25, 0.18], [o + side * 0.25, 0.95], [o, 0.95]], METAL, '#8a8c8e');
    }
    const fr = {};
    for (let s = s0; s <= s1; s += 2.5) {
      road.sample(s, fr);
      for (const side of [-1, 1]) {
        const d = side * (w - 0.1);
        const p = new THREE.Vector3(fr.x + fr.rightX * d, fr.y, fr.z + fr.rightZ * d);
        strut(geo, p, p.clone().setY(fr.y + 1.1), 0.03, METAL, RED);
        // The truss under the deck edge: a diagonal to the next panel point.
        if (s + 2.5 <= s1) {
          const fn = road.sample(s + 2.5, {});
          const up = Math.round(s / 2.5) % 2 ? 1 : 0;
          strut(geo, new THREE.Vector3(p.x, fr.y - 2.6 + up * 2.5, p.z), new THREE.Vector3(fn.x + fn.rightX * d, fn.y - 0.1 - up * 2.5, fn.z + fn.rightZ * d), 0.06, METAL, RED);
        }
      }
    }
    // Towers on piers near each bank, 50 m over the deck.
    const H = 52;
    const towers = [mid - (Wr - 16), mid + (Wr - 16)];
    const cw = w + 0.6;
    const top = [];
    for (const st of towers) {
      road.sample(st, fr);
      const along = new THREE.Vector3(fr.dirX, 0, fr.dirZ), across = new THREE.Vector3(fr.rightX, 0, fr.rightZ);
      geo.box(fr.x, fr.z, level - 6, level + 2, along, 7, across, cw + 4, MASONRY, '#8a8478');
      for (const side of [-1, 1]) {
        const x = fr.x + fr.rightX * side * cw, z = fr.z + fr.rightZ * side * cw;
        geo.box(x, z, level + 2, fr.y + H, along, 2.0, across, 1.6, PAINT, RED);
        geo.box(x, z, fr.y + H, fr.y + H + 2.5, along, 1.4, across, 1.1, PAINT, RED);
        // Floodlit faces.
        geo.box(x - fr.dirX * 2.05, z - fr.dirZ * 2.05, fr.y + 4, fr.y + H - 2, along, 0.05, across, 1.2, EMISSIVE, '#d86a3a');
        geo.box(x + fr.dirX * 2.05, z + fr.dirZ * 2.05, fr.y + 4, fr.y + H - 2, along, 0.05, across, 1.2, EMISSIVE, '#d86a3a');
        top.push({ s: st, side, p: new THREE.Vector3(x, fr.y + H + 1, z) });
      }
      for (const hb of [fr.y - 3, fr.y + 14, fr.y + 30, fr.y + H - 3]) {
        geo.box(fr.x, fr.z, hb, hb + 2.4, along, 1.4, across, cw, PAINT, RED);
      }
      geo.box(fr.x, fr.z, fr.y + H - 0.2, fr.y + H, along, 0.3, across, cw + 1.6, EMISSIVE, '#ff2a1a');
    }
    // Main cables: anchored at the deck ends, over the tower tops, sagging to
    // just above the deck in the middle; hangers down to the deck, and a
    // string of lights along each.
    for (const side of [-1, 1]) {
      const [ta, tb] = top.filter((t) => t.side === side);
      const yOf = (s) => {
        road.sample(s, fr);
        if (s < ta.s) return fr.y + 0.5 + (ta.p.y - fr.y - 0.5) * ((s - s0) / (ta.s - s0)) ** 1.4;
        if (s > tb.s) return fr.y + 0.5 + (tb.p.y - fr.y - 0.5) * ((s1 - s) / (s1 - tb.s)) ** 1.4;
        const u = (s - ta.s) / (tb.s - ta.s);
        return fr.y + 3 + (ta.p.y - fr.y - 3) * (2 * u - 1) ** 2;
      };
      let prev = null;
      for (let s = s0; s <= s1 + 0.01; s += 4) {
        const y = yOf(s);
        road.sample(s, fr);
        const d = side * cw;
        const p = new THREE.Vector3(fr.x + fr.rightX * d, y, fr.z + fr.rightZ * d);
        if (prev) strut(geo, prev, p, 0.35, METAL, RED);
        if (y - fr.y > 2) strut(geo, p, new THREE.Vector3(p.x, fr.y + 0.2, p.z), 0.05, METAL, RED);
        geo.box(p.x, p.z, y + 0.35, y + 0.6, new THREE.Vector3(fr.dirX, 0, fr.dirZ), 0.12, new THREE.Vector3(fr.rightX, 0, fr.rightZ), 0.12, EMISSIVE, '#fff0c8');
        prev = p;
      }
    }
    // Lamps along the walkways.
    for (let s = s0 + 6; s < s1; s += 24) {
      road.sample(s, fr);
      for (const side of [-1, 1]) {
        const d = side * (w - 0.3);
        const p = new THREE.Vector3(fr.x + fr.rightX * d, fr.y, fr.z + fr.rightZ * d);
        strut(geo, p, p.clone().setY(fr.y + 5), 0.06, METAL, '#2a2a2a');
        geo.box(p.x, p.z, fr.y + 5, fr.y + 5.5, new THREE.Vector3(fr.dirX, 0, fr.dirZ), 0.25, new THREE.Vector3(fr.rightX, 0, fr.rightZ), 0.25, EMISSIVE, '#ffe0a0');
        lampSpots.push([p.x, fr.y + 5.3, p.z]);
      }
    }
    // Piers under the approach spans, wherever the ground is below the deck.
    for (let s = s0 + 12; s < s1 - 6; s += 24) {
      if (Math.abs(s - mid) < Wr) continue;
      road.sample(s, fr);
      const g = Math.min(this.terrain.heightAt(fr.x, fr.z), this.terrain.heightAt(fr.x + fr.rightX * w, fr.z + fr.rightZ * w), this.terrain.heightAt(fr.x - fr.rightX * w, fr.z - fr.rightZ * w));
      if (g < fr.y - 3) geo.box(fr.x, fr.z, g - 2, fr.y - 2.6, new THREE.Vector3(fr.dirX, 0, fr.dirZ), 1.2, new THREE.Vector3(fr.rightX, 0, fr.rightZ), w - 1.5, MASONRY, '#8a8478');
    }
    this.mesh(geo);
    // The river and its quays.
    const { o } = job;
    const qgeo = new Geo();
    const ax = new THREE.Vector3(o.rightX, 0, o.rightZ), az = new THREE.Vector3(o.dirX, 0, o.dirZ);
    for (const t of [-Wr, Wr]) {
      for (let n = -1100; n < 1100; n += 20) {
        const x = o.x + o.dirX * t + o.rightX * (n + 10), z = o.z + o.dirZ * t + o.rightZ * (n + 10);
        qgeo.box(x, z, level - 6, level + 3.1, ax, 10.05, az, 0.8, MASONRY, '#7a7468');
      }
    }
    this.mesh(qgeo);
    waterStrip.call(this, o, Wr + 1, 1150, level);
  },

  underpass(job) {
    const { s0, s1 } = job;
    const geo = new Geo();
    const road = this.road;
    const wall = HALF_WIDTH + 1.25;
    const R = 6.2;
    const fr = {};
    for (const side of [-1, 1]) {
      const o = side * HALF_WIDTH;
      // A raised walkway, then the tiled wall with a dark dado and a band.
      sweep(geo, road, s0 - 60, s1 + 60, [[o, -0.2], [o + side * 1.0, -0.2], [o + side * 1.0, 0.25], [o, 0.25]], PAVING, '#8a867e');
      sweep(geo, road, s0, s1, [[side * wall, 0], [side * (wall + 0.4), 0], [side * (wall + 0.4), R - 1], [side * wall, R - 1]], PLASTER, '#e2d8bc');
      sweep(geo, road, s0, s1, [[side * (wall - 0.02), 0], [side * wall, 0], [side * wall, 1.2], [side * (wall - 0.02), 1.2]], PAINT, '#3a4a5a', { caps: false });
      sweep(geo, road, s0, s1, [[side * (wall - 0.02), 3.0], [side * wall, 3.0], [side * wall, 3.25], [side * (wall - 0.02), 3.25]], PAINT, '#c87a2a', { caps: false });
    }
    // The cutting walls either end, as high as the ground beside them.
    for (const [a, b] of [[s0 - 60, s0], [s1, s1 + 60]]) {
      for (let s = a; s < b; s += 2) {
        road.sample(s, fr);
        const fb = road.sample(s + 2, {});
        // As high as the city beside the cutting (see the plan), with a
        // paved top reaching back over the ground behind.
        const hOf = (q) => Math.max(0.6, (R + 0.3) * smooth(s0 - 60, s0, q) * (1 - smooth(s1, s1 + 60, q)) + 0.15);
        const h0 = hOf(s), h1 = hOf(s + 2);
        for (const side of [-1, 1]) {
          const d = side * (wall + 0.2);
          const P = (q, dd, h) => new THREE.Vector3(q.x + q.rightX * dd, q.y + h, q.z + q.rightZ * dd);
          const c = P(fr, d + side * 5, 1);
          geo.quad(P(fr, d, -0.3), P(fb, d, -0.3), P(fb, d, h1), P(fr, d, h0), MASONRY, '#8a8478', c);
          geo.quad(P(fr, d, h0), P(fb, d, h1), P(fb, d + side * 0.5, h1), P(fr, d + side * 0.5, h0), PLASTER, '#a8a298', c.clone().setY(c.y - 50));
          geo.quad(P(fr, d + side * 0.5, h0 - 0.1), P(fb, d + side * 0.5, h1 - 0.1), P(fb, d + side * 10, h1 - 0.1), P(fr, d + side * 10, h0 - 0.1), PAVING, '#8a867e', c.clone().setY(c.y - 50));
        }
      }
    }
    // Roof slab with a paved square on top, the portals' faces and lights.
    sweep(geo, road, s0, s1, [[-wall - 0.4, R - 1], [wall + 0.4, R - 1], [wall + 0.4, R + 0.2], [-wall - 0.4, R + 0.2]], PLASTER, '#6a665e');
    sweep(geo, road, s0, s1, [[-wall - 10.5, R + 0.2], [wall + 10.5, R + 0.2], [wall + 10.5, R + 0.3], [-wall - 10.5, R + 0.3]], PAVING, '#9a968e');
    for (const s of [s0, s1]) {
      road.sample(s, fr);
      const along = new THREE.Vector3(fr.dirX, 0, fr.dirZ), across = new THREE.Vector3(fr.rightX, 0, fr.rightZ);
      geo.box(fr.x, fr.z, fr.y + R - 1.6, fr.y + R + 1.1, along, 0.6, across, wall + 2.5, MASONRY, '#8a8478');
      geo.box(fr.x - fr.dirX * 0.62 * (s === s0 ? 1 : -1), fr.z - fr.dirZ * 0.62 * (s === s0 ? 1 : -1), fr.y + R - 0.6, fr.y + R + 0.2, along, 0.03, across, 2.4, EMISSIVE, '#ff9a30');
    }
    for (let s = s0 + 3; s < s1; s += 6) {
      road.sample(s, fr);
      const along = new THREE.Vector3(fr.dirX, 0, fr.dirZ), across = new THREE.Vector3(fr.rightX, 0, fr.rightZ);
      for (const side of [-1, 1]) {
        const d = side * (wall - 0.05);
        geo.box(fr.x + fr.rightX * d, fr.z + fr.rightZ * d, fr.y + R - 1.6, fr.y + R - 1.35, along, 1.2, across, 0.08, EMISSIVE, '#ff9a30');
      }
      if (Math.round((s - s0) / 6) % 3 === 0) lampSpots.push([fr.x, fr.y + R - 1.5, fr.z]);
      // Jet fans in pairs under the roof.
      if (Math.round((s - s0 - 3) / 6) % 12 === 6) {
        for (const side of [-1, 1]) {
          const x = fr.x + fr.rightX * side * 1.8, z = fr.z + fr.rightZ * side * 1.8;
          geo.box(x, z, fr.y + R - 2.3, fr.y + R - 1.0, along, 2.0, across, 0.6, METAL, '#8a8c8e');
          geo.box(x - fr.dirX * 2.02, z - fr.dirZ * 2.02, fr.y + R - 2.2, fr.y + R - 1.1, along, 0.02, across, 0.5, PAINT, '#1a1a1a');
        }
      }
    }
    this.mesh(geo);
  },

  fair(job) {
    const g = this.props.geos.get('ferris_wheel'), gc = this.props.geos.get('ferris_cab'), gm = this.props.geos.get('carousel');
    if (!g || !gc || !gm) return;
    const { wheel, carousel } = job;
    const base = this.terrain.heightAt(wheel.x, wheel.z);
    const hub = new THREE.Group();
    hub.position.set(wheel.x, base + 26, wheel.z);
    hub.rotation.y = wheel.yaw;
    this.group.add(hub);
    const rim = new THREE.Mesh(g, this.mat);
    hub.add(rim);
    const N = 16;
    const cabs = new THREE.InstancedMesh(gc, this.mat, N);
    hub.add(cabs);
    const round = new THREE.Mesh(gm, this.mat);
    round.position.set(carousel.x, this.terrain.heightAt(carousel.x, carousel.z), carousel.z);
    this.group.add(round);
    const m4 = new THREE.Matrix4();
    this.gondolas.push({
      update: (time) => {
        const a = time * 0.06;
        rim.rotation.z = a;
        for (let i = 0; i < N; i++) {
          const t = a + (i * Math.PI * 2) / N;
          m4.makeTranslation(22 * Math.cos(t), 22 * Math.sin(t), 0);
          cabs.setMatrixAt(i, m4);
        }
        cabs.instanceMatrix.needsUpdate = true;
        round.rotation.y = time * 0.5;
      },
    });
  },

  turbines(job) {
    const g = this.props.geos.get('turbine_rotor');
    if (!g) return;
    const N = job.list.length;
    const im = new THREE.InstancedMesh(g, this.mat, N);
    im.castShadow = true;
    im.frustumCulled = false;
    this.group.add(im);
    const base = job.list.map((p) => {
      const m = new THREE.Matrix4().makeRotationY(p.yaw);
      m.setPosition(p.x, this.terrain.heightAt(p.x, p.z), p.z);
      return m.multiply(new THREE.Matrix4().makeTranslation(0, 62.8, 5.9));
    });
    const spin = new THREE.Matrix4(), m4 = new THREE.Matrix4();
    this.gondolas.push({
      update: (time) => {
        for (let i = 0; i < N; i++) {
          spin.makeRotationZ(time * (1.4 + (i % 3) * 0.12) + i * 1.7);
          im.setMatrixAt(i, m4.multiplyMatrices(base[i], spin));
        }
        im.instanceMatrix.needsUpdate = true;
      },
    });
  },

  viaduct(job) {
    const car = this.props.geos.get('train_car');
    if (!car) return;
    const { A, ux, uz, L, top } = job;
    const N = 5;
    const im = new THREE.InstancedMesh(car, this.mat, N);
    im.castShadow = true;
    im.frustumCulled = false;
    this.group.add(im);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-uz, ux)), one = new THREE.Vector3(1, 1, 1), P = new THREE.Vector3();
    const period = job.f.every ?? 30, speed = 24, run = L + 160;
    this.gondolas.push({
      update: (time) => {
        const t = ((time + (job.f.phase ?? 6)) % period) * speed - 80;
        for (let k = 0; k < N; k++) {
          const u = t - k * 20.5;
          // Out of sight in the cuttings beyond the ends.
          P.set(A.x + ux * u, u < -70 || u > run - 90 ? -1e4 : top + 0.25, A.z + uz * u);
          im.setMatrixAt(k, m4.compose(P, q, one));
        }
        im.instanceMatrix.needsUpdate = true;
      },
    });
  },

  harbour(job) {
    const { s0, s1, side, near, level } = job;
    const geo = new Geo();
    const stone = job.fishing ? '#7f7b72' : '#6a665e';
    const fr = {};
    // The quay wall and its edge, mooring bollards along it.
    for (let s = s0; s < s1; s += 4) {
      this.road.sample(s, fr);
      const fb = this.road.sample(Math.min(s1, s + 4), {});
      const P = (q, d, y) => new THREE.Vector3(q.x + q.rightX * side * d, y, q.z + q.rightZ * side * d);
      const c = P(fr, near - 5, fr.y);
      geo.quad(P(fr, near, level - 8), P(fb, near, level - 8), P(fb, near, fb.y - 0.25), P(fr, near, fr.y - 0.25), MASONRY, stone, c);
      geo.quad(P(fr, near - 0.6, fr.y - 0.25), P(fb, near - 0.6, fb.y - 0.25), P(fb, near, fb.y - 0.25), P(fr, near, fr.y - 0.25), job.fishing ? MASONRY : PAINT, job.fishing ? '#8a867c' : '#c8b83a', c.clone().setY(c.y - 50));
      // The apron: concrete hardstanding from the road out to the edge.
      geo.quad(P(fr, HALF_WIDTH + 0.3, fr.y - 0.28), P(fb, HALF_WIDTH + 0.3, fb.y - 0.28), P(fb, near - 0.6, fb.y - 0.26), P(fr, near - 0.6, fr.y - 0.26), PAVING, '#8a867e', c.clone().setY(c.y - 50));
    }
    if (job.fishing) {
      // The harbour arms: granite walls from each end of the quay out to
      // sea, with a parapet on the seaward side.
      for (const [s, k] of [[s0, 1], [s1, -1]]) {
        this.road.sample(s, fr);
        const along = new THREE.Vector3(fr.dirX, 0, fr.dirZ), across = new THREE.Vector3(fr.rightX, 0, fr.rightZ);
        const mid = near + job.arm / 2 - 1;
        const x = fr.x + fr.rightX * side * mid, z = fr.z + fr.rightZ * side * mid;
        geo.box(x, z, level - 8, fr.y - 0.25, along, 3.5, across, job.arm / 2, MASONRY, stone);
        geo.box(x - fr.dirX * k * 2.9, z - fr.dirZ * k * 2.9, fr.y - 0.25, fr.y + 1.0, along, 0.6, across, job.arm / 2, MASONRY, '#7a766c');
      }
      this.mesh(geo);
      if (this.seaLevel == null) BUILDS.lake.call(this, Object.assign(job, { side, near: near + 0.5, far: near + job.arm }));
      return;
    }
    // End walls where the dock meets the shore.
    for (const s of [s0, s1]) {
      this.road.sample(s, fr);
      const along = new THREE.Vector3(fr.dirX, 0, fr.dirZ), across = new THREE.Vector3(fr.rightX, 0, fr.rightZ);
      const mid = near + 200;
      geo.box(fr.x + fr.rightX * side * mid, fr.z + fr.rightZ * side * mid, level - 8, fr.y - 0.25, along, 0.8, across, 200, MASONRY, '#6a665e');
    }
    this.mesh(geo);
    if (this.seaLevel != null) return;
    Object.assign(job, { side, near: near + 0.5, far: near + 400 });
    BUILDS.lake.call(this, job);
  },
};

// Walls and hedge banks: keep trees and rocks off the strip they stand on.
function edgeBlock(job) {
  const road = this.road;
  const f = {};
  for (let s = job.s0; s <= job.s1; s += 4) {
    road.sample(s, f);
    for (const side of edgeSides(job)) {
      const d = side * (RAIL_OFFSET + 1.2);
      this.terrain.block(f.x + f.rightX * d, f.z + f.rightZ * d, 2.2);
    }
  }
}

function edgeSides(job) {
  return job.f.side === 'left' ? [-1] : job.f.side === 'right' ? [1] : [-1, 1];
}

// One side of a run of wall or hedge bank, following the ground: it stands
// on whichever is lower, the road or the field, and rises above the higher.
function edgeRun(geo, job, side, kind) {
  if (kind === 'wall') return wallRun.call(this, geo, job, side);
  const road = this.road;
  const t = this.terrain;
  const d0 = side * (RAIL_OFFSET - 0.05);
  const w = 1.9;
  const d1 = d0 + side * w;
  const f = {};
  // Hawthorn, hazel and holly greens, with a few dead brown and gorse sprigs.
  const greens = ['#4d6a33', '#567438', '#46602f', '#5d7a3c', '#3f5a2a', '#62803f', '#4a5f2c', '#5f6a33'];
  const LUMPS = 6;
  const ring = (s) => {
    road.sample(s, f);
    const g = t.heightAt(f.x + f.rightX * (d0 + d1) / 2, f.z + f.rightZ * (d0 + d1) / 2);
    const base = Math.min(f.y, g) - 0.8;
    const top = Math.max(f.y + 1.3, g + 1.0);
    const n = this.rand();
    const at = (d, y) => new THREE.Vector3(f.x + f.rightX * d, y, f.z + f.rightZ * d);
    return {
      a: at(d0, base), b: at(d0 + side * 0.08, top), c: at(d1 - side * 0.08, top), e: at(d1, base),
      // The hedge on top: a rounded, lumpy crown, bulging out over the road.
      h: Array.from({ length: LUMPS + 1 }, (_, i) => {
        const u = i / LUMPS;
        const lump = Math.sin(u * Math.PI) * (1.0 + n * 0.5) + (this.rand() - 0.5) * 0.35 * Math.sin(u * Math.PI);
        return at(d0 + side * (-0.15 + u * (w + 0.3)), top + lump);
      }),
    };
  };
  const step = 1;
  let prev = ring(job.s0);
  for (let s = job.s0 + step; s <= job.s1 + 0.01; s += step) {
    const cur = ring(s);
    const faces = [[prev.a, prev.b, cur.b, cur.a], [prev.b, prev.c, cur.c, cur.b], [prev.c, prev.e, cur.e, cur.c]];
    for (const [p, q, r, u] of faces) quadOut(geo, p, q, r, u, side, MASONRY, '#6e7362');
    for (let i = 0; i < LUMPS; i++) {
      const col = greens[Math.floor(this.rand() * greens.length)];
      quadOut(geo, prev.h[i], prev.h[i + 1], cur.h[i + 1], cur.h[i], side, LEAVES, col);
    }
    prev = cur;
  }
}

// Cattle grid: where its gate's hinge post stands (m from the grid's middle)
// and where its wall ends stop. Lane walls leave this stretch to the grid.
const GATE_AT = 1.8, GRID_WALL = 12.5;

// Granite greys, a few with moss in them.
const STONES = ['#7f7a70', '#878275', '#767268', '#8d887c', '#6f6c64', '#7c786b', '#66655c', '#959082', '#6d705f'];

// A dry-stone lane wall: lumpy faces in odd greys, a ragged top of rough
// coping stones, and here and there a slumped stretch with its stones
// tumbled into the grass.
function wallRun(geo, job, side) {
  const road = this.road;
  const t = this.terrain;
  const rand = this.rand;
  const d0 = side * (RAIL_OFFSET - 0.05);
  const w = 0.75;
  const f = {};
  const greys = STONES;
  const p1 = rand() * 6.28, p2 = rand() * 6.28;
  const slumps = [];
  for (let s = job.s0 + 8; s < job.s1 - 8; s += 6) {
    if (rand() < 0.12) {
      slumps.push([s, 1.5 + rand() * 3, 0.3 + rand() * 0.35]);
      s += 12;
    }
  }
  const drop = (s) => {
    let d = 0;
    for (const [c, l, h] of slumps) d = Math.max(d, h * (1 - smooth(l, l + 1.5, Math.abs(s - c))));
    return d;
  };
  // Each ring is the wall's section: up the road face in courses, across
  // the top, down the field face. Every point is nudged in or out a little
  // so the faces come out as lumpy, faceted stone.
  const ROWS = 4;
  const ring = (s) => {
    road.sample(s, f);
    const mid = d0 + side * w / 2;
    const g = t.heightAt(f.x + f.rightX * mid, f.z + f.rightZ * mid);
    const base = Math.min(f.y, g) - 0.8;
    const sag = drop(s);
    const top = Math.max(f.y + 0.95, g + 0.75) + 0.08 * Math.sin(s * 0.21 + p1) + 0.06 * Math.sin(s * 0.57 + p2) - sag;
    const at = (d, y) => new THREE.Vector3(f.x + f.rightX * d, y, f.z + f.rightZ * d);
    const face = (d, low, inward) => {
      const pts = [at(d, base)];
      for (let r = 0; r <= ROWS; r++) {
        const y = low + ((top - low) * r) / ROWS;
        const lean = (0.1 * r) / ROWS; // a little batter: narrower at the top
        const j = r === ROWS ? 0 : (rand() - 0.5) * 0.1;
        pts.push(at(d + inward * (lean + j), y + (r && r < ROWS ? (rand() - 0.5) * 0.06 : 0)));
      }
      return pts;
    };
    const road1 = face(d0, f.y - 0.05, side);
    const field = face(d0 + side * w, g - 0.05, -side).reverse();
    return { pts: [...road1, ...field], m: at(mid, top), c: at(mid, (base + top) / 2), sag, rx: f.rightX, rz: f.rightZ };
  };
  // Cattle grids build their own wall ends and gates: leave them room.
  const grids = [...(this.todo || []), ...(this.endless || [])].filter((j) => j.f.type === 'grid').map((j) => j.s0);
  const open = (s) => grids.some((g) => Math.abs(s - g) < GRID_WALL);
  // Close off an end of the wall so it isn't hollow.
  const cap = (r) => {
    for (let i = 0; i < r.pts.length - 1; i++) {
      geo.tri(r.c, r.pts[i], r.pts[i + 1], PLASTER, greys[0]);
      geo.tri(r.c, r.pts[i + 1], r.pts[i], PLASTER, greys[0]);
    }
  };
  const step = 0.6;
  let prev = ring(job.s0);
  let gap = open(job.s0);
  if (!gap) cap(prev);
  let cols = prev.pts.map(() => greys[Math.floor(rand() * greys.length)]);
  for (let s = job.s0 + step; s <= job.s1 + 0.01; s += step) {
    const cur = ring(s);
    const shut = open(s);
    if (shut !== gap) cap(shut ? prev : cur);
    gap = shut;
    if (gap || open(s - step)) {
      prev = cur;
      continue;
    }
    // A stone runs on into the next column about half the time.
    cols = cols.map((c) => (rand() < 0.45 ? c : greys[Math.floor(rand() * greys.length)]));
    const inside = new THREE.Vector3().lerpVectors(prev.c, cur.c, 0.5);
    for (let i = 0; i < cur.pts.length - 1; i++) geo.quad(prev.pts[i], prev.pts[i + 1], cur.pts[i + 1], cur.pts[i], PLASTER, cols[i], inside);
    // Rough stones along the top, fewer where the wall has slumped.
    const ax = { x: cur.m.x - prev.m.x, z: cur.m.z - prev.m.z };
    const al = Math.hypot(ax.x, ax.z) || 1;
    ax.x /= al;
    ax.z /= al;
    if (!(prev.sag > 0.15 && rand() < 0.6)) {
      const c = new THREE.Vector3().lerpVectors(prev.m, cur.m, 0.4 + rand() * 0.2);
      c.y -= 0.08;
      const yaw = (rand() - 0.5) * 0.5;
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      const a1 = { x: ax.x * cs - ax.z * sn, z: ax.x * sn + ax.z * cs };
      const a2 = { x: -a1.z, z: a1.x };
      lump(geo, c, a1, a2, step * (0.4 + rand() * 0.25), w * (0.3 + rand() * 0.15), 0.12 + rand() * 0.14, greys[Math.floor(rand() * greys.length)], rand);
    }
    // Stones from a slump lie in the grass beyond the wall, the odd one on the verge.
    if (prev.sag > 0.2 && rand() < 0.6) {
      const out = rand() < 0.75 ? side * (w / 2 + 0.5 + rand() * 1.4) : -side * (w / 2 + 0.3);
      this.rock(cur.m.x + cur.rx * out, cur.m.z + cur.rz * out, 0.2 + rand() * 0.25);
    }
    prev = cur;
  }
  if (!gap) cap(prev);
}

// A rough stone: a box with jittered corners, narrower at the top, flat
// shaded. c is the middle of its base, a1 and a2 unit horizontal axes.
function lump(geo, c, a1, a2, hx, hz, h, col, rand) {
  const pts = [];
  for (const y of [0, 1]) {
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const shrink = y ? 0.75 + rand() * 0.2 : 1;
      const x = hx * u * shrink + (rand() - 0.5) * 0.1;
      const z = hz * v * shrink + (rand() - 0.5) * 0.1;
      pts.push(new THREE.Vector3(c.x + a1.x * x + a2.x * z, c.y + y * h * (0.6 + rand() * 0.7), c.z + a1.z * x + a2.z * z));
    }
  }
  const mid = new THREE.Vector3(c.x, c.y + h * 0.45, c.z);
  const [a, b, cc, d, e, f, g, k] = pts;
  geo.quad(e, f, g, k, PLASTER, col, mid);
  geo.quad(a, b, f, e, PLASTER, col, mid);
  geo.quad(b, cc, g, f, PLASTER, col, mid);
  geo.quad(cc, d, k, g, PLASTER, col, mid);
  geo.quad(d, a, e, k, PLASTER, col, mid);
}

// A quad facing up or away from the road's centre line, whichever its
// winding gives (the walls are seen from both sides, so emit both faces).
function quadOut(geo, a, b, c, d, side, kind, col) {
  geo.tri(a, b, c, kind, col);
  geo.tri(a, c, d, kind, col);
  geo.tri(a, c, b, kind, col);
  geo.tri(a, d, c, kind, col);
}

// Deck slab, string course and parapet walls with coping, s0..s1.
function deckAndParapets(geo, road, s0, s1, kind, col) {
  sweep(geo, road, s0, s1, [[-W, -1.3], [W, -1.3], [W, -0.03], [-W, -0.03]], kind, col);
  for (const side of [-1, 1]) {
    const o = side * W;
    sweep(geo, road, s0, s1, [[o - side * 0.55, -0.1], [o, -0.1], [o, 1.0], [o - side * 0.55, 1.0]], kind, col);
    sweep(geo, road, s0 - 0.1, s1 + 0.1, [[o - side * 0.62, 1.0], [o + side * 0.07, 1.0], [o + side * 0.07, 1.16], [o - side * 0.62, 1.16]], PLASTER, COPING);
    sweep(geo, road, s0, s1, [[o, -1.45], [o + side * 0.14, -1.45], [o + side * 0.14, -1.1], [o, -1.1]], PLASTER, COPING);
  }
}

// One arched span under the deck from sa to sb: spandrel walls and barrel
// as a solid, springing at vSpring below the road.
function archSpan(geo, road, sa, sb, R, pierW, vSpring, col) {
  const a = road.sample(sa, {}), b = road.sample(sb, {});
  const dx = b.x - a.x, dz = b.z - a.z;
  const L = Math.hypot(dx, dz);
  const X = new THREE.Vector3(dx / L, 0, dz / L);
  const Z = new THREE.Vector3(-X.z, 0, X.x);
  const slope = (b.y - a.y) / L;
  const top = -1.3;
  const shape = new THREE.Shape();
  shape.moveTo(0, top);
  shape.lineTo(L, top);
  shape.lineTo(L, vSpring);
  shape.lineTo(L / 2 + R, vSpring);
  shape.absarc(L / 2, vSpring, R, 0, Math.PI, false);
  shape.lineTo(0, vSpring);
  shape.lineTo(0, top);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 2 * W, bevelEnabled: false, curveSegments: 14 });
  const m = new THREE.Matrix4().set(
    X.x, 0, Z.x, a.x - Z.x * W,
    slope, 1, 0, a.y,
    X.z, 0, Z.z, a.z - Z.z * W,
    0, 0, 0, 1,
  );
  geo.add(g, m, MASONRY, col);
}

// A stream along a polyline: water ribbon following the ground downhill,
// foaming where it's steep, with boulders on its banks.
// A flat sheet of water `half` m either side of the line through o along
// its dir (a road sample), reaching `len` m out along its right vector.
function waterStrip(o, half, len, level) {
  const pos = [];
  for (const t of [-half, half]) for (const n of [-len, len]) pos.push(o.x + o.dirX * t + o.rightX * n, level, o.z + o.dirZ * t + o.rightZ * n);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(pos.filter((_, i) => i % 3 !== 1).map((v) => v / 14), 2));
  this.lakeMat.side = THREE.DoubleSide;
  const m = new THREE.Mesh(g, this.lakeMat);
  m.receiveShadow = true;
  this.group.add(m);
}

function river(pts, width, fall = false) {
  const t = this.terrain;
  const P = [];
  let prevY = Infinity;
  // Walk downstream from the high end so the water never runs uphill.
  const ends = [t.heightAt(pts[0], pts[1]), t.heightAt(pts[pts.length - 2], pts[pts.length - 1])];
  const order = [];
  for (let i = 0; i < pts.length; i += 2) order.push(i);
  if (ends[1] > ends[0]) order.reverse();
  for (const i of order) {
    const x = pts[i], z = pts[i + 1];
    const y = Math.min(prevY - 0.02, t.heightAt(x, z) + 0.35);
    prevY = y;
    P.push(new THREE.Vector3(x, y, z));
  }
  // Densify for a smooth surface.
  const curve = new THREE.CatmullRomCurve3(P);
  const n = Math.ceil(curve.getLength() / 2);
  const pp = curve.getSpacedPoints(n);
  const pos = [], col = [], uv = [], idx = [];
  let len = 0;
  for (let i = 0; i <= n; i++) {
    const p = pp[i];
    const q = pp[Math.min(n, i + 1)], o = pp[Math.max(0, i - 1)];
    const dx = q.x - o.x, dz = q.z - o.z, dl = Math.hypot(dx, dz) || 1;
    const nx = -dz / dl, nz = dx / dl;
    const slope = Math.abs(q.y - o.y) / dl;
    const rush = Math.min(1, smooth(0.08, 0.5, slope) + (fall ? 0 : 0));
    // Wider and frothier in falls, settling into a pool below.
    const w = width * (1 + rush * 0.3);
    if (i > 0) len += pp[i].distanceTo(pp[i - 1]);
    for (const s of [-1, 1]) {
      const y = Math.max(p.y, t.heightAt(p.x + nx * s * w * 0.5, p.z + nz * s * w * 0.5) + 0.05);
      pos.push(p.x + nx * s * w * 0.5, Math.min(y, p.y + 0.6), p.z + nz * s * w * 0.5);
      col.push(rush, 0, 0);
      uv.push((s + 1) / 2, len / 4);
    }
    if (i < n) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    if (i % 5 === 0 && this.rand() < 0.7) {
      const side = this.rand() < 0.5 ? -1 : 1;
      const d = w * 0.5 + 0.4 + this.rand() * 1.5;
      this.rock(p.x + nx * side * d, p.z + nz * side * d, 0.4 + this.rand() * 1.1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, this.streamMat);
  this.streamMat.side = THREE.DoubleSide;
  m.receiveShadow = true;
  this.group.add(m);
}

// A square beam of half width r between two points.
function strut(geo, a, b, r, kind, col) {
  const d = new THREE.Vector3().subVectors(b, a);
  const up = Math.abs(d.y) / (d.length() || 1) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3().crossVectors(d, up).normalize().multiplyScalar(r);
  const q = new THREE.Vector3().crossVectors(d, p).normalize().multiplyScalar(r);
  const c = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const corner = (o, sp, sq) => o.clone().addScaledVector(p, sp).addScaledVector(q, sq);
  const A = [corner(a, -1, -1), corner(a, 1, -1), corner(a, 1, 1), corner(a, -1, 1)];
  const B = [corner(b, -1, -1), corner(b, 1, -1), corner(b, 1, 1), corner(b, -1, 1)];
  for (let i = 0; i < 4; i++) geo.quad(A[i], A[(i + 1) % 4], B[(i + 1) % 4], B[i], kind, col, c);
  geo.quad(A[0], A[1], A[2], A[3], kind, col, c);
  geo.quad(B[0], B[1], B[2], B[3], kind, col, c);
}

// An eight-sided log's cross-section (for sweep), centred d across and h up.
function logSection(d, h, r) {
  return Array.from({ length: 8 }, (_, i) => [d + Math.cos((i / 8) * 6.2832) * r, h + Math.sin((i / 8) * 6.2832) * r]);
}

// The open sea: deep blue-green water whose waves are two layers of the
// water normal map drifting different ways plus a long swell, all in world
// space and fading to a calmer sheen far off, so the sun glitters on it and
// the sky reflects in streaks rather than as one pale sheet.
function seaMaterial(normal, color) {
  const mat = new THREE.MeshStandardMaterial({ color: color || '#0e3d4f', roughness: 0.14, metalness: 0, envMapIntensity: 0.8 });
  const tex = normal.clone();
  tex.needsUpdate = true;
  tex.repeat.set(1, 1);
  tex.offset.set(0, 0);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tWave = { value: tex };
    shader.uniforms.uTime = waterTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSeaW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSeaW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tWave;\nuniform float uTime;\nvarying vec3 vSeaW;')
      .replace(
        '#include <normal_fragment_maps>',
        `{
          vec2 p = vSeaW.xz;
          vec3 n1 = texture2D(tWave, p / 23.0 + vec2(uTime * 0.011, uTime * 0.007)).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(tWave, mat2(0.8, -0.6, 0.6, 0.8) * p / 9.0 - vec2(uTime * 0.017, -uTime * 0.012)).xyz * 2.0 - 1.0;
          vec2 slope = (n1.xy * 0.6 + n2.xy * 0.4);
          // A long swell rolling in.
          slope += vec2(0.07, 0.03) * cos(dot(p, vec2(0.045, 0.02)) - uTime * 0.9) + vec2(0.03, 0.05) * cos(dot(p, vec2(-0.013, 0.051)) - uTime * 0.7);
          float far = smoothstep(60.0, 900.0, length(vViewPosition));
          slope *= mix(0.9, 0.25, far);
          vec3 wn = normalize(vec3(-slope.x, 1.0, -slope.y));
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'sea';
  return mat;
}

// A soft round puff for chimney smoke.
let smokeTex = null;
function smokeTexture() {
  if (smokeTex) return smokeTex;
  // Billowy lumps lit from above: each lump is brighter on top and shaded
  // underneath, and the whole puff fades softly to its edge.
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rnd = mulberry32(5);
  for (let i = 0; i < 16; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * S * 0.2;
    const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d, r = S * (0.13 + rnd() * 0.12);
    const gr = g.createRadialGradient(x, y - r * 0.35, r * 0.1, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.8)');
    gr.addColorStop(0.55, 'rgba(190,190,196,0.6)');
    gr.addColorStop(1, 'rgba(150,150,158,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  }
  // Soft overall edge.
  g.globalCompositeOperation = 'destination-in';
  const edge = g.createRadialGradient(S / 2, S / 2, S * 0.2, S / 2, S / 2, S * 0.5);
  edge.addColorStop(0, 'rgba(0,0,0,1)');
  edge.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = edge;
  g.fillRect(0, 0, S, S);
  smokeTex = new THREE.CanvasTexture(c);
  smokeTex.colorSpace = THREE.SRGBColorSpace;
  return smokeTex;
}

// Terrain for a railway along a polyline [x, z, ...] at heights ys: a level
// bed `width` wide, cut down through rises and banked up over dips.
function railBed(pts, ys, width) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]);
    maxX = Math.max(maxX, pts[i]);
    minZ = Math.min(minZ, pts[i + 1]);
    maxZ = Math.max(maxZ, pts[i + 1]);
  }
  const R = width + 40;
  return (x, z, f, h) => {
    if (x < minX - R || x > maxX + R || z < minZ - R || z > maxZ + R) return h;
    let best = Infinity, by = 0;
    for (let i = 0; i < pts.length - 2; i += 2) {
      const ax = pts[i], az = pts[i + 1], ex = pts[i + 2] - ax, ez = pts[i + 3] - az;
      const l2 = ex * ex + ez * ez || 1;
      const t = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / l2));
      const d = Math.hypot(ax + ex * t - x, az + ez * t - z);
      if (d < best) {
        best = d;
        by = ys[i / 2] + (ys[i / 2 + 1] - ys[i / 2]) * t;
      }
    }
    if (best > R) return h;
    const out = Math.max(0, best - width / 2);
    // The road itself is never touched.
    if (f.dist < RAIL_OFFSET + 1) return h;
    const want = h > by ? Math.min(h, by - 0.35 + out * 1.1) : Math.max(h, by - 0.35 - out * 1.5);
    return h + (want - h) * (1 - smooth(width / 2 + 25, R, best)) * smooth(RAIL_OFFSET + 1, RAIL_OFFSET + 4, f.dist);
  };
}

// Ballast, sleepers and two rails along a polyline.
function track(pts, ys) {
  const geo = new Geo();
  const up = new THREE.Vector3(0, 1, 0);
  let carry = 0;
  for (let i = 0; i < pts.length - 2; i += 2) {
    const a = new THREE.Vector3(pts[i], ys[i / 2], pts[i + 1]);
    const b = new THREE.Vector3(pts[i + 2], ys[i / 2 + 1], pts[i + 3]);
    const L = a.distanceTo(b);
    if (L < 0.01) continue;
    const dir = new THREE.Vector3().subVectors(b, a).normalize();
    const side = new THREE.Vector3().crossVectors(dir, up).normalize();
    const ax = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    geo.box(mid.x, mid.z, mid.y - 0.5, mid.y - 0.05, ax, L / 2 + 0.05, side, 1.7, MASONRY, '#8a7a6a');
    for (const k of [-0.72, 0.72]) strut(geo, a.clone().addScaledVector(side, k).setY(a.y + 0.1), b.clone().addScaledVector(side, k).setY(b.y + 0.1), 0.05, METAL, '#5a4a40');
    for (let t = carry; t < L; t += 0.7) {
      const p = a.clone().lerp(b, t / L);
      geo.box(p.x, p.z, p.y - 0.08, p.y + 0.05, ax, 0.12, side, 1.25, PLANKS, '#4a3a2e');
      carry = t + 0.7 - L;
    }
  }
  this.mesh(geo);
}

// A freight train running along a polyline: a locomotive and `cars` cars,
// out of sight between runs.
function freight(pts, ys, { every, speed, cars, phase }) {
  const types = ['locomotive', 'boxcar', 'tankcar', 'hopper', 'boxcar', 'flatcar', 'hopper', 'tankcar'];
  const lens = { locomotive: 20.5, boxcar: 14.5, tankcar: 14.5, hopper: 14.5, flatcar: 14.5 };
  const consist = [];
  let off = 0;
  for (let k = 0; k <= cars; k++) {
    const t = k === 0 ? 'locomotive' : types[1 + ((k * 5) % (types.length - 1))];
    consist.push({ t, off: off + lens[t] / 2 });
    off += lens[t];
  }
  const meshes = {};
  for (const c of consist) {
    const g = this.props.geos.get(c.t);
    if (!g) return;
    meshes[c.t] ||= { g, list: [] };
    meshes[c.t].list.push(c);
  }
  for (const m of Object.values(meshes)) {
    m.im = new THREE.InstancedMesh(m.g, this.mat, m.list.length);
    m.im.castShadow = true;
    m.im.frustumCulled = false;
    this.group.add(m.im);
  }
  // Cumulative length along the line.
  const cum = [0];
  for (let i = 2; i < pts.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]));
  const total = cum[cum.length - 1];
  const P = new THREE.Vector3(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), m4 = new THREE.Matrix4(), Y = new THREE.Vector3(0, 1, 0);
  const at = (u) => {
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] > u) hi = mid;
      else lo = mid;
    }
    const t = (u - cum[lo]) / (cum[hi] - cum[lo] || 1);
    const x = pts[lo * 2] + (pts[hi * 2] - pts[lo * 2]) * t, z = pts[lo * 2 + 1] + (pts[hi * 2 + 1] - pts[lo * 2 + 1]) * t;
    const y = ys[lo] + (ys[hi] - ys[lo]) * t;
    return [x, y, z, Math.atan2(pts[hi * 2] - pts[lo * 2], pts[hi * 2 + 1] - pts[lo * 2 + 1])];
  };
  const period = (total + off) / speed + every;
  this.gondolas.push({
    update: (time) => {
      const head = (((time + phase) % period) + period) % period * speed;
      for (const m of Object.values(meshes)) {
        m.list.forEach((c, i) => {
          const u = head - c.off;
          if (u < 0 || u > total) P.set(0, -1e4, 0), q.identity();
          else {
            const [x, y, z, yaw] = at(u);
            P.set(x, y + 0.15, z);
            // The cab (model -Y, three +Z) leads.
            q.setFromAxisAngle(Y, yaw);
          }
          m4.compose(P, q, one);
          m.im.setMatrixAt(i, m4);
        });
        m.im.instanceMatrix.needsUpdate = true;
      }
    },
  });
}

// ---------------------------------------------------------------- suburbs
// Pavement width, a side road's half width, speed hump size, and the
// railway's height over the road and how far it runs either side.
const PAVE = 2.1, SIDE_HALF = 3.0, BUMP_LEN = 3.7, BUMP_H = 0.07, RAIL_CLEAR = 5.2, RAIL_LINE = 160;

// The road's crown (as roadmesh.js): its edges sit 4 cm below the middle.
const crownAt = (d) => -0.04 * (Math.min(Math.abs(d), HALF_WIDTH) / HALF_WIDTH) ** 2;

// Height of a side road t m out from the main road's centre line.
function junctionY(job, t) {
  const u = clamp((t - HALF_WIDTH) / job.L, 0, 1);
  return job.y0 - 0.04 + job.rise * u * u * (3 - 2 * u);
}

// A side road: tarmac, kerbs and pavements down both sides, give-way lines
// across its mouth and a dashed line down the middle.
function junctionMesh(geo, job) {
  const { ox, oz, ux, uz, vx, vz, L } = job;
  const P = (t, n, y) => new THREE.Vector3(ox + ux * t + vx * n, y ?? junctionY(job, t), oz + uz * t + vz * n);
  const T0 = HALF_WIDTH - 0.1, T1 = HALF_WIDTH + L;
  const step = 3;
  const TAR = '#3f4043';
  for (let t = T0; t < T1 - 0.01; t += step) {
    const t2 = Math.min(T1, t + step);
    const y = (tt) => junctionY(job, tt) + 0.012;
    geo.quad(P(t, -SIDE_HALF, y(t)), P(t2, -SIDE_HALF, y(t2)), P(t2, SIDE_HALF, y(t2)), P(t, SIDE_HALF, y(t)), TARMAC, TAR, P(t, 0, y(t) - 5));
    for (const k of [-1, 1]) {
      // Kerb, then pavement beyond the main road's own pavement.
      const ka = Math.max(t, HALF_WIDTH + 0.15);
      if (t2 > ka) slab(geo, P, ka, t2, k * SIDE_HALF, k * (SIDE_HALF + 0.15), 0.12, '#c4c1b9');
      const pa = Math.max(t, HALF_WIDTH + PAVE + 0.15);
      if (t2 > pa) slab(geo, P, pa, t2, k * (SIDE_HALF + 0.15), k * (SIDE_HALF + PAVE), 0.1, '#a3a19b');
    }
  }
  // Give way: two rows of short dashes across the lane coming out. Traffic
  // keeps to its own side, so that's the coming-out driver's left in
  // Britain (drive -1) and right elsewhere.
  const drive = this.road.drive || 1;
  // Which way across the side road is the coming-out driver's right?
  const right = Math.sign(-ux * vz + uz * vx) || 1;
  const lane = drive * right;
  for (const t of [HALF_WIDTH + 0.4, HALF_WIDTH + 0.8]) {
    for (let n = 0.15; n < SIDE_HALF - 0.2; n += 0.9) paint(geo, P, t - 0.1, t + 0.1, lane * n, lane * (n + 0.6));
  }
  for (let t = HALF_WIDTH + 4; t < T1 - 2; t += 6) paint(geo, P, t, t + 2, -0.05, 0.05);
}

// A raised strip beside the side road from t0 to t1, across n0..n1, h high.
function slab(geo, P, t0, t1, n0, n1, h, col) {
  const a = [P(t0, n0), P(t1, n0), P(t1, n1), P(t0, n1)];
  const top = a.map((p) => p.clone().setY(p.y + h + 0.012));
  const bot = a.map((p) => p.clone().setY(p.y - 0.3));
  const mid = new THREE.Vector3().addVectors(top[0], bot[2]).multiplyScalar(0.5);
  geo.quad(top[0], top[1], top[2], top[3], PAVING, col, mid);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    geo.quad(bot[i], bot[j], top[j], top[i], PAVING, col, mid);
  }
}

// White paint on the side road: t0..t1 along it, n0..n1 across.
function paint(geo, P, t0, t1, n0, n1) {
  const up = (p) => p.setY(p.y + 0.02);
  const a = up(P(t0, n0)), b = up(P(t1, n0)), c = up(P(t1, n1)), d = up(P(t0, n1));
  geo.quad(a, b, c, d, PAINT, '#ecebe6', new THREE.Vector3(a.x, a.y - 5, a.z));
}

// White paint on the main road at f (a road sample): a band across from d0
// to d1, half as long as `half`, following the crown.
function stripe(geo, f, d0, d1, half, col) {
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = d0 + ((d1 - d0) * i) / n, b = d0 + ((d1 - d0) * (i + 1)) / n;
    const p = (d, k) => new THREE.Vector3(f.x + f.rightX * d + f.dirX * k * half, f.y + crownAt(d) + 0.015, f.z + f.rightZ * d + f.dirZ * k * half);
    const q = [p(a, -1), p(b, -1), p(b, 1), p(a, 1)];
    geo.quad(q[0], q[1], q[2], q[3], PAINT, col, new THREE.Vector3(q[0].x, q[0].y - 5, q[0].z));
  }
}

// Dashes across the main road at f, from d0 to d1: each `len` long with
// `gap` between, `width` deep along the road, offset `k` m along it.
function dashes(geo, f, d0, d1, k, len, gap, width, col) {
  const g = { ...f, x: f.x + f.dirX * k, z: f.z + f.dirZ * k };
  for (let d = d0; d < d1 - 0.05; d += len + gap) stripe(geo, g, d, Math.min(d1, d + len), width / 2, col);
}

// A painted line between two points on the road, `w` wide.
function line(geo, a, b, w, col) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l = Math.hypot(dx, dz) || 1;
  const nx = (-dz / l) * w / 2, nz = (dx / l) * w / 2;
  const q = [new THREE.Vector3(a.x + nx, a.y, a.z + nz), new THREE.Vector3(b.x + nx, b.y, b.z + nz), new THREE.Vector3(b.x - nx, b.y, b.z - nz), new THREE.Vector3(a.x - nx, a.y, a.z - nz)];
  geo.quad(q[0], q[1], q[2], q[3], PAINT, col, new THREE.Vector3(a.x, a.y - 5, a.z));
}

// One front garden's edge along the pavement, s0..s1 at d = g.
function gardenEdge(geo, road, s0, s1, g, side, style, rand) {
  const o = (x) => g + side * x;
  const greens = ['#3f5f2e', '#4a6b34', '#3a5a2c'];
  if (style === 'brick' || style === 'low') {
    const h = style === 'brick' ? 0.8 : 0.45;
    const col = ['#9a5a43', '#a8664a', '#8d5040', '#b9a58c'][Math.floor(rand() * 4)];
    sweep(geo, road, s0, s1, [[o(0), -0.3], [o(0.25), -0.3], [o(0.25), h], [o(0), h]], MASONRY, col, { step: 1 });
    sweep(geo, road, s0 - 0.03, s1 + 0.03, [[o(-0.03), h], [o(0.28), h], [o(0.28), h + 0.07], [o(-0.03), h + 0.07]], PLASTER, '#cfc8bb', { step: 1 });
  } else if (style === 'hedge') {
    const col = greens[Math.floor(rand() * greens.length)];
    const h = 1.0 + rand() * 0.5;
    sweep(geo, road, s0, s1, [[o(0), -0.2], [o(0.9), -0.2], [o(0.85), h], [o(0.6), h + 0.25], [o(0.3), h + 0.25], [o(0.05), h]], LEAVES, col, { step: 1 });
  } else if (style === 'picket') {
    const col = '#efede6';
    for (const y of [0.25, 0.7]) sweep(geo, road, s0, s1, [[o(0.02), y], [o(0.06), y], [o(0.06), y + 0.07], [o(0.02), y + 0.07]], PAINT, col, { step: 2, caps: false });
    const f = {};
    for (let s = s0; s <= s1; s += 0.16) {
      road.sample(s, f);
      geo.box(f.x + f.rightX * o(0), f.z + f.rightZ * o(0), f.y - 0.1, f.y + 0.95, new THREE.Vector3(f.dirX, 0, f.dirZ), 0.04, new THREE.Vector3(f.rightX, 0, f.rightZ), 0.012, PAINT, col);
    }
  } else if (style === 'railing') {
    const col = '#e9e7e1';
    for (const y of [0.5, 1.0]) sweep(geo, road, s0, s1, [[o(0.0), y], [o(0.06), y], [o(0.06), y + 0.06], [o(0.0), y + 0.06]], METAL, col, { step: 2, caps: false });
    const f = {};
    for (let s = s0; s <= s1; s += 2) {
      road.sample(s, f);
      geo.box(f.x + f.rightX * o(0.03), f.z + f.rightZ * o(0.03), f.y - 0.2, f.y + 1.08, new THREE.Vector3(f.dirX, 0, f.dirZ), 0.04, new THREE.Vector3(f.rightX, 0, f.rightZ), 0.04, METAL, col);
    }
  }
}
