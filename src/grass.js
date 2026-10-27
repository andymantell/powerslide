// Grass tufts on the ground near the rider: crossed alpha-tested cards
// (texture from tools/textures/gen.py tuft) scattered over the grassy parts of
// the terrain and kept off the road, gravel and rock. Placement works in
// small cells around the rider, built a few at a time as they come into
// range, and everything draws as one InstancedMesh. Tufts shrink into the
// ground at the edge of the radius, and sway in the wind.
import * as THREE from 'three';
import { mulberry32, smoothstep } from './noise.js';
import { groundTexture, trackLoad } from './ground.js';
import { boostAlpha } from './forest.js';

const tuftUrl = (name) => new URL(`./assets/textures/${name}.webp`, import.meta.url).href;
const CELL = 8;
const GRID = 4; // height samples per cell side (GRID + 1 points)
const MAX = 32000;
const BUILDS_PER_FRAME = 6;

// Three cards crossed at 60 degrees, 1 m wide and 1 m tall before scaling.
function tuftGeometry() {
  const pos = [], uv = [], idx = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    const cx = Math.cos(a) * 0.5, cz = Math.sin(a) * 0.5;
    const b = pos.length / 3;
    pos.push(-cx, 0, -cz, cx, 0, cz, cx, 1, cz, -cx, 1, -cz);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // Normals point up so the tufts light like the ground they grow from.
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

export class Grass {
  constructor(scene, renderer, terrain, q = {}) {
    this.terrain = terrain;
    this.radius = q.grassRadius ?? 0;
    this.density = q.grassDensity ?? 0.8;
    this.cells = new Map();
    this.dirty = false;
    this.lastX = Infinity;
    this.lastZ = Infinity;
    if (!this.radius) return;

    let map;
    trackLoad(new Promise((res) => (map = new THREE.TextureLoader().load(tuftUrl(terrain.groundSet?.tuft ?? 'grass_tuft'), res, undefined, res))));
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    this.uniforms = {
      uTime: { value: 0 },
      uFade: { value: new THREE.Vector2(this.radius * 0.6, this.radius) },
      tPatch: { value: groundTexture('snow', 'albedo', renderer) },
    };
    const mat = new THREE.MeshStandardMaterial({
      map,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      roughness: 0.95,
      alphaToCoverage: !!q.antialias,
    });
    mat.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, this.uniforms);
      s.vertexShader = s.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute vec2 aTuft; // variant (0 or 1), dryness
          uniform float uTime;
          uniform vec2 uFade;
          varying vec3 vTuft;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec3 tBase = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float tFade = 1.0 - smoothstep(uFade.x, uFade.y, distance(tBase.xz, cameraPosition.xz));
          transformed.y *= tFade;
          // Wind: gusts roll across the slope, tips move most.
          float tH = uv.y * uv.y;
          float gust = sin(uTime * 1.3 + tBase.x * 0.21 + tBase.z * 0.13) * 0.5 + 0.5;
          float flutter = sin(uTime * 4.1 + tBase.x * 1.7 + tBase.z * 1.3);
          vec3 wind = vec3(0.09 * gust + 0.025 * flutter, 0.0, 0.05 * gust) * tH;
          transformed += (inverse(mat3(instanceMatrix)) * wind);
          vTuft = vec3(tBase.xz, aTuft.y);`,
        )
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv.x = vMapUv.x * 0.5 + aTuft.x * 0.5;');
      s.fragmentShader = s.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform sampler2D tPatch;
          varying vec3 vTuft;`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          // Same lush and dry patches as the ground shader, so tufts blend in.
          float gN2 = texture2D(tPatch, vTuft.xy * 0.0031 + 0.5).a;
          diffuseColor.rgb *= mix(vec3(0.74, 0.84, 0.68), vec3(1.15, 1.08, 0.86), smoothstep(0.2, 0.8, gN2));
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.25, 1.12, 0.8), vTuft.z);
          // Darker in the base of the clump.
          diffuseColor.rgb *= mix(0.32, 0.92, smoothstep(0.0, 0.7, vMapUv.y));`,
        )
        .replace(
          '#include <normal_fragment_begin>',
          '#include <normal_fragment_begin>\n  normal = normalize(vNormal);',
        );
      boostAlpha(s, 512);
    };
    mat.customProgramCacheKey = () => 'grass-tuft';

    const geo = tuftGeometry();
    this.attr = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2);
    geo.setAttribute('aTuft', this.attr);
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.count = 0;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  // Tufts for one cell as [x, y, z, scale, yaw, variant, dryness] records.
  buildCell(ix, iz) {
    const t = this.terrain;
    const x0 = ix * CELL, z0 = iz * CELL;
    const n = GRID + 1, step = CELL / GRID;
    const H = new Float32Array(n * n), R = new Float32Array(n * n), D = new Float32Array(n * n);
    const f = {};
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = x0 + i * step, z = z0 + j * step;
        t.road.field(x, z, f);
        const h = t.heightFromField(x, z, f, false);
        H[j * n + i] = h;
        R[j * n + i] = h - f.roadY;
        D[j * n + i] = f.dist;
      }
    }
    const lerp2 = (A, u, v) => {
      const i = Math.min(GRID - 1, Math.floor(u)), j = Math.min(GRID - 1, Math.floor(v));
      const fu = u - i, fv = v - j;
      const a = A[j * n + i] + (A[j * n + i + 1] - A[j * n + i]) * fu;
      const b = A[(j + 1) * n + i] + (A[(j + 1) * n + i + 1] - A[(j + 1) * n + i]) * fu;
      return a + (b - a) * fv;
    };
    const rand = mulberry32(((ix * 73856093) ^ (iz * 19349663)) >>> 0);
    const out = [];
    const sf = {};
    const tries = Math.round(CELL * CELL * this.density);
    for (let k = 0; k < tries; k++) {
      const u = rand() * GRID, v = rand() * GRID;
      const x = x0 + u * step, z = z0 + v * step;
      const dist = lerp2(D, u, v);
      if (dist < 5.4 || t.blocked(x, z)) continue;
      const h = lerp2(H, u, v);
      const gx = (lerp2(H, Math.min(GRID, u + 0.25), v) - lerp2(H, Math.max(0, u - 0.25), v)) / (step * 0.5);
      const gz = (lerp2(H, u, Math.min(GRID, v + 0.25)) - lerp2(H, u, Math.max(0, v - 0.25))) / (step * 0.5);
      const ny = 1 / Math.hypot(gx, 1, gz);
      const s = t.surface(x, z, lerp2(R, u, v), dist, ny, sf);
      const bare = Math.max(s.rock, s.gravel, s.snow);
      // Clumps: denser where the large-scale noise says so.
      const clump = t.noise3(x / 9 + 31, z / 9) * 0.5 + 0.5;
      if (rand() < bare * 1.6 + (1 - clump) * 0.55) continue;
      const sc = (0.45 + rand() * 0.5) * (0.7 + clump * 0.5) * (1 - bare * 0.5);
      out.push(x, h - 0.03, z, sc, rand() * Math.PI, rand() < 0.12 ? 1 : 0, smoothstep(0.35, 0.8, s.v2) * 0.8);
    }
    return new Float32Array(out);
  }

  update(px, pz, time = 0) {
    if (!this.radius) return;
    this.uniforms.uTime.value = time;
    const moved = Math.hypot(px - this.lastX, pz - this.lastZ) > CELL * 0.5;
    if (moved || this.pending) {
      this.lastX = px;
      this.lastZ = pz;
      const r = this.radius + CELL;
      const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL), cr = Math.ceil(r / CELL);
      const want = [];
      const keep = new Set();
      for (let dz = -cr; dz <= cr; dz++) {
        for (let dx = -cr; dx <= cr; dx++) {
          const ix = cx + dx, iz = cz + dz;
          const d = Math.hypot((ix + 0.5) * CELL - px, (iz + 0.5) * CELL - pz);
          if (d > r) continue;
          const key = `${ix},${iz}`;
          keep.add(key);
          if (!this.cells.has(key)) want.push({ key, ix, iz, d });
        }
      }
      for (const key of this.cells.keys()) {
        if (!keep.has(key)) {
          this.cells.delete(key);
          this.dirty = true;
        }
      }
      // Nearest cells first, a few per frame to avoid hitches.
      want.sort((a, b) => a.d - b.d);
      for (const w of want.slice(0, this.budget ?? BUILDS_PER_FRAME)) {
        this.cells.set(w.key, this.buildCell(w.ix, w.iz));
        this.dirty = true;
      }
      this.pending = want.length > BUILDS_PER_FRAME;
    }
    if (this.dirty) this.refill();
  }

  // Drops every cell (the terrain under them changed).
  clear() {
    this.cells.clear();
    this.lastX = Infinity;
    this.dirty = true;
  }

  // Builds every cell in range at once (loading screens, screenshots).
  fill(px, pz) {
    if (!this.radius) return;
    this.budget = Infinity;
    this.lastX = Infinity;
    this.update(px, pz);
    this.budget = undefined;
  }

  refill() {
    this.dirty = false;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const a = this.attr.array;
    let n = 0;
    for (const arr of this.cells.values()) {
      for (let i = 0; i < arr.length && n < MAX; i += 7) {
        const sc = arr[i + 3];
        q.setFromAxisAngle(up, arr[i + 4]);
        m.compose(p.set(arr[i], arr[i + 1], arr[i + 2]), q, s.set(sc * 1.3, sc, sc * 1.3));
        this.mesh.setMatrixAt(n, m);
        a[n * 2] = arr[i + 5];
        a[n * 2 + 1] = arr[i + 6];
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.attr.needsUpdate = true;
  }
}
