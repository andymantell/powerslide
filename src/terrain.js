// Streaming terrain around the player. Heights come from a world-space function
// built from the road "field" (so the land meets the road cleanly, with a
// mountain wall on one side and a valley on the other) plus ridged noise.
// Two rings of tiles: detailed near tiles and coarse far tiles, split by a
// circular cut in the fragment shader so they never overlap visibly.

import * as THREE from 'three';
import { createNoise2D, fbm, ridged, smoothstep, lerp, mulberry32 } from './noise.js';
import { createGroundMaterial } from './ground.js';

const NEAR_SIZE = 160;
const FAR_SIZE = 1280;
const FAR_SEGS = 32;
const SHOULDER = 6.5;


export class Terrain {
  // q: quality preset (nearRadius, nearSegs, farRadius, treeSpacing).
  // groundSet: the biome's entry in GROUND_SETS.
  constructor(scene, road, seed = 99, q = {}, renderer, groundSet) {
    this.scene = scene;
    this.nearRadius = q.nearRadius ?? 4;
    this.nearSegs = q.nearSegs ?? 64;
    this.farRadius = q.farRadius ?? 3;
    this.treeSpacing = q.treeSpacing ?? 7;
    // Near tiles always cover at least nearRadius tiles from the rider.
    this.nearCut = { value: this.nearRadius * NEAR_SIZE - 40 };
    this.road = road;
    // Biome shape: relief scales the hills, snowLine is metres above the road.
    this.groundSet = groundSet;
    this.setShape();
    this.noise = createNoise2D(seed);
    this.noise2 = createNoise2D(seed + 1);
    this.noise3 = createNoise2D(seed + 2);
    this.field = {};
    this.near = new Map();
    this.far = new Map();
    this.cutCenter = new THREE.Vector2();

    const patch = (inside) => (shader) => {
      shader.uniforms.uCut = { value: this.cutCenter };
      shader.uniforms.uCutR = this.nearCut;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPosT;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nvWorldPosT = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vWorldPosT;\nuniform vec2 uCut;\nuniform float uCutR;',
        )
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
          float cutD = distance(vWorldPosT.xz, uCut);
          ${inside ? 'if (cutD > uCutR) discard;' : 'if (cutD < uCutR) discard;'}`,
        );
    };

    this.nearMat = createGroundMaterial(renderer, { simple: !q.groundDetail, patch: patch(true), set: groundSet });
    this.farMat = createGroundMaterial(renderer, { far: true, patch: patch(false), set: groundSet });

    this.forest = null; // set by the owner; receives each tile's tree list
    this.boulders = null;
    // Level shaping (see src/structures.js and src/props.js): functions
    // (x, z, field, h) => h that carve ravines, lakes and building terraces,
    // and circles that trees, rocks and grass keep out of.
    this.mods = [];
    this.blockers = new Map();
  }

  // Keep-out circles for scatter, bucketed in a 32 m grid.
  block(x, z, r) {
    const c = { x, z, r2: r * r };
    for (let gx = Math.floor((x - r) / 32); gx <= Math.floor((x + r) / 32); gx++) {
      for (let gz = Math.floor((z - r) / 32); gz <= Math.floor((z + r) / 32); gz++) {
        const key = gx * 65536 + gz;
        if (!this.blockers.has(key)) this.blockers.set(key, []);
        this.blockers.get(key).push(c);
      }
    }
  }

  blocked(x, z) {
    const list = this.blockers.get(Math.floor(x / 32) * 65536 + Math.floor(z / 32));
    if (!list) return false;
    for (const c of list) if ((x - c.x) ** 2 + (z - c.z) ** 2 < c.r2) return true;
    return false;
  }

  heightAt(x, z, coarse = false) {
    const f = this.road.field(x, z, this.field);
    return this.heightFromField(x, z, f, coarse);
  }

  heightFromField(x, z, f, coarse) {
    const e = Math.max(0, f.dist - SHOULDER);
    const k = f.uphill;
    const up = (0.9 * e * this.relief) / (1 + e / 320);
    const down = (-0.75 * e * this.relief) / (1 + e / 110);
    const base = lerp(down, up, (k + 1) * 0.5);
    const ridge = ridged(this.noise, x / 1100, z / 1100, coarse ? 4 : 5);
    const amp = smoothstep(4, 140, e) * Math.min(this.maxRelief, (12 + Math.min(e, 1600) * 0.24) * this.relief);
    const detail = fbm(this.noise2, x / 55, z / 55, 3) * smoothstep(1, 25, e) * (2 + e * 0.02);
    let h = f.roadY - 0.4 + base + (ridge - 0.3) * amp + detail;
    // Gentle ditch on the shoulder.
    if (f.dist > 4.6 && f.dist < SHOULDER + 2) h -= 0.25 * smoothstep(4.6, 5.6, f.dist);
    for (const m of this.mods) h = m(x, z, f, h);
    // Coarse tiles sit lower near the road so they never cover it far away.
    if (coarse) h -= 8 * (1 - smoothstep(30, 120, f.dist));
    return h;
  }

  // Extra ground cover at a point from the level's mods (see structures.js):
  // sand and wet sand round lakes, and scorched ground where a fire went
  // through, each 0..1. f is the road field at (x, z), h the height.
  coverAt(x, z, f, h, out = {}) {
    out.sand = 0;
    out.wet = 0;
    out.burn = 0;
    for (const m of this.mods) m.cover?.(x, z, f, h, out);
    return out;
  }

  // Ground cover at a point: rock, gravel and snow weights (0..1) plus the
  // noise values the tint uses. rel is height above the road, dist distance
  // from its centre line, ny the up component of the ground normal.
  surface(x, z, rel, dist, ny, out = {}) {
    const v = this.noise3(x / 40, z / 40) * 0.5 + 0.5;
    const v2 = this.noise3(x / 300 + 50, z / 300) * 0.5 + 0.5;
    const outcrop = smoothstep(0.62, 0.8, this.noise2(x / 90 + 7, z / 90)) * smoothstep(8, 30, dist);
    // Road cuts: the uphill bank right beside the road is blasted rock.
    const cut = smoothstep(1.5, 4, rel) * (1 - smoothstep(14, 30, dist)) * (1 - smoothstep(0.8, 0.95, ny)) * smoothstep(0.3, 0.6, v + v2 * 0.5);
    const rock = Math.min(1, 1 - smoothstep(0.62, 0.84, ny) + outcrop * 0.8 + cut);
    const snowLine = this.snowLine + this.noise3(x / 150, z / 150) * 50;
    out.v = v;
    out.v2 = v2;
    out.snow = smoothstep(snowLine, snowLine + 40, rel) * (this.snowCover ? smoothstep(0.4, 0.6, ny) : smoothstep(0.55, 0.75, ny));
    out.gravel = 1 - smoothstep(5.6, 7.6 + v * 1.5, dist);
    out.rock = rock;
    return out;
  }

  buildTile(cx, cz, size, segs, coarse) {
    const n = segs + 1;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const rel = new Float32Array(n * n);
    const dist = new Float32Array(n * n);
    const cover = new Float32Array(n * n * 3);
    const so = {};
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + cx;
      const z = pos.getZ(i) + cz;
      const f = this.road.field(x, z, this.field);
      const h = this.heightFromField(x, z, f, coarse);
      pos.setXYZ(i, x, h, z);
      rel[i] = h - f.roadY;
      dist[i] = f.dist;
      this.coverAt(x, z, f, h, so);
      cover[i * 3] = so.sand;
      cover[i * 3 + 1] = so.wet;
      cover[i * 3 + 2] = so.burn;
    }
    // Skirts are unnecessary: near/far are split by the shader cut.
    geo.computeVertexNormals();
    const nor = geo.attributes.normal;
    // Per-vertex tint (subtle brightness/hue drift) and splat weights for the
    // ground shader: x rock, y gravel, z snow, w dry grass.
    const colors = new Float32Array(pos.count * 3);
    const splat = new Float32Array(pos.count * 4);
    const sf = {};
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const { v, v2, rock, snow, gravel } = this.surface(x, z, rel[i], dist[i], nor.getY(i), sf);
      const b = 0.88 + v * 0.24;
      colors[i * 3] = b * (1.0 + (v2 - 0.5) * 0.08);
      colors[i * 3 + 1] = b;
      colors[i * 3 + 2] = b * (1.0 - (v2 - 0.5) * 0.1);
      splat[i * 4] = rock * (1 - gravel);
      splat[i * 4 + 1] = gravel;
      splat[i * 4 + 2] = snow * (1 - gravel);
      splat[i * 4 + 3] = smoothstep(0.35, 0.8, v2);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
    geo.setAttribute('cover', new THREE.BufferAttribute(cover, 3));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, coarse ? this.farMat : this.nearMat);
    mesh.receiveShadow = !coarse;
    mesh.matrixAutoUpdate = false;
    const group = new THREE.Group();
    group.add(mesh);
    if (!coarse) this.scatter(group, cx, cz, size);
    return group;
  }

  scatter(group, cx, cz, size) {
    const rand = mulberry32(((cx * 73856093) ^ (cz * 19349663)) >>> 0);
    const trees = [];
    const rocks = [];
    const sf = {};
    const spacing = this.treeSpacing;
    for (let gx = 0; gx < size / spacing; gx++) {
      for (let gz = 0; gz < size / spacing; gz++) {
        const x = cx - size / 2 + (gx + rand()) * spacing;
        const z = cz - size / 2 + (gz + rand()) * spacing;
        const forest = this.noise2(x / 140, z / 140) * 0.5 + 0.5;
        const r = rand();
        const f = this.road.field(x, z, this.field);
        if (f.dist < 7.5 || this.blocked(x, z)) continue;
        const h = this.heightFromField(x, z, f, false);
        const rel = h - f.roadY;
        // Estimate slope with a cheap finite difference.
        const hx = this.heightAt(x + 2, z);
        const hz = this.heightAt(x, z + 2);
        const slope = Math.hypot(hx - h, hz - h) / 2;
        // Rock faces get large rocks half buried in them, so cuttings and
        // crags have real relief rather than a flat textured slope. Only near
        // the road, where they are seen up close.
        if (slope > 0.5 && f.dist < 45 && this.surface(x, z, rel, f.dist, 1 / Math.hypot(1, slope), sf).rock > 0.55) {
          for (let k = rand() < 0.6 ? 1 : 0; k > 0; k--) {
            const x2 = x + (rand() - 0.5) * spacing, z2 = z + (rand() - 0.5) * spacing;
            const f2 = this.road.field(x2, z2, this.field);
            const sc = Math.min(1.4 + rand() * 2.2, (f2.dist - 5.5) * 0.6);
            if (sc < 0.5) continue;
            // Sunk deep so only a ledge or a buttress shows.
            rocks.push(x2, this.heightFromField(x2, z2, f2, false) - sc * 0.62, z2, sc, rand() * 6.28, (rand() - 0.5) * 1.2, Math.floor(rand() * 8));
          }
          continue;
        }
        if (f.dist < this.treeClear || (r > forest * 0.9 * this.treeDensity && r > 0.04)) continue;
        if (r <= 0.04 && slope < 1.2) {
          // A boulder, sometimes with a few smaller ones tumbled around it.
          const sc = 0.35 + rand() ** 2 * 1.8;
          rocks.push(x, h - sc * 0.25, z, sc, rand() * 6.28, (rand() - 0.5) * 0.4, Math.floor(rand() * 8));
          for (let k = rand() < 0.5 ? Math.floor(rand() * 4) : 0; k > 0; k--) {
            const a = rand() * 6.28;
            const d = sc * (1.3 + rand() * 1.5);
            const x2 = x + Math.cos(a) * d, z2 = z + Math.sin(a) * d;
            const s2 = sc * (0.2 + rand() * 0.35);
            rocks.push(x2, this.heightAt(x2, z2) - s2 * 0.2, z2, s2, rand() * 6.28, (rand() - 0.5) * 0.8, Math.floor(rand() * 8));
          }
          continue;
        }
        if (slope > 0.75 || rel > 200 + forest * 40) continue;
        // x, y, z, scale, yaw, variant, tint. Trees thin out and shrink towards the treeline.
        const sc = (0.55 + rand() * 0.55) * (1 - smoothstep(150, 240, rel) * 0.4);
        trees.push(x, h - 0.15, z, sc, rand() * Math.PI * 2, Math.floor(rand() * 8), rand());
      }
    }
    if (trees.length && this.forest) {
      group.userData.trees = new Float32Array(trees);
      this.forest.add(group.userData.trees);
    }
    if (rocks.length && this.boulders) {
      group.userData.rocks = new Float32Array(rocks);
      this.boulders.add(group.userData.rocks);
    }
  }

  wanted(px, pz, size, radius) {
    const tx = Math.round(px / size);
    const tz = Math.round(pz / size);
    const list = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        list.push({ key: `${tx + dx},${tz + dz}`, x: (tx + dx) * size, z: (tz + dz) * size, d: dx * dx + dz * dz });
      }
    }
    list.sort((a, b) => a.d - b.d);
    return list;
  }

  // Generate missing tiles nearest-first within a time budget (ms).
  update(px, pz, budgetMs = 6) {
    this.cutCenter.set(px, pz);
    const t0 = performance.now();
    const passes = [
      [this.near, NEAR_SIZE, this.nearSegs, this.nearRadius, false],
      [this.far, FAR_SIZE, FAR_SEGS, this.farRadius, true],
    ];
    let built = 0;
    for (const [map, size, segs, radius, coarse] of passes) {
      const want = this.wanted(px, pz, size, radius);
      const keep = new Set(want.map((w) => w.key));
      for (const [key, g] of map) {
        if (!keep.has(key)) {
          this.disposeGroup(g);
          map.delete(key);
        }
      }
      for (const w of want) {
        if (map.has(w.key)) continue;
        if (performance.now() - t0 > budgetMs && built > 0) return false;
        const g = this.buildTile(w.x, w.z, size, segs, coarse);
        this.scene.add(g);
        map.set(w.key, g);
        built++;
      }
    }
    return true;
  }

  // Drop every tile and reseed the noise, for a new road.
  // The biome's shape, with a level's own tweaks (its "terrain" block) on top.
  setShape(over = {}) {
    const g = { ...this.groundSet, ...over };
    this.relief = g.relief ?? 1;
    this.maxRelief = g.maxRelief ?? Infinity; // caps the far hills (m)
    this.snowLine = g.snowLine ?? 240;
    // Snowing (ENV.snow): white everywhere but the steepest banks.
    this.snowCover = !!g.snowCover;
    if (this.snowCover) this.snowLine = Math.min(this.snowLine, -260);
    this.treeDensity = g.treeDensity ?? 1;
    this.treeClear = g.treeClear ?? 9; // no trees closer to the road centre (m)
  }

  reset(seed, shape) {
    this.setShape(shape);
    for (const map of [this.near, this.far]) {
      for (const g of map.values()) this.disposeGroup(g);
      map.clear();
    }
    this.noise = createNoise2D(seed);
    this.noise2 = createNoise2D(seed + 1);
    this.noise3 = createNoise2D(seed + 2);
    this.mods = [];
    this.blockers.clear();
  }

  get tileCount() {
    return (this.nearRadius * 2 + 1) ** 2 + (this.farRadius * 2 + 1) ** 2;
  }

  disposeGroup(g) {
    this.scene.remove(g);
    if (g.userData.trees) this.forest?.remove(g.userData.trees);
    if (g.userData.rocks) this.boulders?.remove(g.userData.rocks);
    g.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      else if (o.isMesh) o.geometry.dispose();
    });
  }
}
