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
  }

  // Terrain shaping and props for the level's features. Needs the road built.
  plan(level) {
    this.clear();
    this.level = level;
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

  // { type: 'flat', from, to, width } Gentle ground either side of the road,
  // for a village or a farm: no cuttings or drops within `width` m (60).
  flat(job) {
    const { s0, s1 } = job;
    const W = job.f.width ?? 60;
    this.terrain.mods.push((x, z, f, h) => {
      const s = f.index;
      if (s < s0 - 40 || s > s1 + 40 || f.dist > W + 30) return h;
      const w = smooth(s0 - 40, s0, s) * (1 - smooth(s1, s1 + 40, s)) * (1 - smooth(W, W + 30, f.dist));
      // A gentle rise away from the road, with a little of the old shape left.
      const want = f.roadY - 0.25 + Math.max(0, f.dist - 8) * 0.05 + (h - f.roadY) * 0.12;
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
      const m = smooth(s0 - 25, s0 + 4, s) * (1 - smooth(s1 - 4, s1 + 25, s)) * smooth(5.4, 7, f.dist) * (1 - smooth(14, 40, f.dist));
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
      let t = Math.max(h, level + 0.6);
      t += (level - 2.5 - 9 * inner - t) * inner;
      return h + (t - h) * region;
    });
    // Sets with a shore texture (sand in the suburbs) lay it on the low
    // ground round the water: 1 on the beach, fading out up the bank.
    if (this.terrain.groundSet?.shore) {
      this.terrain.mods.at(-1).shore = (x, z, fd, h, out) => {
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
  // The kerb is what stops you (barrier 'kerb').
  street(job) {
    const { s0, s1 } = job;
    const sides = edgeSides(job);
    const P = HALF_WIDTH + PAVE + 0.4;
    // Level the pavement with the road, then let the gardens blend back
    // into the hillside behind.
    this.terrain.mods.push((x, z, f, h) => {
      const s = f.index;
      if (s < s0 - 12 || s > s1 + 12 || f.dist > P + 34 || !sides.includes(f.side)) return h;
      const w = smooth(s0 - 12, s0, s) * (1 - smooth(s1, s1 + 12, s)) * (1 - smooth(P + 16, P + 34, f.dist));
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
};

// ---------------------------------------------------------------- builds
const BUILDS = {
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
